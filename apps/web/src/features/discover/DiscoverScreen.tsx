"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BottomSheet, Button, Chip, FoodCard, IconButton, SearchField } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { AppConfig, ListingCard, ListingSearchParams, MapPin as MapPinData } from "@/lib/contract/types";
import styles from "./DiscoverScreen.module.css";

const ListingMap = dynamic(() => import("./ListingMap"), { ssr: false });

/** Quick filters on Figma V1 01 (2:61–2:66): price (free, < 20k) and distance. */
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
  | { kind: "ready"; cards: ListingCard[]; pins: MapPinData[] };

type Point = { lat: number; lng: number };

/**
 * Figma V1 01 · Bản đồ khám phá (2:2): MapLibre map with price pins, quick filters
 * and the "Gần bạn hôm nay" sheet (LIST-1 map + list). The buyer's location stays
 * in this component only (privacy) and is sent per request as lat/lng.
 */
export function DiscoverScreen() {
  const router = useRouter();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [center, setCenter] = useState<Point | null>(null);
  const [me, setMe] = useState<Point | null>(null);
  const [active, setActive] = useState<Set<QuickFilter>>(() => new Set());
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    saveMeal
      .getConfig()
      .then((c) => {
        setConfig(c);
        setCenter((prev) => prev ?? c.defaultCenter);
      })
      .catch(() => setState({ kind: "error", message: "Không tải được cấu hình. Kiểm tra kết nối mạng." }));
  }, []);

  useEffect(() => {
    if (!center) return;
    let cancelled = false;
    const params = { ...filtersToParams(active), q: q || undefined, lat: center.lat, lng: center.lng };
    Promise.all([saveMeal.searchListings({ ...params, limit: 20 }), saveMeal.mapPins(params)])
      .then(([list, pins]) => {
        if (!cancelled) setState({ kind: "ready", cards: list.data, pins });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof ApiError ? err.message : "Không tải được danh sách món." });
      });
    return () => {
      cancelled = true;
    };
  }, [active, q, center, reload]);

  const toggle = useCallback((f: QuickFilter) => {
    setState({ kind: "loading" });
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  function search(e: FormEvent) {
    e.preventDefault();
    setState({ kind: "loading" });
    setQ(query.trim());
  }

  function locate() {
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("Thiết bị không hỗ trợ định vị.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMe(p);
        setState({ kind: "loading" });
        setCenter(p);
      },
      () => setLocError("Chưa có quyền vị trí. Bạn vẫn có thể xem món quanh khu vực mặc định."),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  const label = active.has("free") ? "MIỄN PHÍ GẦN BẠN" : active.has("under20k") ? "DƯỚI 20K GẦN BẠN" : "MÓN GẦN BẠN";

  return (
    <div className={styles.screen}>
      <div className={styles.map}>
        {config && center ? (
          <ListingMap
            styleUrl={config.map.styleUrl}
            center={center}
            me={me}
            pins={state.kind === "ready" ? state.pins : []}
            onSelect={(pin) => router.push(`/listings/${pin.id}`)}
          />
        ) : (
          <div className={styles.mapPlaceholder} aria-hidden="true" />
        )}
        <div className={styles.topBar}>
          <form onSubmit={search} role="search">
            <SearchField value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
          </form>
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
        <IconButton icon="navigation" label="Về vị trí của tôi" className={styles.locate} onClick={locate} />
      </div>

      <BottomSheet
        title="Gần bạn hôm nay"
        subtitle={state.kind === "ready" ? `${state.pins.length} món đang chờ được cứu` : undefined}
      >
        {locError ? <p className={styles.hint}>{locError}</p> : null}
        <p className={styles.section}>{label}</p>
        {state.kind === "loading" ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Đang tải món gần bạn" />
        ) : state.kind === "error" ? (
          <div className={styles.message} role="alert">
            <p>{state.message}</p>
            <Button variant="secondary" onClick={() => {
              setState({ kind: "loading" });
              setReload((n) => n + 1);
            }}>
              Thử lại
            </Button>
          </div>
        ) : state.cards.length === 0 ? (
          <div className={styles.message}>
            <p className={styles.emptyTitle}>Chưa có món ở đây</p>
            <p>Thử bỏ bớt bộ lọc hoặc chọn khu vực khác.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {state.cards.map((card) => (
              <li key={card.id}>
                <FoodCard listing={card} href={`/listings/${card.id}`} />
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </div>
  );
}
