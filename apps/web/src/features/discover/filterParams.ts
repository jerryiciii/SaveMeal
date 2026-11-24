import { CATEGORIES, type Category, type ListingSearchParams } from "@/lib/contract/types";

export const DEFAULT_RADIUS_KM = 3;
export const DEFAULT_SORT = "distance" as const;
export const SORT_OPTIONS = ["distance", "pickupSoon", "priceAsc", "newest"] as const;
export type DiscoverSort = (typeof SORT_OPTIONS)[number];
export type PickupDay = "today" | "tomorrow";

/** Quick filters on Figma V1 01 (2:61–2:66): price (free, < 20k) and distance. */
export type QuickFilter = "free" | "under20k" | "near";

export const SORT_LABEL: Record<DiscoverSort, string> = {
  distance: "Gần nhất",
  pickupSoon: "Nhận sớm nhất",
  priceAsc: "Giá thấp đến cao",
  newest: "Mới đăng nhất",
};

export const PICKUP_DAY_LABEL: Record<PickupDay, string> = {
  today: "Hôm nay",
  tomorrow: "Ngày mai",
};

export type DiscoverFilters = {
  q?: string;
  category?: Category[];
  free?: boolean;
  priceMax?: number;
  radiusKm?: number;
  pickupDay?: PickupDay;
  pickupFrom?: string;
  pickupTo?: string;
  sort?: DiscoverSort;
};

const VALID_CATEGORIES = new Set<string>(CATEGORIES);
const VALID_SORTS = new Set<string>(SORT_OPTIONS);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTime(value: string | null): value is string {
  return value !== null && TIME_RE.test(value);
}

/** Parse URL search params into validated DiscoverFilters (contract LIST-1). */
export function parseFiltersFromSearchParams(params: Pick<URLSearchParams, "get">): DiscoverFilters {
  const filters: DiscoverFilters = {};

  const rawQ = params.get("q")?.trim();
  if (rawQ) filters.q = rawQ;

  const rawCat = params.get("category");
  if (rawCat) {
    const seen = new Set<Category>();
    for (const part of rawCat.split(",")) {
      const token = part.trim().toUpperCase();
      if (VALID_CATEGORIES.has(token)) seen.add(token as Category);
    }
    if (seen.size > 0) filters.category = Array.from(seen);
  }

  if (params.get("free") === "true") {
    filters.free = true;
  }

  const rawPrice = params.get("priceMax");
  if (rawPrice !== null && rawPrice.trim() !== "") {
    const n = Number(rawPrice);
    if (Number.isFinite(n) && n >= 0) filters.priceMax = Math.round(n);
  }

  const rawRadius = params.get("radiusKm");
  if (rawRadius !== null && rawRadius.trim() !== "") {
    const n = Number(rawRadius);
    if (Number.isFinite(n) && n >= 0.5 && n <= 10) filters.radiusKm = n;
  }

  const rawDay = params.get("pickupDay");
  if (rawDay === "today" || rawDay === "tomorrow") {
    filters.pickupDay = rawDay;
  }

  const rawFrom = params.get("pickupFrom");
  if (isValidTime(rawFrom)) filters.pickupFrom = rawFrom;

  const rawTo = params.get("pickupTo");
  if (isValidTime(rawTo)) filters.pickupTo = rawTo;

  const rawSort = params.get("sort");
  if (rawSort && VALID_SORTS.has(rawSort)) {
    filters.sort = rawSort as DiscoverSort;
  }

  return filters;
}

/** Serialize DiscoverFilters into clean URLSearchParams (omitting defaults). */
export function filtersToSearchParams(filters: DiscoverFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.category && filters.category.length > 0) params.set("category", filters.category.join(","));
  if (filters.free) params.set("free", "true");
  if (filters.priceMax !== undefined && Number.isFinite(filters.priceMax) && filters.priceMax >= 0) {
    params.set("priceMax", String(Math.round(filters.priceMax)));
  }
  if (filters.radiusKm !== undefined && filters.radiusKm !== DEFAULT_RADIUS_KM) {
    params.set("radiusKm", String(filters.radiusKm));
  }
  if (filters.pickupDay) params.set("pickupDay", filters.pickupDay);
  if (filters.pickupFrom && TIME_RE.test(filters.pickupFrom)) params.set("pickupFrom", filters.pickupFrom);
  if (filters.pickupTo && TIME_RE.test(filters.pickupTo)) params.set("pickupTo", filters.pickupTo);
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
  return params;
}

export function filtersToQueryString(filters: DiscoverFilters): string {
  const qs = filtersToSearchParams(filters).toString();
  return qs ? `?${qs}` : "";
}

/** Convert DiscoverFilters into LIST-1 API query parameters. */
export function filtersToListingParams(filters: DiscoverFilters): Omit<ListingSearchParams, "view"> {
  return {
    q: filters.q?.trim() || undefined,
    category: filters.category && filters.category.length > 0 ? filters.category : undefined,
    free: filters.free || undefined,
    priceMax: filters.priceMax,
    radiusKm: filters.radiusKm ?? DEFAULT_RADIUS_KM,
    pickupDay: filters.pickupDay,
    pickupFrom: filters.pickupFrom,
    pickupTo: filters.pickupTo,
    sort: filters.sort ?? DEFAULT_SORT,
  };
}

/** Count active filter dimensions (excluding free-text search `q`) for the filter badge. */
export function countActiveFilters(filters: DiscoverFilters): number {
  let count = 0;
  if (filters.category && filters.category.length > 0) count += 1;
  if (filters.free || filters.priceMax !== undefined) count += 1;
  if (filters.radiusKm !== undefined && filters.radiusKm !== DEFAULT_RADIUS_KM) count += 1;
  if (filters.pickupDay || filters.pickupFrom || filters.pickupTo) count += 1;
  if (filters.sort && filters.sort !== DEFAULT_SORT) count += 1;
  return count;
}

export function hasAnyFilter(filters: DiscoverFilters): boolean {
  return Boolean(filters.q?.trim()) || countActiveFilters(filters) > 0;
}

export function isQuickFilterActive(filters: DiscoverFilters, chip: QuickFilter): boolean {
  if (chip === "free") return Boolean(filters.free);
  if (chip === "under20k") return filters.priceMax === 20000;
  return filters.radiusKm === 1;
}

export function toggleQuickFilter(filters: DiscoverFilters, chip: QuickFilter): DiscoverFilters {
  const next: DiscoverFilters = { ...filters };
  if (chip === "free") {
    next.free = next.free ? undefined : true;
  } else if (chip === "under20k") {
    next.priceMax = next.priceMax === 20000 ? undefined : 20000;
  } else {
    next.radiusKm = next.radiusKm === 1 ? undefined : 1;
  }
  return next;
}
