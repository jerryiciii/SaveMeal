import { beforeEach, describe, expect, it } from "vitest";
import { adminEndpoints } from "@/lib/api/adminEndpoints";
import { createApiClient } from "@/lib/api/client";
import { createTokenStore } from "@/lib/api/tokenStore";
import { seedDb, type DbAccount } from "./db";
import { handleAdminMock, seedAdminDemoReports, type AdminMockDb } from "./adminHandlers";

const BASE_TIME = new Date("2026-11-24T08:00:00Z"); // 15:00 +07:00

function makeAdminAccount(overrides: Partial<DbAccount> = {}): DbAccount {
  return {
    id: "acc-admin",
    phone: "+84900000999",
    email: "admin@savemeal.vn",
    displayName: "Quản trị viên",
    role: "ADMIN",
    status: "ACTIVE",
    seller: { name: null, type: null, verified: false, defaultPickup: null },
    createdAt: new Date(BASE_TIME.getTime() - 24 * 3_600_000).toISOString(),
    ...overrides,
  };
}

function createTestHarness(db: AdminMockDb, now: () => Date = () => BASE_TIME) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const headers: Record<string, string> = {};
    if (init?.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(init?.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else if (init?.headers) {
      Object.assign(headers, init.headers);
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const res = handleAdminMock({ method, path, url, body, headers, now: now(), db });
    if (!res) {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), { status: 404 });
    }
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };

  function asAccount(accountId: string | null) {
    const tokens = createTokenStore();
    if (accountId) tokens.set(`mock-at.${accountId}.${now().getTime()}`);
    return adminEndpoints(createApiClient({ fetchImpl, tokens }));
  }

  return { asAccount, fetchImpl };
}

let db: AdminMockDb;

beforeEach(() => {
  db = {
    ...seedDb(BASE_TIME),
    reports: seedAdminDemoReports(BASE_TIME),
  };
  if (!db.accounts.some((a) => a.id === "acc-admin")) {
    db.accounts.push(makeAdminAccount());
  }
});

