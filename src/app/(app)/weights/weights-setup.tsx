"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Notice, PageHeader } from "@/components/ui";
import { mappingSummary, unmappedAssignmentIds } from "@/lib/assignment-mapping";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { getGradeSetupCourses, saveGradeSetup } from "@/lib/grade-setup-client";
import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import { isCompleteTotal, weightTotalMessage } from "@/lib/weight-total";
import {
  canvasWeightsAvailable,
  resolveWeightPrecedence,
  syllabusReadMessage,
  type CanvasAssignment,
  type CanvasGroup,
} from "@/lib/weight-precedence";
import type { SyllabusSuggestions } from "@/lib/syllabus-client";
import { SyllabusUpload } from "@/components/syllabus/syllabus-upload";
import styles from "./weights.module.css";

type CategoryField = { name: string; weight: string };
export type FormState = {
  categories: CategoryField[];
  assignmentMappings: Record<string, string>;
  finalExamWeight: string;
  cutoffs: Record<string, string>;
  instructor: string;
  section: string;
  credits: string;
};

const DEFAULT_CUTOFFS = { A: "90", B: "80", C: "70", D: "60", F: "0" };

function blankForm(): FormState {
  return {
    categories: [{ name: "Homework", weight: "100" }],
    assignmentMappings: {},
    finalExamWeight: "0",
    cutoffs: { ...DEFAULT_CUTOFFS },
    instructor: "",
    section: "",
    credits: "",
  };
}

