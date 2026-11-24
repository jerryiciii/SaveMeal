"use client";

import Link from "next/link";
import { Button, FoodCard, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { sellerApi } from "@/lib/api/sellerEndpoints";
import type { ListingCard, SellerProfile } from "@/lib/contract/types";
import { useLoad } from "@/lib/useLoad";
import { formatMemberSince, SELLER_TYPE_LABEL, sellerInitials } from "./labels";
import styles from "./SellerProfileScreen.module.css";

type SellerProfileData = {
  profile: SellerProfile;
  listings: ListingCard[];
};

/** Figma V1 16 · Seller or store profile (7:204). SELLER-1 + LIST-1 (sellerId, view=list). */
export function SellerProfileScreen({ id }: { id: string }) {
  const { state, reload } = useLoad<SellerProfileData>(
    async () => {
      const [profile, listingsRes] = await Promise.all([
        sellerApi.getSellerProfile(id),
        saveMeal.searchListings({ sellerId: id, radiusKm: 10, limit: 50 }),
      ]);
      return { profile, listings: listingsRes.data };
    },
    [id],
  );

  if (state.kind === "loading") {
    return (
      <>
        <ScreenHeader title="Hồ sơ người bán" />
        <div className={styles.body} aria-busy="true" aria-label="Đang tải hồ sơ người bán">
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonItem} />
          <div className={styles.skeletonItem} />
        </div>
      </>
    );
  }

  if (state.kind === "error") {
    const notFound = state.error.code === "SELLER_NOT_FOUND" || state.error.status === 404;
    return (
      <>
        <ScreenHeader title="Hồ sơ người bán" />
        <div className={styles.body}>
          {notFound ? (
            <div className={styles.emptyState}>
              <h2 className={styles.emptyTitle}>Không tìm thấy người bán</h2>
              <p className={styles.emptyText}>
                Hồ sơ người bán này không tồn tại hoặc hiện không còn hoạt động trên SaveMeal.
              </p>
              <Link href="/" className={styles.ctaLink}>
                Khám phá món gần bạn
              </Link>
            </div>
          ) : (
            <>
              <Notice tone="error">{state.error.message}</Notice>
              <Button variant="secondary" onClick={reload}>
                Thử lại
              </Button>
              <Link href="/" className={styles.secondaryLink}>
                Về bản đồ khám phá
              </Link>
            </>
          )}
        </div>
      </>
    );
  }

  const { profile, listings } = state.data;

  return (
    <>
      <ScreenHeader title="Hồ sơ người bán" />
      <div className={styles.body}>
        <section className={styles.heroCard} aria-label="Thông tin người bán">
          <div className={styles.identity}>
            <div className={styles.avatar} aria-hidden="true">
              {sellerInitials(profile.name)}
            </div>
            <div className={styles.nameBlock}>
              <h2 className={styles.name}>{profile.name}</h2>
              <div className={styles.badges}>
                {profile.type ? <span className={styles.typeBadge}>{SELLER_TYPE_LABEL[profile.type]}</span> : null}
                {profile.verified ? <span className={styles.verifiedBadge}>Đã xác minh</span> : null}
              </div>
            </div>
          </div>

          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dd className={styles.statValue}>{profile.activeListingCount}</dd>
              <dt className={styles.statLabel}>Món đang đăng</dt>
            </div>
            <div className={styles.stat}>
              <dd className={styles.statValue}>{profile.completedHandovers}</dd>
              <dt className={styles.statLabel}>Lượt bàn giao</dt>
            </div>
            <div className={styles.stat}>
              <dd className={styles.statValue}>{formatMemberSince(profile.memberSince)}</dd>
              <dt className={styles.statLabel}>Tham gia từ</dt>
            </div>
          </dl>
        </section>

        <Notice>
          <p>
            Đặt giữ suất trên ứng dụng và thanh toán trực tiếp cho người bán khi đến nhận. SaveMeal không thu hộ tiền
            và không cấp chứng nhận an toàn thực phẩm.
          </p>
        </Notice>

        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Món đang đăng</h3>
          <span className={styles.sectionCount}>{listings.length} món</span>
        </div>

        {listings.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>Người bán hiện chưa có món nào đang mở đặt giữ.</p>
            <Link href="/" className={styles.secondaryLink}>
              Khám phá món khác gần bạn
            </Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {listings.map((item) => (
              <li key={item.id}>
                <FoodCard listing={item} href={`/listings/${item.id}`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
