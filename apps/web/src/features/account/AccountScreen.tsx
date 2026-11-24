"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { isMockApi, saveMeal } from "@/lib/api";
import { resetDb } from "@/mocks/db";
import styles from "./account.module.css";

type AccountLinkItem = {
  href: string;
  title: string;
  sub: string;
  icon: ReactNode;
  showPendingBadge?: boolean;
};

const LINKS: AccountLinkItem[] = [
  {
    href: "/orders",
    title: "Đơn đã đặt",
    sub: "Theo dõi QR và lịch sử",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 7h12l-1 13H7L6 7Zm3 0V5a3 3 0 0 1 6 0v2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/my-listings",
    title: "Tin đã đăng",
    sub: "Quản lý suất và khung giờ nhận",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/sales",
    title: "Đơn bán & Xác nhận chuyển khoản",
    sub: "Duyệt biên lai P2P và người mua đang đến lấy",
    showPendingBadge: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M9 12l2 2 4-4m5 2a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/sales/scan",
    title: "Quét mã nhận món",
    sub: "Xác nhận giao món bằng QR",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 7V5a1 1 0 0 1 1-1h2M4 17v2a1 1 0 0 0 1 1h2m10-16h2a1 1 0 0 1 1 1v2m-3 14h2a1 1 0 0 0 1-1v-2M7 12h10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/settings",
    title: "Cài đặt & PWA",
    sub: "Hồ sơ, cài ứng dụng và bảo mật",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/** SaveMeal V2.1 · 08 · Tài khoản mua & bán / 35 · Trung tâm tài khoản 2 vai trò (ME-1). */
export function AccountScreen() {
  const session = useSession();
  const router = useRouter();
  const [pendingConfirmCount, setPendingConfirmCount] = useState(0);

  const isAuthenticated = session.status === "authenticated";
  const userId = isAuthenticated ? session.me.id : null;

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    let cancelled = false;
    void saveMeal
      .mySales("AWAITING_SELLER_CONFIRM")
      .then((res) => {
        if (!cancelled) {
          setPendingConfirmCount(res.data.length);
        }
      })
      .catch(() => {
        // Non-blocking check; keep UI responsive if offline or request fails.
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  if (!isAuthenticated) return null;
  const me = session.me;
  const initial = (me.displayName?.trim() || "S").charAt(0).toUpperCase();

  return (
    <section className={styles.body}>
      <h1 className={styles.h1}>Tài khoản</h1>

      {pendingConfirmCount > 0 ? (
        <Link href="/sales" className={styles.pendingBanner} aria-live="polite">
          <span className={styles.pendingIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className={styles.pendingText}>
            <span className={styles.pendingTitle}>
              Bạn có {pendingConfirmCount} biên lai chuyển khoản chờ xác nhận
            </span>
            <span className={styles.pendingCta}>Kiểm tra &amp; mở QR ngay ›</span>
          </span>
        </Link>
      ) : null}

      <div className={styles.profile}>
        <div className={styles.avatar} aria-hidden="true">
          {me.avatar?.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- user avatar URL
            <img src={me.avatar.url} alt="" />
          ) : (
            initial
          )}
        </div>
        <div className={styles.profileInfo}>
          <span className={styles.profileName}>{me.displayName ?? "Người dùng SaveMeal"}</span>
          <span className={styles.profileSub}>
            {me.seller.name ? `Người mua & người đăng · ${me.seller.name}` : "Vừa mua, vừa có thể đăng pass"}
          </span>
          {me.seller.verified ? <span className={styles.verified}>Đã xác minh</span> : null}
        </div>
      </div>

      <ul className={styles.group}>
        {LINKS.map((l) => (
          <li key={l.href} className={styles.groupItem}>
            <Link href={l.href} className={styles.link}>
              <span className={styles.icn} aria-hidden="true">
                {l.icon}
              </span>
              <span className={styles.linkCopy}>
                <span className={styles.linkTitle}>{l.title}</span>
                <span className={styles.linkSub}>{l.sub}</span>
              </span>
              {l.showPendingBadge && pendingConfirmCount > 0 ? (
                <span className={styles.countBadge}>{pendingConfirmCount}</span>
              ) : null}
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
        {me.role === "ADMIN" ? (
          <li className={styles.groupItem}>
            <Link href="/admin" className={`${styles.link} ${styles.adminLink}`}>
              <span className={`${styles.icn} ${styles.icnAdmin}`} aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3l7 4v5c0 4.5-3 8.2-7 9-4-.8-7-4.5-7-9V7l7-4Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className={styles.linkCopy}>
                <span className={styles.adminTitle}>Quản trị hệ thống</span>
                <span className={styles.linkSub}>Kiểm duyệt báo cáo, tin đăng và KPI</span>
              </span>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ) : null}
      </ul>

      <Link className={styles.primary} href="/post">
        Đăng món mới
      </Link>

      <Button
        variant="secondary"
        onClick={async () => {
          await session.signOut();
          router.replace("/login");
        }}
      >
        Đăng xuất
      </Button>

      {isMockApi ? (
        <Notice>
          <p>
            Chế độ demo (mock).{" "}
            <button
              type="button"
              className={styles.reset}
              onClick={() => {
                resetDb();
                window.location.reload();
              }}
            >
              Đặt lại dữ liệu demo
            </button>
          </p>
        </Notice>
      ) : null}
    </section>
  );
}
