"use client";

import Image from "next/image";
import Link from "next/link";
import { Button, Notice, ScreenHeader } from "@/components/ui";
import { STORAGE_LABEL } from "@/features/orders/labels";
import { saveMeal } from "@/lib/api";
import type { ListingDetail, ListingOwnerView } from "@/lib/contract/types";
import { formatCardPrice, formatDistance, formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { useSession } from "@/features/auth/SessionProvider";
import styles from "./listing.module.css";

function isOwnerView(l: ListingDetail | ListingOwnerView): l is ListingOwnerView {
  return "quantityTotal" in l;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Figma V1 04 · Chi tiết món (2:237) and 38 · Hết suất / quá hạn (11:201). LIST-2. */
export function ListingDetailScreen({ id }: { id: string }) {
  const session = useSession();
  const { state, reload } = useLoad(() => saveMeal.getListing(id), [id, session.status]);

  if (state.kind === "loading") return <ScreenHeader title="Chi tiết món" />;
  if (state.kind === "error") {
    return (
      <>
        <ScreenHeader title="Chi tiết món" />
        <div className={styles.body}>
          <Notice tone="error">{state.error.status === 404 ? "Món này không còn hiển thị." : state.error.message}</Notice>
          <Button variant="secondary" onClick={reload}>
            Thử lại
          </Button>
          <Link className={styles.textLink} href="/">
            Khám phá món khác
          </Link>
        </div>
      </>
    );
  }

  const l = state.data;
  const owner = isOwnerView(l);
  const day = formatPickupDay(l.pickupStart);
  const closed = l.status !== "PUBLISHED";
  const unavailable = closed || l.soldOut || l.underReview;
  const distance = formatDistance(l.distanceMeters);

  return (
    <>
      <ScreenHeader title="Chi tiết món" />
      <div className={styles.hero}>
        {l.image ? <Image src={l.image.url} alt={l.title} fill sizes="430px" className={styles.heroImg} priority /> : null}
        {unavailable ? <span className={styles.badgeOut}>{l.soldOut ? "HẾT SUẤT" : "KHÔNG CÒN NHẬN"}</span> : null}
      </div>
      <div className={styles.body}>
        <h2 className={styles.title}>{l.title}</h2>
        <p className={styles.priceRow}>
          <span className={l.isFree ? styles.free : styles.price}>{formatCardPrice(l.price)}</span>
          {l.originalPrice && l.originalPrice > l.price ? <s className={styles.original}>{formatVnd(l.originalPrice)}</s> : null}
          <span className={styles.left}>Còn {l.quantityAvailable} suất</span>
        </p>

        <div className={styles.seller}>
          <b>{l.seller.name}</b>
          {l.seller.verified ? <span className={styles.verified}>Đã xác minh</span> : null}
          <span className={styles.meta}>{[distance, l.pickup.address].filter(Boolean).join(" · ")}</span>
        </div>

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

        {l.description ? <p className={styles.desc}>{l.description}</p> : null}

        <Notice>
          <p>
            Bạn thanh toán trực tiếp cho người bán khi nhận (tiền mặt hoặc chuyển khoản). Mã QR chỉ xác nhận việc giao nhận, không bảo
            đảm chất lượng thực phẩm. {l.declaredAt ? "Người bán đã xác nhận thông tin món khi đăng." : null}
          </p>
        </Notice>

        {owner ? (
          <Link className={styles.textLink} href="/my-listings">
            Đây là tin của bạn · Quản lý tin
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
        {unavailable && !owner ? (
          <Link className={styles.textLink} href="/">
            Khám phá món khác
          </Link>
        ) : null}
      </div>
    </>
  );
}
