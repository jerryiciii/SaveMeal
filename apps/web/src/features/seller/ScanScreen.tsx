"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ScreenHeader, TextField } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import type { PickupLookup, PickupProof } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/contract/errors";
import { formatPickupWindow, formatVnd } from "@/lib/format";
import styles from "./seller.module.css";

const QrScanner = dynamic(() => import("./QrScanner").then((m) => m.QrScanner), { ssr: false });

const BLOCKING: Record<NonNullable<PickupLookup["blockingReason"]>, string> = {
  TOO_EARLY: "Chưa đến giờ nhận.",
  WINDOW_CLOSED: "Đơn đã quá giờ nhận.",
  NOT_ACTIVE: "Đơn này không còn hiệu lực (đã giao, đã hủy hoặc hết giờ).",
  TOKEN_EXPIRED: "Mã QR đã hết hạn. Nhờ người mua mở lại mã trên điện thoại.",
  TOKEN_USED: "Mã QR này đã được dùng.",
  LISTING_BLOCKED: "Tin này đã bị gỡ.",
};

/** "SM–4281", "sm 4281", "4281" → "4281" (manual fallback code, 4 digits). */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 4);
}

/**
 * Figma V1 31 · Quét QR và nhập mã (10:68): scan the buyer's QR (or type the
 * 4-digit code) → RES-7 lookup → seller collects payment offline → RES-8 confirm.
 */
export function ScanScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [proof, setProof] = useState<PickupProof | null>(null);
  const [lookup, setLookup] = useState<PickupLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(p: PickupProof) {
    setBusy(true);
    setError(null);
    try {
      const res = await saveMeal.lookupPickup(p);
      setProof(p);
      setLookup(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đối chiếu được mã.");
    } finally {
      setBusy(false);
    }
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length !== 4) {
      setError("Nhập đủ 4 số của mã đơn (SM–____).");
      return;
    }
    void find({ code: c });
  }

  async function confirm() {
    if (!lookup || !proof) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveMeal.confirmPickup(lookup.reservation.id, proof);
      const q = new URLSearchParams({
        code: res.reservation.code,
        title: res.reservation.listing.title,
        qty: String(res.reservation.quantity),
        left: String(res.listingRemaining),
      });
      router.replace(`/sales/done?${q.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xác nhận được giao món.");
      setBusy(false);
    }
  }

  function reset() {
    setLookup(null);
    setProof(null);
    setError(null);
    setCode("");
  }

  const r = lookup?.reservation;

  return (
    <>
      <ScreenHeader title="Đối chiếu mã nhận" subtitle="Đặt mã QR trong khung" backHref="/sales" />
      <div className={styles.bodyTight}>
        {!lookup ? (
          <>
            <QrScanner paused={busy} onScan={(payload) => void find({ qrPayload: payload })} />
            <form onSubmit={submitCode} className={styles.bodyTight} style={{ padding: 0 }} noValidate>
              <TextField
                label="Hoặc nhập mã nếu không thể quét"
                className={styles.codeInput}
                placeholder="SM– _ _ _ _"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={busy}>
                {busy ? "Đang đối chiếu…" : "Tìm đơn"}
              </Button>
            </form>
          </>
        ) : r ? (
          <section className={styles.card}>
            <div className={styles.cardTop}>
              <b>{r.code}</b>
              <span className={lookup.canConfirm ? styles.badge : styles.badgeMuted}>{lookup.canConfirm ? "Hợp lệ" : "Chưa thể giao"}</span>
            </div>
            <p className={styles.meta}>Người nhận: {r.buyer?.displayName ?? "—"}</p>
            <p className={styles.meta}>
              {r.listing.title} · {r.quantity} suất · {formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}
            </p>
            <p className={styles.amount}>
              {lookup.amountToCollect === 0 ? "Món miễn phí, không thu tiền" : `Thu trực tiếp ${formatVnd(lookup.amountToCollect)}`}
            </p>
            {lookup.blockingReason ? <Notice tone="error">{BLOCKING[lookup.blockingReason]}</Notice> : null}
          </section>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {lookup ? (
          <>
            <Button onClick={confirm} disabled={busy || !lookup.canConfirm}>
              {busy ? "Đang xác nhận…" : "Xác nhận giao món"}
            </Button>
            <Button variant="secondary" onClick={reset}>
              Quét mã khác
            </Button>
          </>
        ) : null}
        <Notice>
          <p>Mã QR chỉ xác nhận việc giao nhận đúng đơn. Thanh toán diễn ra trực tiếp giữa hai bên.</p>
        </Notice>
      </div>
    </>
  );
}
