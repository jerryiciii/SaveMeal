import { beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { createTokenStore } from "@/lib/api/tokenStore";
import { DECLARATION_KEYS, type DeclarationKey } from "@/lib/contract/types";
import { DEMO_BUYER_PHONE, DEMO_SELLER_PHONE, MOCK_OTP, resetDb } from "./db";
import { createMockFetch } from "./mockFetch";

// Clock starts at 14:10 in Đà Nẵng; tests move it forward to simulate expiry.
let clock = new Date("2026-11-24T07:10:00Z");
const now = () => clock;

function client() {
  const tokens = createTokenStore();
  const api = endpoints(createApiClient({ fetchImpl: createMockFetch({ now }), tokens }));
  return { api, tokens };
}

async function signIn(phone: string) {
  const c = client();
  const { requestId } = await c.api.requestOtp("SMS", phone);
  const res = await c.api.verifyOtp(requestId, MOCK_OTP);
  c.tokens.set(res.accessToken);
  return { ...c, me: res.user };
}

const allTrue = Object.fromEntries(DECLARATION_KEYS.map((k) => [k, true])) as Record<DeclarationKey, boolean>;
const key = () => crypto.randomUUID();

beforeEach(() => {
  clock = new Date("2026-11-24T07:10:00Z");
  resetDb(clock);
});

describe("mock API · public reads", () => {
  it("SYS-2 returns config with payments off and a map style", async () => {
    const config = await client().api.getConfig();
    expect(config.features.payments).toBe(false);
    expect(config.map.styleUrl).toMatch(/^https:\/\//);
  });

  it("LIST-1 hides sold-out items, sorts by distance and filters price", async () => {
    const { api } = client();
    const { data } = await api.searchListings({ radiusKm: 3 });
    expect(data.every((l) => !l.soldOut)).toBe(true);
    const d = data.map((l) => l.distanceMeters ?? 0);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    const cheap = await api.searchListings({ priceMax: 20000 });
    expect(cheap.data.every((l) => l.price <= 20000)).toBe(true);
    expect(cheap.data.some((l) => l.title === "5 phần bánh còn nguyên")).toBe(true);
  });

  it("LIST-1 view=map returns pins only; bad radius is VALIDATION_FAILED", async () => {
    const { api } = client();
    const pins = await api.mapPins({ radiusKm: 3 });
    expect(Object.keys(pins[0]!).sort()).toEqual(["category", "id", "isFree", "lat", "lng", "price", "quantityAvailable", "title"]);
    await expect(api.searchListings({ radiusKm: 50 })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });

  it("LIST-2 returns detail or LISTING_NOT_FOUND", async () => {
    const { api } = client();
    expect((await api.getListing("l-banh-ngot")).seller.name).toBe("Tiệm bánh Mây");
    await expect(api.getListing("nope")).rejects.toMatchObject({ status: 404, code: "LISTING_NOT_FOUND" });
  });
});

describe("mock API · demo slice (DOMAIN §10)", () => {
  it("seller posts, buyer reserves 5 → 4 with a QR, seller scans → COMPLETED", async () => {
    const seller = await signIn(DEMO_SELLER_PHONE);
    // 1. Draft → publish needs the checklist and all declarations.
    const draft = await seller.api.createListing({ title: "5 phần bánh mới", category: "BAKERY", imageIds: ["img-croissant"], price: 15000, originalPrice: 25000, quantityTotal: 5, origin: "Làm tại tiệm" });
    expect(draft.missing).toEqual(expect.arrayContaining(["PREPARED_AT", "STORAGE", "PICKUP_WINDOW"]));
    await expect(seller.api.publishListing(draft.id, allTrue)).rejects.toMatchObject({ code: "LISTING_INCOMPLETE" });
    await seller.api.updateListing(draft.id, {
      preparedAt: "2026-11-24T13:00:00+07:00", storage: "ROOM_TEMP",
      pickupStart: "2026-11-24T14:00:00+07:00", pickupEnd: "2026-11-24T15:30:00+07:00",
    });
    await expect(seller.api.publishListing(draft.id, { ...allTrue, NOT_SPOILED: false })).rejects.toMatchObject({ code: "DECLARATION_INCOMPLETE" });
    const live = await seller.api.publishListing(draft.id, allTrue);
    expect(live.status).toBe("PUBLISHED");
    expect(live.quantityAvailable).toBe(5);

    // 2–3. Buyer reserves 1: stock 5 → 4 and a pickup token is issued at once.
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const k = key();
    const r = await buyer.api.reserve(draft.id, 1, k);
    expect(r.status).toBe("RESERVED");
    expect(r.pickupToken?.qrPayload).toMatch(/^SM1\.[A-Za-z0-9_-]{40,}$/);
    expect(r.pickupToken?.qrPayload).not.toContain(r.id); // no IDs / personal data in the QR
    expect((await buyer.api.reserve(draft.id, 1, k)).id).toBe(r.id); // idempotent replay
    expect((await buyer.api.getListing(draft.id)).quantityAvailable).toBe(4);
    expect((await seller.api.mySales()).data.map((x) => x.id)).toContain(r.id);

    // 4. Seller scans: lookup (no state change) → confirm → COMPLETED; token is single-use.
    const qr = r.pickupToken!.qrPayload;
    const lookup = await seller.api.lookupPickup({ qrPayload: qr });
    expect(lookup).toMatchObject({ canConfirm: true, amountToCollect: 15000, blockingReason: null });
    const done = await seller.api.confirmPickup(r.id, { qrPayload: qr });
    expect(done.reservation.status).toBe("COMPLETED");
    expect(done.listingRemaining).toBe(4);
    await expect(seller.api.confirmPickup(r.id, { qrPayload: qr })).rejects.toMatchObject({ code: "PICKUP_TOKEN_USED" });
    expect((await buyer.api.getReservation(r.id)).status).toBe("COMPLETED");
  });

  it("rotating the token revokes the old QR; another seller cannot use it", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const r = await buyer.api.reserve("l-banh-ngot", 1, key());
    const fresh = await buyer.api.newPickupToken(r.id);
    const seller = await signIn(DEMO_SELLER_PHONE);
    await expect(seller.api.confirmPickup(r.id, { qrPayload: r.pickupToken!.qrPayload })).rejects.toMatchObject({ code: "PICKUP_TOKEN_EXPIRED" });
    const other = await signIn("+84900000099");
    await expect(other.api.lookupPickup({ qrPayload: fresh.qrPayload })).rejects.toMatchObject({ code: "PICKUP_TOKEN_INVALID" });
    // Manual 4-digit fallback works for the right seller.
    const res = await seller.api.confirmPickup(r.id, { code: r.code });
    expect(res.reservation.status).toBe("COMPLETED");
  });

  it("cancel returns the portion (4 → 5)", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const r = await buyer.api.reserve("l-banh-ngot", 1, key());
    expect((await buyer.api.getListing("l-banh-ngot")).quantityAvailable).toBe(4);
    const c = await buyer.api.cancelReservation(r.id, "BUYER_CHANGED_PLAN");
    expect(c.status).toBe("CANCELLED");
    expect((await buyer.api.getListing("l-banh-ngot")).quantityAvailable).toBe(5);
    await expect(buyer.api.cancelReservation(r.id, "BUYER_LATE")).rejects.toMatchObject({ code: "RESERVATION_NOT_ACTIVE" });
  });

  it("expired case: listing EXPIRED at pickupEnd, order EXPIRED after grace, QR rejected", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const r = await buyer.api.reserve("l-banh-ngot", 1, key());
    const seller = await signIn(DEMO_SELLER_PHONE);
    clock = new Date(Date.parse(r.listing.pickupEnd) + 16 * 60_000);
    expect((await buyer.api.getReservation(r.id)).status).toBe("EXPIRED");
    expect((await seller.api.myListings("done")).data.find((l) => l.id === "l-banh-ngot")?.status).toBe("EXPIRED");
    await expect(seller.api.confirmPickup(r.id, { qrPayload: r.pickupToken!.qrPayload })).rejects.toMatchObject({
      code: expect.stringMatching(/PICKUP_TOKEN_EXPIRED|RESERVATION_NOT_ACTIVE/),
    });
  });

  it("guards: own listing, sold out, quantity limit, unauthenticated", async () => {
    const seller = await signIn(DEMO_SELLER_PHONE);
    await expect(seller.api.reserve("l-banh-ngot", 1, key())).rejects.toMatchObject({ code: "OWN_LISTING_RESERVATION" });
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await expect(buyer.api.reserve("l-banh-ngot", 3, key())).rejects.toMatchObject({ code: "QUANTITY_LIMIT_EXCEEDED" });
    await expect(buyer.api.reserve("l-sua-chua", 1, key())).rejects.toMatchObject({ code: "LISTING_SOLD_OUT" });
    await expect(client().api.getMe()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("OTP: wrong code is OTP_INVALID; new accounts are flagged", async () => {
    const c = client();
    const { requestId } = await c.api.requestOtp("SMS", "0905 111 222");
    await expect(c.api.verifyOtp(requestId, "000000")).rejects.toMatchObject({ code: "OTP_INVALID" });
    const ok = await c.api.verifyOtp(requestId, MOCK_OTP);
    expect(ok.isNewUser).toBe(true);
    expect(ok.user.phone).toBe("+84905111222");
  });
});
