"use client";

import Image from "next/image";
import { useState } from "react";
import { triggerNativePwaInstall, usePwaInstall } from "@/pwa/pwaInstallStore";
import styles from "./settings.module.css";

/**
 * Featured Dark V2.1 PWA Install Hero Card (36 · Cài đặt & PWA).
 * Backed by global `pwaInstallStore` so `beforeinstallprompt` is captured at app root.
 */
export function PwaInstallCard() {
  const { installed, isIos } = usePwaInstall();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "note"; text: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  async function handleInstallClick() {
    setBusy(true);
    setFeedback(null);
    try {
      const outcome = await triggerNativePwaInstall();
      if (outcome === "accepted") {
        setShowGuide(false);
        setFeedback({ tone: "success", text: "Đang thêm SaveMeal vào màn hình chính!" });
      } else if (outcome === "dismissed") {
        setFeedback({
          tone: "note",
          text: "Bạn có thể bấm lại bất cứ lúc nào để cài SaveMeal.",
        });
      } else {
        setShowGuide(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.pwaHero} aria-label="Cài đặt ứng dụng SaveMeal (PWA)">
      <div className={styles.pwaTop}>
        <Image
          src="/icons/logo-128.png"
          alt=""
          width={40}
          height={40}
          className={styles.pwaIconBadge}
          style={{ objectFit: "cover" }}
        />
        <div className={styles.pwaTitleWrap}>
          <h2 className={styles.pwaTitle}>Cài SaveMeal vào màn hình chính</h2>
        </div>
        <span className={installed ? styles.pwaPillInstalled : styles.pwaPill}>
          {installed ? "Đã cài" : "PWA"}
        </span>
      </div>

      <p className={styles.pwaDesc}>
        Mở nhanh 1 chạm như ứng dụng thật, quét QR mượt hơn và lưu trạng thái ngoại tuyến.
      </p>

      {installed ? (
        <div className={styles.pwaInstalledPill} role="status">
          ✓ SaveMeal đã được cài trên thiết bị này
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.pwaCta}
            onClick={handleInstallClick}
            disabled={busy}
          >
            {busy ? "Đang mở hộp thoại…" : "Cài SaveMeal ngay"}
          </button>

          {feedback ? (
            <p
              className={
                feedback.tone === "success" ? styles.pwaFeedbackSuccess : styles.pwaFeedbackNote
              }
              role="status"
            >
              {feedback.text}
            </p>
          ) : null}

          {showGuide ? (
            <div className={styles.pwaGuide} role="region" aria-label="Hướng dẫn cài đặt thủ công">
              <p className={styles.pwaGuideLabel}>
                {isIos ? "Hướng dẫn trên Safari (iOS)" : "Hướng dẫn cài trên trình duyệt"}
              </p>
              <p className={styles.pwaGuideText}>
                {isIos
                  ? "Trên Safari: bấm biểu tượng Chia sẻ (↑) → Thêm vào MH chính → Thêm"
                  : "Bấm biểu tượng ⋮ hoặc biểu tượng cài đặt trên thanh địa chỉ → Cài đặt SaveMeal"}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
