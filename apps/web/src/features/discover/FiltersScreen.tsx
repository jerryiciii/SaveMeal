"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useState } from "react";
import { Notice, ScreenHeader } from "@/components/ui";
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

type PriceMode = "all" | "free" | "max";

const PRICE_MIN = 5000;
const PRICE_MAX = 100000;
const PRICE_STEP = 5000;
const DEFAULT_PRICE_CAP = 20000;

const PRICE_MODES: ReadonlyArray<{ id: PriceMode; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "free", label: "Miễn phí" },
  { id: "max", label: "Chọn mức giá" },
];

const QUICK_PRICE_PRESETS = [
  { label: "15k", value: 15000 },
  { label: "20k", value: 20000 },
  { label: "30k", value: 30000 },
  { label: "50k", value: 50000 },
] as const;

/**
 * SaveMeal V2.1 Pixel (Orbix "Instant") — 12 · Bộ lọc nâng cao.
 * Covers food category, price (all / free / slider + quick presets),
 * search radius (1/3/5 km), pickup window (day + HH:mm range), and sort.
 * No allergen filter per DOMAIN §9 D5.
 */
function FiltersScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = useMemo(() => parseFiltersFromSearchParams(searchParams), [searchParams]);
  const fromInputId = useId();
  const toInputId = useId();

  const [config, setConfig] = useState<AppConfig | null>(() => saveMeal.peekConfig() ?? null);
  const [point, setPoint] = useState<ClientPoint | null>(
    () => getClientLocation() ?? saveMeal.peekConfig()?.defaultCenter ?? null,
  );
  const [categories, setCategories] = useState<Category[]>(() => initial.category ?? []);
  const [priceMode, setPriceMode] = useState<PriceMode>(() => {
    if (initial.free) return "free";
    if (initial.priceMax !== undefined) return "max";
    return "all";
  });
  const [priceMax, setPriceMax] = useState<number>(() =>
    !initial.free && initial.priceMax !== undefined ? initial.priceMax : DEFAULT_PRICE_CAP,
  );
  const [radiusKm, setRadiusKm] = useState<number>(() => initial.radiusKm ?? DEFAULT_RADIUS_KM);
  const [pickupDay, setPickupDay] = useState<PickupDay | undefined>(() => initial.pickupDay);
  const [pickupFrom, setPickupFrom] = useState<string>(() => initial.pickupFrom ?? "");
  const [pickupTo, setPickupTo] = useState<string>(() => initial.pickupTo ?? "");
  const [sort, setSort] = useState<DiscoverSort>(() => initial.sort ?? DEFAULT_SORT);

  const timeRangeInvalid = Boolean(pickupFrom && pickupTo && pickupFrom >= pickupTo);

  const draft: DiscoverFilters = useMemo(
    () => ({
      q: initial.q,
      category: categories.length > 0 ? categories : undefined,
      free: priceMode === "free" ? true : undefined,
      priceMax: priceMode === "max" ? priceMax : undefined,
      radiusKm,
      pickupDay,
      pickupFrom: !timeRangeInvalid && pickupFrom ? pickupFrom : undefined,
      pickupTo: !timeRangeInvalid && pickupTo ? pickupTo : undefined,
      sort,
    }),
    [initial.q, categories, priceMode, priceMax, radiusKm, pickupDay, pickupFrom, pickupTo, timeRangeInvalid, sort],
  );

  const previewKey = point && !timeRangeInvalid ? `${filtersToQueryString(draft)}|${point.lat}|${point.lng}` : "";
  const [preview, setPreview] = useState<{ key: string; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    saveMeal
      .getConfig({ cache: true })
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
    const params = { ...filtersToListingParams(draft), lat: point.lat, lng: point.lng };
    const hasCached = saveMeal.peekMapPins(params) !== undefined;

    const run = () => {
      saveMeal
        .mapPins(params, { cache: true })
        .then((pins) => {
          if (!cancelled) setPreview({ key: forKey, count: pins.length });
        })
        .catch(() => {
          // non-blocking preview count
        });
    };

    if (hasCached) {
      run();
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(run, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft, point, previewKey, timeRangeInvalid]);

  const availableCategories = config?.enums.categories ?? [...CATEGORIES];
  const radiusOptions = config?.limits.radiusKmOptions ?? [1, 3, 5];
  const matchCount = preview?.key === previewKey ? preview.count : null;

  const sliderValue =
    priceMode === "max" ? Math.min(PRICE_MAX, Math.max(PRICE_MIN, priceMax)) : PRICE_MAX;
  const sliderRatio = (sliderValue - PRICE_MIN) / (PRICE_MAX - PRICE_MIN);

  function toggleCategory(cat: Category) {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((item) => item !== cat) : [...prev, cat]));
  }

  function handleSelectPriceMode(mode: PriceMode) {
    setPriceMode(mode);
  }

  function handleSliderChange(nextValue: number) {
    setPriceMode("max");
    setPriceMax(nextValue);
  }

  function handlePresetClick(value: number) {
    setPriceMode("max");
    setPriceMax(value);
  }

  function resetAll() {
    setCategories([]);
    setPriceMode("all");
    setPriceMax(DEFAULT_PRICE_CAP);
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
        {/* Section 1 · Loại món */}
        <section className={styles.card} aria-label="Loại món">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Loại món</h2>
            {categories.length > 0 ? (
              <span className={styles.tag}>{categories.length} đã chọn</span>
            ) : (
              <span className={styles.tagMuted}>Tất cả</span>
            )}
          </div>
          <div className={styles.seg}>
            {availableCategories.map((cat) => {
              const selected = categories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={selected}
                  className={[styles.chip, selected ? styles.chipActive : ""].filter(Boolean).join(" ")}
                  onClick={() => toggleCategory(cat)}
                >
                  {selected ? <span className={styles.chipDot} aria-hidden="true" /> : null}
                  <span>{CATEGORY_LABEL[cat]}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 2 · Khoảng giá */}
        <section className={styles.card} aria-label="Khoảng giá">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Mức giá tối đa</h2>
            {priceMode === "free" ? (
              <span className={styles.bFree}>Miễn phí 0đ</span>
            ) : priceMode === "max" ? (
              <span className={styles.tag}>≤ {formatVnd(priceMax)}</span>
            ) : (
              <span className={styles.tagMuted}>Tất cả</span>
            )}
          </div>

          <div className={styles.track} role="tablist" aria-label="Chế độ lọc giá">
            {PRICE_MODES.map((mode) => {
              const active = priceMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={[styles.trackBtn, active ? styles.trackBtnActive : ""].filter(Boolean).join(" ")}
                  onClick={() => handleSelectPriceMode(mode.id)}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>

          {priceMode !== "free" ? (
            <div className={styles.rangeBlock}>
              <div className={styles.range}>
                <div className={styles.rail} aria-hidden="true" />
                <div
                  className={[styles.fill, priceMode === "all" ? styles.fillMuted : ""].filter(Boolean).join(" ")}
                  style={{ width: `calc((100% - 26px) * ${sliderRatio})` }}
                  aria-hidden="true"
                />
                <input
                  type="range"
                  className={styles.rangeInput}
                  min={PRICE_MIN}
                  max={PRICE_MAX}
                  step={PRICE_STEP}
                  value={sliderValue}
                  aria-label="Mức giá tối đa"
                  aria-valuetext={priceMode === "max" ? `Tối đa ${formatVnd(priceMax)}` : "Không giới hạn giá"}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                />
              </div>
              <div className={styles.rangeScale} aria-hidden="true">
                <span>5k</span>
                <span>50k</span>
                <span>100k</span>
              </div>
              <div className={styles.presets}>
                {QUICK_PRICE_PRESETS.map((preset) => {
                  const active = priceMode === "max" && priceMax === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      aria-pressed={active}
                      className={[styles.presetBtn, active ? styles.presetBtnActive : ""].filter(Boolean).join(" ")}
                      onClick={() => handlePresetClick(preset.value)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {/* Section 3 · Bán kính tìm kiếm */}
        <section className={styles.card} aria-label="Bán kính tìm kiếm">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Bán kính tìm kiếm</h2>
            <span className={styles.tagMuted}>Trong {radiusKm} km</span>
          </div>
          <div className={styles.track} role="radiogroup" aria-label="Bán kính tìm kiếm">
            {radiusOptions.map((km) => {
              const active = radiusKm === km;
              return (
                <button
                  key={km}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={[styles.trackBtn, active ? styles.trackBtnActive : ""].filter(Boolean).join(" ")}
                  onClick={() => setRadiusKm(km)}
                >
                  {km} km
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 4 · Khung giờ nhận */}
        <section className={styles.card} aria-label="Khung giờ nhận">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Khung giờ nhận</h2>
            {pickupDay ? (
              <span className={styles.tag}>{PICKUP_DAY_LABEL[pickupDay]}</span>
            ) : (
              <span className={styles.tagMuted}>Bất kỳ</span>
            )}
          </div>
          <div className={styles.track} role="radiogroup" aria-label="Ngày nhận">
            <button
              type="button"
              role="radio"
              aria-checked={pickupDay === undefined}
              className={[styles.trackBtn, pickupDay === undefined ? styles.trackBtnActive : ""].filter(Boolean).join(" ")}
              onClick={() => setPickupDay(undefined)}
            >
              Bất kỳ
            </button>
            {(["today", "tomorrow"] as const).map((day) => {
              const active = pickupDay === day;
              return (
                <button
                  key={day}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={[styles.trackBtn, active ? styles.trackBtnActive : ""].filter(Boolean).join(" ")}
                  onClick={() => setPickupDay(day)}
                >
                  {PICKUP_DAY_LABEL[day]}
                </button>
              );
            })}
          </div>
          <div className={styles.timeGrid}>
            <div className={styles.timeField}>
              <label htmlFor={fromInputId} className={styles.timeLabel}>
                Từ
              </label>
              <input
                id={fromInputId}
                type="time"
                className={[styles.inputSoft, timeRangeInvalid ? styles.inputSoftError : ""].filter(Boolean).join(" ")}
                value={pickupFrom}
                onChange={(e) => setPickupFrom(e.target.value)}
              />
            </div>
            <div className={styles.timeField}>
              <label htmlFor={toInputId} className={styles.timeLabel}>
                Đến
              </label>
              <input
                id={toInputId}
                type="time"
                className={[styles.inputSoft, timeRangeInvalid ? styles.inputSoftError : ""].filter(Boolean).join(" ")}
                value={pickupTo}
                onChange={(e) => setPickupTo(e.target.value)}
              />
            </div>
          </div>
          {timeRangeInvalid ? <Notice tone="error">Giờ bắt đầu phải sớm hơn giờ kết thúc.</Notice> : null}
        </section>

        {/* Section 5 · Sắp xếp theo */}
        <section className={styles.sectionBlock} aria-label="Sắp xếp theo">
          <h2 className={styles.sectionEyebrow}>Sắp xếp theo</h2>
          <div className={styles.group} role="radiogroup" aria-label="Sắp xếp kết quả">
            {SORT_OPTIONS.map((option) => {
              const selected = sort === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={[styles.row, selected ? styles.rowSelected : ""].filter(Boolean).join(" ")}
                  onClick={() => setSort(option)}
                >
                  <span>{SORT_LABEL[option]}</span>
                  <span
                    className={[styles.radio, selected ? styles.radioSelected : ""].filter(Boolean).join(" ")}
                    aria-hidden="true"
                  >
                    {selected ? <span className={styles.radioInner} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.cta} disabled={timeRangeInvalid} onClick={apply}>
          {matchCount !== null ? `Áp dụng · Xem ${matchCount} món` : "Áp dụng bộ lọc"}
        </button>
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
