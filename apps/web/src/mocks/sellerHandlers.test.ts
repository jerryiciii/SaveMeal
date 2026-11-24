import { beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { sellerEndpoints } from "@/lib/api/sellerEndpoints";
import { createTokenStore } from "@/lib/api/tokenStore";
import type { ListingOwnerView, SellerProfile } from "@/lib/contract/types";
import { resetDb, type Db, type DbListing } from "./db";
import { handleSellerMock, type SellerMockResult } from "./sellerHandlers";

const CLOCK = new Date("2026-11-24T07:10:00Z"); // 14:10 +07:00

let db: Db;

function authHeader(accountId: string): Record<string, string> {
  return { authorization: `Bearer mock-at.${accountId}.1` };
}

function call(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; now?: Date } = {},
): SellerMockResult | null {
  const url = new URL(`http://mock.local/api/v1${path}`);
  return handleSellerMock({
    method,
    path,
    url,
    body: options.body,
    headers: options.headers ?? {},
    now: options.now ?? CLOCK,
    db,
  });
}

function makeDraft(overrides: Partial<DbListing> = {}): DbListing {
  const draft: DbListing = {
    id: "l-draft-1",
    sellerId: "acc-may",
    title: "Bánh mì nháp",
    description: null,
    category: "BAKERY",
    imageIds: [],
    origin: "Làm tại tiệm",
    preparedAt: null,
    storage: null,
    storageNote: null,
    ingredients: null,
    allergens: [],
    originalPrice: null,
    price: 10000,
    quantityTotal: 3,
    quantityAvailable: 0,
    pickupStart: null,
    pickupEnd: null,
    pickup: null,
    declaration: null,
    declaredAt: null,
    status: "DRAFT",
    underReview: false,
    publishedAt: null,
    closedAt: null,
    closeReason: null,
    createdAt: CLOCK.toISOString(),
    ...overrides,
  };
  db.listings.push(draft);
  return draft;
}

function createTypedClient(accountId?: string) {
  const tokens = createTokenStore();
  if (accountId) tokens.set(`mock-at.${accountId}.1`);
  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const headers: Record<string, string> = {};
    if (init?.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)) {
      Object.assign(headers, init.headers);
    }
    const parsed = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const res = handleSellerMock({ method, path, url, body: parsed, headers, now: CLOCK, db });
    if (!res) {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), { status: 404 });
    }
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };
  return sellerEndpoints(createApiClient({ fetchImpl, tokens }));
}

beforeEach(() => {
  db = resetDb(CLOCK);
});

describe("handleSellerMock · routing", () => {
  it("returns null for unrelated endpoints", () => {
    expect(call("GET", "/health")).toBeNull();
    expect(call("GET", "/listings")).toBeNull();
  });
});

describe("SELLER-1 · GET /sellers/:id", () => {
  it("returns seller profile with activeListingCount, completedHandovers, and memberSince", () => {
    db.reservations.push(
      {
        id: "r-done-1",
        listingId: "l-banh-ngot",
        buyerId: "acc-minh",
        sellerId: "acc-may",
        quantity: 2,
        unitPrice: 15000,
        code: "1111",
        status: "COMPLETED",
        cancelReason: null,
        createdAt: CLOCK.toISOString(),
        completedAt: CLOCK.toISOString(),
        closedAt: CLOCK.toISOString(),
      },
      {
        id: "r-open-1",
        listingId: "l-banh-ngot",
        buyerId: "acc-minh",
        sellerId: "acc-may",
        quantity: 1,
        unitPrice: 15000,
        code: "2222",
        status: "RESERVED",
        cancelReason: null,
        createdAt: CLOCK.toISOString(),
        completedAt: null,
        closedAt: null,
      },
    );

    const res = call("GET", "/sellers/acc-may");
    expect(res?.status).toBe(200);
    const data = (res?.body as { data: SellerProfile }).data;
    expect(data).toMatchObject({
      id: "acc-may",
      name: "Tiệm bánh Mây",
      type: "BAKERY",
      verified: true,
      activeListingCount: 2,
      completedHandovers: 1,
    });
    expect(data.memberSince).toBeTruthy();
  });

  it("excludes under-review and sold-out listings from activeListingCount", () => {
    const croissant = db.listings.find((l) => l.id === "l-croissant")!;
    croissant.underReview = true;
    const res = call("GET", "/sellers/acc-may");
    const data = (res?.body as { data: SellerProfile }).data;
    expect(data.activeListingCount).toBe(1);
  });

  it("returns 404 SELLER_NOT_FOUND for missing or suspended sellers", () => {
    expect(call("GET", "/sellers/does-not-exist")).toMatchObject({
      status: 404,
      body: { error: { code: "SELLER_NOT_FOUND" } },
    });

    const seller = db.accounts.find((a) => a.id === "acc-may")!;
    seller.status = "SUSPENDED";
    expect(call("GET", "/sellers/acc-may")).toMatchObject({
      status: 404,
      body: { error: { code: "SELLER_NOT_FOUND" } },
    });
  });
});

