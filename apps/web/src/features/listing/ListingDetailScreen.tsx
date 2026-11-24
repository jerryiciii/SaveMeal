"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, FoodCard, Notice, ScreenHeader } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { getClientLocation } from "@/features/discover/clientLocation";
import { STORAGE_LABEL } from "@/features/orders/labels";
import { saveMeal } from "@/lib/api";
import type { ListingCard, ListingDetail, ListingOwnerView } from "@/lib/contract/types";
import { formatCardPrice, formatDistance, formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import styles from "./listing.module.css";

function isOwnerView(l: ListingDetail | ListingOwnerView): l is ListingOwnerView {
  return "quantityTotal" in l;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function describeUnavailable(l: Pick<ListingDetail, "status" | "soldOut" | "underReview">): {
  badge: string;
  title: string;
  body: string;
} {
  if (l.underReview) {
    return {
      badge: "ĐANG XEM XÉT",
      title: "Tin đang được tạm ẩn để kiểm tra",
      body: "Món này đang được hệ thống xem xét nên tạm thời không thể đặt giữ.",
    };
  }
  if (l.status === "EXPIRED") {
    return {
      badge: "ĐÃ QUÁ HẠN",
      title: "Tin này đã hết giờ nhận",
      body: "Khung giờ nhận của món đã kết thúc. Bạn có thể chọn các món khác đang mở gần đây.",
    };
  }
  if (l.status === "WITHDRAWN") {
    return {
      badge: "ĐÃ GỠ TIN",
      title: "Người bán đã gỡ tin này",
      body: "Tin đăng này không còn mở nhận nữa. Bạn có thể xem các món khác quanh khu vực này.",
    };
  }
  if (l.status === "BLOCKED") {
    return {
      badge: "ĐÃ KHÓA",
      title: "Tin này không còn khả dụng",
      body: "Tin đăng đã bị đóng và không thể đặt giữ.",
    };
  }
  if (l.status === "DRAFT") {
    return {
      badge: "BẢN NHÁP",
      title: "Tin chưa được đăng công khai",
      body: "Tin đăng này đang ở trạng thái nháp và chưa mở cho người mua.",
    };
  }
  return {
    badge: "HẾT SUẤT",
    title: "Món này đã hết suất",
    body: "Tất cả các suất hiện đã có người đặt giữ. Nếu có đơn hủy trước giờ nhận, suất sẽ tự động mở lại.",
  };
}

/** Nearby available alternatives for Figma V1 38 · Hết suất / Tin quá hạn (LIST-1). */
function NearbySuggestions({ excludeId, lat, lng }: { excludeId: string; lat?: number; lng?: number }) {
  const [items, setItems] = useState<ListingCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let targetLat = lat;
      let targetLng = lng;
      if (targetLat === undefined || targetLng === undefined) {
        const saved = getClientLocation();
        if (saved) {
          targetLat = saved.lat;
          targetLng = saved.lng;
        } else {
          const cfg = await saveMeal.getConfig();
          targetLat = cfg.defaultCenter.lat;
          targetLng = cfg.defaultCenter.lng;
        }
      }
      const res = await saveMeal.searchListings({
        lat: targetLat,
        lng: targetLng,
        radiusKm: 5,
        sort: "distance",
        limit: 4,
      });
      if (!cancelled) {
        setItems(res.data.filter((card) => card.id !== excludeId && !card.soldOut).slice(0, 3));
      }
    }
    load().catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [excludeId, lat, lng]);

  if (items === null) {
    return (
      <section className={styles.suggestions} aria-label="Món khác gần đây">
        <h3 className={styles.suggestTitle}>Món khác đang có gần đây</h3>
        <div className={styles.suggestSkeleton} aria-busy="true" />
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className={styles.suggestions} aria-label="Món khác gần đây">
      <div className={styles.suggestHeader}>
        <h3 className={styles.suggestTitle}>Món khác đang có gần đây</h3>
        <Link href="/" className={styles.suggestMore}>
          Xem tất cả
        </Link>
      </div>
      <ul className={styles.suggestList}>
        {items.map((card) => (
          <li key={card.id}>
            <FoodCard listing={card} href={`/listings/${card.id}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Figma V2.1 · Chi tiết món and Hết suất / quá hạn. LIST-2 + LIST-1 suggestions. */
export function ListingDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const { state, reload } = useLoad(() => saveMeal.getListing(id), [id, session.status]);

  if (state.kind === "loading") return <ScreenHeader title="Chi tiết món" />;
  if (state.kind === "error") {
    const isNotFound = state.error.status === 404;
    return (
      <>
        <ScreenHeader title="Chi tiết món" />
        <div className={styles.body}>
          <div className={styles.unavailableCard} role="status">
            <span className={styles.unavailableBadge}>{isNotFound ? "KHÔNG CÒN HIỂN THỊ" : "LỖI TẢI TIN"}</span>
            <h2 className={styles.unavailableTitle}>
              {isNotFound ? "Món này đã hết hạn hoặc không còn mở nhận" : "Không tải được thông tin món"}
            </h2>
            <p className={styles.unavailableDesc}>
              {isNotFound
                ? "Tin đăng có thể đã hết giờ nhận, được người bán gỡ xuống hoặc đã đóng."
                : state.error.message}
            </p>
            <div className={styles.unavailableActions}>
              {!isNotFound ? (
                <Button variant="secondary" onClick={reload}>
                  Thử lại
                </Button>
              ) : null}
              <Link className={styles.ctaLink} href="/">
                Khám phá món khác quanh bạn
              </Link>
            </div>
          </div>
          {isNotFound ? <NearbySuggestions excludeId={id} /> : null}
        </div>
      </>
    );
  }

  const l = state.data;
  const owner = isOwnerView(l);
  const day = formatPickupDay(l.pickupStart);
  const closed = l.status !== "PUBLISHED";
  const unavailable = closed || l.soldOut || l.underReview;
  const unavailableInfo = unavailable ? describeUnavailable(l) : null;
  const distance = formatDistance(l.distanceMeters);

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <div className={styles.heroTopBar}>
          <button
            type="button"
            className={styles.heroCircleBtn}
            aria-label="Quay lại"
            onClick={() => router.back()}
          >
            ‹
          </button>
          {!owner ? (
            <Link
              href={`/report?listingId=${encodeURIComponent(l.id)}`}
              className={styles.heroCircleBtn}
              aria-label="Báo cáo tin này"
              title="Báo cáo tin này"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
            </Link>
          ) : null}
        </div>
        {l.image ? <Image src={l.image.url} alt={l.title} fill sizes="430px" className={styles.heroImg} priority /> : null}
        {unavailableInfo ? <span className={styles.badgeOut}>{unavailableInfo.badge}</span> : null}
      </div>
      <div className={styles.body}>
        <section className={styles.summaryCard}>
          <h1 className={styles.title}>{l.title}</h1>
          <p className={styles.priceRow}>
            <span className={l.isFree ? styles.free : styles.price}>{formatCardPrice(l.price)}</span>
            {l.originalPrice && l.originalPrice > l.price ? <s className={styles.original}>{formatVnd(l.originalPrice)}</s> : null}
            <span className={styles.left}>{unavailable ? unavailableInfo?.badge : `Còn ${l.quantityAvailable} suất`}</span>
          </p>
          <span className={styles.pickupPill}>
            Nhận {day} · {formatPickupWindow(l.pickupStart, l.pickupEnd)}
          </span>
        </section>

        {unavailableInfo ? (
          <div className={styles.unavailableCard} role="status">
            <h2 className={styles.unavailableTitle}>{unavailableInfo.title}</h2>
            <p className={styles.unavailableDesc}>{unavailableInfo.body}</p>
          </div>
        ) : null}

        <Link href={`/sellers/${l.seller.id}`} className={styles.seller}>
          <div className={styles.sellerMain}>
            <div className={styles.sellerTop}>
              <b>{l.seller.name}</b>
              {l.seller.verified ? <span className={styles.verified}>Đã xác minh</span> : null}
            </div>
            <span className={styles.meta}>{[distance, l.pickup.address].filter(Boolean).join(" · ")}</span>
          </div>
          <span className={styles.sellerChevron} aria-hidden="true">
            ›
          </span>
        </Link>

        <section className={styles.factsCard}>
          <dl className={styles.facts}>
            <div>
              <dt>Giờ nhận</dt>
              <dd>
                {day} {formatPickupWindow(l.pickupStart, l.pickupEnd)}
              </dd>
            </div>
            <div>
              <dt>Nguồn gốc</dt>
              <dd>{l.origin}</dd>
            </div>
            <div>
              <dt>Chế biến / đóng gói</dt>
              <dd>
                {formatPickupDay(l.preparedAt)} {hhmm(l.preparedAt)}
              </dd>
            </div>
            <div>
              <dt>Bảo quản</dt>
              <dd>{[STORAGE_LABEL[l.storage], l.storageNote].filter(Boolean).join(" · ")}</dd>
            </div>
            {l.ingredients ? (
              <div>
                <dt>Thành phần</dt>
                <dd>{l.ingredients}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {l.description ? (
          <section className={styles.descCard}>
            <p className={styles.desc}>{l.description}</p>
          </section>
        ) : null}

        <Notice>
          <p>
            Bạn thanh toán trực tiếp cho người bán khi nhận (tiền mặt hoặc chuyển khoản). Mã QR chỉ xác nhận việc giao nhận, không bảo
            đảm chất lượng thực phẩm. {l.declaredAt ? "Người bán đã xác nhận thông tin món khi đăng." : null}
          </p>
        </Notice>

        {unavailable && !owner ? (
          <>
            <NearbySuggestions excludeId={l.id} lat={l.pickup.lat} lng={l.pickup.lng} />
            <Link className={styles.textLink} href="/">
              Khám phá món khác trên bản đồ
            </Link>
          </>
        ) : null}

        {!owner ? (
          <Link className={styles.reportLink} href={`/report?listingId=${encodeURIComponent(l.id)}`}>
            Báo cáo tin này
          </Link>
        ) : null}
      </div>

      <div className={styles.stickyBar}>
        {owner ? (
          <Link className={styles.textLink} href="/my-listings">
            Tin bạn đăng (không thể tự đặt giữ) · Quản lý tin
          </Link>
        ) : l.myActiveReservationId ? (
          <Link href={`/orders/${l.myActiveReservationId}`} className={styles.ctaLink}>
            Xem mã nhận món của bạn
          </Link>
        ) : unavailable ? (
          <Button disabled>{l.soldOut ? "Đã hết suất" : "Món không còn khả dụng"}</Button>
        ) : (
          <Link href={`/listings/${l.id}/reserve`} className={styles.ctaLink}>
            {l.isFree ? "Đặt giữ miễn phí" : `Đặt giữ · ${formatVnd(l.price)}`}
          </Link>
        )}
      </div>
    </div>
  );
}
