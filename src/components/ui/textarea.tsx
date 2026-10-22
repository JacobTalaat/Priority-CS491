import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import styles from "./input.module.css";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

// Multi-line version of Input with the same label, hint, and error wiring.
export function TextArea({ label, hint, error, id, className, rows = 3, ...props }: TextAreaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        {...props}
        id={fieldId}
        rows={rows}
        className={[styles.input, styles.textarea, error ? styles.invalid : null, className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
      />
      {error ? (
        <p id={messageId} className={styles.error}>
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
