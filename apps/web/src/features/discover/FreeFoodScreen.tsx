"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, FoodCard, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { AppConfig, ListingCard } from "@/lib/contract/types";
import { getClientLocation, type ClientPoint } from "./clientLocation";
import { EmptyNearby } from "./EmptyNearby";
import styles from "./FreeFoodScreen.module.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; cards: ListingCard[] };

type FreeSort = "distance" | "pickupSoon";

/**
 * Figma V1 14 · Free food list (7:122).
 * Queries LIST-1 with `free=true&pickupDay=today`.
 */
export function FreeFoodScreen() {
  const cachedConfig = saveMeal.peekConfig() ?? null;
  const initialPoint = cachedConfig ? (getClientLocation() ?? cachedConfig.defaultCenter) : null;

  const [config, setConfig] = useState<AppConfig | null>(cachedConfig);
  const [point, setPoint] = useState<ClientPoint | null>(initialPoint);
  const [radiusKm, setRadiusKm] = useState<number>(3);
  const [sort, setSort] = useState<FreeSort>("distance");
  const [reload, setReload] = useState(0);

  const requestKey = point ? `${point.lat}|${point.lng}|${radiusKm}|${sort}|${reload}` : "";
  const [entry, setEntry] = useState<{ key: string; state: LoadState }>(() => {
    if (!initialPoint) return { key: "", state: { kind: "loading" } };
    const cached = saveMeal.peekSearchListings({
      free: true,
      pickupDay: "today",
      lat: initialPoint.lat,
      lng: initialPoint.lng,
      radiusKm: 3,
      sort: "distance",
      limit: 20,
    });
    if (cached) {
      return { key: `${initialPoint.lat}|${initialPoint.lng}|3|distance|0`, state: { kind: "ready", cards: cached.data } };
    }
    return { key: "", state: { kind: "loading" } };
  });

  useEffect(() => {
    let cancelled = false;
    saveMeal
      .getConfig({ cache: true, force: reload > 0 })
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setPoint(getClientLocation() ?? c.defaultCenter);
      })
      .catch(() => {
        if (!cancelled) {
          setEntry({ key: "cfg-err", state: { kind: "error", message: "Không tải được cấu hình." } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!point || !requestKey) return;
    let cancelled = false;
    const forKey = requestKey;
    saveMeal
      .searchListings(
        {
          free: true,
          pickupDay: "today",
          lat: point.lat,
          lng: point.lng,
          radiusKm,
          sort,
          limit: 20,
        },
        { cache: true, force: reload > 0 },
      )
      .then((res) => {
        if (!cancelled) setEntry({ key: forKey, state: { kind: "ready", cards: res.data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntry({
            key: forKey,
            state: { kind: "error", message: err instanceof ApiError ? err.message : "Không tải được danh sách món miễn phí." },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [point, radiusKm, sort, requestKey, reload]);

  const state: LoadState =
    entry.key === "cfg-err" ? entry.state : requestKey && entry.key === requestKey ? entry.state : { kind: "loading" };
  const radiusOptions = config?.limits.radiusKmOptions ?? [1, 3, 5];

  return (
    <div className={styles.screen}>
      <ScreenHeader
        title="Món miễn phí hôm nay"
        subtitle="Nhận trực tiếp tại quầy · 0đ"
        backHref="/"
        right={
          <Link href="/?free=true&pickupDay=today" className={styles.mapLink}>
            Bản đồ
          </Link>
        }
      />

      <div className={styles.body}>
        <Notice>
          <p>
            Các suất 0đ do tiệm và cá nhân chia sẻ trong ngày. Vui lòng đặt giữ vừa đủ nhu cầu và đến nhận đúng khung giờ.
          </p>
        </Notice>

        <div className={styles.controls}>
          <div className={styles.chips} role="group" aria-label="Bán kính tìm kiếm">
            {radiusOptions.map((km) => (
              <Chip key={km} selected={radiusKm === km} onClick={() => setRadiusKm(km)}>
                Trong {km} km
              </Chip>
            ))}
          </div>
          <div className={styles.chips} role="group" aria-label="Sắp xếp">
            <Chip selected={sort === "distance"} onClick={() => setSort("distance")}>
              Gần nhất
            </Chip>
            <Chip selected={sort === "pickupSoon"} onClick={() => setSort("pickupSoon")}>
              Nhận sớm nhất
            </Chip>
          </div>
        </div>

        {state.kind === "loading" ? (
          <div className={styles.skeletons} aria-busy="true" aria-label="Đang tải món miễn phí hôm nay">
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        ) : state.kind === "error" ? (
          <div className={styles.errorBox}>
            <Notice tone="error">{state.message}</Notice>
            <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
              Thử lại
            </Button>
          </div>
        ) : state.cards.length === 0 ? (
          <EmptyNearby
            title="Chưa có món miễn phí hôm nay"
            description={`Chưa có suất 0đ nào mở nhận hôm nay trong bán kính ${radiusKm} km. Bạn có thể mở rộng khoảng cách hoặc xem tất cả món ưu đãi gần đây.`}
            primaryAction={
              radiusKm < 5
                ? { label: "Mở rộng bán kính 5 km", onClick: () => setRadiusKm(5) }
                : { label: "Xem tất cả món gần bạn", href: "/" }
            }
            secondaryAction={radiusKm < 5 ? { label: "Xem tất cả món gần bạn", href: "/" } : undefined}
          />
        ) : (
          <section className={styles.results} aria-label="Danh sách món miễn phí">
            <p className={styles.count}>
              {state.cards.length} món miễn phí đang mở nhận trong {radiusKm} km
            </p>
            <ul className={styles.list}>
              {state.cards.map((card) => (
                <li key={card.id}>
                  <FoodCard listing={card} href={`/listings/${card.id}`} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
