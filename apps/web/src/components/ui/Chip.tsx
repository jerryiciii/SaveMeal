import type { ButtonHTMLAttributes } from "react";
import styles from "./Chip.module.css";

/** Filter pill from Figma V1 01 (2:61 active, 2:63 default). */
type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { selected?: boolean };

export function Chip({ selected = false, className, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[styles.chip, selected ? styles.selected : "", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
