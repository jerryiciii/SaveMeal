import Image from "next/image";
import Link from "next/link";
import type { BatchCard } from "@/lib/contract/types";
import { formatCardPrice, formatDistance, formatPickupDay, formatPickupWindow } from "@/lib/format";
import styles from "./FoodCard.module.css";

/** Food card from Figma V1 01 (2:75 surface, 2:76 photo, 2:78–2:81 text). */
export function FoodCard({ batch, href }: { batch: BatchCard; href?: string }) {
  const distance = formatDistance(batch.distanceMeters);
  const meta = [batch.store.name, distance].filter(Boolean).join(" · ");
  const day = formatPickupDay(batch.pickupStart);
  const pickup = `Nhận ${day === "Hôm nay" ? "" : `${day.toLocaleLowerCase("vi")} `}${formatPickupWindow(batch.pickupStart, batch.pickupEnd)}`;
  const body = (
    <>
      <div className={styles.photo}>
        {batch.image ? (
          <Image src={batch.image.url} alt="" fill sizes="100px" className={styles.img} />
        ) : (
          <span className={styles.noPhoto} aria-hidden="true" />
        )}
      </div>
      <div className={styles.text}>
        <h3 className={styles.title}>{batch.title}</h3>
        <p className={styles.meta}>{meta}</p>
        <p className={styles.bottom}>
          <span className={batch.isFree ? styles.free : styles.price}>{formatCardPrice(batch.rescuePrice)}</span>
          <span className={styles.pickup}>{pickup}</span>
        </p>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={styles.card}>
      {body}
    </Link>
  ) : (
    <article className={styles.card}>{body}</article>
  );
}
