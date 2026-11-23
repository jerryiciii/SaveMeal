import type { Metadata } from "next";
import Link from "next/link";
import styles from "./offline.module.css";

export const metadata: Metadata = { title: "Ngoại tuyến" };

/** Served by the service worker when a navigation fails offline. */
export default function OfflinePage() {
  return (
    <section className={styles.wrap}>
      <h1 className={styles.title}>Bạn đang ngoại tuyến</h1>
      <p className={styles.text}>
        SaveMeal cần kết nối mạng để hiển thị số suất còn lại và giữ chỗ cho bạn. Hãy thử lại khi có mạng.
      </p>
      <Link className={styles.link} href="/">
        Thử lại
      </Link>
    </section>
  );
}
