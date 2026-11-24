"use client";

import { useState } from "react";
import { Chip, Notice } from "@/components/ui";
import { CANCEL_REASON_LABEL, RESERVATION_STATUS_LABEL } from "@/features/orders/labels";
import { adminApi } from "@/lib/api/adminEndpoints";
import type { Reservation, ReservationStatus } from "@/lib/contract/types";
import { formatOrderCode, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import styles from "./admin.module.css";
import { formatDateTime } from "./labels";

const RESERVATION_STATUSES: ReservationStatus[] = ["RESERVED", "COMPLETED", "CANCELLED", "EXPIRED"];

function reservationBadge(status: ReservationStatus): string {
  if (status === "COMPLETED") return styles.badgeMint ?? "";
  if (status === "RESERVED") return styles.badgeSky ?? "";
  if (status === "EXPIRED") return styles.badgeOrange ?? "";
  return styles.badgeAlert ?? "";
}

export function ReservationsScreen() {
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useLoad<Reservation[]>(
    () =>
      adminApi
        .listReservations({
          status: statusFilter || undefined,
          from: from || undefined,
          to: to || undefined,
          limit: 50,
        })
        .then((r) => r.data),
    [statusFilter, from, to],
  );

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Đơn đặt giữ</h1>
          <p className={styles.pageSubtitle}>
            Theo dõi trạng thái đơn giữ chỗ toàn hệ thống. Mã QR bàn giao không hiển thị ở giao diện quản trị.
          </p>
        </div>
        <button type="button" className={styles.compactButton} onClick={load.reload}>
          Làm mới
        </button>
      </div>

      <aside className={styles.privacyBanner} role="note" aria-label="Quy tắc bảo mật mã nhận món">
        <span className={styles.privacyIcon} aria-hidden="true">
          i
        </span>
        <div>
          <span className={styles.privacyTitle}>Bảo mật bàn giao:</span> Mã QR nhận món (<code className={styles.mono}>pickupToken</code>) không bao giờ được hiển thị trên giao diện Admin.
        </div>
      </aside>

      <section className={styles.filterPanel} aria-label="Bộ lọc đơn giữ chỗ">
        <div className={styles.chipRow}>
          <Chip selected={statusFilter === ""} onClick={() => setStatusFilter("")}>
            Tất cả trạng thái
          </Chip>
          {RESERVATION_STATUSES.map((s) => (
            <Chip key={s} selected={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {RESERVATION_STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>

        <div className={styles.filterControls}>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Từ ngày</span>
            <input type="date" className={styles.compactInput} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Đến ngày</span>
            <input type="date" className={styles.compactInput} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </section>

      {load.state.kind === "loading" ? (
        <div className={styles.emptyBox}>Đang tải danh sách đơn đặt giữ…</div>
      ) : load.state.kind === "error" ? (
        <Notice tone="error">
          <p>{load.state.error.message}</p>
        </Notice>
      ) : load.state.data.length === 0 ? (
        <div className={styles.emptyBox}>Không có đơn đặt giữ nào phù hợp với bộ lọc hiện tại.</div>
      ) : (
        <>
          {/* Desktop table — NEVER renders pickupToken */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Món &amp; khung giờ</th>
                  <th>Người mua</th>
                  <th>Người bán</th>
                  <th>Số suất</th>
                  <th>Tổng tiền</th>
                  <th>Trạng thái</th>
                  <th>Thời gian tạo</th>
                </tr>
              </thead>
              <tbody>
                {load.state.data.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.orderCode}>{formatOrderCode(r.code)}</td>
                    <td>
                      <div>
                        <b>{r.listing.title}</b>
                      </div>
                      {r.listing.pickupStart && r.listing.pickupEnd ? (
                        <div className={styles.itemMeta}>
                          {formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}
                        </div>
                      ) : null}
                    </td>
                    <td>{r.buyer?.displayName ?? "—"}</td>
                    <td>{r.seller.name}</td>
                    <td className={styles.tabular}>{r.quantity} suất</td>
                    <td className={styles.tabular}>
                      {r.totalPrice === 0 ? (
                        <span className={styles.priceFree}>0đ (Miễn phí)</span>
                      ) : (
                        <span className={styles.priceInline}>{formatVnd(r.totalPrice)}</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.badgeRow}>
                        <span className={`${styles.badge} ${reservationBadge(r.status)}`}>
                          {RESERVATION_STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      {r.cancelReason ? (
                        <div className={styles.itemMeta}>{CANCEL_REASON_LABEL[r.cancelReason]}</div>
                      ) : null}
                    </td>
                    <td className={styles.tabular}>{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards — NEVER renders pickupToken */}
          <div className={styles.mobileCards}>
            {load.state.data.map((r) => (
              <article key={r.id} className={styles.itemCard}>
                <div className={styles.itemHeader}>
                  <span className={styles.orderCode}>{formatOrderCode(r.code)}</span>
                  <span className={`${styles.badge} ${reservationBadge(r.status)}`}>
                    {RESERVATION_STATUS_LABEL[r.status]}
                  </span>
                </div>
                <h2 className={styles.itemTitle}>{r.listing.title}</h2>
                <p className={styles.itemMeta}>
                  <span>Người mua: <b>{r.buyer?.displayName ?? "—"}</b></span>
                  <span>Người bán: <b>{r.seller.name}</b></span>
                </p>
                <p className={styles.itemMeta}>
                  <span className={styles.tabular}>{r.quantity} suất</span>
                  <span className={r.totalPrice === 0 ? styles.priceFree : styles.priceInline}>
                    {r.totalPrice === 0 ? "0đ (Miễn phí)" : formatVnd(r.totalPrice)}
                  </span>
                  {r.listing.pickupStart && r.listing.pickupEnd ? (
                    <span>{formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}</span>
                  ) : null}
                </p>
                <p className={styles.itemMeta}>
                  <span>Tạo lúc {formatDateTime(r.createdAt)}</span>
                  {r.cancelReason ? <span>Lý do: {CANCEL_REASON_LABEL[r.cancelReason]}</span> : null}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
