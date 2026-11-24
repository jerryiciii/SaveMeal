import type { ReactNode } from "react";
import styles from "./Notice.module.css";

/** Inline V2.1 message box: info, success, warning, error. */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
