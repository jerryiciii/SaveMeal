"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/features/auth/SessionProvider";
import { adminApi } from "@/lib/api/adminEndpoints";
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
  const [openReports, setOpenReports] = useState<number>(0);

  const isAdmin = session.status === "authenticated" && session.me.role === "ADMIN";

  useEffect(() => {
    if (session.status === "anonymous") {
      const next = pathname.startsWith("/admin") ? pathname : "/admin";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [session.status, pathname, router]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    Promise.resolve()
      .then(() => adminApi.getMetrics())
      .then((metrics) => {
        if (active && metrics?.reports && typeof metrics.reports.open === "number") {
          setOpenReports(metrics.reports.open);
        }
      })
      .catch(() => {
        /* non-blocking badge count */
      });
    return () => {
      active = false;
    };
  }, [isAdmin, pathname]);

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
          <div className={styles.brandGroup}>
            <Link href="/admin" className={styles.brandLink}>
              <span className={styles.brandSpark} aria-hidden="true">
                ✦
              </span>
              <span className={styles.brandTitle}>SaveMeal</span>
            </Link>
            <span className={styles.adminBadge}>Admin</span>
          </div>

          <div className={styles.topbarRight}>
            <nav className={styles.nav} aria-label="Điều hướng quản trị">
              {ADMIN_TABS.map((tab) => {
                const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
                const showPendingBadge = tab.href === "/admin/reports" && openReports > 0;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={[styles.navTab, active ? styles.navTabActive : ""].filter(Boolean).join(" ")}
                  >
                    <span>{tab.label}</span>
                    {showPendingBadge ? (
                      <span className={styles.navCountBadge} aria-hidden="true">
                        {openReports}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>

            <div className={styles.userRow}>
              <span className={styles.userName}>{adminLabel}</span>
              <Link href="/" className={styles.backApp}>
                Về ứng dụng
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
