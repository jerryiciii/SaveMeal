import type { ReactNode } from "react";
import styles from "./BottomSheet.module.css";

/** Sliding bottom sheet from Figma V1 01 (2:70) with its handle (2:71). Drag behaviour comes in M3. */
export function BottomSheet({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className={styles.sheet} aria-label={title}>
      <div className={styles.handle} aria-hidden="true" />
      <h2 className={styles.title}>{title}</h2>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      {children}
    </section>
  );
}
