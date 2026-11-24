"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import styles from "./QrCode.module.css";

/** Renders the opaque pickup token as a QR (V1/06). The payload carries no personal data. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 480, color: { dark: "#111922", light: "#ffffff" } })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div className={styles.box}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL generated on the client
        <img src={src} alt={label} className={styles.img} />
      ) : (
        <span className={styles.loading} aria-busy="true" />
      )}
    </div>
  );
}
