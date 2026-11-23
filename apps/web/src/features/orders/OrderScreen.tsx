"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Notice, QrCode, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import type { PickupToken, Reservation } from "@/lib/contract/types";
import { formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { CANCEL_REASON_LABEL, RESERVATION_STATUS_LABEL } from "./labels";
import styles from "./orders.module.css";

/** Seconds left until `iso`, floored at 0. */
export function secondsLeft(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
}

/** Refresh the QR token when it has expired or is about to (contract RES-6, D§6). */
export function needsNewToken(token: PickupToken | null, now: number = Date.now()): boolean {
  return !token || secondsLeft(token.expiresAt, now) < 30;
}

/**
 * Figma V1 06 · Nhận mã QR (2:293) + 18 · Chi tiết đơn (8:43). Shows the rotating,
 * single-use pickup QR (RES-3 / RES-6) and polls for the seller's handover.
 */
export function OrderScreen({ id }: { id: string }) {
  const isNew = useSearchParams().get("new") === "1";
  const { state, reload } = useLoad(() => saveMeal.getReservation(id), [id], 10_000);
  const [token, setToken] = useState<PickupToken | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fetching = useRef(false);

  const r: Reservation | null = state.kind === "ready" ? state.data : null;
  const active = r?.status === "RESERVED";
  const current = token ?? r?.pickupToken ?? null;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active || fetching.current || !needsNewToken(current, now)) return;
    fetching.current = true;
    saveMeal
      .newPickupToken(id)
      .then((tk) => {
        setToken(tk);
        setTokenError(null);
      })
      .catch((err: unknown) => setTokenError(err instanceof Error ? err.message : "Không tạo được mã QR."))
      .finally(() => {
        fetching.current = false;
      });
    // Re-check whenever the clock ticks past the refresh threshold.
  }, [active, current, now, id]);

  if (state.kind === "loading") return <ScreenHeader title="Đơn của tôi" backHref="/orders" />;
  if (state.kind === "error" || !r) {
    return (
      <>
        <ScreenHeader title="Đơn của tôi" backHref="/orders" />
        <div className={styles.body}>
          <Notice tone="error">{state.kind === "error" ? state.error.message : "Không tải được đơn."}</Notice>
          <Button variant="secondary" onClick={reload}>
            Thử lại
          </Button>
        </div>
      </>
    );
  }

  const left = current ? secondsLeft(current.expiresAt, now) : 0;

  return (
    <>
      <ScreenHeader title={active ? "Mã nhận món" : "Chi tiết đơn hàng"} backHref="/orders" />
      <div className={styles.body}>
        {active ? (
          <>
            {isNew ? <Notice tone="success">Đã giữ suất thành công!</Notice> : null}
            <p className={styles.center}>Đưa mã này cho người bán khi nhận món</p>
            {current ? <QrCode value={current.qrPayload} label={`Mã QR nhận món ${r.code}`} /> : <div className={styles.qrWait} aria-busy="true" />}
            <p className={styles.code}>{r.code}</p>
            <p className={styles.centerSmall}>
              {current ? `Mã QR tự làm mới sau ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} · dùng một lần` : "Đang tạo mã…"}
            </p>
            {tokenError ? <Notice tone="error">{tokenError}</Notice> : null}
          </>
        ) : (
          <Notice tone={r.status === "COMPLETED" ? "success" : "info"}>
            <p>
              <b>{RESERVATION_STATUS_LABEL[r.status]}</b>
              {r.status === "COMPLETED" ? " · Cảm ơn bạn đã cứu một phần ăn ngon!" : null}
              {r.status === "CANCELLED" && r.cancelReason ? ` · ${CANCEL_REASON_LABEL[r.cancelReason]}` : null}
              {r.status === "EXPIRED" ? " · Đơn đã quá giờ nhận." : null}
            </p>
          </Notice>
        )}

        <section className={styles.card}>
          <p className={styles.cardTitle}>
            {r.listing.title} · {r.quantity} suất
          </p>
          <p className={styles.cardMeta}>{r.seller.name}</p>
          <dl className={styles.facts}>
            <div>
              <dt>Trạng thái</dt>
              <dd>{RESERVATION_STATUS_LABEL[r.status]}</dd>
            </div>
            <div>
              <dt>Giờ nhận</dt>
              <dd>
                {formatPickupDay(r.listing.pickupStart)} {formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}
              </dd>
            </div>
            <div>
              <dt>Địa điểm</dt>
              <dd>{r.listing.pickup.address}</dd>
            </div>
            <div>
              <dt>Trả trực tiếp cho người bán</dt>
              <dd>{r.totalPrice === 0 ? "Miễn phí" : formatVnd(r.totalPrice)}</dd>
            </div>
          </dl>
          <a
            className={styles.link}
            href={`https://www.openstreetmap.org/?mlat=${r.listing.pickup.lat}&mlon=${r.listing.pickup.lng}#map=18/${r.listing.pickup.lat}/${r.listing.pickup.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Chỉ đường đến điểm nhận
          </a>
        </section>

        {r.canCancel ? (
          <Link className={styles.danger} href={`/orders/${r.id}/cancel`}>
            Hủy đơn
          </Link>
        ) : null}
        {r.status !== "RESERVED" ? (
          <Link className={styles.link} href="/">
            Khám phá món khác
          </Link>
        ) : null}
      </div>
    </>
  );
}
