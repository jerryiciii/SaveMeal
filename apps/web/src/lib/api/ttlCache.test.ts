import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listingQueryKey, TtlCache } from "./ttlCache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached value within TTL and refetches after expiry", async () => {
    const cache = new TtlCache<string>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    expect(await cache.getOrFetch("k", fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    expect(cache.get("k")).toBeUndefined();
    expect(await cache.getOrFetch("k", fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent in-flight fetches and supports force bypass", async () => {
    const cache = new TtlCache<number>(60_000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const [a, b] = await Promise.all([cache.getOrFetch("k", fetcher), cache.getOrFetch("k", fetcher)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    expect(await cache.getOrFetch("k", fetcher, true)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes listing query keys and rounds coordinates", () => {
    const k1 = listingQueryKey({ lat: 16.05441, lng: 108.20221, radiusKm: 3, free: true });
    const k2 = listingQueryKey({ free: true, radiusKm: 3, lng: 108.20224, lat: 16.05444 });
    expect(k1).toBe(k2);
  });
});
