import styles from "./ComingSoon.module.css";

/** Placeholder for tabs whose screens land in later FE milestones. */
export function ComingSoon({ title, subtitle, milestone }: { title: string; subtitle: string; milestone: string }) {
  return (
    <section className={styles.wrap}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
      <p className={styles.note}>Màn hình này đang được xây dựng ({milestone}).</p>
    </section>
  );
}
