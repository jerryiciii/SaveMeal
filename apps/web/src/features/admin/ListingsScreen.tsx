"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Chip, Notice, TextArea } from "@/components/ui";
import { adminApi } from "@/lib/api/adminEndpoints";
import { ApiError } from "@/lib/contract/errors";
import type { ListingOwnerView, ListingStatus } from "@/lib/contract/types";
import { formatCardPrice, formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { CATEGORY_LABEL } from "@/features/post/labels";
import styles from "./admin.module.css";
import { formatDateTime, LISTING_STATUS_LABEL } from "./labels";

const LISTING_STATUSES: ListingStatus[] = ["PUBLISHED", "DRAFT", "EXPIRED", "WITHDRAWN", "BLOCKED"];

function listingStatusBadge(status: ListingStatus): string {
  if (status === "PUBLISHED") return styles.badgeMint ?? "";
  if (status === "BLOCKED") return styles.badgeAlert ?? "";
  if (status === "EXPIRED") return styles.badgeOrange ?? "";
  return styles.badgeMuted ?? "";
}

export function ListingsScreen() {
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "">("");
  const [underReviewOnly, setUnderReviewOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useLoad<ListingOwnerView[]>(
    () =>
      adminApi
        .listListings({
          status: statusFilter || undefined,
          underReview: underReviewOnly ? true : undefined,
          from: from || undefined,
          to: to || undefined,
          limit: 50,
        })
        .then((r) => r.data),
    [statusFilter, underReviewOnly, from, to],
  );

  function handleBlocked(updated: ListingOwnerView) {
    if (load.state.kind === "ready") {
      load.setData(load.state.data.map((l) => (l.id === updated.id ? updated : l)));
    }
    setBlockingId(null);
    setFlash(`Đã khóa tin "${updated.title}". Các đơn đang giữ suất (nếu có) đã được hủy.`);
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Quản lý tin đăng</h1>
          <p className={styles.pageSubtitle}>Theo dõi tin đang hiển thị, tin đang bị gắn cờ xem xét và khóa tin vi phạm.</p>
        </div>
        <button type="button" className={styles.compactButton} onClick={load.reload}>
          Làm mới
        </button>
      </div>

      {flash ? (
        <Notice tone="success">
          <p>{flash}</p>
        </Notice>
      ) : null}

      <section className={styles.filterPanel} aria-label="Bộ lọc tin đăng">
        <div className={styles.chipRow}>
          <Chip selected={statusFilter === ""} onClick={() => setStatusFilter("")}>
            Tất cả trạng thái
          </Chip>
          {LISTING_STATUSES.map((s) => (
            <Chip key={s} selected={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {LISTING_STATUS_LABEL[s]}
            </Chip>
          ))}
          <Chip selected={underReviewOnly} onClick={() => setUnderReviewOnly((v) => !v)}>
            Đang xem xét (underReview)
          </Chip>
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
        <div className={styles.emptyBox}>Đang tải danh sách tin đăng…</div>
      ) : load.state.kind === "error" ? (
        <Notice tone="error">
          <p>{load.state.error.message}</p>
        </Notice>
      ) : load.state.data.length === 0 ? (
        <div className={styles.emptyBox}>Không có tin đăng nào phù hợp với bộ lọc hiện tại.</div>
      ) : (
        <div className={styles.cardList}>
          {load.state.data.map((listing) => {
            const canBlock = listing.status === "PUBLISHED" || listing.status === "EXPIRED";
            return (
              <article key={listing.id} className={styles.itemCard}>
                <div className={styles.itemHeader}>
                  <div className={styles.listingCardRow}>
                    {listing.image ? (
                      <Image
                        src={listing.image.url}
                        alt={listing.title}
                        width={68}
                        height={68}
                        unoptimized
                        className={styles.thumb}
                      />
                    ) : (
                      <div className={styles.thumbFallback}>Chưa có ảnh</div>
                    )}

                    <div className={styles.itemTitleGroup}>
                      <div className={styles.badgeRow}>
                        <span className={`${styles.badge} ${listingStatusBadge(listing.status)}`}>
                          {LISTING_STATUS_LABEL[listing.status]}
                        </span>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          {CATEGORY_LABEL[listing.category]}
                        </span>
                        {listing.underReview ? (
                          <span className={`${styles.badge} ${styles.badgeAlert}`}>Đang xem xét</span>
                        ) : null}
                        {listing.seller.verified ? (
                          <span className={`${styles.badge} ${styles.badgeSky}`}>Đã xác minh</span>
                        ) : null}
                      </div>

                      <h2 className={styles.itemTitle}>{listing.title || "(Chưa có tiêu đề)"}</h2>

                      <p className={styles.itemMeta}>
                        <span>Người bán: <b>{listing.seller.name}</b></span>
                        <span>
                          <span className={listing.isFree ? styles.priceFree : styles.priceInline}>
                            {formatCardPrice(listing.price)}
                          </span>
                          {listing.originalPrice ? (
                            <span className={styles.priceOriginal}>{formatVnd(listing.originalPrice)}</span>
                          ) : null}
                        </span>
                        {listing.pickupStart && listing.pickupEnd ? (
                          <span>
                            Nhận: {formatPickupWindow(listing.pickupStart, listing.pickupEnd)} ({formatPickupDay(listing.pickupStart)})
                          </span>
                        ) : null}
                      </p>

                      <p className={styles.itemMeta}>
                        <span className={styles.tabular}>
                          Còn {listing.quantityAvailable}/{listing.quantityTotal} suất · Đang giữ {listing.reservedCount} · Hoàn tất{" "}
                          {listing.completedCount}
                        </span>
                        {listing.pickup.address ? <span>{listing.pickup.address}</span> : null}
                        <span className={styles.mono}>#{listing.id}</span>
                        <span>Tạo: {formatDateTime(listing.createdAt)}</span>
                      </p>
                    </div>
                  </div>

                  {canBlock ? (
                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        className={`${styles.compactButton} ${
                          blockingId === listing.id ? "" : styles.compactButtonDanger
                        }`}
                        onClick={() => setBlockingId(blockingId === listing.id ? null : listing.id)}
                      >
                        {blockingId === listing.id ? "Đóng" : "Khóa tin"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {listing.blockedReason ? (
                  <Notice tone="error">
                    <p>
                      <b>Lý do khóa:</b> {listing.blockedReason}
                    </p>
                  </Notice>
                ) : listing.closeReason ? (
                  <Notice>
                    <p>
                      <b>Lý do đóng tin:</b> {listing.closeReason}
                    </p>
                  </Notice>
                ) : null}

                {blockingId === listing.id ? (
                  <BlockListingForm
                    listing={listing}
                    onCancel={() => setBlockingId(null)}
                    onBlocked={handleBlocked}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function BlockListingForm({
  listing,
  onCancel,
  onBlocked,
}: {
  listing: ListingOwnerView;
  onCancel: () => void;
  onBlocked: (updated: ListingOwnerView) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Vui lòng nhập lý do khóa tin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await adminApi.blockListing(listing.id, trimmed);
      onBlocked(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể khóa tin này.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.inlineForm} onSubmit={onSubmit}>
      <Notice tone="error">
        <p>
          <b>Cảnh báo:</b> Khóa tin sẽ lập tức gỡ tin khỏi bản đồ và <b>tự động hủy toàn bộ đơn đang giữ suất</b>
          {listing.reservedCount > 0 ? ` (hiện có ${listing.reservedCount} suất đang được giữ)` : ""} với lý do &ldquo;Tin đã bị gỡ&rdquo;.
        </p>
      </Notice>

      <TextArea
        id={`block-reason-${listing.id}`}
        label="Lý do khóa tin (bắt buộc)"
        placeholder="Ví dụ: Sản phẩm không đúng mô tả hoặc vi phạm quy định an toàn thực phẩm…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error}
      />

      <div className={styles.actionRow}>
        <button type="submit" disabled={busy} className={`${styles.compactButton} ${styles.compactButtonDanger}`}>
          {busy ? "Đang khóa tin…" : "Xác nhận khóa tin"}
        </button>
        <button type="button" disabled={busy} className={styles.compactButton} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  );
}
