import { describe, expect, it } from "vitest";
import type { MapPin } from "@/lib/contract/types";
import { filtersToParams } from "./DiscoverScreen";
import { projectPins } from "./MapPreview";

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

describe("projectPins", () => {
  const pin = (id: string, lat: number, lng: number): MapPin => ({
    id, lat, lng, title: id, rescuePrice: 0, isFree: true, quantityAvailable: 1, category: "BAKERY",
  });

  it("keeps north up and west left inside the padded box", () => {
    const out = projectPins([pin("nw", 16.06, 108.23), pin("se", 16.04, 108.25)]);
    const nw = out.find((p) => p.pin.id === "nw")!;
    const se = out.find((p) => p.pin.id === "se")!;
    expect(nw.x).toBeLessThan(se.x);
    expect(nw.y).toBeLessThan(se.y);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(0.18 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(0.82 + 1e-9);
    }
  });

  it("handles empty and single-pin input", () => {
    expect(projectPins([])).toEqual([]);
    expect(projectPins([pin("a", 16, 108)])).toHaveLength(1);
  });
});
