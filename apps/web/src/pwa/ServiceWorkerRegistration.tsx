"use client";

import { useEffect } from "react";

/**
 * Registers /service-worker.js in production builds only, so dev never serves
 * stale assets. Push and offline handling live in public/service-worker.js.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
      // Registration failure must never break the app; the PWA simply stays online-only.
    });
  }, []);
  return null;
}
