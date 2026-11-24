import type {
  ChecklistKey,
  DeclarationKey,
  ListingCard,
  ListingDetail,
  ListingOwnerView,
  MapPin,
  Me,
  Reservation,
  SellerSummary,
} from "@/lib/contract/types";
import { DECLARATION_KEYS } from "@/lib/contract/types";
import { loadDb, MOCK_OTP, saveDb, type Db, type DbAccount, type DbListing, type DbReservation } from "./db";
import { mockConfig, mockOrigin } from "./fixtures";

/**
 * In-process mock of the SaveMeal API (docs/API_CONTRACT.md v1.1). Same signature
 * as `fetch`, so the real API client is exercised. It covers the MVP demo slice
 * (DOMAIN §10). Unmocked endpoints answer 404 NOT_FOUND with the contract envelope.
 */

const MINUTE = 60_000;
const NO_SHOW_GRACE_MIN = 15;
const EARLY_PICKUP_MIN = mockConfig.limits.earlyPickupMin;
const TOKEN_TTL_MIN = mockConfig.limits.pickupTokenTtlMin;
const RT_KEY = "sm-mock-rt";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Request-Id": `mock_${Date.now()}` },
  });
}

function fail(status: number, code: string, message: string, details?: Record<string, unknown>): never {
  throw new HttpError(status, code, message, details);
}

