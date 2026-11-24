import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

type Base = { label: string; hint?: ReactNode; error?: string | null };

/** Labelled input in the V2.1 style (warm field, 16px radius, crisp ink + lime focus ring). */
export function TextField({ label, hint, error, className, id, ...rest }: Base & InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = id ?? `f-${label.replace(/\s+/g, "-")}`;
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <input id={fieldId} className={styles.input} aria-invalid={error ? true : undefined} {...rest} />
      {error ? <p className={styles.error}>{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

export function TextArea({ label, hint, error, className, id, ...rest }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fieldId = id ?? `f-${label.replace(/\s+/g, "-")}`;
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <textarea id={fieldId} className={`${styles.input} ${styles.area}`} aria-invalid={error ? true : undefined} {...rest} />
      {error ? <p className={styles.error}>{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

export function SelectField({ label, hint, error, className, id, children, ...rest }: Base & SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = id ?? `f-${label.replace(/\s+/g, "-")}`;
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <select id={fieldId} className={styles.input} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
      {error ? <p className={styles.error}>{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
