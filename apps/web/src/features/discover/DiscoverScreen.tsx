"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, FoodCard, Icon, IconButton } from "@/components/ui";
import { CATEGORY_LABEL } from "@/features/post/labels";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { AppConfig, ListingCard, ListingSearchParams, MapPin as MapPinData } from "@/lib/contract/types";
import { formatVnd } from "@/lib/format";
import { getClientLocation, setClientLocation, type ClientPoint } from "./clientLocation";
import { EmptyNearby } from "./EmptyNearby";
import {
  countActiveFilters,
  DEFAULT_RADIUS_KM,
  DEFAULT_SORT,
  filtersToListingParams,
  filtersToQueryString,
  hasAnyFilter,
  isQuickFilterActive,
  parseFiltersFromSearchParams,
  PICKUP_DAY_LABEL,
  SORT_LABEL,
  toggleQuickFilter,
  type DiscoverFilters,
  type QuickFilter,
} from "./filterParams";
import { PinMiniSheet } from "./PinMiniSheet";
import styles from "./DiscoverScreen.module.css";

const ListingMap = dynamic(() => import("./ListingMap"), { ssr: false });

export type { QuickFilter };

/** Legacy quick-filter mapper kept for backwards compatibility and unit tests. */
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

function sectionHeading(filters: DiscoverFilters): string {
  if (filters.q) return `KẾT QUẢ CHO "${filters.q.toUpperCase()}"`;
  if (filters.free) return "MIỄN PHÍ GẦN BẠN";
  if (filters.priceMax !== undefined) return `DƯỚI ${formatVnd(filters.priceMax).toUpperCase()} GẦN BẠN`;
  return "MÓN GẦN BẠN";
}

function summarizeAdvancedFilters(filters: DiscoverFilters): string[] {
  const tags: string[] = [];
  if (filters.category?.length) {
    tags.push(filters.category.map((c) => CATEGORY_LABEL[c]).join(", "));
  }
  if (filters.priceMax !== undefined && filters.priceMax !== 20000) {
    tags.push(`≤ ${formatVnd(filters.priceMax)}`);
  }
  if (filters.radiusKm !== undefined && filters.radiusKm !== DEFAULT_RADIUS_KM && filters.radiusKm !== 1) {
    tags.push(`Trong ${filters.radiusKm} km`);
  }
  if (filters.pickupDay) {
    tags.push(PICKUP_DAY_LABEL[filters.pickupDay]);
  }
  if (filters.pickupFrom || filters.pickupTo) {
    tags.push(`${filters.pickupFrom ?? "00:00"}–${filters.pickupTo ?? "23:59"}`);
  }
  if (filters.sort && filters.sort !== DEFAULT_SORT) {
    tags.push(SORT_LABEL[filters.sort]);
  }
  return tags;
}

/**
 * Figma V1 01 · Bản đồ khám phá (2:2), 02 · Bottom sheet mở rộng (2:97),
 * 13 · Pin selected / mini-sheet (7:96) and 37 · Không có món gần đây (11:186).
 * Buyer location stays client-only (CLAUDE.md §7) and is sent per LIST-1 request.
 */
function DiscoverScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const filters = useMemo(() => parseFiltersFromSearchParams(new URLSearchParams(searchKey)), [searchKey]);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [center, setCenter] = useState<ClientPoint | null>(null);
  const [me, setMe] = useState<ClientPoint | null>(null);
  const [reload, setReload] = useState(0);
  const [locError, setLocError] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const requestKey = `${searchKey}|${center?.lat ?? ""}|${center?.lng ?? ""}|${reload}`;
  const [entry, setEntry] = useState<{ key: string; state: State }>({ key: "", state: { kind: "loading" } });
  const [pinEntry, setPinEntry] = useState<{ key: string; pin: MapPinData } | null>(null);

  useEffect(() => {
    let cancelled = false;
    saveMeal
      .getConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        const saved = getClientLocation();
        if (saved) {
          setMe((prev) => prev ?? saved);
          setCenter((prev) => prev ?? saved);
        } else {
          setCenter((prev) => prev ?? c.defaultCenter);
        }
      })
      .catch(() => {
        if (!cancelled) setConfigError("Không tải được cấu hình. Kiểm tra kết nối mạng.");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!center) return;
    let cancelled = false;
    const forKey = requestKey;
    const params = { ...filtersToListingParams(filters), lat: center.lat, lng: center.lng };
    Promise.all([saveMeal.searchListings({ ...params, limit: 20 }), saveMeal.mapPins(params)])
      .then(([list, pins]) => {
        if (!cancelled) setEntry({ key: forKey, state: { kind: "ready", cards: list.data, pins } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntry({
            key: forKey,
            state: { kind: "error", message: err instanceof ApiError ? err.message : "Không tải được danh sách món." },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, center, requestKey]);

  const state: State = configError
    ? { kind: "error", message: configError }
    : entry.key === requestKey
      ? entry.state
      : { kind: "loading" };
  const selectedPin = pinEntry?.key === requestKey ? pinEntry.pin : null;

  const applyFilters = useCallback(
    (next: DiscoverFilters) => {
      router.replace(`/${filtersToQueryString(next)}`);
    },
    [router],
  );

  const toggleChip = useCallback(
    (chip: QuickFilter) => {
      applyFilters(toggleQuickFilter(filters, chip));
    },
    [applyFilters, filters],
  );

  function locate() {
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("Thiết bị không hỗ trợ định vị.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setClientLocation(p);
        setMe(p);
        setCenter(p);
      },
      () => setLocError("Chưa có quyền vị trí. Bạn vẫn có thể xem món quanh khu vực mặc định."),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  const filterCount = countActiveFilters(filters);
  const currentQuery = filtersToQueryString(filters);
  const advancedSummary = summarizeAdvancedFilters(filters);
  const selectedCard =
    selectedPin && state.kind === "ready" ? state.cards.find((card) => card.id === selectedPin.id) : undefined;
  const searchHref = filters.q ? `/search?q=${encodeURIComponent(filters.q)}` : "/search";
  const filtersHref = `/filters${currentQuery}`;

  const topBar = (
    <div className={sheetExpanded ? styles.topBarInline : styles.topBar}>
      <div className={styles.searchRow}>
        <div className={styles.searchTriggerWrap}>
          <Link href={searchHref} className={styles.searchTrigger} aria-label="Tìm món ăn gần bạn">
            <Icon name="search" size={22} color="var(--text-primary)" />
            <span className={filters.q ? styles.searchValue : styles.searchPlaceholder}>
              {filters.q || "Tìm món ăn gần bạn"}
            </span>
          </Link>
          {filters.q ? (
            <button
              type="button"
              className={styles.clearQuery}
              aria-label="Xóa từ khóa tìm kiếm"
              onClick={() => applyFilters({ ...filters, q: undefined })}
            >
              ×
            </button>
          ) : null}
        </div>
        <Link href={filtersHref} className={styles.filterBtn} aria-label="Bộ lọc nâng cao">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 5H17M5.5 10H14.5M8 15H12"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
          {filterCount > 0 ? (
            <span className={styles.filterBadge} aria-label={`${filterCount} bộ lọc đang bật`}>
              {filterCount}
            </span>
          ) : null}
        </Link>
      </div>

      <div className={styles.chips} role="group" aria-label="Lọc nhanh">
        <Chip selected={isQuickFilterActive(filters, "free")} onClick={() => toggleChip("free")}>
          Miễn phí
        </Chip>
        <Chip selected={isQuickFilterActive(filters, "under20k")} onClick={() => toggleChip("under20k")}>
          Dưới 20k
        </Chip>
        <Chip selected={isQuickFilterActive(filters, "near")} onClick={() => toggleChip("near")}>
          Gần tôi
        </Chip>
        <Link href="/free" className={styles.freeLinkChip}>
          Miễn phí hôm nay
        </Link>
      </div>
    </div>
  );

  return (
    <div className={styles.screen}>
      {sheetExpanded ? (
        topBar
      ) : (
        <div className={styles.map}>
          {config && center ? (
            <ListingMap
              styleUrl={config.map.styleUrl}
              center={center}
              me={me}
              pins={state.kind === "ready" ? state.pins : []}
              selectedId={selectedPin?.id ?? null}
              onSelect={(pin) => {
                setPinEntry({ key: requestKey, pin });
                setSheetExpanded(false);
              }}
              onClearSelection={() => setPinEntry(null)}
            />
          ) : (
            <div className={styles.mapPlaceholder} aria-hidden="true" />
          )}
          {topBar}
          {!selectedPin ? (
            <IconButton icon="navigation" label="Về vị trí của tôi" className={styles.locate} onClick={locate} />
          ) : null}
          {selectedPin ? (
            <PinMiniSheet pin={selectedPin} card={selectedCard} onClose={() => setPinEntry(null)} />
          ) : null}
        </div>
      )}

      <section
        className={[styles.sheet, sheetExpanded ? styles.sheetExpanded : ""].filter(Boolean).join(" ")}
        aria-label="Gần bạn hôm nay"
      >
        <button
          type="button"
          className={styles.handleBtn}
          aria-expanded={sheetExpanded}
          aria-label={sheetExpanded ? "Thu gọn danh sách, xem bản đồ" : "Mở rộng danh sách món"}
          onClick={() => {
            setPinEntry(null);
            setSheetExpanded((prev) => !prev);
          }}
        >
          <span className={styles.handleBar} aria-hidden="true" />
        </button>

        <div className={styles.sheetHeader}>
          <div>
            <h2 className={styles.sheetTitle}>{hasAnyFilter(filters) ? "Món phù hợp" : "Gần bạn hôm nay"}</h2>
            {state.kind === "ready" ? (
              <p className={styles.sheetSubtitle}>
                {state.cards.length} món đang mở nhận · trong {filters.radiusKm ?? DEFAULT_RADIUS_KM} km
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.expandToggle}
            onClick={() => {
              setPinEntry(null);
              setSheetExpanded((prev) => !prev);
            }}
          >
            {sheetExpanded ? "Xem bản đồ" : "Mở rộng"}
          </button>
        </div>

        {advancedSummary.length > 0 ? (
          <div className={styles.activeSummary}>
            {advancedSummary.map((tag) => (
              <span key={tag} className={styles.summaryTag}>
                {tag}
              </span>
            ))}
            <button type="button" className={styles.resetInline} onClick={() => applyFilters({})}>
              Xóa lọc
            </button>
          </div>
        ) : null}

        {locError ? <p className={styles.hint}>{locError}</p> : null}

        <p className={styles.section}>{sectionHeading(filters)}</p>

        {state.kind === "loading" ? (
          <div className={styles.skeletonList} aria-busy="true" aria-label="Đang tải món gần bạn">
            <div className={styles.skeleton} />
            {sheetExpanded ? <div className={styles.skeleton} /> : null}
          </div>
        ) : state.kind === "error" ? (
          <div className={styles.message} role="alert">
            <p>{state.message}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setConfigError(null);
                setReload((n) => n + 1);
              }}
            >
              Thử lại
            </Button>
          </div>
        ) : state.cards.length === 0 ? (
          <EmptyNearby
            compact={!sheetExpanded}
            title={hasAnyFilter(filters) ? "Không có món khớp bộ lọc" : "Chưa có món nào gần bạn"}
            description={
              hasAnyFilter(filters)
                ? "Thử bỏ bớt tiêu chí lọc hoặc mở rộng khoảng cách để xem thêm món đang mở nhận."
                : "Các tiệm quanh khu vực này hiện chưa có món đang mở nhận. Bạn có thể mở rộng khoảng cách hoặc thử lại sau."
            }
            primaryAction={
              hasAnyFilter(filters)
                ? { label: "Xóa toàn bộ bộ lọc", onClick: () => applyFilters({}) }
                : (filters.radiusKm ?? DEFAULT_RADIUS_KM) < 5
                  ? { label: "Mở rộng bán kính 5 km", onClick: () => applyFilters({ ...filters, radiusKm: 5 }) }
                  : { label: "Tải lại danh sách", onClick: () => setReload((n) => n + 1) }
            }
            secondaryAction={{ label: "Xem món miễn phí hôm nay", href: "/free" }}
          />
        ) : (
          <ul className={styles.list}>
            {state.cards.map((card) => (
              <li key={card.id}>
                <FoodCard listing={card} href={`/listings/${card.id}`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function DiscoverScreen() {
  return (
    <Suspense
      fallback={
        <div className={styles.screen}>
          <div className={styles.map}>
            <div className={styles.mapPlaceholder} aria-hidden="true" />
          </div>
        </div>
      }
    >
      <DiscoverScreenInner />
    </Suspense>
  );
}
