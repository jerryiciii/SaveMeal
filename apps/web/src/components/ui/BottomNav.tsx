"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import styles from "./BottomNav.module.css";

/** Navigation bar from Figma V1 01 (2:82): Khám phá · Đã lưu · Đăng món · Cá nhân. */
export const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Khám phá", icon: "nav-discover" },
  { href: "/saved", label: "Đã lưu", icon: "nav-saved" },
  { href: "/post", label: "Đăng món", icon: "nav-post" },
  { href: "/account", label: "Cá nhân", icon: "nav-account" },
];

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className={styles.nav} aria-label="Điều hướng chính">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[styles.item, active ? styles.active : ""].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} size={23} />
            <span className={styles.label}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
