"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/features/auth/SessionProvider";
import styles from "./admin.module.css";

const ADMIN_TABS = [
  { href: "/admin", label: "KPIs", exact: true },
  { href: "/admin/reports", label: "Báo cáo", exact: false },
  { href: "/admin/listings", label: "Tin đăng", exact: false },
  { href: "/admin/accounts", label: "Tài khoản", exact: false },
  { href: "/admin/reservations", label: "Đơn giữ chỗ", exact: false },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? "/admin";

  useEffect(() => {
    if (session.status === "anonymous") {
      const next = pathname.startsWith("/admin") ? pathname : "/admin";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [session.status, pathname, router]);

  if (session.status === "loading" || session.status === "anonymous") {
    return (
      <div className={styles.viewport} data-admin-shell="true">
        <div className={styles.guardWrap}>
          <div className={styles.guardCard}>
            <h1 className={styles.guardTitle}>Đang kiểm tra quyền truy cập…</h1>
            <p className={styles.guardCopy}>Vui lòng đợi trong giây lát.</p>
          </div>
        </div>
      </div>
    );
  }

  if (session.me.role !== "ADMIN") {
    return (
      <div className={styles.viewport} data-admin-shell="true">
        <div className={styles.guardWrap}>
          <section className={styles.guardCard} aria-labelledby="admin-403-title">
            <span className={styles.guardCode}>403 · Không có quyền truy cập</span>
            <h1 id="admin-403-title" className={styles.guardTitle}>
              Khu vực dành cho quản trị viên
            </h1>
            <p className={styles.guardCopy}>
              Tài khoản <b>{session.me.displayName ?? session.me.phone ?? session.me.email ?? "hiện tại"}</b> không có
              quyền quản trị SaveMeal. Vui lòng quay lại ứng dụng hoặc đăng nhập bằng tài khoản quản trị.
            </p>
            <div className={styles.guardActions}>
              <Link href="/" className={styles.guardLinkPrimary}>
                Về trang khám phá
              </Link>
              <Link href="/account" className={styles.guardLinkSecondary}>
                Về tài khoản
              </Link>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const adminLabel = session.me.displayName ?? session.me.email ?? session.me.phone ?? "Quản trị viên";

  return (
    <div className={styles.viewport} data-admin-shell="true">
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <div className={styles.brandRow}>
            <div className={styles.brandGroup}>
              <Link href="/admin" className={styles.brand}>
                ✦ SaveMeal
              </Link>
              <span className={styles.adminBadge}>Quản trị</span>
            </div>
            <div className={styles.userRow}>
              <span>{adminLabel}</span>
              <Link href="/" className={styles.backApp}>
                Về ứng dụng
              </Link>
            </div>
          </div>

          <nav className={styles.nav} aria-label="Điều hướng quản trị">
            {ADMIN_TABS.map((tab) => {
              const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={[styles.navTab, active ? styles.navTabActive : ""].filter(Boolean).join(" ")}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
