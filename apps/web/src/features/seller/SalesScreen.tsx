"use client";

import Link from "next/link";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import styles from "./seller.module.css";

/** Figma V1 30 · Đơn đang chờ người nhận (10:43). RES-5, polled every 30 s (no push in the MVP). */
export function SalesScreen() {
  const { state, reload } = useLoad(() => saveMeal.mySales("RESERVED"), [], 30_000);
  const count = state.kind === "ready" ? state.data.data.length : 0;

  return (
    <>
      <ScreenHeader title="Đơn chờ nhận" subtitle={state.kind === "ready" ? `Bạn có ${count} đơn cần giao` : undefined} />
      <div className={styles.bodyTight}>
        <Link className={styles.primaryLink} href="/sales/scan">
          Mở máy quét QR
        </Link>
        {state.kind === "loading" ? (
          <p className={styles.meta}>Đang tải…</p>
        ) : state.kind === "error" ? (
          <>
            <Notice tone="error">{state.error.message}</Notice>
            <Button variant="secondary" onClick={reload}>
              Thử lại
            </Button>
          </>
        ) : count === 0 ? (
          <Notice>
            <p>Chưa có đơn nào đang chờ. Đơn mới sẽ hiện ở đây.</p>
          </Notice>
        ) : (
          <ul className={styles.list}>
            {state.data.data.map((r) => (
              <li key={r.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <b>{r.code}</b>
                  <span className={styles.badge}>Đã giữ suất</span>
                </div>
                <p className={styles.meta}>Người nhận: {r.buyer?.displayName ?? "—"}</p>
                <p className={styles.meta}>
                  {r.listing.title} · {r.quantity} suất · Nhận {formatPickupDay(r.listing.pickupStart)}{" "}
                  {formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}
                </p>
                <p className={styles.amount}>{r.totalPrice === 0 ? "Miễn phí" : `Thu ${formatVnd(r.totalPrice)} khi giao`}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
