import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BottomSheet, Button, Chip, FoodCard, IconButton, MapPin, SearchField } from "@/components/ui";
import type { ListingCard } from "@/lib/contract/types";
import styles from "./ui-kit.module.css";

export const metadata: Metadata = { title: "UI kit", robots: { index: false } };

const sample: ListingCard = {
  id: "sample",
  title: "2 bánh croissant cuối ngày",
  category: "BAKERY",
  image: { id: "img", url: "/mock/croissant.png", width: 200, height: 196 },
  originalPrice: 35000,
  price: 0,
  isFree: true,
  quantityAvailable: 2,
  soldOut: false,
  pickupStart: "2026-11-23T17:30:00+07:00",
  pickupEnd: "2026-11-23T18:30:00+07:00",
  pickup: { address: "12 Ngô Thì Sĩ, Mỹ An", lat: 16.0478, lng: 108.2431 },
  distanceMeters: 650,
  seller: { id: "acc-may", name: "Tiệm bánh Mây", type: "BAKERY", verified: true },
};

/** Dev-only gallery of the Figma V1 components (13:48 + screen 01) for visual checks. */
export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={styles.page}>
      <h1>SaveMeal · UI kit (Figma V1)</h1>
      <section>
        <h2>Màu</h2>
        <div className={styles.swatches}>
          {["night", "raised", "mint", "orange", "sky", "alert"].map((c) => (
            <div key={c} className={styles.swatch} style={{ background: `var(--color-${c})` }}>
              {c}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Nút</h2>
        <Button>Đặt giữ món này</Button>
        <Button variant="secondary">Hủy / quay lại</Button>
        <Button disabled>Chưa thể tiếp tục</Button>
      </section>
      <section>
        <h2>Tìm kiếm &amp; bộ lọc</h2>
        <SearchField />
        <div className={styles.row}>
          <Chip selected>Miễn phí</Chip>
          <Chip>Dưới 20k</Chip>
          <Chip>Gần tôi</Chip>
        </div>
      </section>
      <section>
        <h2>Pin &amp; nút nổi</h2>
        <div className={styles.row}>
          <MapPin price={0} title="Bánh mì" />
          <MapPin price={15000} title="Bánh ngọt" />
          <MapPin price={12000} title="Cơm" selected />
          <IconButton icon="navigation" label="Về vị trí của tôi" />
        </div>
      </section>
      <section>
        <h2>Thẻ món</h2>
        <FoodCard listing={sample} />
        <FoodCard listing={{ ...sample, id: "s2", title: "Combo cơm trưa còn 2 phần", price: 18000, isFree: false }} />
      </section>
      <BottomSheet title="Gần bạn hôm nay" subtitle="12 món đang chờ được cứu">
        <p className={styles.note}>Bottom sheet</p>
      </BottomSheet>
    </div>
  );
}