describe("adminHandlers · auth & role guards", () => {
  it("ignores non-admin paths by returning null", () => {
    const res = handleAdminMock({
      method: "GET",
      path: "/listings",
      url: new URL("http://mock.local/api/v1/listings"),
      body: undefined,
      headers: {},
      now: BASE_TIME,
      db,
    });
    expect(res).toBeNull();
  });

  it("rejects unauthenticated callers with 401 and non-ADMIN users with 403 FORBIDDEN", async () => {
    const { asAccount } = createTestHarness(db);
    await expect(asAccount(null).getMetrics()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await expect(asAccount("acc-minh").getMetrics()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(asAccount("acc-may").listReports()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(asAccount("acc-may").listAccounts()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("rejects suspended admin with 403 ACCOUNT_SUSPENDED", async () => {
    db.accounts.find((a) => a.id === "acc-admin")!.status = "SUSPENDED";
    const { asAccount } = createTestHarness(db);
    await expect(asAccount("acc-admin").getMetrics()).rejects.toMatchObject({ status: 403, code: "ACCOUNT_SUSPENDED" });
  });
});

describe("adminHandlers · ADM-1 & ADM-2 reports moderation", () => {
  it("lists reports filtered by status and type with reporter info", async () => {
    const admin = createTestHarness(db).asAccount("acc-admin");
    const all = await admin.listReports();
    expect(all.data).toHaveLength(2);
    expect(all.data[0]?.reporter).toEqual({ id: "acc-minh", displayName: "Minh" });

    const openOnly = await admin.listReports({ status: "OPEN" });
    expect(openOnly.data.map((r) => r.id)).toEqual(["rep-demo-1"]);

    const unsafeOnly = await admin.listReports({ type: "UNSAFE_FOOD" });
    expect(unsafeOnly.data.map((r) => r.id)).toEqual(["rep-demo-2"]);
  });

  it("ADM-2 LISTING_BLOCKED blocks listing, cancels active reservations and revokes pickup tokens", async () => {
    const listing = db.listings.find((l) => l.id === "l-com-ga")!;
    listing.underReview = true;
    db.reservations.push({
      id: "r-active-1",
      listingId: "l-com-ga",
      buyerId: "acc-minh",
      sellerId: "acc-an-thuong",
      quantity: 1,
      unitPrice: 18000,
      code: "4281",
      status: "RESERVED",
      cancelReason: null,
      createdAt: BASE_TIME.toISOString(),
      completedAt: null,
      closedAt: null,
    });
    db.tokens.push({
      token: "secret-qr-token",
      reservationId: "r-active-1",
      expiresAt: new Date(BASE_TIME.getTime() + 600_000).toISOString(),
      usedAt: null,
      revokedAt: null,
    });

    const admin = createTestHarness(db).asAccount("acc-admin");
    const updated = await admin.updateReport("rep-demo-1", {
      status: "RESOLVED",
      action: "LISTING_BLOCKED",
      resolution: "Xác nhận quán đóng cửa sai giờ đăng, khóa tin.",
    });

    expect(updated.status).toBe("RESOLVED");
    expect(updated.action).toBe("LISTING_BLOCKED");
    expect(updated.handledAt).toBe(BASE_TIME.toISOString());
    expect(listing.status).toBe("BLOCKED");
    expect(listing.underReview).toBe(false);
    expect(db.reservations[0]?.status).toBe("CANCELLED");
    expect(db.reservations[0]?.cancelReason).toBe("LISTING_BLOCKED");
    expect(db.tokens[0]?.revokedAt).toBe(BASE_TIME.toISOString());
  });

  it("ADM-2 clearReview clears underReview flag; ACCOUNT_SUSPENDED suspends reported account", async () => {
    const listing = db.listings.find((l) => l.id === "l-com-ga")!;
    listing.underReview = true;

    const admin = createTestHarness(db).asAccount("acc-admin");
    await admin.updateReport("rep-demo-1", {
      status: "DISMISSED",
      action: "NONE",
      resolution: "Thông tin hợp lệ sau khi đối chiếu.",
      clearReview: true,
    });
    expect(listing.underReview).toBe(false);
    expect(listing.status).toBe("PUBLISHED");

    await admin.updateReport("rep-demo-2", {
      status: "RESOLVED",
      action: "ACCOUNT_SUSPENDED",
      resolution: "Vi phạm nhiều lần.",
    });
    expect(db.accounts.find((a) => a.id === "acc-bep-may")?.status).toBe("SUSPENDED");
  });
});

describe("adminHandlers · ADM-3 & ADM-7 listings", () => {
  it("lists listings with status & underReview filters and blocks PUBLISHED/EXPIRED listings", async () => {
    const target = db.listings.find((l) => l.id === "l-banh-ngot")!;
    target.underReview = true;

    db.reservations.push({
      id: "r-block-test",
      listingId: "l-banh-ngot",
      buyerId: "acc-minh",
      sellerId: "acc-may",
      quantity: 2,
      unitPrice: 15000,
      code: "5512",
      status: "RESERVED",
      cancelReason: null,
      createdAt: BASE_TIME.toISOString(),
      completedAt: null,
      closedAt: null,
    });

    const admin = createTestHarness(db).asAccount("acc-admin");
    const flagged = await admin.listListings({ underReview: true });
    expect(flagged.data.map((l) => l.id)).toEqual(["l-banh-ngot"]);

    await expect(admin.blockListing("l-banh-ngot", "   ")).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });

    const blocked = await admin.blockListing("l-banh-ngot", "Món ăn không đúng mô tả");
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blockedReason).toBe("Món ăn không đúng mô tả");
    expect(blocked.underReview).toBe(false);
    expect(db.reservations[0]?.status).toBe("CANCELLED");
    expect(db.reservations[0]?.cancelReason).toBe("LISTING_BLOCKED");

    // Blocking an already-BLOCKED listing fails with 409
    await expect(admin.blockListing("l-banh-ngot", "Lần 2")).rejects.toMatchObject({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
    });
  });
});

describe("adminHandlers · ADM-4, ADM-5 & ADM-6 accounts", () => {
  it("searches and filters accounts, updates status and toggles seller verification", async () => {
    const admin = createTestHarness(db).asAccount("acc-admin");

    const searched = await admin.listAccounts({ q: "mây" });
    expect(searched.data.length).toBeGreaterThanOrEqual(2);
    expect(searched.data.find((a) => a.id === "acc-may")?.phone).toBe("+84900000001");

    const sellersOnly = await admin.listAccounts({ sellerOnly: true });
    expect(sellersOnly.data.some((a) => a.id === "acc-minh")).toBe(false);
    expect(sellersOnly.data.some((a) => a.id === "acc-may")).toBe(true);

    // Suspend and reactivate
    await expect(admin.setAccountStatus("acc-bep-may", "SUSPENDED", "")).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
    });
    const suspended = await admin.setAccountStatus("acc-bep-may", "SUSPENDED", "Vi phạm quy định an toàn");
    expect(suspended).toEqual({ id: "acc-bep-may", status: "SUSPENDED" });

    const suspendedList = await admin.listAccounts({ status: "SUSPENDED" });
    expect(suspendedList.data.map((a) => a.id)).toEqual(["acc-bep-may"]);

    const reactivated = await admin.setAccountStatus("acc-bep-may", "ACTIVE", "Đã khắc phục");
    expect(reactivated).toEqual({ id: "acc-bep-may", status: "ACTIVE" });

    // Prevent self-suspension
    await expect(admin.setAccountStatus("acc-admin", "SUSPENDED", "Test")).rejects.toMatchObject({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
    });

    // Toggle seller verification badge
    const verified = await admin.setSellerVerification("acc-bep-may", true, "Đã kiểm tra thông tin cơ sở");
    expect(verified.seller.verified).toBe(true);
    const unverified = await admin.setSellerVerification("acc-bep-may", false, "Hủy xác minh");
    expect(unverified.seller.verified).toBe(false);
  });
});

describe("adminHandlers · ADM-8 reservations privacy & filtering", () => {
  it("returns reservations with buyer displayName and NEVER includes pickupToken", async () => {
    db.reservations.push(
      {
        id: "r-1",
        listingId: "l-banh-ngot",
        buyerId: "acc-minh",
        sellerId: "acc-may",
        quantity: 2,
        unitPrice: 15000,
        code: "4281",
        status: "RESERVED",
        cancelReason: null,
        createdAt: "2026-11-24T06:00:00Z",
        completedAt: null,
        closedAt: null,
      },
      {
        id: "r-2",
        listingId: "l-com-ga",
        buyerId: "acc-minh",
        sellerId: "acc-an-thuong",
        quantity: 1,
        unitPrice: 18000,
        code: "1029",
        status: "COMPLETED",
        cancelReason: null,
        createdAt: "2026-11-22T06:00:00Z",
        completedAt: "2026-11-22T07:00:00Z",
        closedAt: "2026-11-22T07:00:00Z",
      },
    );
    db.tokens.push({
      token: "should-never-leak-to-admin",
      reservationId: "r-1",
      expiresAt: new Date(BASE_TIME.getTime() + 600_000).toISOString(),
      usedAt: null,
      revokedAt: null,
    });

    const admin = createTestHarness(db).asAccount("acc-admin");
    const all = await admin.listReservations();
    expect(all.data).toHaveLength(2);
    for (const r of all.data) {
      expect(r.pickupToken).toBeNull();
      expect(r.buyer).toEqual({ displayName: "Minh" });
      expect("phone" in (r.buyer ?? {})).toBe(false);
    }

    const todayOnly = await admin.listReservations({ from: "2026-11-24", to: "2026-11-24" });
    expect(todayOnly.data.map((r) => r.code)).toEqual(["SM–4281"]);

    const completedOnly = await admin.listReservations({ status: "COMPLETED" });
    expect(completedOnly.data.map((r) => r.code)).toEqual(["SM–1029"]);
  });
});

describe("adminHandlers · ADM-9 metrics (DOMAIN §8 KPIs)", () => {
  it("computes exact KPIs including discount samples and report breakdowns", async () => {
    // Mark 1 listing EXPIRED with remaining stock (quantityAvailable > 0)
    const expListing = db.listings.find((l) => l.id === "l-croissant")!;
    expListing.status = "EXPIRED";
    expListing.quantityAvailable = 2;

    // Reservations:
    // 1. COMPLETED, qty 2, unitPrice 15000, originalPrice 25000 → discount = 0.40
    // 2. COMPLETED, qty 1, unitPrice 0, originalPrice null (l-banhmi-bo-toi) → excluded from discount samples
    // 3. COMPLETED, qty 1, unitPrice 18000, originalPrice 35000 → discount = 17/35 ≈ 0.4857
    // 4. CANCELLED, qty 1
    // 5. EXPIRED, qty 1
    db.reservations.push(
      {
        id: "r-m1",
        listingId: "l-banh-ngot",
        buyerId: "acc-minh",
        sellerId: "acc-may",
        quantity: 2,
        unitPrice: 15000,
        code: "1001",
        status: "COMPLETED",
        cancelReason: null,
        createdAt: BASE_TIME.toISOString(),
        completedAt: BASE_TIME.toISOString(),
        closedAt: BASE_TIME.toISOString(),
      },
      {
        id: "r-m2",
        listingId: "l-banhmi-bo-toi",
        buyerId: "acc-minh",
        sellerId: "acc-bep-may",
        quantity: 1,
        unitPrice: 0,
        code: "1002",
        status: "COMPLETED",
        cancelReason: null,
        createdAt: BASE_TIME.toISOString(),
        completedAt: BASE_TIME.toISOString(),
        closedAt: BASE_TIME.toISOString(),
      },
      {
        id: "r-m3",
        listingId: "l-com-ga",
        buyerId: "acc-minh",
        sellerId: "acc-an-thuong",
        quantity: 1,
        unitPrice: 18000,
        code: "1003",
        status: "COMPLETED",
        cancelReason: null,
        createdAt: BASE_TIME.toISOString(),
        completedAt: BASE_TIME.toISOString(),
        closedAt: BASE_TIME.toISOString(),
      },
      {
        id: "r-m4",
        listingId: "l-com-ga",
        buyerId: "acc-minh",
        sellerId: "acc-an-thuong",
        quantity: 1,
        unitPrice: 18000,
        code: "1004",
        status: "CANCELLED",
        cancelReason: "BUYER_LATE",
        createdAt: BASE_TIME.toISOString(),
        completedAt: null,
        closedAt: BASE_TIME.toISOString(),
      },
      {
        id: "r-m5",
        listingId: "l-com-chay",
        buyerId: "acc-minh",
        sellerId: "acc-can-tin",
        quantity: 1,
        unitPrice: 0,
        code: "1005",
        status: "EXPIRED",
        cancelReason: null,
        createdAt: BASE_TIME.toISOString(),
        completedAt: null,
        closedAt: BASE_TIME.toISOString(),
      },
    );

    const admin = createTestHarness(db).asAccount("acc-admin");
    const m = await admin.getMetrics();

    expect(m.portionsHandedOver).toBe(4); // 2 + 1 + 1
    expect(m.reservations).toEqual({ created: 5, completed: 3, cancelled: 1, expired: 1 });
    expect(m.completionRate).toBe(0.6);
    expect(m.listings).toEqual({ published: 6, expiredWithStock: 1 });
    expect(m.listingExpiredRate).toBeCloseTo(1 / 6, 4);
    expect(m.discount.samples).toBe(2); // only r-m1 & r-m3 have originalPrice
    expect(m.discount.avgRate).toBeCloseTo((0.4 + 17 / 35) / 2, 4);
    expect(m.reports).toEqual({
      total: 2,
      byType: { WRONG_INFO: 1, UNSAFE_FOOD: 1 },
      open: 1,
      medianHandlingHours: 3.5, // rep-demo-2: 240min - 30min = 210min = 3.5h
      byAction: { WARNING: 1 },
    });

    // Seller filter
    const mayMetrics = await admin.getMetrics({ sellerId: "acc-may" });
    expect(mayMetrics.portionsHandedOver).toBe(2);
    expect(mayMetrics.reservations.created).toBe(1);
    expect(mayMetrics.listings).toEqual({ published: 2, expiredWithStock: 1 });
    expect(mayMetrics.discount).toEqual({ avgRate: 0.4, samples: 1 });
  });
});
