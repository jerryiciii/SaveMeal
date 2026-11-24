"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./seller.module.css";

/** Figma V1 32 · Giao hàng hoàn tất (10:88). Data comes from the RES-8 response. */
export function SaleDone() {
  const p = useSearchParams();
  return (
    <section className={styles.done}>
      <span className={styles.tick} aria-hidden="true">
        ✓
      </span>
      <h1 className={styles.h1}>Giao hàng hoàn tất!</h1>
      <p className={styles.meta}>
        {p.get("title")} · {p.get("qty")} suất
      </p>
      <p className={styles.meta}>Mã nhận: {p.get("code")}</p>
      <p className={styles.meta}>Số suất còn: {p.get("left")}</p>
      <Link className={styles.primaryLink} style={{ width: "100%" }} href="/sales">
        Quay lại các đơn
      </Link>
    </section>
  );
}
