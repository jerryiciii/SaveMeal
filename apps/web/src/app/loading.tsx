import styles from "./loading.module.css";

export default function Loading() {
  return (
    <div className={styles.screen} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.card}>
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.label}>Chờ mình kiểm tra chút nha…</p>
      </div>
    </div>
  );
}
