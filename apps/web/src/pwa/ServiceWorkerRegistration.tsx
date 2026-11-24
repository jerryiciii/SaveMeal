"use client";

import { useEffect } from "react";
import { initPwaInstallCapture } from "./pwaInstallStore";

/**
 * Registers /service-worker.js in production builds and captures `beforeinstallprompt`
 * globally on first paint so the "Cài SaveMeal ngay" button in /settings triggers the
 * real native Add-to-Home-Screen prompt.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    const cleanupInstall = initPwaInstallCapture();
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {
        // Registration failure must never break the app; the PWA simply stays online-only.
      });
    }
    return cleanupInstall;
  }, []);
  return null;
}