describe("LIST-5 · DELETE /listings/:id", () => {
  it("deletes an owned DRAFT listing and returns 204", () => {
    makeDraft();
    const res = call("DELETE", "/listings/l-draft-1", { headers: authHeader("acc-may") });
    expect(res).toEqual({ status: 204 });
    expect(db.listings.some((l) => l.id === "l-draft-1")).toBe(false);
  });

  it("rejects deleting a PUBLISHED listing with 409 INVALID_STATE_TRANSITION", () => {
    const res = call("DELETE", "/listings/l-banh-ngot", { headers: authHeader("acc-may") });
    expect(res).toMatchObject({
      status: 409,
      body: { error: { code: "INVALID_STATE_TRANSITION" } },
    });
  });

  it("rejects non-owner with 404 and anonymous with 401", () => {
    makeDraft();
    expect(call("DELETE", "/listings/l-draft-1", { headers: authHeader("acc-minh") })).toMatchObject({
      status: 404,
      body: { error: { code: "LISTING_NOT_FOUND" } },
    });
    expect(call("DELETE", "/listings/l-draft-1")).toMatchObject({
      status: 401,
      body: { error: { code: "UNAUTHENTICATED" } },
    });
  });
});

describe("LIST-7 · POST /listings/:id/withdraw", () => {
  it("withdraws PUBLISHED listing, cancels active RESERVED orders, revokes tokens, and keeps COMPLETED orders", () => {
    db.reservations.push(
      {
        id: "r-active",
        listingId: "l-banh-ngot",
        buyerId: "acc-minh",
        sellerId: "acc-may",
        quantity: 1,
        unitPrice: 15000,
        code: "4281",
        status: "RESERVED",
        cancelReason: null,
        createdAt: CLOCK.toISOString(),
        completedAt: null,
        closedAt: null,
      },
      {
        id: "r-completed",
        listingId: "l-banh-ngot",
        buyerId: "acc-minh",
        sellerId: "acc-may",
        quantity: 1,
        unitPrice: 15000,
        code: "4282",
        status: "COMPLETED",
        cancelReason: null,
        createdAt: CLOCK.toISOString(),
        completedAt: CLOCK.toISOString(),
        closedAt: CLOCK.toISOString(),
      },
    );
    db.tokens.push({
      token: "tok-active",
      reservationId: "r-active",
      expiresAt: new Date(CLOCK.getTime() + 10 * 60_000).toISOString(),
      usedAt: null,
      revokedAt: null,
    });

    const res = call("POST", "/listings/l-banh-ngot/withdraw", {
      headers: authHeader("acc-may"),
      body: { reason: "STORAGE_NOT_OK", note: "Tủ mát mất điện" },
    });

    expect(res?.status).toBe(200);
    const data = (res?.body as { data: ListingOwnerView }).data;
    expect(data.status).toBe("WITHDRAWN");
    expect(data.closeReason).toBe("STORAGE_NOT_OK: Tủ mát mất điện");

    const activeOrder = db.reservations.find((r) => r.id === "r-active")!;
    expect(activeOrder.status).toBe("CANCELLED");
    expect(activeOrder.cancelReason).toBe("SELLER_WITHDREW");
    expect(activeOrder.closedAt).toBe(CLOCK.toISOString());

    const completedOrder = db.reservations.find((r) => r.id === "r-completed")!;
    expect(completedOrder.status).toBe("COMPLETED");

    const token = db.tokens.find((t) => t.token === "tok-active")!;
    expect(token.revokedAt).toBe(CLOCK.toISOString());
  });

  it("validates withdraw reason, note length, and terminal transitions", () => {
    expect(
      call("POST", "/listings/l-banh-ngot/withdraw", {
        headers: authHeader("acc-may"),
        body: { reason: "INVALID_REASON" },
      }),
    ).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_FAILED" } } });

    expect(
      call("POST", "/listings/l-banh-ngot/withdraw", {
        headers: authHeader("acc-may"),
        body: { reason: "OTHER", note: "a".repeat(201) },
      }),
    ).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_FAILED" } } });

    const first = call("POST", "/listings/l-banh-ngot/withdraw", {
      headers: authHeader("acc-may"),
      body: { reason: "SOLD_ELSEWHERE", note: null },
    });
    expect(first?.status).toBe(200);

    const second = call("POST", "/listings/l-banh-ngot/withdraw", {
      headers: authHeader("acc-may"),
      body: { reason: "SOLD_ELSEWHERE", note: null },
    });
    expect(second).toMatchObject({ status: 409, body: { error: { code: "INVALID_STATE_TRANSITION" } } });
  });
});

