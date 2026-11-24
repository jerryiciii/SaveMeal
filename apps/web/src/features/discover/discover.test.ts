import { beforeEach, describe, expect, it } from "vitest";
import { describeUnavailable } from "@/features/listing/ListingDetailScreen";
import { clearClientLocation, getClientLocation, setClientLocation } from "./clientLocation";
import { filtersToParams } from "./DiscoverScreen";
import {
  countActiveFilters,
  filtersToListingParams,
  filtersToQueryString,
  filtersToSearchParams,
  hasAnyFilter,
  isQuickFilterActive,
  parseFiltersFromSearchParams,
  toggleQuickFilter,
} from "./filterParams";
import { addRecentSearch, clearRecentSearches, loadRecentSearches, removeRecentSearch } from "./recentSearches";

describe("discover quick filters", () => {
  it("maps chips to LIST-1 params", () => {
    expect(filtersToParams(new Set())).toEqual({ sort: "distance", free: undefined, priceMax: undefined, radiusKm: 3 });
    expect(filtersToParams(new Set(["free", "under20k", "near"]))).toEqual({
      sort: "distance",
      free: true,
      priceMax: 20000,
      radiusKm: 1,
    });
  });
});

describe("filterParams helpers", () => {
  it("parses valid URLSearchParams and ignores invalid values", () => {
    const params = new URLSearchParams({
      q: "  Bánh mì  ",
      category: "BAKERY,meal,INVALID,BAKERY",
      free: "true",
      priceMax: "20000",
      radiusKm: "5",
      pickupDay: "today",
      pickupFrom: "17:00",
      pickupTo: "19:30",
      sort: "priceAsc",
    });

    expect(parseFiltersFromSearchParams(params)).toEqual({
      q: "Bánh mì",
      category: ["BAKERY", "MEAL"],
      free: true,
      priceMax: 20000,
      radiusKm: 5,
      pickupDay: "today",
      pickupFrom: "17:00",
      pickupTo: "19:30",
      sort: "priceAsc",
    });

    const invalid = new URLSearchParams({
      radiusKm: "99",
      priceMax: "-100",
      pickupDay: "yesterday",
      pickupFrom: "25:99",
      pickupTo: "abc",
      sort: "cheapest",
      free: "false",
    });
    expect(parseFiltersFromSearchParams(invalid)).toEqual({});
  });

  it("serializes cleanly and omits default radiusKm/sort", () => {
    expect(filtersToQueryString({ radiusKm: 3, sort: "distance" })).toBe("");
    const qs = filtersToQueryString({
      category: ["BAKERY", "DRINK"],
      priceMax: 20000,
      radiusKm: 1,
      pickupDay: "tomorrow",
      pickupFrom: "16:30",
      pickupTo: "18:30",
      sort: "pickupSoon",
    });
    const parsed = parseFiltersFromSearchParams(new URLSearchParams(qs));
    expect(parsed).toEqual({
      category: ["BAKERY", "DRINK"],
      priceMax: 20000,
      radiusKm: 1,
      pickupDay: "tomorrow",
      pickupFrom: "16:30",
      pickupTo: "18:30",
      sort: "pickupSoon",
    });
    expect(filtersToSearchParams({ free: true }).get("free")).toBe("true");
  });

  it("maps DiscoverFilters to LIST-1 API params", () => {
    expect(filtersToListingParams({})).toEqual({
      q: undefined,
      category: undefined,
      free: undefined,
      priceMax: undefined,
      radiusKm: 3,
      pickupDay: undefined,
      pickupFrom: undefined,
      pickupTo: undefined,
      sort: "distance",
    });

    expect(
      filtersToListingParams({
        q: "croissant",
        category: ["BAKERY"],
        free: true,
        radiusKm: 1,
        pickupDay: "today",
        pickupFrom: "17:00",
        pickupTo: "18:30",
        sort: "newest",
      }),
    ).toEqual({
      q: "croissant",
      category: ["BAKERY"],
      free: true,
      priceMax: undefined,
      radiusKm: 1,
      pickupDay: "today",
      pickupFrom: "17:00",
      pickupTo: "18:30",
      sort: "newest",
    });
  });

  it("counts active filter dimensions and toggles quick filters", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ q: "bánh" })).toBe(0);
    expect(hasAnyFilter({ q: "bánh" })).toBe(true);
    expect(
      countActiveFilters({
        category: ["MEAL"],
        priceMax: 20000,
        radiusKm: 1,
        pickupDay: "today",
        sort: "priceAsc",
      }),
    ).toBe(5);

    const f1 = toggleQuickFilter({}, "free");
    expect(isQuickFilterActive(f1, "free")).toBe(true);
    const f2 = toggleQuickFilter(f1, "under20k");
    expect(isQuickFilterActive(f2, "under20k")).toBe(true);
    expect(f2.priceMax).toBe(20000);
    const f3 = toggleQuickFilter(f2, "near");
    expect(isQuickFilterActive(f3, "near")).toBe(true);
    expect(f3.radiusKm).toBe(1);
    const f4 = toggleQuickFilter(f3, "near");
    expect(isQuickFilterActive(f4, "near")).toBe(false);
    expect(f4.radiusKm).toBeUndefined();
  });
});

describe("clientLocation (client-only)", () => {
  beforeEach(() => {
    clearClientLocation();
  });

  it("stores, reads, and clears coordinates on the client", () => {
    expect(getClientLocation()).toBeNull();
    setClientLocation({ lat: 16.0544, lng: 108.2022 });
    expect(getClientLocation()).toEqual({ lat: 16.0544, lng: 108.2022 });
    clearClientLocation();
    expect(getClientLocation()).toBeNull();
  });
});

describe("recentSearches", () => {
  beforeEach(() => {
    clearRecentSearches();
  });

  it("deduplicates, caps at 6 items, removes and clears", () => {
    let list = addRecentSearch("Bánh mì", []);
    list = addRecentSearch("Cơm gà", list);
    list = addRecentSearch("bánh mì", list);
    expect(list).toEqual(["bánh mì", "Cơm gà"]);

    for (const term of ["Trà sữa", "Croissant", "Cơm chay", "Sữa chua", "Bánh ngọt"]) {
      list = addRecentSearch(term, list);
    }
    expect(list).toHaveLength(6);
    expect(list[0]).toBe("Bánh ngọt");

    list = removeRecentSearch("Croissant", list);
    expect(list).not.toContain("Croissant");

    expect(clearRecentSearches()).toEqual([]);
    expect(loadRecentSearches()).toEqual([]);
  });
});

describe("describeUnavailable (V1 38)", () => {
  it("returns distinct labels for underReview, expired, withdrawn, blocked, and soldOut", () => {
    expect(describeUnavailable({ status: "PUBLISHED", soldOut: false, underReview: true }).badge).toBe("ĐANG XEM XÉT");
    expect(describeUnavailable({ status: "EXPIRED", soldOut: false, underReview: false }).badge).toBe("ĐÃ QUÁ HẠN");
    expect(describeUnavailable({ status: "WITHDRAWN", soldOut: false, underReview: false }).badge).toBe("ĐÃ GỠ TIN");
    expect(describeUnavailable({ status: "BLOCKED", soldOut: false, underReview: false }).badge).toBe("ĐÃ KHÓA");
    expect(describeUnavailable({ status: "PUBLISHED", soldOut: true, underReview: false }).badge).toBe("HẾT SUẤT");
  });
});
