"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ScreenHeader, TextArea, TextField } from "@/components/ui";
import { STORAGE_LABEL } from "@/features/orders/labels";
import { CATEGORY_LABEL, CHECKLIST_LABEL } from "@/features/post/labels";
import { parseVnd } from "@/features/post/PostStep1";
import { saveMeal } from "@/lib/api";
import type { ListingInput } from "@/lib/api/endpoints";
import { sellerApi, WITHDRAW_REASONS, type WithdrawReason } from "@/lib/api/sellerEndpoints";
import { ApiError } from "@/lib/contract/errors";
import type {
  Allergen,
  Image as ApiImage,
  ListingDetail,
  ListingOwnerView,
  ListingStatus,
} from "@/lib/contract/types";
import { APP_TIME_ZONE, formatCardPrice, formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { downscaleImage } from "@/lib/image";
import { vnIso, vnTime } from "@/lib/time";
import { useLoad } from "@/lib/useLoad";
import styles from "./EditListingScreen.module.css";

const MAX_IMAGES = 4;

const STATUS_LABEL: Record<ListingStatus, string> = {
  DRAFT: "Bản nháp",
  PUBLISHED: "Đang hiển thị",
  EXPIRED: "Hết giờ",
  WITHDRAWN: "Đã gỡ",
  BLOCKED: "Bị khóa",
};

const ALLERGEN_LABEL: Record<Allergen, string> = {
  GLUTEN: "Gluten",
  MILK: "Sữa",
  EGG: "Trứng",
  PEANUT: "Đậu phộng",
  TREE_NUT: "Hạt cây",
  SOY: "Đậu nành",
  FISH: "Cá",
  SHELLFISH: "Hải sản có vỏ",
  SESAME: "Mè",
};

const WITHDRAW_REASON_LABEL: Record<WithdrawReason, string> = {
  STORAGE_NOT_OK: "Điều kiện bảo quản không còn đảm bảo",
  SOLD_ELSEWHERE: "Đã bán hoặc chia sẻ hết nơi khác",
  OTHER: "Lý do khác",
};

function isOwnerView(l: ListingDetail | ListingOwnerView): l is ListingOwnerView {
  return "quantityTotal" in l;
}

function vnDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(new Date(iso));
}

function formatCloseReason(raw: string | null): string | null {
  if (!raw) return null;
  for (const key of WITHDRAW_REASONS) {
    if (raw === key) return WITHDRAW_REASON_LABEL[key];
    if (raw.startsWith(`${key}: `)) {
      return `${WITHDRAW_REASON_LABEL[key]} — ${raw.slice(key.length + 2)}`;
    }
  }
  return raw;
}

/** Figma V1 33 · Chỉnh sửa & tạm dừng tin (11:2). LIST-2, LIST-4, LIST-5, LIST-7, IMG-2. */
export function EditListingScreen({ id }: { id: string }) {
  const { state, reload, setData } = useLoad(() => saveMeal.getListing(id), [id]);

  if (state.kind === "loading") {
    return (
      <>
        <ScreenHeader title="Chỉnh sửa tin đăng" backHref="/my-listings" />
        <div className={styles.body}>
          <p className={styles.meta}>Đang tải thông tin tin đăng…</p>
        </div>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <ScreenHeader title="Chỉnh sửa tin đăng" backHref="/my-listings" />
        <div className={styles.body}>
          <Notice tone="error">
            {state.error.status === 404 ? "Không tìm thấy tin đăng này." : state.error.message}
          </Notice>
          <Button variant="secondary" onClick={reload}>
            Thử lại
          </Button>
          <Link href="/my-listings" className={styles.secondaryLink}>
            Về danh sách tin của tôi
          </Link>
        </div>
      </>
    );
  }

  if (!isOwnerView(state.data)) {
    return (
      <>
        <ScreenHeader title="Chỉnh sửa tin đăng" backHref="/my-listings" />
        <div className={styles.body}>
          <Notice tone="error">Bạn không có quyền chỉnh sửa tin đăng này.</Notice>
          <Link href="/my-listings" className={styles.secondaryLink}>
            Về danh sách tin của tôi
          </Link>
        </div>
      </>
    );
  }

  const listing = state.data;

  if (listing.status === "DRAFT") {
    return <DraftListingView listing={listing} />;
  }

  if (listing.status !== "PUBLISHED") {
    return <ClosedListingView listing={listing} />;
  }

  return <PublishedEditView key={listing.id} listing={listing} onUpdated={(next) => setData(next)} />;
}