function rid(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `${prefix}-${rand}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function localDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
}

function localHm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// ---------- session (per tab) ----------

type Session = { get(): string | null; set(accountId: string | null): void };

function tabSession(): Session {
  let memory: string | null = null;
  const ss = (): globalThis.Storage | null => {
    try {
      return typeof window !== "undefined" ? window.sessionStorage : null;
    } catch {
      return null;
    }
  };
  return {
    get: () => ss()?.getItem(RT_KEY) ?? memory,
    set(id) {
      memory = id;
      const s = ss();
      if (!s) return;
      if (id) s.setItem(RT_KEY, id);
      else s.removeItem(RT_KEY);
    },
  };
}

// ---------- jobs (applied lazily on every request) ----------

export function runJobs(db: Db, now: Date): void {
  const t = now.getTime();
  for (const l of db.listings) {
    if (l.status === "PUBLISHED" && l.pickupEnd && t >= Date.parse(l.pickupEnd)) {
      l.status = "EXPIRED"; // JOB-1
      l.closedAt = now.toISOString();
    }
  }
  for (const r of db.reservations) {
    const l = db.listings.find((x) => x.id === r.listingId);
    if (r.status === "RESERVED" && l?.pickupEnd && t >= Date.parse(l.pickupEnd) + NO_SHOW_GRACE_MIN * MINUTE) {
      r.status = "EXPIRED"; // JOB-2
      r.closedAt = now.toISOString();
      revokeTokens(db, r.id, now);
    }
  }
}

function revokeTokens(db: Db, reservationId: string, now: Date): void {
  for (const tk of db.tokens) if (tk.reservationId === reservationId && !tk.usedAt && !tk.revokedAt) tk.revokedAt = now.toISOString();
}

// ---------- views ----------

function sellerSummary(a: DbAccount): SellerSummary {
  return { id: a.id, name: a.seller.name ?? a.displayName ?? "Người bán", type: a.seller.type, verified: a.seller.verified };
}

function imageOf(db: Db, id: string | undefined) {
  const img = id ? db.images.find((i) => i.id === id) : undefined;
  return img ? { id: img.id, url: img.url, width: img.width, height: img.height } : null;
}

function account(db: Db, id: string): DbAccount {
  return db.accounts.find((a) => a.id === id)!;
}

function toCard(db: Db, l: DbListing, distanceMeters: number | null): ListingCard {
  const price = l.price ?? 0;
  return {
    id: l.id,
    title: l.title ?? "",
    category: l.category,
    image: imageOf(db, l.imageIds[0]),
    originalPrice: l.originalPrice,
    price,
    isFree: price === 0,
    quantityAvailable: l.quantityAvailable,
    soldOut: l.quantityAvailable === 0,
    pickupStart: l.pickupStart ?? "",
    pickupEnd: l.pickupEnd ?? "",
    pickup: l.pickup ?? { address: "", lat: 0, lng: 0 },
    distanceMeters,
    seller: sellerSummary(account(db, l.sellerId)),
  };
}

function toDetail(db: Db, l: DbListing, viewerId: string | null): ListingDetail {
  const mine = viewerId
    ? db.reservations.find((r) => r.listingId === l.id && r.buyerId === viewerId && r.status === "RESERVED")
    : undefined;
  return {
    ...toCard(db, l, l.pickup ? Math.round(haversineMeters(mockOrigin, l.pickup)) : null),
    description: l.description,
    images: l.imageIds.map((id) => imageOf(db, id)).filter((x): x is NonNullable<typeof x> => x !== null),
    origin: l.origin ?? "",
    preparedAt: l.preparedAt ?? "",
    storage: l.storage ?? "ROOM_TEMP",
    storageNote: l.storageNote,
    ingredients: l.ingredients,
    allergens: l.allergens,
    status: l.status,
    underReview: l.underReview,
    declaredAt: l.declaredAt,
    myActiveReservationId: mine?.id ?? null,
  };
}

export function missingChecklist(l: DbListing, now: Date): ChecklistKey[] {
  const m: ChecklistKey[] = [];
  if (l.imageIds.length < 1) m.push("PHOTO");
  if (!l.title || l.title.trim().length < 3 || l.title.length > 80) m.push("NAME");
  if (l.price === null || l.price < 0 || (l.originalPrice !== null && l.price > l.originalPrice)) m.push("PRICE");
  if (!l.quantityTotal || l.quantityTotal < 1 || l.quantityTotal > 50) m.push("PORTIONS");
  if (!l.origin?.trim()) m.push("ORIGIN");
  if (!l.preparedAt || Date.parse(l.preparedAt) > now.getTime()) m.push("PREPARED_AT");
  if (!l.storage) m.push("STORAGE");
  const s = l.pickupStart ? Date.parse(l.pickupStart) : NaN;
  const e = l.pickupEnd ? Date.parse(l.pickupEnd) : NaN;
  if (!(s < e) || e <= now.getTime() || e - s > mockConfig.limits.maxWindowHours * 60 * MINUTE) m.push("PICKUP_WINDOW");
  if (!l.pickup?.address || !Number.isFinite(l.pickup.lat) || !Number.isFinite(l.pickup.lng)) m.push("PICKUP_LOCATION");
  return m;
}

const PUBLISHED_EDITABLE = ["title", "description", "imageIds", "quantityTotal", "price", "pickupEnd"];

function toOwner(db: Db, l: DbListing, now: Date): ListingOwnerView {
  const rs = db.reservations.filter((r) => r.listingId === l.id);
  return {
    ...toDetail(db, l, null),
    quantityTotal: l.quantityTotal ?? 0,
    reservedCount: rs.filter((r) => r.status === "RESERVED").reduce((n, r) => n + r.quantity, 0),
    completedCount: rs.filter((r) => r.status === "COMPLETED").reduce((n, r) => n + r.quantity, 0),
    missing: l.status === "DRAFT" ? missingChecklist(l, now) : [],
    editableFields: l.status === "DRAFT" ? ["*"] : l.status === "PUBLISHED" ? PUBLISHED_EDITABLE : [],
    closeReason: l.closeReason,
    blockedReason: null,
    createdAt: l.createdAt,
    publishedAt: l.publishedAt,
  };
}

function currentToken(db: Db, r: DbReservation, now: Date) {
  return db.tokens.find(
    (t) => t.reservationId === r.id && !t.usedAt && !t.revokedAt && Date.parse(t.expiresAt) > now.getTime(),
  );
}

function toReservation(db: Db, r: DbReservation, viewerId: string, now: Date): Reservation {
  const l = db.listings.find((x) => x.id === r.listingId)!;
  const isBuyer = viewerId === r.buyerId;
  const tk = isBuyer && r.status === "RESERVED" ? currentToken(db, r, now) : undefined;
  const active = r.status === "RESERVED";
  return {
    id: r.id,
    code: `SM–${r.code}`,
    status: r.status,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    totalPrice: r.unitPrice * r.quantity,
    listing: {
      id: l.id,
      title: l.title ?? "",
      image: imageOf(db, l.imageIds[0]),
      pickupStart: l.pickupStart ?? "",
      pickupEnd: l.pickupEnd ?? "",
      pickup: l.pickup ?? { address: "", lat: 0, lng: 0 },
      status: l.status,
    },
    seller: sellerSummary(account(db, r.sellerId)),
    buyer: isBuyer ? null : { displayName: account(db, r.buyerId).displayName ?? "Người mua" },
    pickupToken: tk ? { qrPayload: `SM1.${tk.token}`, expiresAt: tk.expiresAt } : null,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    closedAt: r.closedAt,
    canCancel: isBuyer && active && now.getTime() < Date.parse(l.pickupEnd ?? ""),
    canReport: isBuyer,
  };
}

function toMe(db: Db, a: DbAccount): Me {
  const myListings = db.listings.filter((l) => l.sellerId === a.id && (l.status === "PUBLISHED" || l.status === "DRAFT"));
  return {
    id: a.id,
    displayName: a.displayName,
    phone: a.phone,
    email: a.email,
    avatar: null,
    role: a.role,
    status: a.status,
    seller: a.seller,
    stats: {
      portionsHandedOver: db.reservations.filter((r) => r.sellerId === a.id && r.status === "COMPLETED").reduce((n, r) => n + r.quantity, 0),
      reservationsActive: db.reservations.filter((r) => r.buyerId === a.id && r.status === "RESERVED").length,
      listingsActive: myListings.length,
    },
    createdAt: a.createdAt,
  };
}

function issueToken(db: Db, r: DbReservation, l: DbListing, now: Date) {
  revokeTokens(db, r.id, now);
  const limit = Date.parse(l.pickupEnd ?? "") + NO_SHOW_GRACE_MIN * MINUTE;
  const tk = {
    token: randomToken(),
    reservationId: r.id,
    expiresAt: new Date(Math.min(now.getTime() + TOKEN_TTL_MIN * MINUTE, limit)).toISOString(),
    usedAt: null,
    revokedAt: null,
  };
  db.tokens.push(tk);
  return { qrPayload: `SM1.${tk.token}`, expiresAt: tk.expiresAt };
}

// ---------- request plumbing ----------

type Req = {
  url: URL;
  method: string;
  params: string[];
  body: unknown;
  form: FormData | null;
  headers: Record<string, string>;
  now: Date;
  db: Db;
  session: Session;
};
type Result = { status: number; body?: unknown };
type Handler = (req: Req) => Result | Promise<Result>;

function requireUser(req: Req): DbAccount {
  const auth = req.headers.authorization ?? req.headers.Authorization ?? "";
  const m = /^Bearer mock-at\.([^.]+)\./.exec(auth);
  const acc = m ? req.db.accounts.find((a) => a.id === m[1]) : undefined;
  if (!acc) fail(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.");
  if (acc.status !== "ACTIVE") fail(403, "ACCOUNT_SUSPENDED", "Tài khoản đang bị tạm khóa.");
  return acc;
}

function optionalUser(req: Req): DbAccount | null {
  try {
    return requireUser(req);
  } catch {
    return null;
  }
}

function accessToken(accountId: string): string {
  return `mock-at.${accountId}.${Date.now()}`;
}

function body<T>(req: Req): Partial<T> {
  return (req.body && typeof req.body === "object" ? req.body : {}) as Partial<T>;
}

function findListing(req: Req, id: string | undefined): DbListing {
  const l = req.db.listings.find((x) => x.id === id);
  if (!l) fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  return l;
}

function findReservation(req: Req, id: string | undefined): DbReservation {
  const r = req.db.reservations.find((x) => x.id === id);
  if (!r) fail(404, "RESERVATION_NOT_FOUND", "Không tìm thấy đơn này.");
  return r;
}

function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[\s.-]/g, "");
  if (/^\+84\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d)) return `+84${d.slice(1)}`;
  return null;
}

// ---------- handlers ----------

const handlers: { method: string; pattern: RegExp; handler: Handler }[] = [];
const on = (method: string, pattern: RegExp, handler: Handler) => handlers.push({ method, pattern, handler });

on("GET", /^\/health$/, () => ({ status: 200, body: { data: { status: "ok", db: "ok", version: "mock-1.1" } } }));
on("GET", /^\/config$/, () => ({ status: 200, body: { data: mockConfig } }));

// AUTH-1
on("POST", /^\/auth\/otp\/request$/, (req) => {
  const b = body<{ channel: string; identifier: string }>(req);
  const id = b.channel === "EMAIL" ? (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.identifier ?? "") ? b.identifier!.toLowerCase() : null) : normalizePhone(b.identifier ?? "");
  if (!id) fail(400, "VALIDATION_FAILED", "Số điện thoại hoặc email chưa đúng.", { fields: { identifier: "invalid" } });
  const requestId = rid("otp");
  req.db.otps.push({ requestId, identifier: id, code: MOCK_OTP, expiresAt: new Date(req.now.getTime() + 5 * MINUTE).toISOString(), attempts: 0 });
  console.info(`[mock OTP] ${id}: ${MOCK_OTP}`);
  return { status: 200, body: { data: { requestId, expiresAt: new Date(req.now.getTime() + 5 * MINUTE).toISOString(), resendAfterSec: 60, codeLength: 6 } } };
});

// AUTH-2
on("POST", /^\/auth\/otp\/verify$/, (req) => {
  const b = body<{ requestId: string; code: string }>(req);
  const otp = req.db.otps.find((o) => o.requestId === b.requestId);
  if (!otp || Date.parse(otp.expiresAt) < req.now.getTime()) fail(400, "OTP_EXPIRED", "Mã đã hết hạn. Vui lòng gửi lại mã.");
  if (otp.attempts >= 5) fail(429, "OTP_TOO_MANY_ATTEMPTS", "Bạn đã nhập sai quá nhiều lần.");
  if (b.code !== otp.code) {
    otp.attempts += 1;
    fail(400, "OTP_INVALID", "Mã xác minh chưa đúng.", { attemptsLeft: 5 - otp.attempts });
  }
  req.db.otps = req.db.otps.filter((o) => o.requestId !== otp.requestId);
  const isPhone = otp.identifier.startsWith("+");
  let acc = req.db.accounts.find((a) => (isPhone ? a.phone : a.email) === otp.identifier);
  const isNewUser = !acc;
  if (!acc) {
    acc = {
      id: rid("acc"), phone: isPhone ? otp.identifier : null, email: isPhone ? null : otp.identifier, displayName: null,
      role: "USER", status: "ACTIVE", seller: { name: null, type: null, verified: false, defaultPickup: null }, createdAt: req.now.toISOString(),
    };
    req.db.accounts.push(acc);
  }
  req.session.set(acc.id);
  return {
    status: 200,
    body: { data: { accessToken: accessToken(acc.id), accessTokenExpiresAt: new Date(req.now.getTime() + 15 * MINUTE).toISOString(), isNewUser, user: toMe(req.db, acc) } },
  };
});

// AUTH-3
on("POST", /^\/auth\/refresh$/, (req) => {
  const id = req.session.get();
  const acc = id ? req.db.accounts.find((a) => a.id === id) : undefined;
  if (!acc) fail(401, "REFRESH_INVALID", "Phiên đăng nhập đã hết hạn.");
  return { status: 200, body: { data: { accessToken: accessToken(acc.id), accessTokenExpiresAt: new Date(req.now.getTime() + 15 * MINUTE).toISOString() } } };
});

// AUTH-4
on("POST", /^\/auth\/logout$/, (req) => {
  req.session.set(null);
  return { status: 204 };
});

// ME-1 / ME-2
on("GET", /^\/me$/, (req) => ({ status: 200, body: { data: toMe(req.db, requireUser(req)) } }));
on("PATCH", /^\/me$/, (req) => {
  const acc = requireUser(req);
  const b = body<{ displayName: string; seller: Partial<DbAccount["seller"]> }>(req);
  if (b.displayName !== undefined) {
    const n = String(b.displayName).trim();
    if (n.length < 2 || n.length > 40) fail(400, "VALIDATION_FAILED", "Tên hiển thị cần 2–40 ký tự.", { fields: { displayName: "2-40" } });
    acc.displayName = n;
  }
  if (b.seller) {
    if (b.seller.name !== undefined) acc.seller.name = b.seller.name;
    if (b.seller.type !== undefined) acc.seller.type = b.seller.type;
    if (b.seller.defaultPickup !== undefined) acc.seller.defaultPickup = b.seller.defaultPickup;
  }
  return { status: 200, body: { data: toMe(req.db, acc) } };
});

// IMG-1 (multipart). The FE downsizes before upload, so a data URL fits in localStorage.
on("POST", /^\/images$/, async (req) => {
  const acc = requireUser(req);
  const file = req.form?.get("file");
  if (!(file instanceof Blob)) fail(400, "VALIDATION_FAILED", "Thiếu ảnh.", { fields: { file: "required" } });
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) fail(415, "IMAGE_TYPE_UNSUPPORTED", "Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.");
  if (file.size > 5 * 1024 * 1024) fail(413, "IMAGE_TOO_LARGE", "Ảnh lớn hơn 5 MB.");
  const url = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const img = { id: rid("img"), url, width: 0, height: 0, uploaderId: acc.id };
  req.db.images.push(img);
  return { status: 201, body: { data: { id: img.id, url: img.url, width: img.width, height: img.height } } };
});

// LIST-1
on("GET", /^\/listings$/, (req) => {
  const q = req.url.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const csv = (k: string) => (q.get(k) ? q.get(k)!.split(",") : []);
  const lat = num("lat") ?? mockOrigin.lat;
  const lng = num("lng") ?? mockOrigin.lng;
  const radiusKm = num("radiusKm") ?? 3;
  if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radiusKm) || radiusKm < 0.5 || radiusKm > 10) {
    fail(400, "VALIDATION_FAILED", "Tham số tìm kiếm không hợp lệ.", { fields: { radiusKm: "0.5–10" } });
  }
  const text = (q.get("q") ?? "").trim().toLocaleLowerCase("vi");
  const categories = csv("category");
  const priceMax = num("priceMax");
  const free = q.get("free") === "true";
  const sellerId = q.get("sellerId");
  const includeSoldOut = q.get("includeSoldOut") === "true";
  const pickupDay = q.get("pickupDay");
  const pickupFrom = q.get("pickupFrom");
  const pickupTo = q.get("pickupTo");
  const today = localDay(req.now.toISOString());
  const tomorrow = localDay(new Date(req.now.getTime() + 86_400_000).toISOString());

  let rows = req.db.listings
    .filter((l) => l.status === "PUBLISHED" && !l.underReview && l.pickup && account(req.db, l.sellerId).status === "ACTIVE")
    .map((l) => ({ l, d: haversineMeters({ lat, lng }, l.pickup!) }))
    .filter(({ d }) => d <= radiusKm * 1000)
    .filter(({ l }) => includeSoldOut || l.quantityAvailable > 0)
    .filter(({ l }) => !text || (l.title ?? "").toLocaleLowerCase("vi").includes(text) || sellerSummary(account(req.db, l.sellerId)).name.toLocaleLowerCase("vi").includes(text))
    .filter(({ l }) => categories.length === 0 || categories.includes(l.category))
    .filter(({ l }) => !sellerId || l.sellerId === sellerId)
    .filter(({ l }) => priceMax === undefined || (l.price ?? 0) <= priceMax)
    .filter(({ l }) => !free || l.price === 0)
    .filter(({ l }) => !pickupDay || localDay(l.pickupStart!) === (pickupDay === "today" ? today : tomorrow))
    .filter(({ l }) => !pickupFrom || localHm(l.pickupEnd!) > pickupFrom)
    .filter(({ l }) => !pickupTo || localHm(l.pickupStart!) < pickupTo);

  const sort = q.get("sort") ?? "distance";
  rows = rows.sort((x, y) => {
    if (sort === "pickupSoon") return x.l.pickupStart!.localeCompare(y.l.pickupStart!);
    if (sort === "priceAsc") return (x.l.price ?? 0) - (y.l.price ?? 0);
    if (sort === "newest") return (y.l.publishedAt ?? "").localeCompare(x.l.publishedAt ?? "");
    return x.d - y.d;
  });

  if (q.get("view") === "map") {
    const pins: MapPin[] = rows.slice(0, 200).map(({ l }) => ({
      id: l.id, lat: l.pickup!.lat, lng: l.pickup!.lng, title: l.title ?? "", price: l.price ?? 0, isFree: l.price === 0,
      quantityAvailable: l.quantityAvailable, category: l.category,
    }));
    return { status: 200, body: { data: pins } };
  }
  const limit = Math.min(Number(q.get("limit") ?? 20), 50);
  const offset = Number(q.get("cursor") ?? 0);
  const page = rows.slice(offset, offset + limit);
  return {
    status: 200,
    body: { data: page.map(({ l, d }) => toCard(req.db, l, Math.round(d))), page: { nextCursor: offset + limit < rows.length ? String(offset + limit) : null, limit } },
  };
});

// LIST-2
on("GET", /^\/listings\/([^/]+)$/, (req) => {
  const l = findListing(req, req.params[0]);
  const viewer = optionalUser(req);
  if (viewer && viewer.id === l.sellerId) return { status: 200, body: { data: toOwner(req.db, l, req.now) } };
  const hasOrder = viewer && req.db.reservations.some((r) => r.listingId === l.id && r.buyerId === viewer.id);
  if (l.status !== "PUBLISHED" && !hasOrder) fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  return { status: 200, body: { data: toDetail(req.db, l, viewer?.id ?? null) } };
});

type ListingInputBody = Partial<{
  title: string;
  description: string | null;
  category: DbListing["category"];
  imageIds: string[];
  origin: string;
  preparedAt: string;
  storage: DbListing["storage"];
  storageNote: string | null;
  ingredients: string | null;
  allergens: DbListing["allergens"];
  originalPrice: number | null;
  price: number;
  quantityTotal: number;
  pickupStart: string;
  pickupEnd: string;
  pickup: DbListing["pickup"];
}>;

function applyInput(l: DbListing, b: ListingInputBody): void {
  const keys = Object.keys(b) as (keyof ListingInputBody)[];
  for (const k of keys) {
    const v = b[k];
    if (v === undefined) continue;
    (l as Record<string, unknown>)[k] = v;
  }
}

// LIST-3
on("POST", /^\/listings$/, (req) => {
  const acc = requireUser(req);
  const b = body<ListingInputBody>(req);
  if (!b.title || b.title.trim().length < 3) fail(400, "VALIDATION_FAILED", "Tên món cần ít nhất 3 ký tự.", { fields: { title: "min 3" } });
  if (!b.category) fail(400, "VALIDATION_FAILED", "Chọn loại món.", { fields: { category: "required" } });
  const active = req.db.listings.filter((l) => l.sellerId === acc.id && (l.status === "DRAFT" || l.status === "PUBLISHED"));
  if (active.length >= 5) fail(422, "LISTING_LIMIT", "Bạn đã có 5 tin đang hoạt động.");
  const l: DbListing = {
    id: rid("l"), sellerId: acc.id, title: null, description: null, category: b.category, imageIds: [], origin: null,
    preparedAt: null, storage: null, storageNote: null, ingredients: null, allergens: [], originalPrice: null, price: null,
    quantityTotal: null, quantityAvailable: 0, pickupStart: null, pickupEnd: null, pickup: acc.seller.defaultPickup,
    declaration: null, declaredAt: null, status: "DRAFT", underReview: false, publishedAt: null, closedAt: null,
    closeReason: null, createdAt: req.now.toISOString(),
  };
  applyInput(l, b);
  req.db.listings.push(l);
  return { status: 201, body: { data: toOwner(req.db, l, req.now) } };
});

// LIST-4
on("PATCH", /^\/listings\/([^/]+)$/, (req) => {
  const acc = requireUser(req);
  const l = findListing(req, req.params[0]);
  if (l.sellerId !== acc.id) fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  const b = body<ListingInputBody>(req);
  if (l.status === "PUBLISHED") {
    const locked = Object.keys(b).filter((k) => !PUBLISHED_EDITABLE.includes(k));
    if (locked.length) fail(409, "FIELD_LOCKED", "Không thể sửa thông tin này sau khi đăng.", { fields: locked });
    const reserved = (l.quantityTotal ?? 0) - l.quantityAvailable;
    if (b.quantityTotal !== undefined && b.quantityTotal < reserved) fail(409, "QUANTITY_BELOW_RESERVED", "Số suất ít hơn số đã được giữ.");
    if (b.price !== undefined && b.price > (l.price ?? 0)) fail(409, "PRICE_INCREASE_NOT_ALLOWED", "Chỉ có thể giảm giá sau khi đăng.");
    if (b.pickupEnd !== undefined && Date.parse(b.pickupEnd) > Date.parse(l.pickupEnd ?? "")) fail(409, "PICKUP_WINDOW_EXTENSION_NOT_ALLOWED", "Không thể kéo dài giờ nhận.");
    if (b.quantityTotal !== undefined) l.quantityAvailable += b.quantityTotal - (l.quantityTotal ?? 0);
  } else if (l.status !== "DRAFT") {
    fail(409, "INVALID_STATE_TRANSITION", "Tin này đã đóng.", { from: l.status, action: "update" });
  }
  applyInput(l, b);
  return { status: 200, body: { data: toOwner(req.db, l, req.now) } };
});

// LIST-6
on("POST", /^\/listings\/([^/]+)\/publish$/, (req) => {
  const acc = requireUser(req);
  const l = findListing(req, req.params[0]);
  if (l.sellerId !== acc.id) fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  if (l.status !== "DRAFT") fail(409, "INVALID_STATE_TRANSITION", "Tin này đã được đăng.", { from: l.status, action: "publish" });
  const missing = missingChecklist(l, req.now);
  if (missing.length) fail(422, "LISTING_INCOMPLETE", "Tin còn thiếu thông tin bắt buộc.", { missing });
  const decl = (body<{ declaration: Record<DeclarationKey, boolean> }>(req).declaration ?? {}) as Partial<Record<DeclarationKey, boolean>>;
  const missingDecl = DECLARATION_KEYS.filter((k) => decl[k] !== true);
  if (missingDecl.length) fail(422, "DECLARATION_INCOMPLETE", "Cần xác nhận đủ các điều kiện.", { missing: missingDecl });
  l.status = "PUBLISHED";
  l.declaration = decl;
  l.declaredAt = req.now.toISOString();
  l.publishedAt = req.now.toISOString();
  l.quantityAvailable = l.quantityTotal ?? 0;
  return { status: 200, body: { data: toOwner(req.db, l, req.now) } };
});

// LIST-8
on("GET", /^\/me\/listings$/, (req) => {
  const acc = requireUser(req);
  const tab = req.url.searchParams.get("tab") ?? "active";
  const rows = req.db.listings
    .filter((l) => l.sellerId === acc.id)
    .filter((l) => (tab === "done" ? !["DRAFT", "PUBLISHED"].includes(l.status) : ["DRAFT", "PUBLISHED"].includes(l.status)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { status: 200, body: { data: rows.map((l) => toOwner(req.db, l, req.now)), page: { nextCursor: null, limit: 50 } } };
});

// RES-1
on("POST", /^\/reservations$/, (req) => {
  const acc = requireUser(req);
  const key = req.headers["Idempotency-Key"] ?? req.headers["idempotency-key"];
  if (!key) fail(400, "VALIDATION_FAILED", "Thiếu Idempotency-Key.", { fields: { "Idempotency-Key": "required" } });
  const prior = req.db.idempotency[`${acc.id}:${key}`];
  if (prior) return prior;
  const b = body<{ listingId: string; quantity: number }>(req);
  const qty = Number(b.quantity ?? 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > mockConfig.limits.maxQtyPerReservation) {
    fail(422, "QUANTITY_LIMIT_EXCEEDED", `Mỗi đơn tối đa ${mockConfig.limits.maxQtyPerReservation} suất.`);
  }
  const l = findListing(req, b.listingId);
  if (l.sellerId === acc.id) fail(403, "OWN_LISTING_RESERVATION", "Bạn không thể giữ món của chính mình.");
  const mine = req.db.reservations.filter((r) => r.buyerId === acc.id && r.status === "RESERVED");
  const dup = mine.find((r) => r.listingId === l.id);
  if (dup) fail(409, "ALREADY_RESERVED", "Bạn đã giữ món này rồi.", { reservationId: dup.id });
  if (mine.length >= mockConfig.limits.maxActiveReservations) fail(409, "ACTIVE_RESERVATION_LIMIT", "Bạn đang có quá nhiều đơn chưa nhận.");
  // Atomic conditional decrement (single-threaded here; the real API uses one UPDATE … WHERE).
  if (l.status !== "PUBLISHED" || l.underReview || req.now.getTime() >= Date.parse(l.pickupEnd ?? "")) {
    fail(409, "LISTING_NOT_AVAILABLE", "Món này không còn nhận đặt.");
  }
  if (l.quantityAvailable < qty) fail(409, "LISTING_SOLD_OUT", "Món này vừa hết suất.", { quantityAvailable: l.quantityAvailable });
  l.quantityAvailable -= qty;
  const used = new Set(req.db.reservations.filter((r) => r.sellerId === l.sellerId && r.status === "RESERVED").map((r) => r.code));
  let code = "";
  do code = String(Math.floor(1000 + Math.random() * 9000));
  while (used.has(code));
  const r: DbReservation = {
    id: rid("r"), listingId: l.id, buyerId: acc.id, sellerId: l.sellerId, quantity: qty, unitPrice: l.price ?? 0, code,
    status: "RESERVED", cancelReason: null, createdAt: req.now.toISOString(), completedAt: null, closedAt: null,
  };
  req.db.reservations.push(r);
  issueToken(req.db, r, l, req.now);
  const result = { status: 201, body: { data: toReservation(req.db, r, acc.id, req.now) } };
  req.db.idempotency[`${acc.id}:${key}`] = result;
  return result;
});

// RES-2
on("GET", /^\/me\/reservations$/, (req) => {
  const acc = requireUser(req);
  const tab = req.url.searchParams.get("tab") ?? "upcoming";
  const rows = req.db.reservations
    .filter((r) => r.buyerId === acc.id && (tab === "history" ? r.status !== "RESERVED" : r.status === "RESERVED"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { status: 200, body: { data: rows.map((r) => toReservation(req.db, r, acc.id, req.now)), page: { nextCursor: null, limit: 50 } } };
});

// RES-3
on("GET", /^\/reservations\/([^/]+)$/, (req) => {
  const acc = requireUser(req);
  const r = findReservation(req, req.params[0]);
  if (r.buyerId !== acc.id && r.sellerId !== acc.id && acc.role !== "ADMIN") fail(404, "RESERVATION_NOT_FOUND", "Không tìm thấy đơn này.");
  return { status: 200, body: { data: toReservation(req.db, r, acc.id, req.now) } };
});

// RES-4
on("POST", /^\/reservations\/([^/]+)\/cancel$/, (req) => {
  const acc = requireUser(req);
  const r = findReservation(req, req.params[0]);
  if (r.buyerId !== acc.id) fail(404, "RESERVATION_NOT_FOUND", "Không tìm thấy đơn này.");
  if (r.status !== "RESERVED") fail(409, "RESERVATION_NOT_ACTIVE", "Đơn này không còn hiệu lực.");
  const l = findListing(req, r.listingId);
  if (req.now.getTime() >= Date.parse(l.pickupEnd ?? "")) fail(409, "CANCEL_WINDOW_CLOSED", "Đã hết giờ nhận, không thể hủy.");
  const reason = body<{ reason: DbReservation["cancelReason"] }>(req).reason ?? "BUYER_OTHER";
  r.status = "CANCELLED";
  r.cancelReason = reason;
  r.closedAt = req.now.toISOString();
  revokeTokens(req.db, r.id, req.now);
  if (l.status === "PUBLISHED") l.quantityAvailable += r.quantity;
  return { status: 200, body: { data: toReservation(req.db, r, acc.id, req.now) } };
});

// RES-5
on("GET", /^\/me\/sales$/, (req) => {
  const acc = requireUser(req);
  const statuses = (req.url.searchParams.get("status") ?? "RESERVED").split(",");
  const listingId = req.url.searchParams.get("listingId");
  const rows = req.db.reservations
    .filter((r) => r.sellerId === acc.id && statuses.includes(r.status) && (!listingId || r.listingId === listingId))
    .map((r) => ({ r, l: req.db.listings.find((x) => x.id === r.listingId)! }))
    .sort((a, b) => (a.l.pickupStart ?? "").localeCompare(b.l.pickupStart ?? ""));
  return { status: 200, body: { data: rows.map(({ r }) => toReservation(req.db, r, acc.id, req.now)), page: { nextCursor: null, limit: 50 } } };
});

// RES-6
on("POST", /^\/reservations\/([^/]+)\/pickup-token$/, (req) => {
  const acc = requireUser(req);
  const r = findReservation(req, req.params[0]);
  if (r.buyerId !== acc.id) fail(404, "RESERVATION_NOT_FOUND", "Không tìm thấy đơn này.");
  if (r.status !== "RESERVED") fail(409, "RESERVATION_NOT_ACTIVE", "Đơn này không còn hiệu lực.");
  const l = findListing(req, r.listingId);
  if (req.now.getTime() >= Date.parse(l.pickupEnd ?? "") + NO_SHOW_GRACE_MIN * MINUTE) fail(409, "PICKUP_WINDOW_CLOSED", "Đã hết giờ nhận.");
  return { status: 201, body: { data: issueToken(req.db, r, l, req.now) } };
});

type PickupBody = { reservationId?: string; qrPayload?: string; code?: string };

/** Shared by RES-7 and RES-8: resolves the reservation the seller is handing over. */
function resolvePickup(req: Req, seller: DbAccount, b: PickupBody) {
  if (b.qrPayload) {
    const raw = b.qrPayload.trim();
    const tokenStr = raw.startsWith("SM1.") ? raw.slice(4) : "";
    const tk = req.db.tokens.find((t) => t.token === tokenStr);
    const r = tk ? req.db.reservations.find((x) => x.id === tk.reservationId) : undefined;
    if (!tk || !r || r.sellerId !== seller.id) fail(422, "PICKUP_TOKEN_INVALID", "Mã QR không hợp lệ cho cửa hàng của bạn.");
    if (b.reservationId && b.reservationId !== r.id) fail(422, "PICKUP_TOKEN_INVALID", "Mã QR không khớp với đơn.");
    return { r, tk };
  }
  const digits = (b.code ?? "").replace(/\D/g, "");
  const r = req.db.reservations.find(
    (x) => x.sellerId === seller.id && x.code === digits && (!b.reservationId || x.id === b.reservationId) && x.status === "RESERVED",
  );
  if (!r) fail(422, "PICKUP_CODE_INVALID", "Không tìm thấy đơn với mã này.");
  return { r, tk: null };
}

function blockingReason(req: Req, r: DbReservation, tk: { usedAt: string | null; revokedAt: string | null; expiresAt: string } | null) {
  const l = req.db.listings.find((x) => x.id === r.listingId)!;
  const t = req.now.getTime();
  if (l.status === "BLOCKED") return "LISTING_BLOCKED" as const;
  if (tk && tk.usedAt) return "TOKEN_USED" as const;
  if (r.status !== "RESERVED") return "NOT_ACTIVE" as const;
  if (tk && (tk.revokedAt || Date.parse(tk.expiresAt) <= t)) return "TOKEN_EXPIRED" as const;
  if (t < Date.parse(l.pickupStart ?? "") - EARLY_PICKUP_MIN * MINUTE) return "TOO_EARLY" as const;
  if (t > Date.parse(l.pickupEnd ?? "") + NO_SHOW_GRACE_MIN * MINUTE) return "WINDOW_CLOSED" as const;
  return null;
}

// RES-7
on("POST", /^\/pickups\/lookup$/, (req) => {
  const seller = requireUser(req);
  const { r, tk } = resolvePickup(req, seller, body<PickupBody>(req));
  const reason = blockingReason(req, r, tk);
  return {
    status: 200,
    body: { data: { reservation: toReservation(req.db, r, seller.id, req.now), amountToCollect: r.unitPrice * r.quantity, canConfirm: reason === null, blockingReason: reason } },
  };
});

// RES-8
on("POST", /^\/pickups\/confirm$/, (req) => {
  const seller = requireUser(req);
  const b = body<PickupBody>(req);
  if (!b.reservationId) fail(400, "VALIDATION_FAILED", "Thiếu reservationId.", { fields: { reservationId: "required" } });
  const { r, tk } = resolvePickup(req, seller, b);
  const reason = blockingReason(req, r, tk);
  const errors: Record<string, [number, string, string]> = {
    LISTING_BLOCKED: [409, "LISTING_BLOCKED", "Tin này đã bị khóa."],
    NOT_ACTIVE: [409, "RESERVATION_NOT_ACTIVE", "Đơn này không còn hiệu lực."],
    TOKEN_USED: [409, "PICKUP_TOKEN_USED", "Mã QR này đã được dùng."],
    TOKEN_EXPIRED: [409, "PICKUP_TOKEN_EXPIRED", "Mã QR đã hết hạn. Nhờ người mua mở lại mã."],
    TOO_EARLY: [409, "PICKUP_TOO_EARLY", "Chưa đến giờ nhận."],
    WINDOW_CLOSED: [409, "PICKUP_WINDOW_CLOSED", "Đã hết giờ nhận."],
  };
  if (reason) {
    const [s, c, m] = errors[reason]!;
    fail(s, c, m);
  }
  if (tk) tk.usedAt = req.now.toISOString();
  revokeTokens(req.db, r.id, req.now);
  r.status = "COMPLETED";
  r.completedAt = req.now.toISOString();
  r.closedAt = r.completedAt;
  const l = req.db.listings.find((x) => x.id === r.listingId)!;
  return { status: 200, body: { data: { reservation: toReservation(req.db, r, seller.id, req.now), listingRemaining: l.quantityAvailable } } };
});

// ---------- entry point ----------

export type MockFetchOptions = { latencyMs?: number; now?: () => Date };

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...h };
}

export function createMockFetch({ latencyMs = 0, now = () => new Date() }: MockFetchOptions = {}): typeof fetch {
  const session = tabSession();
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    let parsed: unknown;
    let form: FormData | null = null;
    if (typeof init?.body === "string") {
      try {
        parsed = JSON.parse(init.body);
      } catch {
        return json(400, { error: { code: "VALIDATION_FAILED", message: "Body không phải JSON hợp lệ." } });
      }
    } else if (init?.body instanceof FormData) {
      form = init.body;
    }
    for (const route of handlers) {
      if (route.method !== method) continue;
      const m = path.match(route.pattern);
      if (!m) continue;
      const t = now();
      const db = loadDb(t);
      runJobs(db, t);
      try {
        const res = await route.handler({
          url, method, params: m.slice(1).map(decodeURIComponent), body: parsed, form, headers: headerRecord(init?.headers), now: t, db, session,
        });
        saveDb(db);
        return json(res.status, res.body);
      } catch (err) {
        if (err instanceof HttpError) {
          saveDb(db);
          return json(err.status, { error: { code: err.code, message: err.message, details: err.details, requestId: `mock_${Date.now()}` } });
        }
        throw err;
      }
    }
    return json(404, { error: { code: "NOT_FOUND", message: `Mock chưa hỗ trợ ${method} ${path}.` } });
  };
}
