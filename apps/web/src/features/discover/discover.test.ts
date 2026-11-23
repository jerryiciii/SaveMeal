import { describe, expect, it } from "vitest";
import { filtersToParams } from "./DiscoverScreen";

describe("discover quick filters", () => {
  it("maps chips to BATCH-1 params", () => {
    expect(filtersToParams(new Set())).toEqual({ sort: "distance", free: undefined, priceMax: undefined, radiusKm: 3 });
    expect(filtersToParams(new Set(["free", "under20k", "near"]))).toEqual({
      sort: "distance",
      free: true,
      priceMax: 20000,
      radiusKm: 1,
    });
  });
});
