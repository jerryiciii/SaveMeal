import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { createTokenStore } from "@/lib/api/tokenStore";
import { createMockFetch } from "./mockFetch";

// 14:00 in Đà Nẵng, so every seeded pickup window is still open.
const now = () => new Date("2026-11-23T07:00:00Z");
const api = endpoints(createApiClient({ fetchImpl: createMockFetch({ now }), tokens: createTokenStore() }));

describe("mock API follows the contract", () => {
  it("SYS-2 returns config with payments off", async () => {
    const config = await api.getConfig();
    expect(config.features.payments).toBe(false);
    expect(config.limits.radiusKmOptions).toEqual([1, 3, 5]);
  });

  it("LIST-1 list hides sold-out items and sorts by distance", async () => {
    const { data, page } = await api.searchListings({ radiusKm: 3 });
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((b) => !b.soldOut)).toBe(true);
    const distances = data.map((b) => b.distanceMeters ?? 0);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(page.limit).toBe(20);
  });

  it("LIST-1 filters free, priceMax and sellerId", async () => {
    const free = await api.searchListings({ free: true });
    expect(free.data.every((b) => b.price === 0)).toBe(true);
    const cheap = await api.searchListings({ priceMax: 15000 });
    expect(cheap.data.every((b) => b.price <= 15000)).toBe(true);
    const one = await api.searchListings({ sellerId: "acc-may" });
    expect(one.data.length).toBeGreaterThan(0);
    expect(one.data.every((b) => b.seller.id === "acc-may")).toBe(true);
  });

  it("LIST-1 view=map returns pins only", async () => {
    const pins = await api.mapPins({ radiusKm: 3 });
    expect(pins.length).toBeGreaterThan(0);
    expect(Object.keys(pins[0]!).sort()).toEqual(
      ["category", "id", "isFree", "lat", "lng", "quantityAvailable", "price", "title"].sort(),
    );
  });

  it("LIST-1 rejects an out-of-range radius with VALIDATION_FAILED", async () => {
    await expect(api.searchListings({ radiusKm: 50 })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  it("LIST-2 returns detail or LISTING_NOT_FOUND", async () => {
    const b = await api.getListing("l-croissant");
    expect(b.seller.name).toBe("Tiệm bánh Mây");
    expect(b.status).toBe("PUBLISHED");
    await expect(api.getListing("nope")).rejects.toMatchObject({ status: 404, code: "LISTING_NOT_FOUND" });
  });

  it("unmocked endpoints answer the contract 404 envelope", async () => {
    const client = createApiClient({ fetchImpl: createMockFetch({ now }), tokens: createTokenStore() });
    await expect(client.request("GET", "/me")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
