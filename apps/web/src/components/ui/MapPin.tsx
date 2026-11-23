import type { ButtonHTMLAttributes } from "react";
import { formatPinPrice } from "@/lib/format";
import styles from "./MapPin.module.css";

/** Price pin from Figma V1 01 (2:46 priced #FFB66B, 2:48 free #67E5B5). */
type MapPinProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & {
  price: number;
  title: string;
  selected?: boolean;
};

export function MapPin({ price, title, selected = false, className, ...rest }: MapPinProps) {
  const free = price === 0;
  return (
    <button
      type="button"
      aria-label={`${title}, ${free ? "miễn phí" : formatPinPrice(price)}`}
      aria-pressed={selected}
      className={[styles.pin, free ? styles.free : styles.priced, selected ? styles.selected : "", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {formatPinPrice(price)}
    </button>
  );
}
