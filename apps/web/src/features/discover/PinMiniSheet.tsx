"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY_LABEL } from "@/features/post/labels";
import { saveMeal } from "@/lib/api";
import type { ListingCard, ListingDetail, MapPin } from "@/lib/contract/types";
import { formatCardPrice, formatDistance, formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";
import { googleMapsDirectionsUrl } from "@/lib/maps";
import styles from "./PinMiniSheet.module.css";

type PinMiniSheetProps = {
  pin: MapPin;
  card?: ListingCard;
  onClose: () => void;
};

/**
 * Figma V1 13 · Pin selected / mini-sheet (7:96).
 * Shown when a buyer taps a price pin on the map: quick info + CTA to /listings/[id].
 */
export function PinMiniSheet({ pin, card, onClose }: PinMiniSheetProps) {
  const [fetched, setFetched] = useState<ListingDetail | null>(null);

  useEffect(() => {
    if (card) return;
    let cancelled = false;
    saveMeal
      .getListing(pin.id)
      .then((detail) => {
        if (!cancelled) setFetched(detail);
      })
      .catch(() => {
        // Fallback gracefully to pin fields if LIST-2 fails
      });
    return () => {
      cancelled = true;
    };
  }, [card, pin.id]);

  const info = card ?? (fetched?.id === pin.id ? fetched : null);
  const distance = info ? formatDistance(info.distanceMeters) : null;
  const pickupText = info
    ? `Nhận ${formatPickupDay(info.pickupStart) === "Hôm nay" ? "" : `${formatPickupDay(info.pickupStart).toLocaleLowerCase("vi")} `}${formatPickupWindow(info.pickupStart, info.pickupEnd)}`
    : null;
  const quantity = info ? info.quantityAvailable : pin.quantityAvailable;

  return (
    <section className={styles.sheet} aria-label={`Thông tin nhanh: ${pin.title}`}>
      <div className={styles.topRow}>
        <div className={styles.badges}>
          <span className={styles.category}>{CATEGORY_LABEL[pin.category]}</span>
          <span className={styles.portions}>Còn {quantity} suất</span>
        </div>
        <button type="button" className={styles.close} aria-label="Đóng thẻ món" onClick={onClose}>
          ×
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.photo}>
          {info?.image ? (
            <Image src={info.image.url} alt="" fill sizes="84px" className={styles.img} />
          ) : (
            <span className={styles.placeholder} aria-hidden="true" />
          )}
        </div>
        <div className={styles.info}>
          <h3 className={styles.title}>{info?.title ?? pin.title}</h3>
          {info ? (
            <p className={styles.seller}>
              <span>{info.seller.name}</span>
              {info.seller.verified ? <span className={styles.verified}>Đã xác minh</span> : null}
              {distance ? <span>· {distance}</span> : null}
            </p>
          ) : null}
          <div className={styles.priceRow}>
            <span className={pin.isFree ? styles.free : styles.price}>{formatCardPrice(info?.price ?? pin.price)}</span>
            {info?.originalPrice && info.originalPrice > info.price ? (
              <s className={styles.original}>{formatVnd(info.originalPrice)}</s>
            ) : null}
            {pickupText ? <span className={styles.pickup}>{pickupText}</span> : null}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <a
          href={googleMapsDirectionsUrl(info?.pickup.lat ?? pin.lat, info?.pickup.lng ?? pin.lng)}
          target="_blank"
          rel="noreferrer"
          className={styles.dirBtn}
        >
          Chỉ đường
        </a>
        <Link href={`/listings/${pin.id}`} className={styles.cta}>
          Xem chi tiết
        </Link>
      </div>
    </section>
  );
}
