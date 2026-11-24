"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Notice, QrCode, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { Image as UploadedImage, PickupToken, Reservation } from "@/lib/contract/types";
import { formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { downscaleImage } from "@/lib/image";
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

function formatMmSs(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function headerTitleFor(status: Reservation["status"]): string {
  if (status === "PENDING_PAYMENT") return "Chuyển khoản cho người bán";
  if (status === "AWAITING_SELLER_CONFIRM") return "Chờ người bán xác nhận";
  if (status === "RESERVED") return "Mã nhận món";
  return "Chi tiết đơn hàng";
}

function pollIntervalFor(status: Reservation["status"] | undefined): number | undefined {
  if (status === "PENDING_PAYMENT" || status === "AWAITING_SELLER_CONFIRM") return 5_000;
  if (status === "RESERVED") return 10_000;
  return undefined;
}

/**
 * Figma V2.1 21 · Chuyển khoản P2P + 06b · Chờ xác nhận + 06 · Nhận mã QR + 18 · Chi tiết đơn.
 * Handles P2P bank QR + proof upload (PAY-2), awaiting seller confirm, and rotating pickup QR (RES-3 / RES-6).
 */
export function OrderScreen({ id }: { id: string }) {
  const isNew = useSearchParams().get("new") === "1";
  const { state, reload, setData } = useLoad(() => saveMeal.getReservation(id), [id]);
  const [token, setToken] = useState<PickupToken | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fetching = useRef(false);

  // Screen 21 (PENDING_PAYMENT) proof upload state
  const [uploadedImg, setUploadedImg] = useState<UploadedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  const r: Reservation | null = state.kind === "ready" ? state.data : null;
  const active = r?.status === "RESERVED";
  const pendingPayment = r?.status === "PENDING_PAYMENT";
  const awaitingConfirm = r?.status === "AWAITING_SELLER_CONFIRM";
  const current = token ?? r?.pickupToken ?? null;
  const pollMs = pollIntervalFor(r?.status);
  const setDataRef = useRef(setData);
  useEffect(() => {
    setDataRef.current = setData;
  });

  useEffect(() => {
    if (!pollMs) return;
    let live = true;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      saveMeal
        .getReservation(id)
        .then((next) => {
          if (live) setDataRef.current(next);
        })
        .catch(() => {
          // Silent background poll; keep last known reservation state.
        });
    }, pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, pollMs]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  async function onPickProof(file: File | null) {
    setProofError(null);
    setUploadedImg(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
    if (!file) return;
    setUploading(true);
    try {
      const blob = await downscaleImage(file);
      const img = await saveMeal.uploadImage(blob, "PAYMENT_PROOF");
      setUploadedImg(img);
    } catch (err) {
      setProofError(err instanceof ApiError ? err.message : "Không tải được ảnh biên lai. Vui lòng thử lại.");
    } finally {
      setUploading(false);
    }
  }

  async function submitProof() {
    if (!r || !uploadedImg) return;
    setSubmittingProof(true);
    setProofError(null);
    try {
      await saveMeal.submitPaymentProof(r.id, uploadedImg.id);
      reload();
    } catch (err) {
      setProofError(err instanceof ApiError ? err.message : "Không gửi được biên lai. Vui lòng thử lại.");
    } finally {
      setSubmittingProof(false);
    }
  }

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
  const payLeft = r.payment?.expiresAt ? secondsLeft(r.payment.expiresAt, now) : 0;
  const payable = r.payableAmount ?? r.totalPrice;
  const paymentConfirmed = r.payment?.status === "CONFIRMED";

  const summaryCard = (
    <div className={styles.ticketBottom}>
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
          <dt>{paymentConfirmed ? "Thanh toán" : "Trả trực tiếp cho người bán"}</dt>
          <dd>{paymentConfirmed ? "0đ (đã chuyển khoản)" : r.totalPrice === 0 ? "Miễn phí" : formatVnd(r.totalPrice)}</dd>
        </div>
      </dl>
      <a
        className={styles.directionBtn}
        href={`https://www.openstreetmap.org/?mlat=${r.listing.pickup.lat}&mlon=${r.listing.pickup.lng}#map=18/${r.listing.pickup.lat}/${r.listing.pickup.lng}`}
        target="_blank"
        rel="noreferrer"
      >
        Chỉ đường đến điểm nhận
      </a>
    </div>
  );

  return (
    <>
      <ScreenHeader title={headerTitleFor(r.status)} backHref="/orders" />
      <div className={styles.body}>
        {active && isNew ? <Notice tone="success">Đã giữ suất thành công!</Notice> : null}

        {pendingPayment ? (
          <>
            <div className={styles.timer} role="status" aria-live="polite">
              <span className={styles.timerLabel}>Giữ suất còn</span>
              <span className={styles.timerPill}>{formatMmSs(payLeft)}</span>
            </div>

            <article className={styles.payCard}>
              <div className={styles.payHeader}>
                <div>
                  <p className={styles.payCaption}>Số tiền chuyển khoản</p>
                  <p className={styles.payAmount}>{formatVnd(payable)}</p>
                </div>
                <span className={styles.feeBadge}>0đ phí sàn</span>
              </div>

              <div className={styles.noteRow}>
                <span className={styles.noteLabel}>Nội dung chuyển khoản</span>
                <span className={styles.notePill}>{r.code}</span>
              </div>

              {r.payment?.sellerQrImage?.url ? (
                <div className={styles.qrFrameWrap}>
                  <div className={styles.qrFrame}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.payment.sellerQrImage.url}
                      alt={`Mã QR ngân hàng của ${r.seller.name}`}
                      className={styles.bankQrImg}
                    />
                  </div>
                  <a
                    href={r.payment.sellerQrImage.url}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.qrOpenLink}
                  >
                    Mở ảnh QR lớn
                  </a>
                </div>
              ) : (
                <Notice tone="info">Người bán chưa đính kèm ảnh QR. Vui lòng kiểm tra lại với người bán.</Notice>
              )}
            </article>

            <section className={styles.upl}>
              <h2 className={styles.uplTitle}>Tải ảnh biên lai chuyển khoản</h2>
              <p className={styles.uplDesc}>
                Chụp màn hình giao dịch thành công để người bán đối chiếu nhanh và mở mã QR nhận món.
              </p>

              <label className={styles.uplPicker}>
                <input
                  type="file"
                  accept="image/*"
                  className={styles.uplInput}
                  disabled={uploading || submittingProof}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    void onPickProof(f);
                  }}
                />
                <span>
                  {uploading ? "Đang tải ảnh lên…" : uploadedImg ? "Đổi ảnh biên lai" : "Chọn ảnh biên lai"}
                </span>
              </label>

              {previewUrl || uploadedImg?.url ? (
                <div className={styles.proofPreview}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl ?? uploadedImg?.url ?? ""}
                    alt="Xem trước biên lai chuyển khoản"
                    className={styles.proofThumb}
                  />
                  <div className={styles.proofPreviewMeta}>
                    <b>{uploading ? "Đang tải ảnh…" : uploadedImg ? "Đã tải biên lai" : "Đang xử lý…"}</b>
                    <span>{uploadedImg ? "Sẵn sàng gửi cho người bán" : "Vui lòng đợi giây lát"}</span>
                  </div>
                </div>
              ) : null}

              {proofError ? <Notice tone="error">{proofError}</Notice> : null}

              <Button onClick={submitProof} disabled={!uploadedImg || uploading || submittingProof}>
                {submittingProof ? "Đang gửi biên lai…" : "Tôi đã chuyển khoản · Gửi biên lai"}
              </Button>
            </section>

            <article className={styles.ticket}>{summaryCard}</article>
          </>
        ) : awaitingConfirm ? (
          <>
            <section className={styles.awaitCard} role="status" aria-live="polite">
              <div className={styles.awaitTop}>
                <span className={styles.dots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className={styles.awaitBadge}>Đang chờ xác nhận</span>
              </div>
              <h2 className={styles.awaitTitle}>Đã gửi biên lai cho người bán</h2>
              <p className={styles.awaitDesc}>
                Hệ thống đã gửi email thông báo cho người bán. Trang sẽ tự động mở mã QR nhận món ngay khi người bán xác
                nhận đã nhận tiền.
              </p>
            </section>

            {r.payment?.proofImage?.url ? (
              <section className={styles.proofCard}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.payment.proofImage.url}
                  alt="Biên lai chuyển khoản đã gửi"
                  className={styles.proofThumb}
                />
                <div className={styles.proofPreviewMeta}>
                  <b>Biên lai đã gửi</b>
                  <span>
                    {formatVnd(payable)} · {r.code}
                  </span>
                </div>
                <a
                  href={r.payment.proofImage.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.proofViewLink}
                >
                  Xem biên lai
                </a>
              </section>
            ) : null}

            <article className={styles.ticket}>{summaryCard}</article>
          </>
        ) : (
          <>
            {!active ? (
              <Notice tone={r.status === "COMPLETED" ? "success" : "info"}>
                <p>
                  <b>{RESERVATION_STATUS_LABEL[r.status]}</b>
                  {r.status === "COMPLETED" ? " · Cảm ơn bạn đã cứu một phần ăn ngon!" : null}
                  {r.status === "CANCELLED" && r.cancelReason ? ` · ${CANCEL_REASON_LABEL[r.cancelReason]}` : null}
                  {r.status === "EXPIRED" ? " · Đơn đã quá giờ nhận." : null}
                </p>
              </Notice>
            ) : null}

            <article className={styles.ticket}>
              {active ? (
                <>
                  <div className={styles.ticketTop}>
                    <div className={styles.ticketBadgeRow}>
                      <span className={styles.statusPill}>{RESERVATION_STATUS_LABEL[r.status]}</span>
                      <span className={styles.centerSmall}>Đưa mã cho người bán</span>
                    </div>
                    {paymentConfirmed ? (
                      <span className={styles.paidBadge}>Đã xác nhận thanh toán · Trả 0đ khi nhận</span>
                    ) : null}
                    <div className={styles.qrWrap}>
                      {current ? (
                        <QrCode value={current.qrPayload} label={`Mã QR nhận món ${r.code}`} />
                      ) : (
                        <div className={styles.qrWait} aria-busy="true" />
                      )}
                    </div>
                    <p className={styles.codePill}>{r.code}</p>
                    <p className={styles.centerSmall}>
                      {current
                        ? `Mã QR tự làm mới sau ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} · dùng một lần`
                        : "Đang tạo mã…"}
                    </p>
                    {tokenError ? <Notice tone="error">{tokenError}</Notice> : null}
                  </div>
                  <div className={styles.perforation} aria-hidden="true" />
                </>
              ) : null}

              {summaryCard}
            </article>
          </>
        )}

        {r.canCancel ? (
          <Link className={styles.danger} href={`/orders/${r.id}/cancel`}>
            Hủy đơn
          </Link>
        ) : null}
        {r.canReport ? (
          <Link
            className={styles.link}
            style={{ textAlign: "center", marginTop: 4 }}
            href={`/report?reservationId=${encodeURIComponent(r.id)}&listingId=${encodeURIComponent(r.listing.id)}`}
          >
            Báo cáo vấn đề
          </Link>
        ) : null}
        {!active && !pendingPayment && !awaitingConfirm ? (
          <Link className={styles.link} href="/">
            Khám phá món khác
          </Link>
        ) : null}
      </div>
    </>
  );
}
