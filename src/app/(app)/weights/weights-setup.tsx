"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Notice, PageHeader } from "@/components/ui";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { getGradeSetupCourses, saveGradeSetup } from "@/lib/grade-setup-client";
import { isCompleteTotal, weightTotalMessage } from "@/lib/weight-total";
import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import styles from "./weights.module.css";

type CategoryField = { name: string; weight: string };
type FormState = {
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

function canvasWeightsAvailable(course: GradeSetupCourse) {
  const groups = course.assignmentGroups;
  return (
    groups.length > 0 &&
    groups.every((group) => group.groupWeight !== null && Number.isFinite(group.groupWeight)) &&
    Math.abs(groups.reduce((sum, group) => sum + (group.groupWeight ?? 0), 0) - 100) <= 0.001
  );
}

export function WeightsSetup() {
  const [courses, setCourses] = useState<GradeSetupCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
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

  useEffect(() => {
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
  }, []);

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
              }}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}{course.courseCode ? ` (${course.courseCode})` : ""}
                </option>
              ))}
            </select>
          </div>

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
                  selectedCourse.assignments.map((assignment) => (
                    <div className={styles.mappingRow} key={assignment.id}>
                      <label className={styles.label} htmlFor={`assignment-${assignment.id}`}>{assignment.title}</label>
                      <select
                        className={styles.select}
                        id={`assignment-${assignment.id}`}
                        value={form.assignmentMappings[assignment.id] ?? ""}
                        onChange={(event) => updateMapping(assignment.id, event.target.value)}
                        required
                      >
                        <option value="">Choose a category</option>
                        {form.categories.filter((item) => item.name.trim()).map((item, index) => (
                          <option key={`${item.name}-${index}`} value={item.name}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                  ))
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
        </section>
      ) : null}
    </>
  );
}
