"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Notice, PageHeader, TextArea } from "@/components/ui";
import { mappingSummary, unmappedAssignmentIds } from "@/lib/assignment-mapping";
import { detailText, detailValue, formatContacts } from "@/lib/class-details";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { getGradeSetupCourses, saveGradeSetup } from "@/lib/grade-setup-client";
import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import { isCompleteTotal, weightTotalMessage } from "@/lib/weight-total";
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
  officeHours: string;
  latePolicy: string;
  contacts: string;
  // The assignment that is the final exam, for the final exam tool; "" when there isn't one.
  finalExamAssignmentId: string;
};

// Class details the syllabus reader can fill in, shown with a "from your syllabus" hint.
type ReadDetailField = "instructor" | "officeHours" | "latePolicy" | "contacts";
const READ_DETAIL_FIELDS: ReadDetailField[] = ["instructor", "officeHours", "latePolicy", "contacts"];

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
    officeHours: "",
    latePolicy: "",
    contacts: "",
    finalExamAssignmentId: "",
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
      cutoffs: Object.fromEntries(
        Object.entries(saved.cutoffs).map(([label, cutoff]) => [label, String(cutoff)]),
      ),
      instructor: typeof saved.classDetails.instructor === "string" ? saved.classDetails.instructor : "",
      section: typeof saved.classDetails.section === "string" ? saved.classDetails.section : "",
      credits:
        typeof saved.classDetails.credits === "number" ? String(saved.classDetails.credits) : "",
      officeHours: detailText(saved.classDetails, "officeHours"),
      latePolicy: detailText(saved.classDetails, "latePolicy"),
      contacts: detailText(saved.classDetails, "contacts"),
      finalExamAssignmentId: detailText(saved.classDetails, "finalExamAssignmentId"),
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
    officeHours: "",
    latePolicy: "",
    contacts: "",
    finalExamAssignmentId: "",
  };
}

