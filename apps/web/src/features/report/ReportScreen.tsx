"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Notice, ScreenHeader, TextArea } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { createReport, REPORT_TYPES, type Report } from "@/lib/api/trustEndpoints";
import { ApiError } from "@/lib/contract/errors";
import type { ReportType } from "@/lib/contract/types";
import { downscaleImage } from "@/lib/image";
import { REPORT_TYPE_HINT, REPORT_TYPE_LABEL, requiresReservation } from "./labels";
import styles from "./report.module.css";

const MAX_PHOTOS = 3;
const MIN_DESC = 10;
const MAX_DESC = 1000;

type LocalPhoto = { id: string; file: File; previewUrl: string };

type TargetPreview = {
  eyebrow: string;
  title: string;
  meta: string;
};

/**
 * Figma V1 23 · Báo cáo chất lượng (8:351).
 * Submits REP-1 (`POST /reports`) with optional evidence photos via IMG-1 (`purpose="REPORT"`).
 */
export function ReportScreen() {
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listingId")?.trim() || null;
  const reservationId = searchParams.get("reservationId")?.trim() || null;
  const accountId = searchParams.get("accountId")?.trim() || null;
  const hasTarget = Boolean(listingId || reservationId || accountId);

  const [target, setTarget] = useState<TargetPreview | null>(null);
  const [type, setType] = useState<ReportType | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<Report | null>(null);
  const photosRef = useRef<LocalPhoto[]>([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (reservationId) {
      saveMeal
        .getReservation(reservationId)
        .then((r) => {
          if (cancelled) return;
          setTarget({
            eyebrow: `Đơn ${r.code}`,
            title: r.listing.title,
            meta: `${r.seller.name} · ${r.quantity} suất`,
          });
        })
        .catch(() => {
          // Target summary is optional; the user can still submit the report.
        });
    } else if (listingId) {
      saveMeal
        .getListing(listingId)
        .then((l) => {
          if (cancelled) return;
          setTarget({
            eyebrow: "Tin đăng",
            title: l.title,
            meta: l.seller.name,
          });
        })
        .catch(() => {
          // Target may already be under review or closed.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [reservationId, listingId]);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const picked = Array.from(fileList).slice(0, remaining);
    const valid: LocalPhoto[] = [];
    for (const file of picked) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        setError("Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.");
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Mỗi ảnh cần nhỏ hơn 5 MB.");
        continue;
      }
      valid.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (valid.length > 0) {
      setPhotos((prev) => [...prev, ...valid]);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const targetPhoto = prev.find((p) => p.id === id);
      if (targetPhoto) URL.revokeObjectURL(targetPhoto.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hasTarget) {
      setError("Thiếu thông tin đối tượng báo cáo.");
      return;
    }
    if (!type) {
      setError("Vui lòng chọn loại vấn đề bạn gặp phải.");
      return;
    }
    if (requiresReservation(type) && !reservationId) {
      setError("Loại báo cáo này chỉ áp dụng khi báo cáo từ một đơn đặt giữ.");
      return;
    }
    const trimmed = description.trim();
    if (trimmed.length < MIN_DESC) {
      setError(`Mô tả chi tiết cần ít nhất ${MIN_DESC} ký tự.`);
      return;
    }
    if (trimmed.length > MAX_DESC) {
      setError(`Mô tả chi tiết tối đa ${MAX_DESC} ký tự.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const uploadedIds: string[] = [];
      for (const p of photos) {
        const blob = await downscaleImage(p.file);
        const uploaded = await saveMeal.uploadImage(blob, "REPORT");
        uploadedIds.push(uploaded.id);
      }

      const created = await createReport({
        type,
        listingId,
        reservationId,
        accountId,
        description: trimmed,
        imageIds: uploadedIds,
      });
      setSubmitted(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không gửi được báo cáo. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const backHref = reservationId ? `/orders/${reservationId}` : listingId ? `/listings/${listingId}` : "/";

  if (submitted) {
    return (
      <section className={styles.done}>
        <div className={styles.tick} aria-hidden="true">
          ✓
        </div>
        <h1 className={styles.doneTitle}>Đã tiếp nhận báo cáo</h1>
        <p className={styles.doneText}>
          Cảm ơn bạn đã phản hồi. Đội ngũ vận hành SaveMeal sẽ kiểm tra thông tin và xử lý theo quy định cộng đồng.
        </p>
        {submitted.type === "UNSAFE_FOOD" ? (
          <Notice>
            <p>
              Tin đăng liên quan đã được <b>tạm ẩn ngay lập tức</b> và ngừng nhận đặt giữ mới cho đến khi quản trị viên
              xem xét.
            </p>
          </Notice>
        ) : null}
        <div className={styles.doneCard}>
          <div className={styles.doneRow}>
            <span>Mã báo cáo</span>
            <span>{submitted.id.slice(0, 14).toUpperCase()}</span>
          </div>
          <div className={styles.doneRow}>
            <span>Phân loại</span>
            <span>{REPORT_TYPE_LABEL[submitted.type]}</span>
          </div>
          <div className={styles.doneRow}>
            <span>Trạng thái</span>
            <span>Đang chờ xử lý</span>
          </div>
        </div>
        {reservationId ? (
          <Link className={styles.linkBtn} href={`/orders/${reservationId}`}>
            Quay lại chi tiết đơn
          </Link>
        ) : null}
        <Link className={reservationId ? styles.linkBtnSecondary : styles.linkBtn} href="/">
          Về trang khám phá
        </Link>
      </section>
    );
  }

  if (!hasTarget) {
    return (
      <>
        <ScreenHeader title="Báo cáo vấn đề" backHref="/" />
        <div className={styles.body}>
          <Notice tone="error">
            <p>
              Vui lòng mở mục báo cáo từ trang chi tiết món ăn hoặc chi tiết đơn đặt giữ để hệ thống xác định đúng đối
              tượng cần kiểm tra.
            </p>
          </Notice>
          <Link className={styles.linkBtn} href="/orders">
            Xem đơn của tôi
          </Link>
          <Link className={styles.linkBtnSecondary} href="/">
            Về bản đồ khám phá
          </Link>
        </div>
      </>
    );
  }

  const trimmedLen = description.trim().length;

  return (
    <>
      <ScreenHeader title="Báo cáo chất lượng" subtitle="Giúp cộng đồng an toàn và minh bạch hơn" backHref={backHref} />
      <form className={styles.body} onSubmit={submit} noValidate>
        {target ? (
          <div className={styles.targetCard}>
            <p className={styles.targetEyebrow}>{target.eyebrow}</p>
            <p className={styles.targetTitle}>{target.title}</p>
            <p className={styles.targetMeta}>{target.meta}</p>
          </div>
        ) : null}

        <fieldset className={styles.section}>
          <legend className={styles.legend}>Bạn gặp vấn đề gì?</legend>
          {REPORT_TYPES.map((rt) => {
            const disabled = requiresReservation(rt) && !reservationId;
            const checked = type === rt;
            const cls = [
              styles.option,
              checked ? (rt === "UNSAFE_FOOD" ? styles.optionDanger : styles.optionSelected) : "",
              disabled ? styles.optionDisabled : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <label key={rt} className={cls}>
                <input
                  type="radio"
                  name="reportType"
                  value={rt}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    setType(rt);
                    setError(null);
                  }}
                />
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}>{REPORT_TYPE_LABEL[rt]}</span>
                  <span className={styles.optionHint}>
                    {disabled ? "Chỉ áp dụng khi báo cáo từ một đơn đặt giữ." : REPORT_TYPE_HINT[rt]}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {type === "UNSAFE_FOOD" ? (
          <div className={styles.unsafeBanner} role="status">
            <b>Tin đăng sẽ được tạm ẩn ngay lập tức</b>
            <p>
              Khi gửi báo cáo thực phẩm không an toàn, tin đăng này sẽ tự động ẩn khỏi bản đồ và không nhận thêm lượt giữ
              chỗ mới cho đến khi quản trị viên kiểm tra xong.
            </p>
          </div>
        ) : null}

        <TextArea
          label="Mô tả chi tiết vấn đề"
          placeholder="Ghi rõ tình trạng món, thời điểm nhận và thông tin bạn muốn phản ánh (tối thiểu 10 ký tự)…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={MAX_DESC}
          rows={4}
        />
        <div className={styles.counterRow}>
          <span className={trimmedLen > 0 && trimmedLen < MIN_DESC ? styles.counterError : undefined}>
            {trimmedLen < MIN_DESC ? `Cần thêm ít nhất ${MIN_DESC - trimmedLen} ký tự` : "Đủ độ dài tối thiểu"}
          </span>
          <span>
            {description.length}/{MAX_DESC}
          </span>
        </div>

        <div className={styles.photosSection}>
          <span className={styles.legend}>Ảnh minh chứng (không bắt buộc)</span>
          <div className={styles.photosGrid}>
            {photos.map((p) => (
              <div key={p.id} className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={p.previewUrl} alt="Ảnh minh chứng" />
                <button
                  type="button"
                  className={styles.removePhoto}
                  aria-label="Xóa ảnh"
                  onClick={() => removePhoto(p.id)}
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <label className={styles.addPhoto}>
                <span>＋</span>
                <span>Thêm ảnh</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
          <p className={styles.photoHint}>Tối đa {MAX_PHOTOS} ảnh (JPG, PNG, WebP · ≤ 5 MB). Thông tin vị trí EXIF được tự động xóa.</p>
        </div>

        <Notice>
          <p>
            SaveMeal không cấp chứng nhận an toàn thực phẩm, nhưng chúng tôi ghi nhận mọi báo cáo để kiểm duyệt nội dung
            và xử lý vi phạm.
          </p>
        </Notice>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Đang gửi báo cáo…" : "Gửi báo cáo"}
        </Button>
      </form>
    </>
  );
}
