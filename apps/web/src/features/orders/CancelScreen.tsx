"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { CancelReason } from "@/lib/contract/types";
import { useLoad } from "@/lib/useLoad";
import { CANCEL_REASON_LABEL } from "./labels";
import styles from "./orders.module.css";

const REASONS: CancelReason[] = ["BUYER_LATE", "BUYER_WRONG_QTY", "BUYER_CHANGED_PLAN"];

/** Figma V1 39 · Hủy đơn (11:220). RES-4; no deposit/refund in the MVP (payment is offline). */
export function CancelScreen({ id }: { id: string }) {
  const router = useRouter();
  const { state } = useLoad(() => saveMeal.getReservation(id), [id]);
  const [reason, setReason] = useState<CancelReason>("BUYER_CHANGED_PLAN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await saveMeal.cancelReservation(id, reason);
      router.replace(`/orders/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không hủy được đơn.");
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Hủy đơn đặt giữ" backHref={`/orders/${id}`} />
      <div className={styles.body}>
        <h2 style={{ margin: 0, fontSize: 24 }}>Bạn có chắc muốn hủy?</h2>
        {state.kind === "ready" ? (
          <p className={styles.orderMeta}>
            Đơn {state.data.code} · {state.data.listing.title}
          </p>
        ) : null}
        <fieldset className={styles.reasons}>
          <legend className={styles.orderMeta} style={{ marginBottom: 8 }}>
            Lý do hủy
          </legend>
          {REASONS.map((r) => (
            <label key={r} className={styles.reason}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {CANCEL_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <Notice>
          <p>Suất bạn hủy sẽ được trả lại để người khác có thể đặt.</p>
        </Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button onClick={cancel} disabled={busy}>
          {busy ? "Đang hủy…" : "Xác nhận hủy đơn"}
        </Button>
        <Button variant="secondary" onClick={() => router.replace(`/orders/${id}`)}>
          Giữ đơn và quay lại
        </Button>
      </div>
    </>
  );
}
