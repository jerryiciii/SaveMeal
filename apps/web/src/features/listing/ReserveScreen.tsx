"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import { formatCardPrice, formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import styles from "./reserve.module.css";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** Figma V1 05 · Xác nhận đặt giữ (2:266): quantity stepper + atomic reserve (RES-1 with Idempotency-Key). */
export function ReserveScreen({ id }: { id: string }) {
  const router = useRouter();
  const { state } = useLoad(() => Promise.all([saveMeal.getListing(id), saveMeal.getConfig()]), [id]);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per screen visit: a double tap or retry never creates two reservations.
  const [idemKey] = useState(newKey);

  if (state.kind === "loading") return <ScreenHeader title="Xác nhận đặt giữ" />;
  if (state.kind === "error") {
    return (
      <>
        <ScreenHeader title="Xác nhận đặt giữ" />
        <div className={styles.body}>
          <Notice tone="error">{state.error.message}</Notice>
        </div>
      </>
    );
  }
  const [l, config] = state.data;
  const max = Math.max(1, Math.min(config.limits.maxQtyPerReservation, l.quantityAvailable));

  async function reserve() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveMeal.reserve(l.id, qty, idemKey);
      router.replace(`/orders/${r.id}?new=1`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_RESERVED" && typeof err.details?.reservationId === "string") {
        router.replace(`/orders/${err.details.reservationId}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Không giữ được suất. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Xác nhận đặt giữ" subtitle="Kiểm tra trước khi đặt" />
      <div className={styles.body}>
        <section className={styles.card}>
          <h2 className={styles.name}>{l.title}</h2>
          <p className={styles.meta}>{l.seller.name}</p>
          <p className={l.isFree ? styles.free : styles.price}>{formatCardPrice(l.price)}</p>
        </section>

        <section className={styles.row}>
          <span>Số lượng</span>
          <div className={styles.stepper}>
            <button type="button" aria-label="Bớt một suất" disabled={qty <= 1} onClick={() => setQty((n) => n - 1)}>
              −
            </button>
            <output aria-live="polite">{qty}</output>
            <button type="button" aria-label="Thêm một suất" disabled={qty >= max} onClick={() => setQty((n) => n + 1)}>
              +
            </button>
          </div>
        </section>

        <section className={styles.row}>
          <span>Đến nhận</span>
          <b>
            {formatPickupDay(l.pickupStart)} {formatPickupWindow(l.pickupStart, l.pickupEnd)}
          </b>
        </section>
        <section className={styles.row}>
          <span>Địa điểm</span>
          <b className={styles.addr}>{l.pickup.address}</b>
        </section>
        <section className={styles.row}>
          <span>Thanh toán khi nhận</span>
          <b>{formatVnd(l.price * qty)}</b>
        </section>

        <Notice>
          <p>
            <b>Lưu ý:</b> Bạn nhận tại quầy và trả tiền trực tiếp cho người bán (tiền mặt hoặc chuyển khoản). SaveMeal không giữ tiền.
            QR xác nhận giao nhận, không bảo đảm chất lượng thực phẩm.
          </p>
        </Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button onClick={reserve} disabled={busy || l.soldOut}>
          {busy ? "Đang giữ suất…" : "Xác nhận đặt giữ"}
        </Button>
      </div>
    </>
  );
}
