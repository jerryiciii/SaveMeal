"use client";

import { useState } from "react";
import { Button, Icon } from "@/components/ui";
import { setClientLocation, type ClientPoint } from "./clientLocation";
import styles from "./LocationPromptModal.module.css";

export const LOCATION_PROMPTED_KEY = "sm-location-prompted-v1";

function markPrompted() {
  try {
    window.localStorage.setItem(LOCATION_PROMPTED_KEY, "1");
  } catch {
    // ignore storage access errors
  }
}

type Props = {
  open: boolean;
  onGranted: (point: ClientPoint) => void;
  onDismiss: () => void;
};

/**
 * First-visit location permission dialog on `/` (Figma V1 dark palette).
 * Buyer coordinates stay client-only via sessionStorage and are never saved on the server.
 */
export function LocationPromptModal({ open, onGranted, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function requestLocation() {
    setError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError("Thiết bị này không hỗ trợ định vị. Bạn vẫn có thể xem khu vực Đà Nẵng.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point: ClientPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setClientLocation(point);
        markPrompted();
        setBusy(false);
        onGranted(point);
      },
      (err) => {
        setBusy(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Bạn chưa cấp quyền vị trí. Bạn có thể bật lại trong cài đặt trình duyệt hoặc xem khu vực Đà Nẵng.");
        } else {
          setError("Chưa lấy được vị trí lúc này. Bạn có thể thử lại hoặc xem khu vực Đà Nẵng.");
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  function dismiss() {
    markPrompted();
    setError(null);
    onDismiss();
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="location-prompt-title" aria-describedby="location-prompt-desc">
      <div className={styles.card}>
        <div className={styles.iconBadge} aria-hidden="true">
          <Icon name="navigation" size={26} color="var(--color-mint)" />
        </div>
        <h2 id="location-prompt-title" className={styles.title}>
          Cho phép dùng vị trí gần bạn?
        </h2>
        <p id="location-prompt-desc" className={styles.desc}>
          SaveMeal chỉ dùng vị trí trên thiết bị này để tìm món quanh bạn và không lưu vị trí lên máy chủ.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button variant="primary" onClick={requestLocation} disabled={busy}>
            {busy ? "Đang lấy vị trí…" : "Cho phép vị trí"}
          </Button>
          <Button variant="secondary" onClick={dismiss} disabled={busy}>
            Để sau (xem khu vực Đà Nẵng)
          </Button>
        </div>
      </div>
    </div>
  );
}
