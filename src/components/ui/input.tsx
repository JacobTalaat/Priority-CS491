import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import styles from "./input.module.css";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  // The error replaces the hint so the field only ever has one line of help under it.
  const messageId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        className={[styles.input, error ? styles.invalid : null, className].filter(Boolean).join(" ")}
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