function canvasWeightsAvailable(course: GradeSetupCourse) {
  const groups = course.assignmentGroups;
  return (
    groups.length > 0 &&
    groups.every((group) => group.groupWeight !== null && Number.isFinite(group.groupWeight)) &&
    Math.abs(groups.reduce((sum, group) => sum + (group.groupWeight ?? 0), 0) - 100) <= 0.001
  );
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
// PR-39 owns whether Canvas weights should win over an explicitly requested syllabus read.
export function applySyllabusSuggestions(
  current: FormState,
  suggestions: SyllabusSuggestions
): FormState {
  const categories =
    suggestions.categories.length > 0
      ? suggestions.categories.map((suggested) => ({
          name: suggested.name,
          weight: suggested.weight === null ? "" : String(suggested.weight),
        }))
      : current.categories;
  const exactNameBySuggestedName = new Map<string, string>();
  for (const category of categories) {
    exactNameBySuggestedName.set(category.name.trim().toLowerCase(), category.name);
  }
  // buildPayload compares mapping values to category names exactly, so a mapping kept by
  // case-insensitive name is rewritten to the suggested category's exact name.
  const assignmentMappings = Object.fromEntries(
    Object.entries(current.assignmentMappings)
      .filter(([, categoryName]) => exactNameBySuggestedName.has(categoryName.trim().toLowerCase()))
      .map(([assignmentId, categoryName]) => [
        assignmentId,
        exactNameBySuggestedName.get(categoryName.trim().toLowerCase()) ?? "",
      ]),
  );
  const instructorIndex = firstInstructorContactIndex(suggestions.contacts);
  return {
    categories,
    assignmentMappings,
    finalExamWeight:
      suggestions.finalExamWeight === null
        ? current.finalExamWeight
        : String(suggestions.finalExamWeight),
    // A syllabus may state only some cutoff labels, so suggestions merge over the current
    // ones and no known label is lost.
    cutoffs: Object.fromEntries(
      Object.entries({ ...current.cutoffs, ...suggestions.cutoffs }).map(([label, value]) => [
        label,
        String(value),
      ]),
    ),

    // Details only fill empty fields, so a read never overwrites what the student typed.
    instructor:
      current.instructor.trim() === "" && instructorIndex !== -1
        ? (suggestions.contacts[instructorIndex].name ?? "").trim()
        : current.instructor,
    section: current.section,
    credits: current.credits,
    officeHours:
      current.officeHours.trim() === "" && suggestions.officeHours !== null
        ? suggestions.officeHours
        : current.officeHours,
    latePolicy:
      current.latePolicy.trim() === "" && suggestions.latePolicy !== null
        ? suggestions.latePolicy
        : current.latePolicy,
    contacts: current.contacts.trim() === "" ? formatContacts(suggestions.contacts) || current.contacts : current.contacts,
    finalExamAssignmentId: current.finalExamAssignmentId,
  };
}

// Which class details a read filled in, so the form can point them out for checking.
export function detailsFilledByRead(before: FormState, after: FormState): ReadDetailField[] {
  return READ_DETAIL_FIELDS.filter((field) => before[field] !== after[field]);
}

export type SyllabusReadExtras = {
  unsupportedRules: string[];
  latePolicy: string | null;
  officeHours: string | null;
  contacts: SyllabusSuggestions["contacts"];
};

// The form changes plus everything else the last read found. Late policy, office hours, and
// contacts also land in the form's class details (when empty), where the student can edit
// them; unsupported rules stay review-only. Nothing is saved until the student confirms.
// Returns null when the read is for a course that is no longer selected, so a late reply
// cannot populate another class's form.
export function applySyllabusRead(
  courseId: string,
  selectedCourseId: string,
  form: FormState,
  suggestions: SyllabusSuggestions
): { form: FormState; extras: SyllabusReadExtras | null } | null {
  if (courseId !== selectedCourseId) {
    return null;
  }
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
  return { form: applySyllabusSuggestions(form, suggestions), extras: hasExtras ? extras : null };
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
  const hasCanvasWeights = selectedCourse ? canvasWeightsAvailable(selectedCourse) : false;
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
  const formRef = useRef(form);
  useEffect(() => {
    selectedCourseIdRef.current = selectedCourseId;
    formRef.current = form;
  }, [selectedCourseId, form]);
  const [readExtras, setReadExtras] = useState<SyllabusReadExtras | null>(null);
  const [filledByRead, setFilledByRead] = useState<ReadDetailField[]>([]);

  function updateDetail(field: ReadDetailField | "section" | "credits", value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    // Once the student edits a filled-in detail, it's theirs and no longer needs the hint.
    setFilledByRead((current) => current.filter((item) => item !== field));
  }

  function detailHint(field: ReadDetailField, fallback?: string) {
    return filledByRead.includes(field) ? "Filled in from your syllabus. Check it before you confirm." : fallback;
  }

  function handleSyllabusRead(courseId: string, suggestions: SyllabusSuggestions) {
    // A read for a course the student already left must not touch the new course's form.
    if (courseId !== selectedCourseIdRef.current) {
      return;
    }
    const read = applySyllabusRead(courseId, selectedCourseIdRef.current, formRef.current, suggestions);
    if (read === null) {
      return;
    }
    setManualMode(true);
    setFilledByRead(detailsFilledByRead(formRef.current, read.form));
    setForm(read.form);
    setReadExtras(read.extras);
    setMessage({
      tone: "success",
      text: "The AI's suggestions are filled in below. Nothing is saved until you confirm them.",
    });
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
      classDetails: {
        instructor: form.instructor.trim(),
        section: form.section.trim(),
        credits,
        // Saved under the keys GET /api/courses/[courseId] reads, as plain strings or null.
        officeHours: detailValue(form.officeHours),
        latePolicy: detailValue(form.latePolicy),
        contacts: detailValue(form.contacts),
        // Only a current assignment counts; one removed from Canvas since is saved as none.
        finalExamAssignmentId: selectedCourse.assignments.some(
          (assignment) => assignment.id === form.finalExamAssignmentId,
        )
          ? form.finalExamAssignmentId
          : null,
      },
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
                setFilledByRead([]);
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
              <div className={styles.coursePicker}>
                <label className={styles.label} htmlFor="final-exam-assignment">Final exam</label>
                <select
                  className={styles.select}
                  id="final-exam-assignment"
                  value={
                    selectedCourse.assignments.some((assignment) => assignment.id === form.finalExamAssignmentId)
                      ? form.finalExamAssignmentId
                      : ""
                  }
                  onChange={(event) =>
                    setForm((current) => ({ ...current, finalExamAssignmentId: event.target.value }))
                  }
                  aria-describedby="final-exam-assignment-hint"
                >
                  <option value="">No final exam in this class</option>
                  {selectedCourse.assignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>{assignment.title}</option>
                  ))}
                </select>
                <p className={styles.description} id="final-exam-assignment-hint">
                  Pick the assignment that is your final, so Priority can show the score you need on it.
                </p>
              </div>
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
                    onChange={(event) => updateDetail("instructor", event.target.value)}
                    hint={detailHint("instructor")}
                  />
                  <Input
                    label="Section"
                    value={form.section}
                    onChange={(event) => updateDetail("section", event.target.value)}
                  />
                  <Input
                    label="Credits"
                    type="number"
                    min="0"
                    step="any"
                    value={form.credits}
                    onChange={(event) => updateDetail("credits", event.target.value)}
                  />
                </div>
                <Input
                  label="Office hours"
                  value={form.officeHours}
                  onChange={(event) => updateDetail("officeHours", event.target.value)}
                  hint={detailHint("officeHours")}
                />
                <TextArea
                  label="Late policy"
                  value={form.latePolicy}
                  onChange={(event) => updateDetail("latePolicy", event.target.value)}
                  hint={detailHint("latePolicy")}
                />
                <TextArea
                  label="Contacts"
                  value={form.contacts}
                  onChange={(event) => updateDetail("contacts", event.target.value)}
                  hint={detailHint("contacts", "Name, role, and email. Separate people with semicolons.")}
                />
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

          {readExtras && readExtras.unsupportedRules.length > 0 ? (
            <section className={styles.canvasWeights} aria-label="What the syllabus also said">
              <h2 className={styles.sectionTitle}>What the syllabus also said</h2>
              <Notice tone="error">
                The syllabus has grading rules Priority cannot calculate automatically. Account for these
                yourself when you check your grades:
              </Notice>
              <ul className={styles.weightList}>
                {readExtras.unsupportedRules.map((rule, index) => (
                  // The AI can repeat a rule, so the text alone isn't a unique key.
                  <li key={`${index}-${rule}`}>{rule}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
