"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  countUnreadNotifications,
  fetchNotifications,
  loadSeenIds,
  NOTIF_CHANGED_EVENT,
} from "@/features/notifications/notificationFeed";
import { tokens } from "@/lib/api";
import { Icon, type IconName } from "./Icon";
import styles from "./BottomNav.module.css";

/** Navigation bar from SaveMeal V2.1: collapsible circular 3-bar trigger -> floating ink dock + detached lime FAB. */
export const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Khám phá", icon: "nav-discover" },
  { href: "/notifications", label: "Thông báo", icon: "nav-notifications" },
  { href: "/post", label: "Đăng món", icon: "nav-post" },
  { href: "/account", label: "Cá nhân", icon: "nav-account" },
];

const DOCK_ITEMS = NAV_ITEMS.filter((item) => item.href !== "/post");
const SCROLL_COLLAPSE_THRESHOLD_PX = 36;

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function readScrollTop(target: EventTarget | null): number {
  if (!target || target === document || target === window) {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }
  if (target instanceof HTMLElement) {
    return target.scrollTop;
  }
  return 0;
}

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const postActive = isNavActive(pathname, "/post");
  const [expanded, setExpanded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);
  const prevPathnameRef = useRef(pathname);

  // Auto-collapse when navigating to another route.
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setExpanded(false);
    }
  }, [pathname]);

  // Poll unread notification count when authenticated (shows red badge on collapsed trigger & Thông báo tab).
  useEffect(() => {
    let cancelled = false;

    async function refreshUnread() {
      if (!tokens.get()) {
        if (!cancelled) setUnreadCount(0);
        return;
      }
      try {
        const items = await fetchNotifications();
        if (!cancelled) {
          setUnreadCount(countUnreadNotifications(items, loadSeenIds()));
        }
      } catch {
        // non-blocking badge check
      }
    }

    void refreshUnread();
    const timer = setInterval(() => void refreshUnread(), 30_000);
    const onNotifChanged = () => void refreshUnread();
    window.addEventListener(NOTIF_CHANGED_EVENT, onNotifChanged);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(NOTIF_CHANGED_EVENT, onNotifChanged);
    };
  }, [pathname]);

  // While expanded, auto-collapse on downward scroll, outside tap, or Escape key.
  useEffect(() => {
    if (!expanded) return;

    const scrollOrigins = new WeakMap<EventTarget, number>();
    let windowOrigin = window.scrollY || document.documentElement.scrollTop || 0;

    function handleScroll(event: Event) {
      const target = event.target;
      const currentTop = readScrollTop(target);

      if (!target || target === document || target === window) {
        if (currentTop - windowOrigin >= SCROLL_COLLAPSE_THRESHOLD_PX) {
          setExpanded(false);
        } else if (currentTop < windowOrigin) {
          windowOrigin = currentTop;
        }
        return;
      }

      const prevTop = scrollOrigins.get(target);
      if (prevTop === undefined) {
        scrollOrigins.set(target, currentTop);
        return;
      }
      if (currentTop - prevTop >= SCROLL_COLLAPSE_THRESHOLD_PX) {
        setExpanded(false);
      } else if (currentTop < prevTop) {
        scrollOrigins.set(target, currentTop);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const navEl = navRef.current;
      if (navEl && event.target instanceof Node && !navEl.contains(event.target)) {
        setExpanded(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    }

    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("scroll", handleScroll, { capture: true });
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <nav
      ref={navRef}
      className={[styles.nav, expanded ? styles.navExpanded : styles.navCollapsed].join(" ")}
      aria-label="Điều hướng chính"
    >
      {expanded ? (
        <div className={styles.expandedRow}>
          <div className={styles.dock}>
            {DOCK_ITEMS.map((item) => {
              const active = isNavActive(pathname, item.href);
              const showBadge = item.href === "/notifications" && unreadCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[styles.item, active ? styles.active : ""].filter(Boolean).join(" ")}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setExpanded(false)}
                >
                  <span className={styles.iconWrap}>
                    <Icon name={item.icon} size={20} className={styles.icon} />
                    {showBadge ? (
                      <span className={styles.tabBadge} aria-label={`${unreadCount} thông báo chưa đọc`}>
                        {badgeLabel}
                      </span>
                    ) : null}
                  </span>
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
            onClick={() => setExpanded(false)}
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
        </div>
      ) : (
        <button
          type="button"
          className={styles.toggle}
          aria-label={unreadCount > 0 ? `Mở thanh điều hướng (${unreadCount} thông báo mới)` : "Mở thanh điều hướng"}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7H20M4 12H20M4 17H20"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          {unreadCount > 0 ? (
            <span className={styles.toggleBadge} aria-hidden="true">
              {badgeLabel}
            </span>
          ) : null}
        </button>
      )}
    </nav>
  );
}
