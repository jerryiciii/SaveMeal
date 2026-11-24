"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Notice } from "@/components/ui";
import styles from "./settings.module.css";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const noopSubscribe = () => () => {};

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    nav.standalone === true
  );
}

function detectIos(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * PWA install card for Figma V1 36 · Cài đặt & PWA (`11:135`).
 * Client-side only (no push notifications in MVP).
 */
export function PwaInstallCard() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const standaloneDetected = useSyncExternalStore(noopSubscribe, detectStandalone, () => false);
  const isIos = useSyncExternalStore(noopSubscribe, detectIos, () => false);
  const installed = standaloneDetected || justInstalled;

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setJustInstalled(true);
      setDeferredPrompt(null);
      setStatusMessage("Đã cài đặt SaveMeal vào màn hình chính.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installNow() {
    if (!deferredPrompt) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setJustInstalled(true);
        setStatusMessage("Đang thêm SaveMeal vào màn hình chính.");
      } else {
        setStatusMessage("Bạn có thể cài đặt SaveMeal bất cứ lúc nào từ mục này.");
      }
      setDeferredPrompt(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.sectionTitle}>Cài đặt ứng dụng (PWA)</h2>
        {installed ? <span className={styles.badge}>Đã cài</span> : null}
      </div>
      <p className={styles.sectionDesc}>
        Thêm SaveMeal vào màn hình chính để mở nhanh như ứng dụng, quét QR mượt hơn và xem được trạng thái ngoại tuyến.
      </p>

      {installed ? (
        <Notice tone="success">
          <p>SaveMeal đang chạy ở chế độ ứng dụng trên thiết bị này.</p>
        </Notice>
      ) : deferredPrompt ? (
        <Button type="button" onClick={installNow} disabled={busy}>
          {busy ? "Đang mở hộp thoại…" : "Cài đặt SaveMeal ngay"}
        </Button>
      ) : (
        <ul className={styles.installSteps}>
          {isIos ? (
            <li className={styles.installStep}>
              <b>Trên iPhone / iPad (Safari)</b>
              Nhấn biểu tượng <b>Chia sẻ</b> ở thanh dưới cùng → cuộn xuống chọn <b>Thêm vào MH chính</b> → nhấn{" "}
              <b>Thêm</b>.
            </li>
          ) : (
            <>
              <li className={styles.installStep}>
                <b>Trên Android (Chrome / Edge)</b>
                Nhấn biểu tượng <b>⋮</b> ở góc trên phải → chọn <b>Cài đặt ứng dụng</b> hoặc{" "}
                <b>Thêm vào màn hình chính</b>.
              </li>
              <li className={styles.installStep}>
                <b>Trên iPhone / iPad (Safari)</b>
                Nhấn biểu tượng <b>Chia sẻ</b> ở thanh dưới cùng → chọn <b>Thêm vào MH chính</b>.
              </li>
            </>
          )}
        </ul>
      )}

      {statusMessage ? (
        <Notice>
          <p>{statusMessage}</p>
        </Notice>
      ) : null}
    </section>
  );
}
