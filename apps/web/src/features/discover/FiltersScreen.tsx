"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Button, Chip, Notice, ScreenHeader, TextField } from "@/components/ui";
import { CATEGORY_LABEL } from "@/features/post/labels";
import { saveMeal } from "@/lib/api";
import { CATEGORIES, type AppConfig, type Category } from "@/lib/contract/types";
import { formatVnd } from "@/lib/format";
import { getClientLocation, type ClientPoint } from "./clientLocation";
import {
  DEFAULT_RADIUS_KM,
  DEFAULT_SORT,
  filtersToListingParams,
  filtersToQueryString,
  parseFiltersFromSearchParams,
  PICKUP_DAY_LABEL,
  SORT_LABEL,
  SORT_OPTIONS,
  type DiscoverFilters,
  type DiscoverSort,
  type PickupDay,
} from "./filterParams";
import styles from "./FiltersScreen.module.css";

const PRICE_PRESETS = [
  { id: "all", label: "Tất cả" },
  { id: "free", label: "Miễn phí (0đ)" },
  { id: "15000", label: "Dưới 15.000đ", priceMax: 15000 },
  { id: "20000", label: "Dưới 20.000đ", priceMax: 20000 },
  { id: "30000", label: "Dưới 30.000đ", priceMax: 30000 },
  { id: "50000", label: "Dưới 50.000đ", priceMax: 50000 },
] as const;

/**
 * Figma V1 12 · Advanced filters (7:54).
 * Covers food category, price (free / priceMax), distance (1/3/5 km),
 * pickup time (today/tomorrow + HH:mm range), and sort.
 * No allergen filter per DOMAIN §9 D5.
 */
function FiltersScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = useMemo(() => parseFiltersFromSearchParams(searchParams), [searchParams]);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [point, setPoint] = useState<ClientPoint | null>(null);
  const [categories, setCategories] = useState<Category[]>(() => initial.category ?? []);
  const [free, setFree] = useState<boolean>(() => Boolean(initial.free));
  const [priceMaxInput, setPriceMaxInput] = useState<string>(() =>
    !initial.free && initial.priceMax !== undefined ? String(initial.priceMax) : "",
  );
  const [radiusKm, setRadiusKm] = useState<number>(() => initial.radiusKm ?? DEFAULT_RADIUS_KM);
  const [pickupDay, setPickupDay] = useState<PickupDay | undefined>(() => initial.pickupDay);
  const [pickupFrom, setPickupFrom] = useState<string>(() => initial.pickupFrom ?? "");
  const [pickupTo, setPickupTo] = useState<string>(() => initial.pickupTo ?? "");
  const [sort, setSort] = useState<DiscoverSort>(() => initial.sort ?? DEFAULT_SORT);

  const parsedPriceMax = useMemo(() => {
    if (free || !priceMaxInput.trim()) return undefined;
    const digits = priceMaxInput.replace(/\D/g, "");
    if (!digits) return undefined;
    const n = Number(digits);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }, [free, priceMaxInput]);

  const timeRangeInvalid = Boolean(pickupFrom && pickupTo && pickupFrom >= pickupTo);

  const draft: DiscoverFilters = useMemo(
    () => ({
      q: initial.q,
      category: categories.length > 0 ? categories : undefined,
      free: free || undefined,
      priceMax: free ? undefined : parsedPriceMax,
      radiusKm,
      pickupDay,
      pickupFrom: !timeRangeInvalid && pickupFrom ? pickupFrom : undefined,
      pickupTo: !timeRangeInvalid && pickupTo ? pickupTo : undefined,
      sort,
    }),
    [initial.q, categories, free, parsedPriceMax, radiusKm, pickupDay, pickupFrom, pickupTo, timeRangeInvalid, sort],
  );

  const previewKey = point && !timeRangeInvalid ? `${filtersToQueryString(draft)}|${point.lat}|${point.lng}` : "";
  const [preview, setPreview] = useState<{ key: string; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    saveMeal
      .getConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setPoint(getClientLocation() ?? c.defaultCenter);
      })
      .catch(() => {
        // fallback defaults remain active
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!point || !previewKey || timeRangeInvalid) return;
    let cancelled = false;
    const forKey = previewKey;
    saveMeal
      .mapPins({ ...filtersToListingParams(draft), lat: point.lat, lng: point.lng })
      .then((pins) => {
        if (!cancelled) setPreview({ key: forKey, count: pins.length });
      })
      .catch(() => {
        // non-blocking preview count
      });
    return () => {
      cancelled = true;
    };
  }, [draft, point, previewKey, timeRangeInvalid]);

  const availableCategories = config?.enums.categories ?? [...CATEGORIES];
  const radiusOptions = config?.limits.radiusKmOptions ?? [1, 3, 5];
  const matchCount = preview?.key === previewKey ? preview.count : null;

  function toggleCategory(cat: Category) {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((item) => item !== cat) : [...prev, cat]));
  }

  function resetAll() {
    setCategories([]);
    setFree(false);
    setPriceMaxInput("");
    setRadiusKm(DEFAULT_RADIUS_KM);
    setPickupDay(undefined);
    setPickupFrom("");
    setPickupTo("");
    setSort(DEFAULT_SORT);
  }

  function apply() {
    if (timeRangeInvalid) return;
    router.push(`/${filtersToQueryString(draft)}`);
  }

  return (
    <div className={styles.screen}>
      <ScreenHeader
        title="Bộ lọc"
        right={
          <button type="button" className={styles.resetBtn} onClick={resetAll}>
            Đặt lại
          </button>
        }
      />

      <div className={styles.body}>
        <section className={styles.section} aria-label="Loại món">
          <h2 className={styles.sectionTitle}>Loại món</h2>
          <div className={styles.chips}>
            {availableCategories.map((cat) => (
              <Chip key={cat} selected={categories.includes(cat)} onClick={() => toggleCategory(cat)}>
                {CATEGORY_LABEL[cat]}
              </Chip>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-label="Mức giá">
          <h2 className={styles.sectionTitle}>Mức giá</h2>
          <div className={styles.chips}>
            {PRICE_PRESETS.map((preset) => {
              const selected =
                preset.id === "all"
                  ? !free && parsedPriceMax === undefined
                  : preset.id === "free"
                    ? free
                    : !free && parsedPriceMax === preset.priceMax;
              return (
                <Chip
                  key={preset.id}
                  selected={selected}
                  onClick={() => {
                    if (preset.id === "all") {
                      setFree(false);
                      setPriceMaxInput("");
                    } else if (preset.id === "free") {
                      setFree(true);
                      setPriceMaxInput("");
                    } else {
                      setFree(false);
                      setPriceMaxInput(String(preset.priceMax));
                    }
                  }}
                >
                  {preset.label}
                </Chip>
              );
            })}
          </div>
          {!free ? (
            <TextField
              label="Giá tối đa tùy chỉnh (VND)"
              inputMode="numeric"
              placeholder="Ví dụ: 25000"
              value={priceMaxInput}
              onChange={(e) => setPriceMaxInput(e.target.value.replace(/\D/g, ""))}
              hint={parsedPriceMax !== undefined ? `Hiển thị món từ ${formatVnd(parsedPriceMax)} trở xuống` : "Để trống nếu không giới hạn giá"}
            />
          ) : null}
        </section>

        <section className={styles.section} aria-label="Khoảng cách">
          <h2 className={styles.sectionTitle}>Khoảng cách tối đa</h2>
          <div className={styles.chips}>
            {radiusOptions.map((km) => (
              <Chip key={km} selected={radiusKm === km} onClick={() => setRadiusKm(km)}>
                Trong {km} km
              </Chip>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-label="Thời gian nhận">
          <h2 className={styles.sectionTitle}>Thời gian nhận</h2>
          <div className={styles.chips}>
            <Chip selected={pickupDay === undefined} onClick={() => setPickupDay(undefined)}>
              Bất kỳ ngày nào
            </Chip>
            {(["today", "tomorrow"] as const).map((day) => (
              <Chip key={day} selected={pickupDay === day} onClick={() => setPickupDay(day)}>
                {PICKUP_DAY_LABEL[day]}
              </Chip>
            ))}
          </div>
          <div className={styles.timeGrid}>
            <TextField
              label="Nhận từ giờ"
              type="time"
              value={pickupFrom}
              onChange={(e) => setPickupFrom(e.target.value)}
            />
            <TextField
              label="Đến giờ"
              type="time"
              value={pickupTo}
              onChange={(e) => setPickupTo(e.target.value)}
            />
          </div>
          {timeRangeInvalid ? (
            <Notice tone="error">Giờ bắt đầu phải sớm hơn giờ kết thúc.</Notice>
          ) : null}
        </section>

        <section className={styles.section} aria-label="Sắp xếp">
          <h2 className={styles.sectionTitle}>Sắp xếp theo</h2>
          <div className={styles.sortList} role="radiogroup" aria-label="Sắp xếp kết quả">
            {SORT_OPTIONS.map((option) => {
              const selected = sort === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={[styles.sortOption, selected ? styles.sortSelected : ""].filter(Boolean).join(" ")}
                  onClick={() => setSort(option)}
                >
                  <span>{SORT_LABEL[option]}</span>
                  <span className={styles.radioDot} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className={styles.footer}>
        <Button variant="primary" disabled={timeRangeInvalid} onClick={apply}>
          {matchCount !== null ? `Áp dụng · Xem ${matchCount} món` : "Áp dụng bộ lọc"}
        </Button>
      </div>
    </div>
  );
}

export function FiltersScreen() {
  return (
    <Suspense fallback={<ScreenHeader title="Bộ lọc" />}>
      <FiltersScreenInner />
    </Suspense>
  );
}
