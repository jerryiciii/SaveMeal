import type { InputHTMLAttributes } from "react";
import { Icon } from "./Icon";
import styles from "./SearchField.module.css";

/** Search field from Figma V1 01 (2:56). */
type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: string };

export function SearchField({ label = "Tìm món ăn", placeholder = "Tìm món ăn gần bạn", className, ...rest }: SearchFieldProps) {
  return (
    <label className={[styles.field, className].filter(Boolean).join(" ")}>
      <span className="visually-hidden">{label}</span>
      <Icon name="search" size={22} color="var(--text-primary)" />
      <input type="search" className={styles.input} placeholder={placeholder} autoComplete="off" {...rest} />
    </label>
  );
}
