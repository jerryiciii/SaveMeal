"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import styles from "./NavigationFeedback.module.css";

const PILL_DELAY_MS = 250;
const SAFETY_TIMEOUT_MS = 8000;

function NavigationFeedbackInner() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const routeKey = search ? `${pathname}?${search}` : pathname;

  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [showPill, setShowPill] = useState(false);

  const routeKeyRef = useRef(routeKey);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNavigating = pendingFrom !== null && pendingFrom === routeKey;

  useEffect(() => {
    routeKeyRef.current = routeKey;
    if (pillTimerRef.current !== null) {
      clearTimeout(pillTimerRef.current);
      pillTimerRef.current = null;
    }
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, [routeKey]);

  useEffect(() => {
    const clearTimers = () => {
      if (pillTimerRef.current !== null) {
        clearTimeout(pillTimerRef.current);
        pillTimerRef.current = null;
      }
      if (safetyTimerRef.current !== null) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }

      clearTimers();
      setShowPill(false);
      setPendingFrom(routeKeyRef.current);

      pillTimerRef.current = setTimeout(() => {
        setShowPill(true);
      }, PILL_DELAY_MS);

      safetyTimerRef.current = setTimeout(() => {
        setPendingFrom(null);
        setShowPill(false);
      }, SAFETY_TIMEOUT_MS);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      clearTimers();
    };
  }, []);

  if (!isNavigating) return null;

  return (
    <>
      <div className={styles.barTrack} aria-hidden="true">
        <div className={styles.barFill} />
      </div>
      {showPill && (
        <div className={styles.pillWrap} role="status" aria-live="polite">
          <div className={styles.pill}>
            <span className={styles.spinner} aria-hidden="true" />
            <span>Chờ mình kiểm tra chút nha…</span>
          </div>
        </div>
      )}
    </>
  );
}

export function NavigationFeedback() {
  return (
    <Suspense fallback={null}>
      <NavigationFeedbackInner />
    </Suspense>
  );
}
