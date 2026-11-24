"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import styles from "./BottomNav.module.css";

/** Navigation bar from SaveMeal V2.1: floating ink dock (Khám phá · Đã lưu · Cá nhân) + detached lime FAB (Đăng món). */
export const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Khám phá", icon: "nav-discover" },
  { href: "/saved", label: "Đã lưu", icon: "nav-saved" },
  { href: "/post", label: "Đăng món", icon: "nav-post" },
  { href: "/account", label: "Cá nhân", icon: "nav-account" },
];

const DOCK_ITEMS = NAV_ITEMS.filter((item) => item.href !== "/post");

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const postActive = isNavActive(pathname, "/post");

  return (
    <nav className={styles.nav} aria-label="Điều hướng chính">
      <div className={styles.dock}>
        {DOCK_ITEMS.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[styles.item, active ? styles.active : ""].filter(Boolean).join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={item.icon} size={20} className={styles.icon} />
              <span className={styles.label}>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <Link
        href="/post"
        className={[styles.fab, postActive ? styles.fabActive : ""].filter(Boolean).join(" ")}
        aria-label="Đăng món"
        aria-current={postActive ? "page" : undefined}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 5V19M5 12H19"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </nav>
  );
}
