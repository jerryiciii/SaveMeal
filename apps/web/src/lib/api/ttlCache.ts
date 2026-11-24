/** Lightweight in-memory TTL cache with in-flight promise deduplication. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 40,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency for LRU-style eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  getOrFetch(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
    if (!force) {
      const cached = this.get(key);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = this.inflight.get(key);
      if (pending) return pending;
    }

    const promise = fetcher().then(
      (value) => {
        this.set(key, value);
        this.inflight.delete(key);
        return value;
      },
      (err) => {
        this.inflight.delete(key);
        throw err;
      },
    );

    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}

/** Build a stable cache key for listing discovery/search parameters (rounds lat/lng to ~11m). */
export function listingQueryKey(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const raw = params[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if ((key === "lat" || key === "lng") && typeof raw === "number") {
      parts.push(`${key}=${raw.toFixed(4)}`);
    } else if (Array.isArray(raw)) {
      if (raw.length > 0) parts.push(`${key}=${[...raw].sort().join(",")}`);
    } else {
      parts.push(`${key}=${String(raw)}`);
    }
  }
  return parts.join("&");
}
