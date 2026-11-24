"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import styles from "./seller.module.css";

/**
 * Camera QR scanner (getUserMedia + jsQR). Calls `onScan` once per new payload.
 * Falls back to a message when the camera is unavailable; manual code entry is
 * always offered next to it (V1/31 "Nhập mã thủ công").
 */
export function QrScanner({ onScan, paused }: { onScan: (payload: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(() =>
    typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia
      ? "Trình duyệt không hỗ trợ camera. Hãy nhập mã thủ công."
      : null,
  );
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onScanRef.current = onScan;
    pausedRef.current = paused;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let last = "";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function tick() {
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && !pausedRef.current) {
        const w = 360;
        const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
        if (found?.data && found.data !== last) {
          last = found.data;
          onScanRef.current(found.data);
        }
      }
      if (pausedRef.current) last = "";
      raf = requestAnimationFrame(tick);
    }

    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError("Chưa có quyền camera. Hãy cho phép camera hoặc nhập mã thủ công."));

    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={styles.scanBox}>
      <video ref={video} className={styles.video} playsInline muted aria-label="Camera quét mã QR" />
      <span className={styles.scanFrame} aria-hidden="true" />
      {error ? <p className={styles.meta}>{error}</p> : null}
    </div>
  );
}
