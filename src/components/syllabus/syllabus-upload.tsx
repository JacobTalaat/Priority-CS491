"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Button, Notice } from "@/components/ui";
import { NOT_READ, uploadSyllabus, validateSyllabusFile } from "@/lib/syllabus-client";
import type { SyllabusSuggestions } from "@/lib/syllabus-client";
import styles from "./syllabus-upload.module.css";

type SyllabusUploadProps = {
  // The class picked on the Weights tab. Render with key={course.id} to reset on change.
  course: { id: string; name: string; courseCode: string | null };
  // Hands the AI's suggestions to the weights form. Nothing is saved here.
  onRead?: (courseId: string, suggestions: SyllabusSuggestions) => void;
};

export function SyllabusUpload({ course, onRead }: SyllabusUploadProps) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const error = validateSyllabusFile(file);
    setFileError(error);
    if (error || !file) {
      return;
    }

    setReading(true);
    const result = await uploadSyllabus(course.id, file);
    setReading(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    if (result.suggestions === null) {
      setMessage({ tone: "error", text: result.suggestionsError ?? NOT_READ });
      return;
    }
    setMessage({ tone: "success", text: "Read your syllabus. Check every suggestion below before you confirm." });
    onRead?.(course.id, result.suggestions);
  }

  const fileFieldId = `${id}-file`;
  const disclosureId = `${id}-disclosure`;
  const label = course.courseCode ?? course.name;

  return (
    <section className={styles.panel} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        Read the {label} syllabus
      </h2>

      <p id={disclosureId} className={styles.disclosure}>
        <strong>Uses AI.</strong> Priority saves your syllabus text and sends it to an AI service to suggest your
        categories, weights, and cutoffs. It can make mistakes, and your weights are not saved until you check and
        confirm them.
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate aria-describedby={disclosureId}>
        <div className={styles.field}>
          <label htmlFor={fileFieldId} className={styles.label}>
            Syllabus PDF
          </label>
          <input
            id={fileFieldId}
            className={fileError ? `${styles.control} ${styles.file} ${styles.invalid}` : `${styles.control} ${styles.file}`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFileError(null);
            }}
            disabled={reading}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? `${fileFieldId}-error` : `${fileFieldId}-hint`}
          />
          {fileError ? (
            <p id={`${fileFieldId}-error`} className={styles.error}>
              {fileError}
            </p>
          ) : (
            <p id={`${fileFieldId}-hint`} className={styles.hint}>
              PDF only, up to 10 MB. Scanned pages can&apos;t be read.
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button type="submit" loading={reading}>
            {reading ? "Reading syllabus…" : "Read syllabus"}
          </Button>
          {reading ? (
            <p className={styles.reading} role="status">
              The AI is reading your syllabus. This can take up to a minute.
            </p>
          ) : null}
        </div>
      </form>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}
