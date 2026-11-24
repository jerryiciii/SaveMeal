"use client";

import { useSyncExternalStore } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

type PwaSnapshot = {
  canPrompt: boolean;
  installed: boolean;
  isIos: boolean;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const listeners = new Set<() => void>();

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true || nav.standalone === true;
}

function detectIos(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

let cachedSnapshot: PwaSnapshot = { canPrompt: false, installed: false, isIos: false };

function computeSnapshot(): PwaSnapshot {
  const next: PwaSnapshot = {
    canPrompt: deferredPrompt !== null,
    installed: installedFlag || detectStandalone(),
    isIos: detectIos(),
  };
  if (
    next.canPrompt !== cachedSnapshot.canPrompt ||
    next.installed !== cachedSnapshot.installed ||
    next.isIos !== cachedSnapshot.isIos
  ) {
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}

function notify() {
  computeSnapshot();
  for (const fn of listeners) fn();
}

let initialized = false;

/** Attach global listeners once at app root so `beforeinstallprompt` is never missed before opening /settings. */
export function initPwaInstallCapture(): () => void {
  if (typeof window === "undefined" || initialized) return () => {};
  initialized = true;

  const handleBeforeInstall = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  };
  const handleInstalled = () => {
    installedFlag = true;
    deferredPrompt = null;
    notify();
  };

  window.addEventListener("beforeinstallprompt", handleBeforeInstall);
  window.addEventListener("appinstalled", handleInstalled);
  notify();

  return () => {
    window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    window.removeEventListener("appinstalled", handleInstalled);
    initialized = false;
  };
}

export async function triggerNativePwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const evt = deferredPrompt;
  deferredPrompt = null;
  notify();
  await evt.prompt();
  const choice = await evt.userChoice;
  if (choice.outcome === "accepted") {
    installedFlag = true;
    notify();
  }
  return choice.outcome;
}

const SERVER_SNAPSHOT: PwaSnapshot = { canPrompt: false, installed: false, isIos: false };

export function usePwaInstall(): PwaSnapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    computeSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
