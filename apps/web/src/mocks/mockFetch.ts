import type { BatchCard, BatchDetail, MapPin } from "@/lib/contract/types";
import { buildMockBatches, mockConfig, mockOrigin } from "./fixtures";

/**
 * In-process mock of the LASTBITE API (docs/API_CONTRACT.md). It has the same
 * signature as `fetch`, so the real API client code path is exercised.
 * Endpoints not mocked yet answer 404 NOT_FOUND with the contract envelope.
 */

type Handler = (req: { url: URL; method: string; params: string[]; body: unknown; now: Date }) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Request-Id": `mock_${Date.now()}` },
  });
}

function error(status: number, code: string, message: string, details?: Record<string, unknown>): Response {
  return json(status, { error: { code, message, details, requestId: `mock_${Date.now()}` } });
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toCard(b: BatchDetail, distanceMeters: number | null): BatchCard {
  const { store } = b;
  return {
    id: b.id,
    title: b.title,
    category: b.category,
    image: b.image,
    originalPrice: b.originalPrice,
    rescuePrice: b.rescuePrice,
    isFree: b.isFree,
    quantityAvailable: b.quantityAvailable,
    soldOut: b.soldOut,
    pickupStart: b.pickupStart,
    pickupEnd: b.pickupEnd,
    allergens: b.allergens,
    distanceMeters,
    isSaved: b.isSaved,
    store: {
      id: store.id,
      name: store.name,
      type: store.type,
      area: store.area,
      lat: store.lat,
      lng: store.lng,
      verified: store.verified,
      ratingAvg: store.ratingAvg,
      ratingCount: store.ratingCount,
    },
  };
}

function localDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
}

const listBatches: Handler = ({ url, now }) => {
  const q = url.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const csv = (k: string) => (q.get(k) ? q.get(k)!.split(",") : []);
  const lat = num("lat") ?? mockOrigin.lat;
  const lng = num("lng") ?? mockOrigin.lng;
  const radiusKm = num("radiusKm") ?? 3;
  if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radiusKm) || radiusKm < 0.5 || radiusKm > 10) {
    return error(400, "VALIDATION_FAILED", "Tham số tìm kiếm không hợp lệ.", { fields: { radiusKm: "0.5–10" } });
  }
  const text = (q.get("q") ?? "").trim().toLocaleLowerCase("vi");
  const categories = csv("category");
  const excludeAllergens = csv("excludeAllergens");
  const priceMax = num("priceMax");
  const free = q.get("free") === "true";
  const includeSoldOut = q.get("includeSoldOut") === "true";
  const pickupDay = q.get("pickupDay");
  const today = localDay(now.toISOString());
  const tomorrow = localDay(new Date(now.getTime() + 86400000).toISOString());

  let rows = buildMockBatches(now)
    .filter((b) => b.status === "PUBLISHED" && !b.isPaused && new Date(b.pickupEnd) > now)
    .map((b) => ({ b, d: haversineMeters({ lat, lng }, b.store) }))
    .filter(({ d }) => d <= radiusKm * 1000)
    .filter(({ b }) => includeSoldOut || !b.soldOut)
    .filter(({ b }) => !text || b.title.toLocaleLowerCase("vi").includes(text) || b.store.name.toLocaleLowerCase("vi").includes(text))
    .filter(({ b }) => categories.length === 0 || categories.includes(b.category))
    .filter(({ b }) => !excludeAllergens.some((a) => (b.allergens as string[]).includes(a)))
    .filter(({ b }) => priceMax === undefined || b.rescuePrice <= priceMax)
    .filter(({ b }) => !free || b.rescuePrice === 0)
    .filter(({ b }) => !pickupDay || localDay(b.pickupStart) === (pickupDay === "today" ? today : tomorrow));

  const sort = q.get("sort") ?? "distance";
  rows = rows.sort((x, y) => {
    if (sort === "pickupSoon") return x.b.pickupStart.localeCompare(y.b.pickupStart);
    if (sort === "priceAsc") return x.b.rescuePrice - y.b.rescuePrice;
    return x.d - y.d;
  });

  if (q.get("view") === "map") {
    const pins: MapPin[] = rows.slice(0, 200).map(({ b }) => ({
      id: b.id,
      lat: b.store.lat,
      lng: b.store.lng,
      title: b.title,
      rescuePrice: b.rescuePrice,
      isFree: b.isFree,
      quantityAvailable: b.quantityAvailable,
      category: b.category,
    }));
    return json(200, { data: pins });
  }

  const limit = Math.min(Number(q.get("limit") ?? 20), 50);
  const offset = Number(q.get("cursor") ?? 0);
  const page = rows.slice(offset, offset + limit);
  const nextCursor = offset + limit < rows.length ? String(offset + limit) : null;
  return json(200, { data: page.map(({ b, d }) => toCard(b, Math.round(d))), page: { nextCursor, limit } });
};

const getBatch: Handler = ({ params, now }) => {
  const b = buildMockBatches(now).find((x) => x.id === params[0]);
  if (!b) return error(404, "BATCH_NOT_FOUND", "Không tìm thấy món này.");
  return json(200, { data: { ...b, distanceMeters: Math.round(haversineMeters(mockOrigin, b.store)) } });
};

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
  { method: "GET", pattern: /^\/health$/, handler: () => json(200, { data: { status: "ok", db: "ok", version: "mock" } }) },
  { method: "GET", pattern: /^\/config$/, handler: () => json(200, { data: mockConfig }) },
  { method: "GET", pattern: /^\/batches$/, handler: listBatches },
  { method: "GET", pattern: /^\/batches\/([^/]+)$/, handler: getBatch },
];

export type MockFetchOptions = { latencyMs?: number; now?: () => Date };

export function createMockFetch({ latencyMs = 0, now = () => new Date() }: MockFetchOptions = {}): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        return error(400, "VALIDATION_FAILED", "Body không phải JSON hợp lệ.");
      }
    }
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = path.match(route.pattern);
      if (m) return route.handler({ url, method, params: m.slice(1).map(decodeURIComponent), body, now: now() });
    }
    return error(404, "NOT_FOUND", `Mock chưa hỗ trợ ${method} ${path}.`);
  };
}
