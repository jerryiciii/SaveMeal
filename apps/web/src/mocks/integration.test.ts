import { beforeEach, describe, expect, it } from "vitest";
import { adminEndpoints } from "@/lib/api/adminEndpoints";
import { createApiClient } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { sellerEndpoints } from "@/lib/api/sellerEndpoints";
import { createTokenStore } from "@/lib/api/tokenStore";
import { DELETE_ACCOUNT_CONFIRM, trustEndpoints } from "@/lib/api/trustEndpoints";
import { downscaleImage } from "@/lib/image";
import { DEMO_ADMIN_PHONE, DEMO_BUYER_PHONE, DEMO_SELLER_PHONE, MOCK_OTP, resetDb } from "./db";
import { createMockFetch } from "./mockFetch";

// 14:10 Asia/Ho_Chi_Minh
let clock = new Date("2026-11-24T07:10:00Z");
const now = () => clock;

function makeClient() {
  const tokens = createTokenStore();
  const fetchImpl = createMockFetch({ now });
  const raw = createApiClient({ fetchImpl, tokens });
  return {
    api: endpoints(raw),
    seller: sellerEndpoints(raw),
    trust: trustEndpoints(raw),
    admin: adminEndpoints(raw),
    tokens,
  };
}

async function signIn(phone: string) {
  const c = makeClient();
  const { requestId } = await c.api.requestOtp("SMS", phone);
  const res = await c.api.verifyOtp(requestId, MOCK_OTP);
  c.tokens.set(res.accessToken);
  return { ...c, me: res.user };
}

beforeEach(() => {
  clock = new Date("2026-11-24T07:10:00Z");
  resetDb(clock);
});

describe("integrated mock API · REP-1 -> LIST-1 -> ADM-1/2/3/9", () => {
  it("flows UNSAFE_FOOD report from buyer to hidden listing to admin moderation & KPIs", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const admin = await signIn(DEMO_ADMIN_PHONE);
    expect(admin.me.role).toBe("ADMIN");

    const beforeMetrics = await admin.admin.getMetrics();
    expect(beforeMetrics.reports.total).toBe(2);
    expect(beforeMetrics.reports.open).toBe(1);

    // 1. Buyer submits UNSAFE_FOOD report -> listing immediately hidden from LIST-1
    const report = await buyer.trust.createReport({
      type: "UNSAFE_FOOD",
      listingId: "l-banh-ngot",
      description: "Bánh có mùi lạ và hộp bị hở khi kiểm tra tại quầy.",
    });
    expect(report.status).toBe("OPEN");

    const afterReportList = await buyer.api.searchListings({ radiusKm: 5 });
    expect(afterReportList.data.some((l) => l.id === "l-banh-ngot")).toBe(false);

    // 2. Admin sees the new report in ADM-1 and updated KPIs in ADM-9
    const adminReports = await admin.admin.listReports({ status: "OPEN" });
    expect(adminReports.data.some((r) => r.id === report.id)).toBe(true);

    const midMetrics = await admin.admin.getMetrics();
    expect(midMetrics.reports.total).toBe(3);
    expect(midMetrics.reports.open).toBe(2);
    expect(midMetrics.reports.byType.UNSAFE_FOOD).toBe(2);

    // 3. Admin dismisses report with clearReview -> listing becomes visible again in LIST-1
    clock = new Date(clock.getTime() + 60 * 60_000);
    const dismissed = await admin.admin.updateReport(report.id, {
      status: "DISMISSED",
      action: "NONE",
      resolution: "Đã đối chiếu trực tiếp, sản phẩm đạt yêu cầu.",
      clearReview: true,
    });
    expect(dismissed.status).toBe("DISMISSED");

    const restoredList = await buyer.api.searchListings({ radiusKm: 5 });
    expect(restoredList.data.some((l) => l.id === "l-banh-ngot")).toBe(true);

    // 4. Buyer reserves, then Admin blocks listing (ADM-3) -> cancels active reservation
    const reservation = await buyer.api.reserve("l-banh-ngot", 1, crypto.randomUUID());
    const blocked = await admin.admin.blockListing("l-banh-ngot", "Vi phạm quy định mô tả nguồn gốc");
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blockedReason).toBe("Vi phạm quy định mô tả nguồn gốc");

    const updatedOrder = await buyer.api.getReservation(reservation.id);
    expect(updatedOrder.status).toBe("CANCELLED");
    expect(updatedOrder.cancelReason).toBe("LISTING_BLOCKED");

    const finalMetrics = await admin.admin.getMetrics();
    expect(finalMetrics.reservations.cancelled).toBe(1);
    expect(finalMetrics.reports.open).toBe(1);

    // 5. resetDb restores clean demo reports
    resetDb(clock);
    const resetMetrics = await admin.admin.getMetrics();
    expect(resetMetrics.reports.total).toBe(2);
  });
});

