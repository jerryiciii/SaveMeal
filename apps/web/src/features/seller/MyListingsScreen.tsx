"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Chip, Notice } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { sellerApi } from "@/lib/api/sellerEndpoints";
import { ApiError } from "@/lib/contract/errors";
import type { ListingStatus } from "@/lib/contract/types";
import { formatCardPrice, formatPickupDay, formatPickupWindow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import styles from "./seller.module.css";

const STATUS: Record<ListingStatus, string> = {
  DRAFT: "Bản nháp",
  PUBLISHED: "Đang hiển thị",
  EXPIRED: "Hết giờ",
  WITHDRAWN: "Đã rút",
  BLOCKED: "Đã bị gỡ",
};

const DANGER_BTN_STYLE = {
  background: "var(--danger-soft)",
  border: 0,
  padding: "6px 12px",
  borderRadius: "999px",
  color: "var(--danger)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const MUTED_BTN_STYLE = {
  background: "var(--field)",
  border: 0,
  padding: "6px 12px",
  borderRadius: "999px",
  color: "var(--muted)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
} as const;

/** Figma V1 29 · Tin đang đăng & quản lý (10:2). LIST-8, LIST-5, polled every 30 s. */
export function MyListingsScreen() {
  const [tab, setTab] = useState<"active" | "done">("active");
  const { state, reload, setData } = useLoad(() => saveMeal.myListings(tab), [tab], 30_000);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDeleteDraft(listingId: string) {
    setDeletingId(listingId);
    setActionError(null);
    try {
      await sellerApi.deleteDraftListing(listingId);
      setConfirmDeleteId(null);
      if (state.kind === "ready") {
        setData({ ...state.data, data: state.data.data.filter((item) => item.id !== listingId) });
      } else {
        reload();
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Không thể xóa bản nháp. Vui lòng thử lại.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={styles.body}>
      <h1 className={styles.h1}>Tin của tôi</h1>
      <p className={styles.lead}>Quản lý những món đang hiển thị</p>
      <div className={styles.row}>
        <Chip
          selected={tab === "active"}
          onClick={() => {
            setTab("active");
            setConfirmDeleteId(null);
            setActionError(null);
          }}
        >
          Đang đăng
        </Chip>
        <Chip
          selected={tab === "done"}
          onClick={() => {
            setTab("done");
            setConfirmDeleteId(null);
            setActionError(null);
          }}
        >
          Đã kết thúc
        </Chip>
      </div>
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      {state.kind === "loading" ? (
        <p className={styles.meta}>Đang tải…</p>
      ) : state.kind === "error" ? (
        <>
          <Notice tone="error">{state.error.message}</Notice>
          <Button variant="secondary" onClick={reload}>
            Thử lại
          </Button>
        </>
      ) : state.data.data.length === 0 ? (
        <Notice>
          <p>{tab === "active" ? "Bạn chưa có tin nào đang đăng." : "Chưa có tin nào kết thúc."}</p>
        </Notice>
      ) : (
        <ul className={styles.list}>
          {state.data.data.map((l) => (
            <li key={l.id} className={styles.card}>
              <div className={styles.cardTop}>
                <b>{l.title || "(chưa đặt tên)"}</b>
                <span className={l.status === "PUBLISHED" && !l.underReview ? styles.badge : styles.badgeMuted}>
                  {l.status === "PUBLISHED" && l.underReview ? "Đang xem xét" : STATUS[l.status]}
                </span>
              </div>
              <p className={styles.meta}>
                {formatCardPrice(l.price)} · còn {l.quantityAvailable}/{l.quantityTotal} suất
                {l.pickupStart ? ` · ${formatPickupDay(l.pickupStart)} ${formatPickupWindow(l.pickupStart, l.pickupEnd)}` : ""}
              </p>
              <p className={styles.meta}>
                {l.reservedCount > 0 ? `${l.reservedCount} suất đang được giữ` : "Chưa có đơn đặt"}
                {l.completedCount > 0 ? ` · ${l.completedCount} suất đã giao` : ""}
              </p>
              <div className={styles.row}>
                {l.status === "DRAFT" ? (
                  <>
                    <Link className={styles.link} href={`/post/${l.id}/details`}>
                      Tiếp tục
                    </Link>
                    {confirmDeleteId === l.id ? (
                      <>
                        <button
                          type="button"
                          style={DANGER_BTN_STYLE}
                          disabled={deletingId === l.id}
                          onClick={() => void handleDeleteDraft(l.id)}
                        >
                          {deletingId === l.id ? "Đang xóa…" : "Xác nhận xóa"}
                        </button>
                        <button
                          type="button"
                          style={MUTED_BTN_STYLE}
                          disabled={deletingId === l.id}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        style={DANGER_BTN_STYLE}
                        onClick={() => {
                          setActionError(null);
                          setConfirmDeleteId(l.id);
                        }}
                      >
                        Xóa nháp
                      </button>
                    )}
                  </>
                ) : l.status === "PUBLISHED" ? (
                  <>
                    <Link className={styles.link} href={`/my-listings/${l.id}/edit`}>
                      Chỉnh sửa / Gỡ tin
                    </Link>
                    <Link className={styles.link} href={`/listings/${l.id}`}>
                      Xem tin
                    </Link>
                  </>
                ) : (
                  <Link className={styles.link} href={`/listings/${l.id}`}>
                    Xem tin
                  </Link>
                )}
                {l.reservedCount > 0 ? (
                  <Link className={styles.link} href="/sales">
                    Đơn chờ nhận
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link className={styles.primaryLink} href="/post">
        + Đăng món mới
      </Link>
    </section>
  );
}