describe("IMG-2 · DELETE /images/:id", () => {
  it("deletes uploader's unused or draft image and rejects published-in-use image", () => {
    db.images.push(
      { id: "img-free", url: "/mock/free.png", width: 200, height: 200, uploaderId: "acc-may" },
      { id: "img-pub", url: "/mock/pub.png", width: 200, height: 200, uploaderId: "acc-may" },
    );
    const live = db.listings.find((l) => l.id === "l-banh-ngot")!;
    live.imageIds.push("img-pub");

    // Image used by published listing → 409 IMAGE_IN_USE
    expect(call("DELETE", "/images/img-pub", { headers: authHeader("acc-may") })).toMatchObject({
      status: 409,
      body: { error: { code: "IMAGE_IN_USE" } },
    });

    // Another user cannot delete uploader's image → 404 IMAGE_NOT_FOUND
    expect(call("DELETE", "/images/img-free", { headers: authHeader("acc-minh") })).toMatchObject({
      status: 404,
      body: { error: { code: "IMAGE_NOT_FOUND" } },
    });

    // Uploader can delete unused image → 204
    expect(call("DELETE", "/images/img-free", { headers: authHeader("acc-may") })).toEqual({ status: 204 });
    expect(db.images.some((i) => i.id === "img-free")).toBe(false);
  });
});

describe("LIST-4 · PATCH /listings/:id (DOMAIN §3 PUBLISHED rules)", () => {
  it("updates editable fields and adjusts quantityAvailable atomically", () => {
    const live = db.listings.find((l) => l.id === "l-banh-ngot")!;
    // Simulate 2 reserved portions: total 5, available 3
    live.quantityAvailable = 3;
    const earlierEnd = new Date(Date.parse(live.pickupEnd!) - 30 * 60_000).toISOString();

    const res = call("PATCH", "/listings/l-banh-ngot", {
      headers: authHeader("acc-may"),
      body: {
        title: "5 phần bánh ngọt giảm thêm",
        description: "Gói sẵn hộp giấy",
        quantityTotal: 7,
        price: 12000,
        pickupEnd: earlierEnd,
      },
    });
    expect(res?.status).toBe(200);
    const updated = (res?.body as { data: ListingOwnerView }).data;
    expect(updated.title).toBe("5 phần bánh ngọt giảm thêm");
    expect(updated.description).toBe("Gói sẵn hộp giấy");
    expect(updated.quantityTotal).toBe(7);
    expect(updated.quantityAvailable).toBe(5); // 3 + (7 - 5)
    expect(updated.price).toBe(12000);
    expect(updated.pickupEnd).toBe(earlierEnd);
  });

  it("enforces locked fields, price-down-only, quantity >= reserved, and no pickup window extension", () => {
    const live = db.listings.find((l) => l.id === "l-banh-ngot")!;
    live.quantityAvailable = 2; // 3 allocated

    expect(
      call("PATCH", "/listings/l-banh-ngot", {
        headers: authHeader("acc-may"),
        body: { origin: "Nguồn khác", storage: "CHILLED" },
      }),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "FIELD_LOCKED", details: { fields: ["origin", "storage"] } } },
    });

    expect(
      call("PATCH", "/listings/l-banh-ngot", {
        headers: authHeader("acc-may"),
        body: { quantityTotal: 2 },
      }),
    ).toMatchObject({ status: 409, body: { error: { code: "QUANTITY_BELOW_RESERVED" } } });

    expect(
      call("PATCH", "/listings/l-banh-ngot", {
        headers: authHeader("acc-may"),
        body: { price: 20000 },
      }),
    ).toMatchObject({ status: 409, body: { error: { code: "PRICE_INCREASE_NOT_ALLOWED" } } });

    const laterEnd = new Date(Date.parse(live.pickupEnd!) + 30 * 60_000).toISOString();
    expect(
      call("PATCH", "/listings/l-banh-ngot", {
        headers: authHeader("acc-may"),
        body: { pickupEnd: laterEnd },
      }),
    ).toMatchObject({ status: 409, body: { error: { code: "PICKUP_WINDOW_EXTENSION_NOT_ALLOWED" } } });

    const pastEnd = new Date(CLOCK.getTime() - 5 * 60_000).toISOString();
    expect(
      call("PATCH", "/listings/l-banh-ngot", {
        headers: authHeader("acc-may"),
        body: { pickupEnd: pastEnd },
      }),
    ).toMatchObject({ status: 422, body: { error: { code: "PICKUP_WINDOW_INVALID" } } });
  });
});

describe("sellerEndpoints typed API wrappers", () => {
  it("works end-to-end with ApiClient", async () => {
    const publicApi = createTypedClient();
    const profile = await publicApi.getSellerProfile("acc-may");
    expect(profile.name).toBe("Tiệm bánh Mây");
    expect(profile.type).toBe("BAKERY");

    const seller = createTypedClient("acc-may");
    makeDraft({ id: "l-draft-api" });
    await expect(seller.deleteDraftListing("l-draft-api")).resolves.toBeUndefined();

    const withdrawn = await seller.withdrawListing("l-croissant", "SOLD_ELSEWHERE", "Đã tặng hết");
    expect(withdrawn.status).toBe("WITHDRAWN");

    db.images.push({ id: "img-del-api", url: "/mock/x.png", width: 100, height: 100, uploaderId: "acc-may" });
    await expect(seller.deleteImage("img-del-api")).resolves.toBeUndefined();
  });
});
