"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { clearClientLocation, setClientLocation } from "@/features/discover/clientLocation";
import { saveMeal } from "@/lib/api";
import styles from "./onboarding.module.css";

type GeoStatus = "idle" | "requesting" | "denied" | "unsupported";

/**
 * Figma V1 11 · Location permission (7:37).
 * Strictly client-only browser geolocation: buyer coordinates are never stored server-side.
 */
export function LocationPermissionScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [defaultLabel, setDefaultLabel] = useState("Đà Nẵng");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    saveMeal
      .getConfig()
      .then((c) => {
        if (c.defaultCenter.label) setDefaultLabel(c.defaultCenter.label);
      })
      .catch(() => {
        // fallback label stays "Đà Nẵng"
      });
  }, []);

  function requestLocation() {
    setErrorDetail(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unsupported");
      setErrorDetail("Trình duyệt trên thiết bị này không hỗ trợ định vị. Bạn vẫn có thể xem món theo khu vực mặc định.");
      return;
    }
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setClientLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        router.push("/");
      },
      (err) => {
        setStatus("denied");
        if (err.code === err.PERMISSION_DENIED) {
          setErrorDetail("Bạn chưa cấp quyền vị trí. Bạn có thể bật lại trong cài đặt trình duyệt hoặc dùng khu vực mặc định.");
        } else {
          setErrorDetail("Không lấy được vị trí lúc này. Bạn có thể thử lại hoặc khám phá theo khu vực mặc định.");
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  function useDefaultArea() {
    clearClientLocation();
    router.push("/");
  }

  return (
    <div className={styles.locationShell}>
      <ScreenHeader title="Vị trí của bạn" backHref="/onboarding" />
      <div className={styles.locationBody}>
        <div className={styles.radarWrap} aria-hidden="true">
          <div className={styles.radarRingOuter} />
          <div className={styles.radarRingInner} />
          <div className={styles.radarCenter}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path
                d="M14 4C9.58 4 6 7.58 6 12C6 17.25 12.2 22.85 13.34 23.82C13.72 24.14 14.28 24.14 14.66 23.82C15.8 22.85 22 17.25 22 12C22 7.58 18.42 4 14 4Z"
                fill="#111111"
              />
              <circle cx="14" cy="12" r="3.4" fill="#d7f75b" />
            </svg>
          </div>
        </div>

        <h1 className={styles.locationTitle}>Cho phép vị trí để tìm món gần bạn</h1>
        <p className={styles.locationLead}>
          SaveMeal hiển thị khoảng cách và các suất ăn đang mở nhận quanh bạn trong bán kính 1–5 km.
        </p>

        <Notice>
          <p>
            <strong>Quyền riêng tư:</strong> Vị trí chỉ xử lý trực tiếp trên thiết bị của bạn khi tìm món và{" "}
            <strong>không bao giờ được lưu trên máy chủ</strong>.
          </p>
        </Notice>

        {errorDetail ? (
          <Notice tone="error">
            <p>{errorDetail}</p>
          </Notice>
        ) : null}

        <div className={styles.locationActions}>
          <Button variant="primary" disabled={status === "requesting"} onClick={requestLocation}>
            {status === "requesting" ? "Đang xác định vị trí…" : status === "denied" ? "Thử lấy vị trí lại" : "Bật vị trí hiện tại"}
          </Button>
          <Button variant="secondary" onClick={useDefaultArea}>
            Dùng khu vực mặc định ({defaultLabel})
          </Button>
        </div>
      </div>
    </div>
  );
}
