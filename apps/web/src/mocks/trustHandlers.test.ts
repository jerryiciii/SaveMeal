import { beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { createTokenStore } from "@/lib/api/tokenStore";
import { DELETE_ACCOUNT_CONFIRM, trustEndpoints } from "@/lib/api/trustEndpoints";
import { DEMO_BUYER_PHONE, DEMO_SELLER_PHONE, loadDb, MOCK_OTP, resetDb, saveDb } from "./db";
import { createMockFetch } from "./mockFetch";
import { loadReports, resetReports } from "./reportsStore";
import { handleTrustMock, type TrustMockSession } from "./trustHandlers";

let clock = new Date("2026-11-24T07:10:00Z");
const now = () => clock;

function createIntegratedMockFetch(): { fetchImpl: typeof fetch; session: TrustMockSession } {
  const baseFetch = createMockFetch({ now });
  let sessionId: string | null = null;
  const session: TrustMockSession = {
    get: () => sessionId,
    set: (id) => {
      sessionId = id;
    },
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");

    let parsed: unknown;
    if (typeof init?.body === "string") {
      parsed = JSON.parse(init.body);
    }
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k] = v;
      } else {
        Object.assign(headers, init.headers);
      }
    }

    const db = loadDb(now());
    const handled = handleTrustMock({
      method,
      path,
      url,
      body: parsed,
      headers,
      now: now(),
      db,
      session,
    });
    if (handled) {
      saveDb(db);
      return new Response(handled.status === 204 ? null : JSON.stringify(handled.body), {
        status: handled.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return baseFetch(input, init);
  };

  return { fetchImpl, session };
}

function makeClient() {
  const tokens = createTokenStore();
  const { fetchImpl, session } = createIntegratedMockFetch();
  const client = createApiClient({ fetchImpl, tokens });
  return {
    api: endpoints(client),
    trust: trustEndpoints(client),
    tokens,
    session,
  };
}

async function signIn(phone: string) {
  const c = makeClient();
  const { requestId } = await c.api.requestOtp("SMS", phone);
  const res = await c.api.verifyOtp(requestId, MOCK_OTP);
  c.tokens.set(res.accessToken);
  c.session.set(res.user.id);
  return { ...c, me: res.user };
}

beforeEach(() => {
  clock = new Date("2026-11-24T07:10:00Z");
  resetDb(clock);
  resetReports();
});

describe("handleTrustMock · routing", () => {
  it("returns null for unhandled paths", () => {
    const db = loadDb(clock);
    const res = handleTrustMock({
      method: "GET",
      path: "/listings",
      body: undefined,
      headers: {},
      now: clock,
      db,
      session: { get: () => null, set: () => {} },
    });
    expect(res).toBeNull();
  });
});

describe("handleTrustMock · REP-1 POST /reports", () => {
  it("sets listing.underReview = true immediately on UNSAFE_FOOD report", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const report = await buyer.trust.createReport({
      type: "UNSAFE_FOOD",
      listingId: "l-banh-ngot",
      description: "Bánh có mùi chua bất thường khi nhận tại quầy.",
      imageIds: ["img-croissant"],
    });

    expect(report.status).toBe("OPEN");
    expect(report.type).toBe("UNSAFE_FOOD");
    expect(report.listingId).toBe("l-banh-ngot");
    expect(report.reportedAccountId).toBe("acc-may");
    expect(report.images).toHaveLength(1);
    expect(report.reporter).toBeNull();
    expect(loadReports()).toHaveLength(1);

    const detail = await buyer.api.getListing("l-banh-ngot");
    expect(detail.underReview).toBe(true);

    // Listing is hidden from LIST-1 and cannot be reserved while underReview.
    const { data } = await buyer.api.searchListings({ radiusKm: 5 });
    expect(data.some((l) => l.id === "l-banh-ngot")).toBe(false);
    await expect(buyer.api.reserve("l-banh-ngot", 1, crypto.randomUUID())).rejects.toMatchObject({
      status: 409,
      code: "LISTING_NOT_AVAILABLE",
    });
  });

  it("does NOT set underReview on WRONG_INFO report", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await buyer.trust.createReport({
      type: "WRONG_INFO",
      listingId: "l-banh-ngot",
      description: "Giá gốc hiển thị trên tin khác với thực tế tại tiệm.",
    });

    const detail = await buyer.api.getListing("l-banh-ngot");
    expect(detail.underReview).toBe(false);
  });

  it("enforces reservationId for NOT_RECEIVED and SELLER_ABSENT", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await expect(
      buyer.trust.createReport({
        type: "NOT_RECEIVED",
        listingId: "l-banh-ngot",
        description: "Đến nơi nhưng không nhận được món đã đặt giữ.",
      }),
    ).rejects.toMatchObject({ status: 422, code: "REPORT_TARGET_INVALID" });

    await expect(
      buyer.trust.createReport({
        type: "SELLER_ABSENT",
        listingId: "l-banh-ngot",
        description: "Quầy đóng cửa khi tôi đến trong khung giờ nhận.",
      }),
    ).rejects.toMatchObject({ status: 422, code: "REPORT_TARGET_INVALID" });

    // With caller's own reservationId, NOT_RECEIVED succeeds.
    const reservation = await buyer.api.reserve("l-banh-ngot", 1, crypto.randomUUID());
    const report = await buyer.trust.createReport({
      type: "NOT_RECEIVED",
      reservationId: reservation.id,
      description: "Đến đúng giờ nhưng nhân viên báo đã hết bánh.",
    });
    expect(report.reservationId).toBe(reservation.id);
    expect(report.listingId).toBe("l-banh-ngot");
    expect(report.reportedAccountId).toBe("acc-may");

    // Another user cannot report using buyer's reservationId.
    const other = await signIn("+84900000099");
    await expect(
      other.trust.createReport({
        type: "NOT_RECEIVED",
        reservationId: reservation.id,
        description: "Cố tình báo cáo đơn đặt giữ của người khác.",
      }),
    ).rejects.toMatchObject({ status: 422, code: "REPORT_TARGET_INVALID" });
  });

  it("validates description length, self-reporting, image existence, and daily limit", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await expect(
      buyer.trust.createReport({
        type: "OTHER",
        listingId: "l-banh-ngot",
        description: "Quá ngắn",
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });

    await expect(
      buyer.trust.createReport({
        type: "OTHER",
        description: "Báo cáo không gắn với đối tượng cụ thể nào.",
      }),
    ).rejects.toMatchObject({ status: 422, code: "REPORT_TARGET_INVALID" });

    await expect(
      buyer.trust.createReport({
        type: "OTHER",
        listingId: "l-banh-ngot",
        description: "Ảnh minh chứng không tồn tại trong hệ thống.",
        imageIds: ["img-missing"],
      }),
    ).rejects.toMatchObject({ status: 404, code: "IMAGE_NOT_FOUND" });

    // Seller cannot report their own listing.
    const seller = await signIn(DEMO_SELLER_PHONE);
    await expect(
      seller.trust.createReport({
        type: "OTHER",
        listingId: "l-banh-ngot",
        description: "Tự báo cáo tin đăng của chính mình là không hợp lệ.",
      }),
    ).rejects.toMatchObject({ status: 422, code: "REPORT_TARGET_INVALID" });

    // Rate limit: 10 reports/day per account.
    for (let i = 0; i < 10; i++) {
      await buyer.trust.createReport({
        type: "OTHER",
        listingId: "l-banh-ngot",
        description: `Báo cáo kiểm thử giới hạn số lượng trong ngày #${i + 1}.`,
      });
    }
    await expect(
      buyer.trust.createReport({
        type: "OTHER",
        listingId: "l-banh-ngot",
        description: "Báo cáo thứ 11 trong cùng một ngày sẽ bị giới hạn.",
      }),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});

describe("handleTrustMock · ME-2 PATCH /me (avatarImageId + profile + seller)", () => {
  it("updates displayName, avatarImageId, and optional seller fields", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const updated = await buyer.trust.updateProfile({
      displayName: "Minh Nguyễn",
      avatarImageId: "img-croissant",
      seller: {
        name: "Bếp Minh",
        type: "INDIVIDUAL",
        defaultPickup: { address: "20 An Thượng 1, Đà Nẵng", lat: 16.0501, lng: 108.2455 },
      },
    });

    expect(updated.displayName).toBe("Minh Nguyễn");
    expect(updated.avatar).toMatchObject({ id: "img-croissant", url: "/mock/croissant.png" });
    expect(updated.seller).toEqual({
      name: "Bếp Minh",
      type: "INDIVIDUAL",
      verified: false,
      defaultPickup: { address: "20 An Thượng 1, Đà Nẵng", lat: 16.0501, lng: 108.2455 },
    });

    // Persisted on GET /me too.
    const reloaded = await buyer.api.getMe();
    expect(reloaded.avatar?.id).toBe("img-croissant");

    // Clearing avatar works.
    const cleared = await buyer.trust.updateProfile({ avatarImageId: null });
    expect(cleared.avatar).toBeNull();
  });

  it("rejects missing avatarImageId with 404 IMAGE_NOT_FOUND", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await expect(
      buyer.trust.updateProfile({ avatarImageId: "img-not-found" }),
    ).rejects.toMatchObject({ status: 404, code: "IMAGE_NOT_FOUND" });
  });
});

