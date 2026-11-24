"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { getClientLocation } from "@/features/discover/clientLocation";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { Me } from "@/lib/contract/types";
import styles from "./settings.module.css";

const RADIUS_OPTIONS = [1, 3, 5] as const;
const DEFAULT_CENTER = { lat: 16.0544, lng: 108.2022 };

/**
 * Opt-in nearby listing email alerts card (ME-2 `nearbyAlerts`, v1.3.1).
 * Also handles 1-click unsubscribe deep-link `/settings?disableAlerts=1` from Resend emails.
 */
export function NearbyAlertsCard({ me }: { me: Me }) {
  const session = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const disableParam = searchParams.get("disableAlerts") === "1";

  const current = me.nearbyAlerts ?? { enabled: false, lat: null, lng: null, radiusKm: 3 };
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(() =>
    disableParam && !current.enabled ? "Thông báo email món mới gần đây hiện đã tắt." : null,
  );
  const handledDisableRef = useRef(false);

  // Auto-disable when arriving from the email "Tắt thông báo" link (?disableAlerts=1).
  useEffect(() => {
    if (!disableParam || handledDisableRef.current) return;
    handledDisableRef.current = true;

    if (!current.enabled) {
      router.replace("/settings");
      return;
    }

    let cancelled = false;
    void saveMeal
      .updateMe({ nearbyAlerts: { enabled: false } })
      .then((updated) => {
        if (cancelled) return;
        session.setMe(updated);
        setMessage("Đã tắt thông báo email món mới gần đây. Bạn có thể bật lại bất cứ lúc nào.");
        router.replace("/settings");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Chưa tắt được thông báo. Vui lòng thử lại.");
      });

    return () => {
      cancelled = true;
    };
  }, [disableParam, current.enabled, router, session]);

  async function saveAlerts(patch: { enabled?: boolean; lat?: number | null; lng?: number | null; radiusKm?: number }, okText: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await saveMeal.updateMe({ nearbyAlerts: patch });
      session.setMe(updated);
      setMessage(okText);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không cập nhật được cài đặt thông báo.");
    } finally {
      setBusy(false);
    }
  }

  function handleToggle() {
    if (busy) return;
    if (current.enabled) {
      void saveAlerts({ enabled: false }, "Đã tắt thông báo email món mới gần đây.");
      return;
    }

    // Enabling: ensure we have coordinates (saved alert coords -> client GPS -> seller pickup -> Đà Nẵng default).
    const fallback =
      current.lat !== null && current.lng !== null
        ? { lat: current.lat, lng: current.lng }
        : (getClientLocation() ??
            (me.seller.defaultPickup ? { lat: me.seller.defaultPickup.lat, lng: me.seller.defaultPickup.lng } : DEFAULT_CENTER));

    void saveAlerts(
      { enabled: true, lat: fallback.lat, lng: fallback.lng, radiusKm: current.radiusKm || 3 },
      "Đã bật thông báo email khi có món mới gần bạn.",
    );
  }

  function updateLocationFromGps() {
    if (!("geolocation" in navigator)) {
      setError("Thiết bị không hỗ trợ định vị.");
      return;
    }
    setLocating(true);
    setError(null);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void saveAlerts(
          { enabled: true, lat: pos.coords.latitude, lng: pos.coords.longitude, radiusKm: current.radiusKm || 3 },
          "Đã cập nhật vị trí nhận thông báo món mới gần bạn.",
        );
      },
      () => {
        setLocating(false);
        setError("Chưa lấy được vị trí hiện tại. Hãy cấp quyền định vị trên trình duyệt.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <section className={styles.card} aria-label="Thông báo email món mới gần đây">
      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <span className={styles.icn} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Zm-4.27 13a2 2 0 0 1-3.46 0"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h2 className={styles.sectionTitle}>Email món mới gần bạn</h2>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={current.enabled}
          aria-label="Bật thông báo email món mới gần bạn"
          className={[styles.alertSwitch, current.enabled ? styles.alertSwitchOn : ""].filter(Boolean).join(" ")}
          disabled={busy}
          onClick={handleToggle}
        >
          <span className={styles.alertThumb} />
        </button>
      </div>

      <p className={styles.sectionDesc}>
        Nhận email qua {me.email ?? "địa chỉ đăng nhập"} khi có món ăn mới đăng trong bán kính bạn chọn.
      </p>

      {current.enabled ? (
        <div className={styles.alertControls}>
          <div className={styles.alertTrack} role="group" aria-label="Bán kính nhận thông báo">
            {RADIUS_OPTIONS.map((km) => (
              <button
                key={km}
                type="button"
                className={[styles.alertTrackBtn, current.radiusKm === km ? styles.alertTrackBtnOn : ""].filter(Boolean).join(" ")}
                disabled={busy}
                onClick={() => void saveAlerts({ radiusKm: km }, `Đã đổi bán kính nhận thông báo sang ${km} km.`)}
              >
                Trong {km} km
              </button>
            ))}
          </div>

          <div className={styles.alertLocRow}>
            <span className={styles.alertLocText}>
              {current.lat !== null && current.lng !== null
                ? `Tọa độ nhận tin: ${current.lat.toFixed(4)}, ${current.lng.toFixed(4)}`
                : "Đang dùng khu vực mặc định (Đà Nẵng)"}
            </span>
            <Button
              type="button"
              variant="secondary"
              block={false}
              disabled={busy || locating}
              onClick={updateLocationFromGps}
            >
              {locating ? "Đang lấy vị trí…" : "Cập nhật vị trí"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
    </section>
  );
}
