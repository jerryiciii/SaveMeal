"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button, Chip, FoodCard, Notice, ScreenHeader, SearchField } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import type { AppConfig, ListingCard } from "@/lib/contract/types";
import { getClientLocation, type ClientPoint } from "./clientLocation";
import { EmptyNearby } from "./EmptyNearby";
import { addRecentSearch, clearRecentSearches, loadRecentSearches, removeRecentSearch } from "./recentSearches";
import styles from "./SearchScreen.module.css";

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; cards: ListingCard[] };

const FREE_KEYWORD = "món miễn phí";

function isFreeShortcut(term: string): boolean {
  return term.trim().toLocaleLowerCase("vi") === FREE_KEYWORD;
}

/**
 * Figma V1 03 · Tìm kiếm (2:188).
 * SYS-2 popularSearches, live search via LIST-1 `q`, local recent searches, and empty state (37).
 */
function SearchScreenInner() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q")?.trim() ?? "";

  const [input, setInput] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [recent, setRecent] = useState<string[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [point, setPoint] = useState<ClientPoint | null>(null);
  const [reload, setReload] = useState(0);

  const trimmed = debouncedQ.trim();
  const queryKey = trimmed && point ? `${trimmed}|${point.lat}|${point.lng}|${reload}` : "";
  const [entry, setEntry] = useState<{ key: string; state: SearchState }>({ key: "", state: { kind: "idle" } });

  useEffect(() => {
    let cancelled = false;
    saveMeal
      .getConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setPoint(getClientLocation() ?? c.defaultCenter);
        setRecent(loadRecentSearches());
      })
      .catch(() => {
        if (!cancelled) setRecent(loadRecentSearches());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(input);
    }, 220);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    if (!trimmed || !point || !queryKey) return;
    let cancelled = false;
    const forKey = queryKey;
    const freeOnly = isFreeShortcut(trimmed);
    saveMeal
      .searchListings({
        lat: point.lat,
        lng: point.lng,
        radiusKm: 5,
        q: freeOnly ? undefined : trimmed,
        free: freeOnly ? true : undefined,
        sort: "distance",
        limit: 20,
      })
      .then((res) => {
        if (!cancelled) setEntry({ key: forKey, state: { kind: "ready", cards: res.data } });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntry({
            key: forKey,
            state: { kind: "error", message: err instanceof ApiError ? err.message : "Không thể tìm món lúc này." },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, point, queryKey]);

  const state: SearchState = !trimmed
    ? { kind: "idle" }
    : !point
      ? { kind: "loading" }
      : entry.key === queryKey
        ? entry.state
        : { kind: "loading" };

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const term = input.trim();
    if (!term) return;
    setDebouncedQ(term);
    setRecent((prev) => addRecentSearch(term, prev));
  }

  function pickTerm(term: string) {
    setInput(term);
    setDebouncedQ(term);
    setRecent((prev) => addRecentSearch(term, prev));
  }

  const popular = config?.popularSearches ?? ["Bánh mì", "Bánh ngọt", "Cơm trưa", "Món miễn phí"];
  const mapHref = isFreeShortcut(trimmed) ? "/?free=true" : `/?q=${encodeURIComponent(trimmed)}`;

  return (
    <div className={styles.screen}>
      <ScreenHeader
        title="Tìm kiếm"
        backHref="/"
        right={
          <Link href={trimmed ? `/filters?q=${encodeURIComponent(trimmed)}` : "/filters"} className={styles.headerAction}>
            Bộ lọc
          </Link>
        }
      />

      <div className={styles.body}>
        <form onSubmit={submitSearch} role="search" className={styles.form}>
          <SearchField
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tìm tên món hoặc tiệm gần bạn"
            enterKeyHint="search"
            autoFocus
          />
        </form>

        {state.kind === "idle" ? (
          <>
            {recent.length > 0 ? (
              <section className={styles.section} aria-label="Tìm kiếm gần đây">
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>Tìm kiếm gần đây</h2>
                  <button
                    type="button"
                    className={styles.textBtn}
                    onClick={() => setRecent(clearRecentSearches())}
                  >
                    Xóa tất cả
                  </button>
                </div>
                <ul className={styles.recentList}>
                  {recent.map((term) => (
                    <li key={term} className={styles.recentItem}>
                      <button type="button" className={styles.recentTerm} onClick={() => pickTerm(term)}>
                        {term}
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        aria-label={`Xóa "${term}" khỏi lịch sử`}
                        onClick={() => setRecent((prev) => removeRecentSearch(term, prev))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={styles.section} aria-label="Tìm kiếm phổ biến">
              <h2 className={styles.sectionTitle}>Tìm kiếm phổ biến</h2>
              <div className={styles.chips}>
                {popular.map((term) => (
                  <Chip key={term} onClick={() => pickTerm(term)}>
                    {term}
                  </Chip>
                ))}
              </div>
            </section>

            <section className={styles.shortcuts} aria-label="Lối tắt khám phá">
              <Link href="/free" className={styles.shortcutCard}>
                <div>
                  <p className={styles.shortcutTitle}>Món miễn phí hôm nay</p>
                  <p className={styles.shortcutDesc}>Xem nhanh các suất 0đ đang mở nhận quanh bạn</p>
                </div>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </Link>
              <Link href="/filters" className={styles.shortcutCard}>
                <div>
                  <p className={styles.shortcutTitle}>Lọc theo loại món, giá & giờ nhận</p>
                  <p className={styles.shortcutDesc}>Thu hẹp kết quả theo bán kính 1–5 km</p>
                </div>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </Link>
            </section>
          </>
        ) : state.kind === "loading" ? (
          <div className={styles.skeletons} aria-busy="true" aria-label="Đang tìm món">
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
            title={`Không tìm thấy "${trimmed}"`}
            description="Thử tìm bằng từ khóa ngắn hơn (như bánh mì, cơm) hoặc xem các món đang mở gần bạn."
            primaryAction={{
              label: "Xóa từ khóa",
              onClick: () => {
                setInput("");
                setDebouncedQ("");
              },
            }}
            secondaryAction={{ label: "Xem tất cả trên bản đồ", href: "/" }}
          />
        ) : (
          <section className={styles.results} aria-label="Kết quả tìm kiếm">
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Tìm thấy {state.cards.length} món</h2>
              <Link href={mapHref} className={styles.mapLink}>
                Xem trên bản đồ
              </Link>
            </div>
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

export function SearchScreen() {
  return (
    <Suspense fallback={<ScreenHeader title="Tìm kiếm" backHref="/" />}>
      <SearchScreenInner />
    </Suspense>
  );
}