describe("handleTrustMock · ME-3 DELETE /me and AUTH-4 logout", () => {
  it("requires exact confirmation string XOA TAI KHOAN", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await expect(buyer.trust.deleteMe("xoa tai khoan")).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
    });
  });

  it("blocks deletion with 409 ACCOUNT_HAS_ACTIVE_ITEMS when user has active reservations or listings", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    await buyer.api.reserve("l-banh-ngot", 1, crypto.randomUUID());

    await expect(buyer.trust.deleteMe(DELETE_ACCOUNT_CONFIRM)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_HAS_ACTIVE_ITEMS",
      details: { activeReservations: 1, activeListings: 0 },
    });

    const seller = await signIn(DEMO_SELLER_PHONE);
    await expect(seller.trust.deleteMe(DELETE_ACCOUNT_CONFIRM)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_HAS_ACTIVE_ITEMS",
      details: { activeReservations: 1, activeListings: 2 },
    });
  });

  it("anonymises personal data, deletes DRAFT listings, keeps completed history, and revokes session on 204", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    // Attach avatar and create a DRAFT listing (drafts should be deleted, not block deletion).
    await buyer.trust.updateProfile({ avatarImageId: "img-croissant" });
    const draft = await buyer.api.createListing({ title: "Bánh nháp chưa đăng", category: "BAKERY" });

    // Create a reservation and complete it so history exists.
    const r = await buyer.api.reserve("l-banh-ngot", 1, crypto.randomUUID());
    const seller = await signIn(DEMO_SELLER_PHONE);
    await seller.api.confirmPickup(r.id, { qrPayload: r.pickupToken!.qrPayload });

    await buyer.trust.deleteMe(DELETE_ACCOUNT_CONFIRM);
    expect(buyer.session.get()).toBeNull();

    const db = loadDb(clock);
    const acc = db.accounts.find((a) => a.id === "acc-minh")!;
    expect(acc.phone).toBeNull();
    expect(acc.email).toBeNull();
    expect(acc.displayName).toBe("Người dùng đã xóa");
    expect(acc.seller).toEqual({ name: null, type: null, verified: false, defaultPickup: null });

    // Draft listing deleted; completed reservation retained.
    expect(db.listings.some((l) => l.id === draft.id)).toBe(false);
    expect(db.reservations.some((x) => x.id === r.id)).toBe(true);

    // Subsequent authenticated call is rejected.
    await expect(buyer.api.getMe()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("AUTH-4 logoutAll clears session and is idempotent", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    expect(buyer.session.get()).toBe("acc-minh");
    await buyer.trust.logoutAll(true);
    expect(buyer.session.get()).toBeNull();
    await expect(buyer.trust.logoutAll(true)).resolves.toBeUndefined();
  });
});
