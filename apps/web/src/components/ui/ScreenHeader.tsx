"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./ScreenHeader.module.css";

/** Top bar used on Figma V1 detail screens: "‹" back button + title (e.g. 04, 05, 18, 25). */
export function ScreenHeader({ title, subtitle, backHref, right }: { title: string; subtitle?: string; backHref?: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.back}
        aria-label="Quay lại"
        onClick={() => (backHref ? router.push(backHref) : router.back())}
      >
        ‹
      </button>
      <div className={styles.titles}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {right ? <div className={styles.right}>{right}</div> : null}
    </header>
  );
}