function numberValue(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function formForCourse(course: GradeSetupCourse): FormState {
  const saved = course.gradeSetup;
  if (saved) {
    return {
      categories: saved.categories.map((category) => ({
        name: category.name,
        weight: String(category.weight),
      })),
      assignmentMappings: Object.fromEntries(
        saved.assignmentMappings.map((mapping) => [mapping.assignmentId, mapping.category]),
      ),
      finalExamWeight: String(saved.finalExamWeight),
    // A syllabus may state only some cutoff labels, so suggestions merge over the current
    // ones and no known label is lost.
    cutoffs: Object.fromEntries(
        Object.entries(saved.cutoffs).map(([label, cutoff]) => [label, String(cutoff)]),
      ),
      instructor: typeof saved.classDetails.instructor === "string" ? saved.classDetails.instructor : "",
      section: typeof saved.classDetails.section === "string" ? saved.classDetails.section : "",
      credits:
        typeof saved.classDetails.credits === "number" ? String(saved.classDetails.credits) : "",
    };
  }

  const categories = course.assignmentGroups
    .filter((group) => group.groupWeight !== null)
    .map((group) => ({ name: group.name, weight: String(group.groupWeight) }));
  if (categories.length === 0) {
    const form = blankForm();
    form.assignmentMappings = Object.fromEntries(
      course.assignments.map((assignment) => [assignment.id, form.categories[0].name]),
    );
    return form;
  }

  const categoryNames = new Set(categories.map((category) => category.name.toLowerCase()));
  const assignmentMappings = Object.fromEntries(
    course.assignments
      .filter(
        (assignment) =>
          assignment.assignmentGroup &&
          categoryNames.has(assignment.assignmentGroup.name.toLowerCase()),
      )
      .map((assignment) => [assignment.id, assignment.assignmentGroup!.name]),
  );
  const categoryTotal = categories.reduce((sum, category) => sum + numberValue(category.weight), 0);
  return {
    categories,
    assignmentMappings,
    finalExamWeight: String(Math.max(0, 100 - categoryTotal)),
    cutoffs: { ...DEFAULT_CUTOFFS },
    instructor: "",
    section: "",
    credits: "",
  };
}

function firstInstructorContactIndex(contacts: SyllabusSuggestions["contacts"]): number {
  for (let index = 0; index < contacts.length; index++) {
    const contact = contacts[index];
    if (
      contact.role !== null &&
      /instructor/i.test(contact.role) &&
      contact.name !== null &&
      contact.name.trim() !== ""
    ) {
      return index;
    }
  }
  return -1;
}

// Fills the suggested grading rules into the form state. A fact the syllabus did not state
// leaves the form's value alone: a missing suggestion is "did not say", not a default.
// PR-39: the professor's Canvas group weights outrank a syllabus read. resolveWeightPrecedence
// keeps every weight Canvas already provides and lets the syllabus fill only what Canvas
// leaves out; the syllabus replaces the categories wholesale only when Canvas has none.
function applySyllabusSuggestionsWithOutcome(
  current: FormState,
  suggestions: SyllabusSuggestions,
  canvasGroups: CanvasGroup[],
  canvasAssignments: CanvasAssignment[]
): { form: FormState; canvasKept: boolean } {
  const resolved = resolveWeightPrecedence({
    current: {
      categories: current.categories,
      assignmentMappings: current.assignmentMappings,
      finalExamWeight: current.finalExamWeight,
    },
    suggestedCategories: suggestions.categories,
    suggestedFinalExamWeight: suggestions.finalExamWeight,
    canvasGroups,
    canvasAssignments,
  });
  const instructorIndex = firstInstructorContactIndex(suggestions.contacts);
  return {
    form: {
      categories: resolved.categories,
      assignmentMappings: resolved.assignmentMappings,
      finalExamWeight: resolved.finalExamWeight,
      cutoffs: Object.fromEntries(
        Object.entries({ ...current.cutoffs, ...suggestions.cutoffs }).map(([label, value]) => [
          label,
          String(value),
        ]),
      ),
      instructor:
        current.instructor.trim() === "" && instructorIndex !== -1
          ? (suggestions.contacts[instructorIndex].name ?? "").trim()
          : current.instructor,
      section: current.section,
      credits: current.credits,
    },
    canvasKept: resolved.canvasKept,
  };
}

export function applySyllabusSuggestions(
  current: FormState,
  suggestions: SyllabusSuggestions,
  canvasGroups: CanvasGroup[] = [],
  canvasAssignments: CanvasAssignment[] = []
): FormState {
  return applySyllabusSuggestionsWithOutcome(current, suggestions, canvasGroups, canvasAssignments)
    .form;
}

export type SyllabusReadExtras = {
  unsupportedRules: string[];
  latePolicy: string | null;
  officeHours: string | null;
  contacts: SyllabusSuggestions["contacts"];
};

// The form changes plus the review-only parts of the last read — unsupported rules, late
// policy, office hours, and every suggested contact including the one whose name was
// auto-filled as the instructor. Held in component state for review before confirming;
// nothing is saved. Returns null when the read is for a course that is no longer selected,
// so a late reply cannot populate another class's form.
export function applySyllabusRead(
  courseId: string,
  selectedCourseId: string,
  form: FormState,
  suggestions: SyllabusSuggestions,
  canvasGroups: CanvasGroup[] = [],
  canvasAssignments: CanvasAssignment[] = []
): { form: FormState; extras: SyllabusReadExtras | null; canvasKept: boolean } | null {
  if (courseId !== selectedCourseId) {
    return null;
  }
  const { form: nextForm, canvasKept } = applySyllabusSuggestionsWithOutcome(
    form,
    suggestions,
    canvasGroups,
    canvasAssignments
  );
  const extras: SyllabusReadExtras = {
    unsupportedRules: suggestions.unsupportedRules,
    latePolicy: suggestions.latePolicy,
    officeHours: suggestions.officeHours,
    contacts: suggestions.contacts,
  };
  const hasExtras =
    extras.unsupportedRules.length > 0 ||
    extras.latePolicy !== null ||
    extras.officeHours !== null ||
    extras.contacts.length > 0;
  return { form: nextForm, extras: hasExtras ? extras : null, canvasKept };
}

export function WeightsSetup({ initialCourses }: { initialCourses?: GradeSetupCourse[] } = {}) {
  const [courses, setCourses] = useState<GradeSetupCourse[]>(initialCourses ?? []);
  const [selectedCourseId, setSelectedCourseId] = useState(initialCourses?.[0]?.id ?? "");
  const [state, setState] = useState<"loading" | "ready" | "error">(
    initialCourses ? "ready" : "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    initialCourses?.[0] ? formForCourse(initialCourses[0]) : blankForm(),
  );
  const [manualMode, setManualMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const hasCanvasWeights = selectedCourse
    ? canvasWeightsAvailable(selectedCourse.assignmentGroups)
    : false;
  const showForm = Boolean(selectedCourse && (selectedCourse.gradeSetup || !hasCanvasWeights || manualMode));
  const totalWeight = useMemo(
    () =>
      form.categories.reduce((sum, category) => {
        const weight = numberValue(category.weight);
        return sum + (Number.isFinite(weight) ? weight : 0);
      }, numberValue(form.finalExamWeight) || 0),
    [form.categories, form.finalExamWeight],
  );

  const unmappedIds = useMemo(
    () =>
      new Set(
        selectedCourse
          ? unmappedAssignmentIds(
              selectedCourse.assignments,
              form.assignmentMappings,
              form.categories.map((category) => category.name),
            )
          : [],
      ),
    [selectedCourse, form.assignmentMappings, form.categories],
  );

  useEffect(() => {
    // initialCourses is for rendering the preloaded state in tests, so there is nothing to fetch.
    if (initialCourses) {
      return;
    }
    let cancelled = false;
    getGradeSetupCourses().then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.error);
        setState("error");
        return;
      }
      setCourses(result.data.courses);
      setSelectedCourseId(result.data.courses[0]?.id ?? "");
      if (result.data.courses[0]) {
        setForm(formForCourse(result.data.courses[0]));
      }
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [initialCourses]);

  // Kept in an effect rather than during render. A syllabus read's callback fires from an
  // event, after any committed change, so the refs are current even for a long-old request.
  const selectedCourseIdRef = useRef(selectedCourseId);
  const selectedCourseRef = useRef(selectedCourse);
  const formRef = useRef(form);
  useEffect(() => {
    selectedCourseIdRef.current = selectedCourseId;
    selectedCourseRef.current = selectedCourse;
    formRef.current = form;
  }, [selectedCourseId, selectedCourse, form]);
  const [readExtras, setReadExtras] = useState<SyllabusReadExtras | null>(null);

  function handleSyllabusRead(courseId: string, suggestions: SyllabusSuggestions) {
    // A read for a course the student already left must not touch the new course's form.
    if (courseId !== selectedCourseIdRef.current) {
      return;
    }
    const selectedCourse = selectedCourseRef.current;
    const read = applySyllabusRead(
      courseId,
      selectedCourseIdRef.current,
      formRef.current,
      suggestions,
      selectedCourse?.assignmentGroups ?? [],
      selectedCourse?.assignments.map((assignment) => ({
        id: assignment.id,
        groupName: assignment.assignmentGroup?.name ?? null,
      })) ?? []
    );
    if (read === null) {
      return;
    }
    setManualMode(true);
    setForm(read.form);
    setReadExtras(read.extras);
    setMessage({ tone: "success", text: syllabusReadMessage(read.canvasKept) });
  }

  function updateCategory(index: number, field: keyof CategoryField, value: string) {
    setForm((current) => {
      const categories = current.categories.map((category, categoryIndex) =>
        categoryIndex === index ? { ...category, [field]: value } : category,
      );
      let assignmentMappings = current.assignmentMappings;
      if (field === "name") {
        const previousName = current.categories[index].name;
        assignmentMappings = Object.fromEntries(
          Object.entries(current.assignmentMappings).map(([assignmentId, categoryName]) => [
            assignmentId,
            categoryName === previousName ? value : categoryName,
          ]),
        );
      }
      return { ...current, categories, assignmentMappings };
    });
    setMessage(null);
  }

  function updateMapping(assignmentId: string, category: string) {
    setForm((current) => ({
      ...current,
      assignmentMappings: { ...current.assignmentMappings, [assignmentId]: category },
    }));
    setMessage(null);
  }

  function buildPayload(): GradeSetupPayload | null {
    if (!selectedCourse) {
      return null;
    }
    const categories = form.categories.map((category) => ({
      name: category.name.trim(),
      weight: numberValue(category.weight),
    }));
    const finalExamWeight = numberValue(form.finalExamWeight);
    if (
      categories.some(
        (category) =>
          category.name.length === 0 ||
          !Number.isFinite(category.weight) ||
          category.weight < 0 ||
          category.weight > 100,
      )
    ) {
      setMessage({ tone: "error", text: "Enter a name and a weight from 0 to 100 for each category." });
      return null;
    }
    if (new Set(categories.map((category) => category.name.toLowerCase())).size !== categories.length) {
      setMessage({ tone: "error", text: "Category names must be unique." });
      return null;
    }
    if (!Number.isFinite(finalExamWeight) || finalExamWeight < 0 || finalExamWeight > 100) {
      setMessage({ tone: "error", text: "The final exam weight must be from 0 to 100." });
      return null;
    }
    if (Math.abs(categories.reduce((sum, category) => sum + category.weight, finalExamWeight) - 100) > 0.001) {
      setMessage({ tone: "error", text: "Category weights and the final exam weight must add up to 100." });
      return null;
    }
    const assignmentMappings = selectedCourse.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      category: form.assignmentMappings[assignment.id] ?? "",
    }));
    if (assignmentMappings.some((mapping) => !categories.some((category) => category.name === mapping.category))) {
      setMessage({ tone: "error", text: "Map every assignment to a category before confirming." });
      return null;
    }
    const cutoffs: Record<string, number> = {};
    for (const [label, value] of Object.entries(form.cutoffs)) {
      const cutoff = numberValue(value);
      if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 100) {
        setMessage({ tone: "error", text: "Enter grade cutoffs from 0 to 100." });
        return null;
      }
      cutoffs[label] = cutoff;
    }
    const credits = form.credits.trim() === "" ? null : numberValue(form.credits);
    if (credits !== null && (!Number.isFinite(credits) || credits < 0)) {
      setMessage({ tone: "error", text: "Credits must be zero or greater." });
      return null;
    }
    return {
      categories,
      assignmentMappings,
      finalExamWeight,
      cutoffs,
      classDetails: { instructor: form.instructor.trim(), section: form.section.trim(), credits },
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = buildPayload();
    if (!payload || !selectedCourse) {
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await saveGradeSetup(selectedCourse.id, payload);
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    const savedCourse = {
      ...selectedCourse,
      gradeSetup: { ...payload, confirmedAt: result.data.confirmedAt },
    };
    setCourses((current) => current.map((course) => (course.id === savedCourse.id ? savedCourse : course)));
    setMessage({ tone: "success", text: "Your grade setup is confirmed and saved." });
  }

  return (
    <>
      <PageHeader
        eyebrow="Grade weights"
        title="Weights"
        description="Set up each class using its syllabus, Canvas weights, or your own categories."
      />

      {state === "loading" ? <p className={styles.status} role="status">Loading your classes…</p> : null}
      {state === "error" ? <Notice tone="error">{loadError}</Notice> : null}
      {state === "ready" && courses.length === 0 ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>No current classes yet</h2>
          <p className={styles.emptyDescription}>Import your current Canvas classes to set up their grade weights.</p>
        </div>
      ) : null}

      {courses.length > 0 ? (
        <section className={styles.setup} aria-label="Course grade setup">
          <div className={styles.coursePicker}>
            <label className={styles.label} htmlFor="weight-course">Class</label>
            <select
              className={styles.select}
              id="weight-course"
              value={selectedCourseId}
              onChange={(event) => {
                const courseId = event.target.value;
                const course = courses.find((item) => item.id === courseId);
                setSelectedCourseId(courseId);
                if (course) {
                  setForm(formForCourse(course));
                }
                setManualMode(false);
                setMessage(null);
                setReadExtras(null);
              }}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}{course.courseCode ? ` (${course.courseCode})` : ""}
                </option>
              ))}
            </select>
          </div>

          {selectedCourse ? (
            <SyllabusUpload key={selectedCourse.id} course={selectedCourse} onRead={handleSyllabusRead} />
          ) : null}

          {selectedCourse && hasCanvasWeights && !selectedCourse.gradeSetup && !manualMode ? (
            <div className={styles.canvasWeights}>
              <h2 className={styles.sectionTitle}>Canvas category weights</h2>
              <ul className={styles.weightList}>
                {selectedCourse.assignmentGroups.map((group) => (
                  <li key={group.name}><span>{group.name}</span><span>{group.groupWeight}%</span></li>
                ))}
              </ul>
              <Button onClick={() => setManualMode(true)}>Enter weights manually</Button>
            </div>
          ) : null}

          {showForm && selectedCourse ? (
            <form className={styles.form} onSubmit={handleSubmit}>
              {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
              <div className={styles.formHeading}>
                <h2 className={styles.sectionTitle}>
                  {selectedCourse.gradeSetup ? "Edit confirmed setup" : "Set up weights manually"}
                </h2>
                <p className={styles.description}>
                  Add every assignment to a category. Category weights and the final exam must total 100%.
                </p>
              </div>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Categories</legend>
                {form.categories.map((category, index) => (
                  <div className={styles.categoryRow} key={`category-${index}`}>
                    <Input
                      label={`Category ${index + 1}`}
                      value={category.name}
                      onChange={(event) => updateCategory(index, "name", event.target.value)}
                      required
                    />
                    <Input
                      label="Weight (%)"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={category.weight}
                      onChange={(event) => updateCategory(index, "weight", event.target.value)}
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${category.name || `category ${index + 1}`}`}
                      disabled={form.categories.length === 1}
                      onClick={() => {
                        const removedName = category.name;
                        setForm((current) => ({
                          ...current,
                          categories: current.categories.filter((_, categoryIndex) => categoryIndex !== index),
                          assignmentMappings: Object.fromEntries(
                            Object.entries(current.assignmentMappings).map(([assignmentId, categoryName]) => [
                              assignmentId,
                              categoryName === removedName ? "" : categoryName,
                            ]),
                          ),
                        }));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      categories: [...current.categories, { name: "", weight: "0" }],
                    }))
                  }
                >
                  Add category
                </Button>
              </fieldset>

              <Input
                label="Final exam weight (%)"
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.finalExamWeight}
                onChange={(event) => setForm((current) => ({ ...current, finalExamWeight: event.target.value }))}
                required
              />
              <p className={isCompleteTotal(totalWeight) ? styles.totalValid : styles.totalInvalid} role="status">
                {weightTotalMessage(totalWeight)}
              </p>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Assignment categories</legend>
                {selectedCourse.assignments.length === 0 ? (
                  <p className={styles.description}>No imported assignments yet. You can confirm categories now and map assignments after syncing Canvas.</p>
                ) : (
                  <>
                    <p
                      className={unmappedIds.size > 0 ? styles.mappingSummaryWarn : styles.mappingSummaryDone}
                      role="status"
                    >
                      {mappingSummary(selectedCourse.assignments.length, unmappedIds.size)}
                    </p>
                    {selectedCourse.assignments.map((assignment) => {
                      const unmapped = unmappedIds.has(assignment.id);
                      const noteId = `assignment-${assignment.id}-note`;
                      return (
                        <div
                          className={unmapped ? `${styles.mappingRow} ${styles.unmapped}` : styles.mappingRow}
                          key={assignment.id}
                        >
                          <div className={styles.mappingText}>
                            <label className={styles.label} htmlFor={`assignment-${assignment.id}`}>{assignment.title}</label>
                            {unmapped ? (
                              <span id={noteId} className={styles.needsCategory}>Needs a category</span>
                            ) : null}
                          </div>
                          <select
                            className={unmapped ? `${styles.select} ${styles.selectUnmapped}` : styles.select}
                            id={`assignment-${assignment.id}`}
                            value={form.assignmentMappings[assignment.id] ?? ""}
                            onChange={(event) => updateMapping(assignment.id, event.target.value)}
                            aria-invalid={unmapped ? true : undefined}
                            aria-describedby={unmapped ? noteId : undefined}
                            required
                          >
                            <option value="">Choose a category</option>
                            {form.categories.filter((item) => item.name.trim()).map((item, index) => (
                              <option key={`${item.name}-${index}`} value={item.name}>{item.name}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </>
                )}
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Grade cutoffs (%)</legend>
                <div className={styles.cutoffGrid}>
                  {Object.entries(form.cutoffs).map(([label, cutoff]) => (
                    <Input
                      key={label}
                      label={label}
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={cutoff}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          cutoffs: { ...current.cutoffs, [label]: event.target.value },
                        }))
                      }
                      required
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Class details</legend>
                <div className={styles.detailGrid}>
                  <Input
                    label="Instructor"
                    value={form.instructor}
                    onChange={(event) => setForm((current) => ({ ...current, instructor: event.target.value }))}
                  />
                  <Input
                    label="Section"
                    value={form.section}
                    onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))}
                  />
                  <Input
                    label="Credits"
                    type="number"
                    min="0"
                    step="any"
                    value={form.credits}
                    onChange={(event) => setForm((current) => ({ ...current, credits: event.target.value }))}
                  />
                </div>
              </fieldset>

              <div className={styles.actions}>
                <Button type="submit" loading={saving}>
                  {saving ? "Saving setup…" : "Confirm and save"}
                </Button>
                {manualMode && hasCanvasWeights && !selectedCourse.gradeSetup ? (
                  <Button type="button" variant="ghost" onClick={() => setManualMode(false)}>
                    Use Canvas weights
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}

          {readExtras ? (
            <section className={styles.canvasWeights} aria-label="What the syllabus also said">
              <h2 className={styles.sectionTitle}>What the syllabus also said</h2>
              {readExtras.unsupportedRules.length > 0 ? (
                <>
                  <Notice tone="error">
                    The syllabus has grading rules Priority cannot calculate automatically. Account for these
                    yourself when you check your grades:
                  </Notice>
                  <ul className={styles.weightList}>
                    {readExtras.unsupportedRules.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {readExtras.latePolicy ? <p className={styles.description}>Late policy: {readExtras.latePolicy}</p> : null}
              {readExtras.officeHours ? (
                <p className={styles.description}>Office hours: {readExtras.officeHours}</p>
              ) : null}
              {readExtras.contacts.map((contact) => (
                <p
                  className={styles.description}
                  key={`${contact.name ?? ""}-${contact.email ?? ""}`}
                >
                  {[
                    contact.name ?? null,
                    contact.role ?? null,
                    contact.email ?? null,
                  ]
                    .filter((part) => part !== null)
                    .join(" \u2014 ")}
                </p>
              ))}
            </section>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