function DraftListingView({ listing }: { listing: ListingOwnerView }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeleteDraft() {
    setBusy(true);
    setError(null);
    try {
      await sellerApi.deleteDraftListing(listing.id);
      router.replace("/my-listings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể xóa bản nháp. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Quản lý bản nháp" backHref="/my-listings" />
      <div className={styles.body}>
        <section className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <h2 className={styles.summaryTitle}>{listing.title || "(Chưa đặt tên)"}</h2>
            <span className={styles.badgeMuted}>{STATUS_LABEL.DRAFT}</span>
          </div>
          <p className={styles.meta}>
            {CATEGORY_LABEL[listing.category]} · {formatCardPrice(listing.price)}
            {listing.quantityTotal > 0 ? ` · ${listing.quantityTotal} suất` : ""}
          </p>
          {listing.missing.length > 0 ? (
            <div>
              <p className={styles.meta}>Còn thiếu để đăng tin:</p>
              <ul className={styles.missingList}>
                {listing.missing.map((key) => (
                  <li key={key}>{CHECKLIST_LABEL[key]}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={styles.meta}>Thông tin cơ bản đã đủ. Bạn có thể tiếp tục hoàn tất đăng tin.</p>
          )}
        </section>

        <Link href={`/post/${listing.id}/details`} className={styles.primaryLink}>
          Tiếp tục hoàn thiện & đăng tin
        </Link>

        <section className={styles.dangerSection}>
          <h3 className={styles.dangerTitle}>Xóa bản nháp</h3>
          <p className={styles.meta}>Bản nháp sẽ bị xóa vĩnh viễn khỏi danh sách của bạn.</p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {confirmDelete ? (
            <div className={styles.confirmBox}>
              <p className={styles.meta}>Bạn chắc chắn muốn xóa bản nháp này? Hành động không thể hoàn tác.</p>
              <div className={styles.confirmRow}>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Hủy
                </Button>
                <button type="button" className={styles.dangerBtn} onClick={handleDeleteDraft} disabled={busy}>
                  {busy ? "Đang xóa…" : "Xác nhận xóa"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.dangerBtn} onClick={() => setConfirmDelete(true)}>
              Xóa bản nháp
            </button>
          )}
        </section>
      </div>
    </>
  );
}

function ClosedListingView({ listing }: { listing: ListingOwnerView }) {
  const reasonText = listing.status === "BLOCKED" ? listing.blockedReason : formatCloseReason(listing.closeReason);
  const statusDesc =
    listing.status === "WITHDRAWN"
      ? "Tin đã được gỡ và không còn hiển thị trên bản đồ."
      : listing.status === "BLOCKED"
        ? "Tin đã bị quản trị viên khóa và ẩn khỏi hệ thống."
        : "Tin đã hết giờ nhận và tự động đóng.";

  return (
    <>
      <ScreenHeader title="Tin đã kết thúc" backHref="/my-listings" />
      <div className={styles.body}>
        <section className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <h2 className={styles.summaryTitle}>{listing.title}</h2>
            <span className={listing.status === "BLOCKED" ? styles.badgeAlert : styles.badgeMuted}>
              {STATUS_LABEL[listing.status]}
            </span>
          </div>
          <p className={styles.meta}>
            {formatCardPrice(listing.price)} · đã giao {listing.completedCount}/{listing.quantityTotal} suất
          </p>
        </section>

        <Notice tone={listing.status === "BLOCKED" ? "error" : "info"}>
          <p>{statusDesc}</p>
          {reasonText ? <p style={{ marginTop: 6 }}>Lý do: {reasonText}</p> : null}
        </Notice>

        <Link href="/post" className={styles.primaryLink}>
          + Đăng món mới
        </Link>
        <Link href="/my-listings" className={styles.secondaryLink}>
          Về danh sách tin của tôi
        </Link>
      </div>
    </>
  );
}

function PublishedEditView({
  listing,
  onUpdated,
}: {
  listing: ListingOwnerView;
  onUpdated: (next: ListingOwnerView) => void;
}) {
  const initialImages = listing.images.length > 0 ? listing.images : listing.image ? [listing.image] : [];
  const [images, setImages] = useState<ApiImage[]>(initialImages);
  const [newlyUploadedIds, setNewlyUploadedIds] = useState<string[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description ?? "");
  const [qty, setQty] = useState(String(listing.quantityTotal));
  const [price, setPrice] = useState(String(listing.price));
  const [pickupEndTime, setPickupEndTime] = useState(vnTime(listing.pickupEnd));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [withdrawReason, setWithdrawReason] = useState<WithdrawReason>("SOLD_ELSEWHERE");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const allocatedCount = Math.max(listing.reservedCount, listing.quantityTotal - listing.quantityAvailable);
  const minQty = Math.max(1, allocatedCount);
  const parsedQty = Number(qty);
  const previewAvailable =
    Number.isInteger(parsedQty) && parsedQty >= minQty
      ? listing.quantityAvailable + (parsedQty - listing.quantityTotal)
      : listing.quantityAvailable;

  async function handleAddImage(file: File | null) {
    if (!file) return;
    if (images.length >= MAX_IMAGES) {
      setSaveError(`Tối đa ${MAX_IMAGES} ảnh cho mỗi tin đăng.`);
      return;
    }
    setUploading(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const scaled = await downscaleImage(file);
      const uploaded = await saveMeal.uploadImage(scaled, "LISTING");
      setImages((prev) => [...prev, uploaded]);
      setNewlyUploadedIds((prev) => [...prev, uploaded.id]);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Không tải ảnh lên được. Vui lòng thử lại.");
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveImage(imageId: string) {
    if (images.length <= 1) {
      setSaveError("Tin đang đăng cần có ít nhất 1 ảnh thật của món.");
      return;
    }
    setSaveError(null);
    setSaveSuccess(null);
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    if (newlyUploadedIds.includes(imageId)) {
      setNewlyUploadedIds((prev) => prev.filter((id) => id !== imageId));
      void sellerApi.deleteImage(imageId).catch(() => undefined);
    } else {
      setPendingDeleteIds((prev) => (prev.includes(imageId) ? prev : [...prev, imageId]));
    }
  }

  function stepQty(delta: number) {
    const base = Number.isInteger(parsedQty) ? parsedQty : listing.quantityTotal;
    const next = Math.min(50, Math.max(minQty, base + delta));
    setQty(String(next));
    setSaveSuccess(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 80) {
      return setSaveError("Tên món cần từ 3 đến 80 ký tự.");
    }
    const trimmedDesc = description.trim();
    if (trimmedDesc.length > 500) {
      return setSaveError("Mô tả tối đa 500 ký tự.");
    }
    if (images.length < 1 || images.length > MAX_IMAGES) {
      return setSaveError(`Tin cần từ 1 đến ${MAX_IMAGES} ảnh.`);
    }

    const nextQty = Number(qty);
    if (!Number.isInteger(nextQty) || nextQty < 1 || nextQty > 50) {
      return setSaveError("Tổng số suất phải từ 1 đến 50.");
    }
    if (nextQty < minQty) {
      return setSaveError(
        `Số suất không thể nhỏ hơn ${minQty} (đã có ${listing.reservedCount} suất đang giữ${listing.completedCount > 0 ? ` và ${listing.completedCount} suất đã giao` : ""}).`,
      );
    }

    const nextPrice = parseVnd(price);
    if (nextPrice === null || Number.isNaN(nextPrice) || !Number.isInteger(nextPrice) || nextPrice < 0) {
      return setSaveError("Nhập giá bán hợp lệ (0 nếu tặng miễn phí).");
    }
    if (nextPrice > listing.price) {
      return setSaveError(`Sau khi đăng chỉ có thể giảm giá (tối đa ${formatVnd(listing.price)}).`);
    }

    const currentEndTime = vnTime(listing.pickupEnd);
    let nextPickupEndIso: string | undefined;
    if (pickupEndTime !== currentEndTime) {
      if (!/^\d{2}:\d{2}$/.test(pickupEndTime)) {
        return setSaveError("Giờ kết thúc nhận không hợp lệ.");
      }
      const candidateIso = vnIso(vnDateOf(listing.pickupEnd), pickupEndTime);
      const candidateMs = Date.parse(candidateIso);
      const currentEndMs = Date.parse(listing.pickupEnd);
      const startMs = Date.parse(listing.pickupStart);
      if (candidateMs > currentEndMs) {
        return setSaveError("Không thể kéo dài giờ nhận sau khi đăng. Chỉ có thể rút ngắn sớm hơn.");
      }
      if (candidateMs <= startMs) {
        return setSaveError("Giờ kết thúc phải sau giờ bắt đầu nhận.");
      }
      if (candidateMs <= Date.now()) {
        return setSaveError("Giờ kết thúc phải sau thời điểm hiện tại.");
      }
      nextPickupEndIso = candidateIso;
    }

    const patch: ListingInput = {};
    if (trimmedTitle !== listing.title) patch.title = trimmedTitle;
    const normalizedDesc = trimmedDesc || null;
    if (normalizedDesc !== (listing.description ?? null)) patch.description = normalizedDesc;
    const currentImageIds = (listing.images.length > 0 ? listing.images : listing.image ? [listing.image] : []).map(
      (i) => i.id,
    );
    const nextImageIds = images.map((i) => i.id);
    if (nextImageIds.join(",") !== currentImageIds.join(",")) patch.imageIds = nextImageIds;
    if (nextQty !== listing.quantityTotal) patch.quantityTotal = nextQty;
    if (nextPrice !== listing.price) patch.price = nextPrice;
    if (nextPickupEndIso) patch.pickupEnd = nextPickupEndIso;

    if (Object.keys(patch).length === 0) {
      return setSaveSuccess("Chưa có thay đổi nào cần lưu.");
    }

    setSaving(true);
    try {
      const updated = await saveMeal.updateListing(listing.id, patch);
      const toDelete = [...pendingDeleteIds];
      setPendingDeleteIds([]);
      setNewlyUploadedIds([]);
      if (toDelete.length > 0) {
        void Promise.allSettled(toDelete.map((imgId) => sellerApi.deleteImage(imgId)));
      }
      setImages(updated.images.length > 0 ? updated.images : updated.image ? [updated.image] : []);
      setTitle(updated.title);
      setDescription(updated.description ?? "");
      setQty(String(updated.quantityTotal));
      setPrice(String(updated.price));
      setPickupEndTime(vnTime(updated.pickupEnd));
      onUpdated(updated);
      setSaveSuccess("Đã lưu thay đổi tin đăng.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Không lưu được thay đổi. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  }

  async function handleWithdraw() {
    if (withdrawNote.trim().length > 200) {
      return setWithdrawError("Ghi chú tối đa 200 ký tự.");
    }
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      const withdrawn = await sellerApi.withdrawListing(listing.id, withdrawReason, withdrawNote);
      onUpdated(withdrawn);
    } catch (err) {
      setWithdrawError(err instanceof ApiError ? err.message : "Không thể gỡ tin lúc này. Vui lòng thử lại.");
      setWithdrawing(false);
    }
  }

  const allergensText =
    listing.allergens.length > 0 ? listing.allergens.map((a) => ALLERGEN_LABEL[a]).join(", ") : "Không khai báo";

  return (
    <>
      <ScreenHeader title="Chỉnh sửa & gỡ tin" backHref="/my-listings" />
      <div className={styles.body}>
        <section className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <h2 className={styles.summaryTitle}>{listing.title}</h2>
            <span className={listing.underReview ? styles.badgeAlert : styles.badgeLive}>
              {listing.underReview ? "Đang xem xét" : STATUS_LABEL.PUBLISHED}
            </span>
          </div>
          <p className={styles.meta}>
            {formatCardPrice(listing.price)} · còn {listing.quantityAvailable}/{listing.quantityTotal} suất ·{" "}
            {formatPickupDay(listing.pickupStart)} {formatPickupWindow(listing.pickupStart, listing.pickupEnd)}
          </p>
          <p className={styles.meta}>
            {listing.reservedCount > 0 ? `${listing.reservedCount} suất đang được giữ` : "Chưa có đơn đang giữ"}
            {listing.completedCount > 0 ? ` · ${listing.completedCount} suất đã bàn giao` : ""}
          </p>
          {listing.underReview ? (
            <Notice tone="error">
              Tin đang tạm ẩn để quản trị viên xem xét sau một báo cáo về chất lượng. Các đơn đã giữ trước đó vẫn còn
              hiệu lực.
            </Notice>
          ) : null}
          {listing.reservedCount > 0 ? (
            <Link href="/sales" className={styles.inlineLink}>
              Xem đơn chờ bàn giao →
            </Link>
          ) : null}
        </section>

        <form className={styles.section} onSubmit={handleSave} noValidate>
          <h3 className={styles.sectionTitle}>Thông tin có thể chỉnh sửa</h3>
          <p className={styles.sectionSub}>
            Sau khi đăng, bạn có thể cập nhật ảnh, mô tả, số suất, giảm giá bán hoặc rút ngắn giờ nhận.
          </p>

          <div>
            <p className={styles.lockedFieldLabel} style={{ margin: "0 0 8px" }}>
              Ảnh món ăn ({images.length}/{MAX_IMAGES})
            </p>
            <div className={styles.photoGrid}>
              {images.map((img, index) => (
                <div key={img.id} className={styles.thumb}>
                  <Image
                    src={img.url}
                    alt={`Ảnh món ${index + 1}`}
                    fill
                    sizes="96px"
                    unoptimized={img.url.startsWith("data:") || img.url.startsWith("blob:")}
                    className={styles.thumbImg}
                  />
                  {images.length > 1 ? (
                    <button
                      type="button"
                      className={styles.removeThumb}
                      aria-label={`Xóa ảnh ${index + 1}`}
                      onClick={() => handleRemoveImage(img.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {images.length < MAX_IMAGES ? (
                <label className={styles.addThumb}>
                  <span>{uploading ? "Đang tải…" : "＋ Thêm ảnh"}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      void handleAddImage(f);
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>

          <TextField
            label="Tên món"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaveSuccess(null);
            }}
            maxLength={80}
          />

          <TextArea
            label="Mô tả thêm (nếu có)"
            placeholder="Ghi chú thêm về khẩu phần hoặc cách nhận tại quầy…"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaveSuccess(null);
            }}
            maxLength={500}
            hint={`${description.length}/500 ký tự`}
          />

          <div>
            <div className={styles.qtyRow}>
              <TextField
                className={styles.qtyInput}
                label="Tổng số suất"
                inputMode="numeric"
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value.replace(/\D/g, ""));
                  setSaveSuccess(null);
                }}
              />
              <button
                type="button"
                className={styles.stepperBtn}
                aria-label="Giảm 1 suất"
                disabled={!Number.isInteger(parsedQty) || parsedQty <= minQty}
                onClick={() => stepQty(-1)}
              >
                −
              </button>
              <button
                type="button"
                className={styles.stepperBtn}
                aria-label="Tăng 1 suất"
                disabled={Number.isInteger(parsedQty) && parsedQty >= 50}
                onClick={() => stepQty(1)}
              >
                +
              </button>
            </div>
            <p className={styles.meta} style={{ marginTop: 6 }}>
              Tối thiểu {minQty} suất · Sau khi lưu sẽ còn {Math.max(0, previewAvailable)} suất trống để khách đặt.
            </p>
          </div>

          <TextField
            label="Giá pass (VNĐ)"
            inputMode="numeric"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setSaveSuccess(null);
            }}
            hint={`Hiện tại: ${formatCardPrice(listing.price)}. Chỉ có thể giảm giá (nhập 0 nếu tặng miễn phí).`}
          />

          <div className={styles.two}>
            <div className={styles.lockedFieldBox}>
              <span className={styles.lockedFieldLabel}>Bắt đầu nhận (đã khóa)</span>
              <div className={styles.lockedFieldValue}>
                {formatPickupDay(listing.pickupStart)} {vnTime(listing.pickupStart)}
              </div>
            </div>
            <TextField
              label="Kết thúc nhận"
              type="time"
              value={pickupEndTime}
              onChange={(e) => {
                setPickupEndTime(e.target.value);
                setSaveSuccess(null);
              }}
              hint={`Tối đa ${vnTime(listing.pickupEnd)} (không thể kéo dài)`}
            />
          </div>

          {saveError ? <Notice tone="error">{saveError}</Notice> : null}
          {saveSuccess ? <Notice tone="success">{saveSuccess}</Notice> : null}

          <Button type="submit" disabled={saving || uploading}>
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </form>

        <section className={styles.section} aria-label="Thông tin đã khóa">
          <h3 className={styles.sectionTitle}>Thông tin đã khóa</h3>
          <p className={styles.sectionSub}>Để đổi thông tin này, hãy gỡ tin và đăng mới.</p>
          <dl className={styles.facts}>
            <div>
              <dt>Loại món</dt>
              <dd>{CATEGORY_LABEL[listing.category]}</dd>
            </div>
            <div>
              <dt>Nguồn gốc</dt>
              <dd>{listing.origin || "—"}</dd>
            </div>
            <div>
              <dt>Chế biến / đóng gói</dt>
              <dd>
                {listing.preparedAt ? `${formatPickupDay(listing.preparedAt)} ${vnTime(listing.preparedAt)}` : "—"}
              </dd>
            </div>
            <div>
              <dt>Bảo quản</dt>
              <dd>{STORAGE_LABEL[listing.storage]}</dd>
            </div>
            <div>
              <dt>Ghi chú bảo quản</dt>
              <dd>{listing.storageNote || "Không có"}</dd>
            </div>
            <div>
              <dt>Thành phần</dt>
              <dd>{listing.ingredients || "Không khai báo"}</dd>
            </div>
            <div>
              <dt>Chất gây dị ứng</dt>
              <dd>{allergensText}</dd>
            </div>
            <div>
              <dt>Giờ bắt đầu nhận</dt>
              <dd>
                {listing.pickupStart ? `${formatPickupDay(listing.pickupStart)} ${vnTime(listing.pickupStart)}` : "—"}
              </dd>
            </div>
            <div>
              <dt>Địa điểm nhận</dt>
              <dd>{listing.pickup.address || "—"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.dangerSection} aria-label="Gỡ tin đăng">
          <h3 className={styles.dangerTitle}>Gỡ tin đăng</h3>
          <Notice tone="error">
            <p>
              {listing.reservedCount > 0
                ? `Tin đang có ${listing.reservedCount} suất được khách giữ chỗ. Gỡ tin sẽ hủy toàn bộ các đơn đang giữ và thu hồi mã QR của khách.`
                : "Gỡ tin sẽ ẩn món ngay khỏi bản đồ và tự động hủy mọi đơn đang giữ chỗ (nếu có). Tin đã gỡ không thể mở lại."}
            </p>
          </Notice>

          <fieldset className={styles.reasons}>
            <legend className={styles.lockedFieldLabel} style={{ marginBottom: 8 }}>
              Lý do gỡ tin
            </legend>
            {WITHDRAW_REASONS.map((r) => (
              <label key={r} className={styles.reason}>
                <input
                  type="radio"
                  name="withdrawReason"
                  value={r}
                  checked={withdrawReason === r}
                  onChange={() => setWithdrawReason(r)}
                />
                {WITHDRAW_REASON_LABEL[r]}
              </label>
            ))}
          </fieldset>

          <TextArea
            label="Ghi chú thêm (không bắt buộc)"
            placeholder="Ví dụ: Tủ mát gặp sự cố nên không thể giao món…"
            value={withdrawNote}
            onChange={(e) => setWithdrawNote(e.target.value)}
            maxLength={200}
            hint={`${withdrawNote.length}/200 ký tự`}
          />

          {withdrawError ? <Notice tone="error">{withdrawError}</Notice> : null}

          {confirmWithdraw ? (
            <div className={styles.confirmBox}>
              <p className={styles.meta}>
                Xác nhận gỡ tin <strong>{listing.title}</strong>? Các đơn đang giữ chỗ sẽ bị hủy ngay.
              </p>
              <div className={styles.confirmRow}>
                <Button variant="secondary" onClick={() => setConfirmWithdraw(false)} disabled={withdrawing}>
                  Quay lại
                </Button>
                <button type="button" className={styles.dangerBtn} onClick={handleWithdraw} disabled={withdrawing}>
                  {withdrawing ? "Đang gỡ…" : "Xác nhận gỡ tin"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.dangerBtn} onClick={() => setConfirmWithdraw(true)}>
              Gỡ tin
            </button>
          )}
        </section>
      </div>
    </>
  );
}
