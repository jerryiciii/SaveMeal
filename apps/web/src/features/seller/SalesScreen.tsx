"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Chip, Notice, ScreenHeader, TextArea } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { Reservation } from "@/lib/contract/types";
import { formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { vnTime } from "@/lib/time";
import { useLoad } from "@/lib/useLoad";
import styles from "./seller.module.css";

const REJECT_SUGGESTIONS = [
  "Chưa thấy tiền vào tài khoản",
  "Sai số tiền chuyển khoản",
  "Ảnh chuyển khoản chưa rõ thông tin",
] as const;

function PaymentReviewCard({ reservation: r, onDone }: { reservation: Reservation; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = r.payableAmount ?? r.totalPrice;
  const proofUrl = r.payment?.proofImage?.url ?? null;
  const trimmedReason = reason.trim();
  const busy = confirming || rejecting;

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      await saveMeal.confirmPayment(r.id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xác nhận được thanh toán. Vui lòng thử lại.");
    } finally {
      setConfirming(false);
    }
  }

  async function handleReject() {
    if (trimmedReason.length < 3 || trimmedReason.length > 300) {
      setError("Nhập lý do từ chối từ 3 đến 300 ký tự.");
      return;
    }
    setRejecting(true);
    setError(null);
    try {
      await saveMeal.rejectPayment(r.id, trimmedReason);
      setRejectOpen(false);
      setReason("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không từ chối được đơn lúc này. Vui lòng thử lại.");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <li className={`${styles.card} ${styles.reviewCard}`}>
      <div className={styles.cardTop}>
        <b>{r.code}</b>
        <span className={styles.badgeWarn}>Chờ xác nhận tiền</span>
      </div>

      <p className={styles.meta}>Người mua: {r.buyer?.displayName ?? "—"}</p>
      <p className={styles.meta}>
        {r.listing.title} · {r.quantity} suất · Nhận {formatPickupDay(r.listing.pickupStart)}{" "}
        {formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}
      </p>

      <div className={styles.amountRow}>
        <span className={styles.amountLabel}>Số tiền cần đối chiếu</span>
        <span className={styles.amountStrong}>{formatVnd(amount)}</span>
      </div>

      {proofUrl ? (
        <div className={styles.proofBox}>
          <div className={styles.proofHead}>
            <span className={styles.proofLabel}>Ảnh chụp chuyển khoản</span>
            <a className={styles.proofLink} href={proofUrl} target="_blank" rel="noopener noreferrer">
              Xem ảnh lớn ↗
            </a>
          </div>
          <a href={proofUrl} target="_blank" rel="noopener noreferrer" className={styles.proofImgWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element -- buyer transfer proof URL */}
            <img src={proofUrl} alt={`Ảnh chuyển khoản đơn ${r.code}`} className={styles.proofImg} />
          </a>
        </div>
      ) : (
        <p className={styles.meta}>Chưa có ảnh chứng từ chuyển khoản.</p>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className={styles.reviewActions}>
        <Button variant="lime" onClick={handleConfirm} disabled={busy}>
          {confirming ? "Đang xác nhận…" : "Đã nhận tiền · Mở QR nhận món"}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setRejectOpen((open) => !open);
            setError(null);
          }}
          disabled={busy}
        >
          {rejectOpen ? "Đóng phần từ chối" : "Chưa nhận / Từ chối"}
        </Button>
      </div>

      {rejectOpen ? (
        <div className={styles.rejectBox}>
          <p className={styles.rejectTitle}>Chọn nhanh hoặc nhập lý do từ chối</p>
          <div className={styles.chips}>
            {REJECT_SUGGESTIONS.map((s) => (
              <Chip
                key={s}
                selected={reason === s}
                onClick={() => {
                  setReason(s);
                  setError(null);
                }}
              >
                {s}
              </Chip>
            ))}
          </div>
          <TextArea
            label="Lý do từ chối (gửi cho người mua)"
            placeholder="Ví dụ: Chưa thấy tiền vào tài khoản sau khi kiểm tra sao kê"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            hint={`${trimmedReason.length}/300 ký tự (tối thiểu 3 ký tự).`}
          />
          <div className={styles.rejectFooter}>
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={busy || trimmedReason.length < 3 || trimmedReason.length > 300}
            >
              {rejecting ? "Đang gửi từ chối…" : "Xác nhận từ chối"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Figma V1 30 / V2.1 30b · Đơn bán & xác nhận chuyển khoản P2P.
 * Polls RES-5 (`AWAITING_SELLER_CONFIRM,RESERVED,PENDING_PAYMENT`) every 15s.
 */
export function SalesScreen() {
  const { state, reload } = useLoad(
    () => saveMeal.mySales("AWAITING_SELLER_CONFIRM,RESERVED,PENDING_PAYMENT"),
    [],
    15_000,
  );

  const items = state.kind === "ready" ? state.data.data : [];
  const awaitingConfirm = items.filter((r) => r.status === "AWAITING_SELLER_CONFIRM");
  const pendingPayment = items.filter((r) => r.status === "PENDING_PAYMENT");
  const reserved = items.filter((r) => r.status === "RESERVED");

  const subtitle =
    state.kind !== "ready"
      ? undefined
      : awaitingConfirm.length > 0
        ? `${awaitingConfirm.length} đơn chờ xác nhận tiền · ${reserved.length} đơn chờ giao`
        : `Bạn có ${reserved.length} đơn cần giao`;

  return (
    <>
      <ScreenHeader title="Đơn chờ nhận" subtitle={subtitle} />
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
        ) : items.length === 0 ? (
          <Notice>
            <p>Chưa có đơn nào đang chờ. Đơn mới sẽ hiện ở đây.</p>
          </Notice>
        ) : (
          <>
            {awaitingConfirm.length > 0 ? (
              <section className={styles.section} aria-label="Chờ bạn xác nhận tiền">
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Chờ bạn xác nhận tiền</h2>
                  <span className={styles.countBadgeWarn}>{awaitingConfirm.length}</span>
                </div>
                <ul className={styles.list}>
                  {awaitingConfirm.map((r) => (
                    <PaymentReviewCard key={r.id} reservation={r} onDone={reload} />
                  ))}
                </ul>
              </section>
            ) : null}

            {pendingPayment.length > 0 ? (
              <section className={styles.section} aria-label="Đang chờ người mua chuyển khoản">
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Đang chờ người mua chuyển khoản</h2>
                  <span className={styles.countBadgeMuted}>{pendingPayment.length}</span>
                </div>
                <ul className={styles.list}>
                  {pendingPayment.map((r) => (
                    <li key={r.id} className={`${styles.card} ${styles.cardMuted}`}>
                      <div className={styles.cardTop}>
                        <b>{r.code}</b>
                        <span className={styles.badgeMuted}>Đang giữ suất</span>
                      </div>
                      <p className={styles.meta}>
                        Người mua: {r.buyer?.displayName ?? "—"} · {r.listing.title} ({r.quantity} suất)
                      </p>
                      <p className={styles.meta}>
                        {formatVnd(r.payableAmount ?? r.totalPrice)}
                        {r.payment?.expiresAt ? ` · Giữ suất đến ${vnTime(r.payment.expiresAt)}` : " · Đang chờ tải ảnh chuyển khoản"}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={styles.section} aria-label="Đơn chờ giao (đã có QR)">
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Đơn chờ giao (đã có QR)</h2>
                <span className={styles.countBadge}>{reserved.length}</span>
              </div>
              {reserved.length === 0 ? (
                <Notice>
                  <p>Chưa có đơn nào sẵn sàng quét QR giao món.</p>
                </Notice>
              ) : (
                <ul className={styles.list}>
                  {reserved.map((r) => {
                    const paid = r.payment?.status === "CONFIRMED";
                    return (
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
                        {paid ? (
                          <span className={styles.paidBadge}>Đã chuyển khoản · Thu 0đ</span>
                        ) : (
                          <p className={styles.amount}>
                            {r.totalPrice === 0 ? "Miễn phí" : `Thu ${formatVnd(r.totalPrice)} khi giao`}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
