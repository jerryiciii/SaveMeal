import Link from "next/link";
import { Button } from "@/components/ui";
import styles from "./EmptyNearby.module.css";

export type EmptyAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

type EmptyNearbyProps = {
  title?: string;
  description?: string;
  primaryAction?: EmptyAction;
  secondaryAction?: EmptyAction;
  compact?: boolean;
};

/**
 * Figma V1 37 · Không có món gần đây (11:186).
 * Reusable empty state shared across Discover, Search, and Free Food screens.
 */
export function EmptyNearby({
  title = "Chưa có món nào gần bạn",
  description = "Khu vực này hiện chưa có món đang mở nhận. Bạn có thể mở rộng khoảng cách, đổi bộ lọc hoặc quay lại sau.",
  primaryAction,
  secondaryAction,
  compact = false,
}: EmptyNearbyProps) {
  return (
    <div className={[styles.card, compact ? styles.compact : ""].filter(Boolean).join(" ")} role="status">
      <div className={styles.art} aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="19" stroke="rgba(101, 228, 179, 0.28)" strokeWidth="1.5" strokeDasharray="3 3" />
          <path
            d="M20 9.5C15.3 9.5 11.5 13.3 11.5 18C11.5 23.6 18.2 29.5 19.3 30.4C19.7 30.7 20.3 30.7 20.7 30.4C21.8 29.5 28.5 23.6 28.5 18C28.5 13.3 24.7 9.5 20 9.5Z"
            stroke="#65E4B3"
            strokeWidth="2"
          />
          <circle cx="20" cy="18" r="3" fill="#FFB66C" />
        </svg>
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.desc}>{description}</p>
      {primaryAction || secondaryAction ? (
        <div className={styles.actions}>
          {primaryAction ? (
            primaryAction.href ? (
              <Link href={primaryAction.href} className={styles.primaryLink}>
                {primaryAction.label}
              </Link>
            ) : (
              <Button variant="primary" onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            )
          ) : null}
          {secondaryAction ? (
            secondaryAction.href ? (
              <Link href={secondaryAction.href} className={styles.secondaryLink}>
                {secondaryAction.label}
              </Link>
            ) : (
              <Button variant="secondary" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
