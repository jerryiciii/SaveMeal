import { BottomNav } from "@/components/ui";
import styles from "./tabs.module.css";

/** Screens that show the bottom navigation (Figma V1 01, 02, 14–17, 29, 34–36). */
export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>{children}</main>
      <div className={styles.nav}>
        <BottomNav />
      </div>
    </div>
  );
}
