"use client";

import { useCallback, useEffect, useState } from "react";
import { BottomSheet, Button, Chip, FoodCard, IconButton, SearchField } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { ListingCard, ListingSearchParams, MapPin as MapPinData } from "@/lib/contract/types";
import { MapPreview } from "./MapPreview";
import styles from "./DiscoverScreen.module.css";

/** Quick filters on Figma V1 01 (2:61–2:66). */
export type QuickFilter = "free" | "under20k" | "near";

export function filtersToParams(active: ReadonlySet<QuickFilter>): Omit<ListingSearchParams, "view"> {
  return {
    sort: "distance",
    free: active.has("free") || undefined,
    priceMax: active.has("under20k") ? 20000 : undefined,
    radiusKm: active.has("near") ? 1 : 3,
  };
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; cards: ListingCard[]; pins: MapPinData[]; total: number };

/**
 * Figma V1 01 · Bản đồ khám phá (2:2). M1 shows the layout with mock data and a
 * placeholder map; the real interactive map, search and filter screens land in M3.
 */
export function DiscoverScreen() {
  const [active, setActive] = useState<Set<QuickFilter>>(() => new Set(["free"]));
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = filtersToParams(active);
    Promise.all([
      saveMeal.searchListings({ ...params, limit: 10 }),
      saveMeal.mapPins({ sort: "distance", radiusKm: params.radiusKm }),
    ])
      .then(([list, pins]) => {
        if (!cancelled) setState({ kind: "ready", cards: list.data, pins, total: pins.length });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Không tải được danh sách món.";
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [active, reload]);

  const toggle = useCallback((f: QuickFilter) => {
    setState({ kind: "loading" });
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setReload((n) => n + 1);
  }, []);

  const sectionLabel = active.has("free") ? "MIỄN PHÍ GẦN BẠN" : "GẦN BẠN";

  return (
    <div className={styles.screen}>
      <div className={styles.map}>
        <MapPreview pins={state.kind === "ready" ? state.pins : []} />
        <div className={styles.topBar}>
          <SearchField />
          <div className={styles.chips} role="group" aria-label="Lọc nhanh">
            <Chip selected={active.has("free")} onClick={() => toggle("free")}>
              Miễn phí
            </Chip>
            <Chip selected={active.has("under20k")} onClick={() => toggle("under20k")}>
              Dưới 20k
            </Chip>
            <Chip selected={active.has("near")} onClick={() => toggle("near")}>
              Gần tôi
            </Chip>
          </div>
        </div>
        <IconButton icon="navigation" label="Về vị trí của tôi" className={styles.locate} />
      </div>

      <BottomSheet
        title="Gần bạn hôm nay"
        subtitle={state.kind === "ready" ? `${state.total} món đang chờ được cứu` : undefined}
      >
        <p className={styles.section}>{sectionLabel}</p>
        {state.kind === "loading" ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Đang tải món gần bạn" />
        ) : state.kind === "error" ? (
          <div className={styles.message} role="alert">
            <p>{state.message}</p>
            <Button variant="secondary" onClick={retry}>
              Thử lại
            </Button>
          </div>
        ) : state.cards.length === 0 ? (
          <div className={styles.message}>
            <p className={styles.emptyTitle}>Chưa có món ở đây</p>
            <p>Thử bỏ bớt bộ lọc hoặc mở rộng bán kính tìm kiếm.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {state.cards.map((card) => (
              <li key={card.id}>
                <FoodCard listing={card} />
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </div>
  );
}