describe("integrated mock API · SELLER-1 + LIST-1 filters", () => {
  it("loads seller profile alongside sellerId listings and supports full LIST-1 filters", async () => {
    const pub = makeClient();

    const profile = await pub.seller.getSellerProfile("acc-may");
    expect(profile.name).toBe("Tiệm bánh Mây");
    expect(profile.verified).toBe(true);
    expect(profile.activeListingCount).toBe(2);

    const sellerListings = await pub.api.searchListings({ sellerId: "acc-may" });
    expect(sellerListings.data).toHaveLength(2);
    expect(sellerListings.data.every((l) => l.seller.id === "acc-may")).toBe(true);

    const freeToday = await pub.api.searchListings({ free: true, pickupDay: "today", radiusKm: 5 });
    expect(freeToday.data.length).toBeGreaterThan(0);
    expect(freeToday.data.every((l) => l.isFree)).toBe(true);

    const multiCat = await pub.api.searchListings({
      category: ["BAKERY", "MEAL"],
      priceMax: 18000,
      sort: "priceAsc",
      radiusKm: 5,
    });
    expect(multiCat.data.every((l) => l.category === "BAKERY" || l.category === "MEAL")).toBe(true);
    expect(multiCat.data.every((l) => l.price <= 18000)).toBe(true);
    const prices = multiCat.data.map((l) => l.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);

    const withSoldOut = await pub.api.searchListings({ includeSoldOut: true, radiusKm: 5 });
    expect(withSoldOut.data.some((l) => l.id === "l-sua-chua" && l.soldOut)).toBe(true);

    const byTimeWindow = await pub.api.searchListings({
      pickupFrom: "14:00",
      pickupTo: "16:30",
      sort: "pickupSoon",
      radiusKm: 5,
    });
    expect(byTimeWindow.data.length).toBeGreaterThan(0);
  });
});

describe("integrated mock API · LIST-4 published edit + LIST-7 withdraw + ME-2/ME-3", () => {
  it("guards published edits and cancels active buyer reservations on withdraw", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const seller = await signIn(DEMO_SELLER_PHONE);

    const res = await buyer.api.reserve("l-banh-ngot", 1, crypto.randomUUID());
    expect((await buyer.api.getListing("l-banh-ngot")).quantityAvailable).toBe(4);

    // Locked field rejected
    await expect(
      seller.api.updateListing("l-banh-ngot", { origin: "Nguồn thay đổi" }),
    ).rejects.toMatchObject({ status: 409, code: "FIELD_LOCKED" });

    // Price increase rejected
    await expect(seller.api.updateListing("l-banh-ngot", { price: 20000 })).rejects.toMatchObject({
      status: 409,
      code: "PRICE_INCREASE_NOT_ALLOWED",
    });

    // Valid published edit: lower price & increase quantityTotal (5 -> 6, available 4 -> 5)
    const edited = await seller.api.updateListing("l-banh-ngot", {
      title: "6 phần bánh giảm giá cuối ngày",
      price: 12000,
      quantityTotal: 6,
    });
    expect(edited.price).toBe(12000);
    expect(edited.quantityTotal).toBe(6);
    expect(edited.quantityAvailable).toBe(5);

    // Withdraw listing -> active reservation cancelled with SELLER_WITHDREW & QR revoked
    const withdrawn = await seller.seller.withdrawListing("l-banh-ngot", "STORAGE_NOT_OK", "Hỏng tủ mát");
    expect(withdrawn.status).toBe("WITHDRAWN");

    const buyerOrder = await buyer.api.getReservation(res.id);
    expect(buyerOrder.status).toBe("CANCELLED");
    expect(buyerOrder.cancelReason).toBe("SELLER_WITHDREW");

    await expect(
      seller.api.confirmPickup(res.id, { qrPayload: res.pickupToken!.qrPayload }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("persists avatar across GET /me and enforces ME-3 active items guard", async () => {
    const buyer = await signIn(DEMO_BUYER_PHONE);
    const patched = await buyer.trust.updateProfile({
      displayName: "Minh SaveMeal",
      avatarImageId: "img-croissant",
    });
    expect(patched.avatar?.id).toBe("img-croissant");

    const fetched = await buyer.api.getMe();
    expect(fetched.avatar?.id).toBe("img-croissant");

    await buyer.api.reserve("l-croissant", 1, crypto.randomUUID());
    await expect(buyer.trust.deleteMe(DELETE_ACCOUNT_CONFIRM)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_HAS_ACTIVE_ITEMS",
    });
  });

  it("downscaleImage falls back safely when createImageBitmap is unavailable in jsdom", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.jpg", { type: "image/jpeg" });
    const out = await downscaleImage(file);
    expect(out).toBe(file);
  });
});
