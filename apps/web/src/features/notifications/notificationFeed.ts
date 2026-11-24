import { saveMeal } from "@/lib/api";
import type { Reservation } from "@/lib/contract/types";
import { formatPickupDay, formatPickupWindow, formatVnd } from "@/lib/format";

export type NotificationItem = {
  id: string;
  role: "seller" | "buyer";
  urgent: boolean;
  tone: "danger" | "lime" | "lilac" | "neutral";
  tag: string;
  title: string;
  body: string;
  href: string;
  timestamp: string;
};

const SEEN_STORAGE_KEY = "savemeal:seen_notifs_v1";
export const NOTIF_CHANGED_EVENT = "savemeal:notif-changed";

export function loadSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function markNotificationsSeen(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  try {
    const next = loadSeenIds();
    for (const id of ids) next.add(id);
    // Keep only the most recent 200 seen IDs to cap storage size.
    const arr = Array.from(next).slice(-200);
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(arr));
    window.dispatchEvent(new Event(NOTIF_CHANGED_EVENT));
  } catch {
    // ignore storage errors
  }
}

function mapSellerReservation(r: Reservation): NotificationItem | null {
  const buyer = r.buyer?.displayName ?? "Người mua";
  const amount = formatVnd(r.payableAmount ?? r.totalPrice);
  const pickup = `${formatPickupDay(r.listing.pickupStart)} ${formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}`;

  if (r.status === "AWAITING_SELLER_CONFIRM") {
    return {
      id: `seller:${r.id}:AWAITING_SELLER_CONFIRM`,
      role: "seller",
      urgent: true,
      tone: "danger",
      tag: "Cần xác nhận tiền",
      title: `${buyer} đã gửi biên lai (${amount})`,
      body: `Đơn ${r.code} · ${r.listing.title} (${r.quantity} suất). Kiểm tra tài khoản và mở QR nhận món.`,
      href: "/sell/orders",
      timestamp: r.payment?.proofSubmittedAt ?? r.createdAt,
    };
  }
  if (r.status === "RESERVED") {
    return {
      id: `seller:${r.id}:RESERVED`,
      role: "seller",
      urgent: true,
      tone: "lime",
      tag: "Đơn chờ giao",
      title: `${buyer} đã đặt giữ ${r.quantity} suất`,
      body: `Đơn ${r.code} · ${r.listing.title} · Nhận ${pickup}.`,
      href: "/sales",
      timestamp: r.payment?.confirmedAt ?? r.createdAt,
    };
  }
  if (r.status === "PENDING_PAYMENT") {
    return {
      id: `seller:${r.id}:PENDING_PAYMENT`,
      role: "seller",
      urgent: false,
      tone: "neutral",
      tag: "Chờ chuyển khoản",
      title: `${buyer} đang chuyển khoản cho đơn ${r.code}`,
      body: `${r.listing.title} · ${amount}. Bạn sẽ nhận thông báo khi người mua gửi biên lai.`,
      href: "/sell/orders",
      timestamp: r.createdAt,
    };
  }
  return null;
}

function mapBuyerReservation(r: Reservation): NotificationItem | null {
  const amount = formatVnd(r.payableAmount ?? r.totalPrice);
  const pickup = `${formatPickupDay(r.listing.pickupStart)} ${formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}`;

  if (r.status === "PENDING_PAYMENT") {
    return {
      id: `buyer:${r.id}:PENDING_PAYMENT`,
      role: "buyer",
      urgent: true,
      tone: "danger",
      tag: "Chờ chuyển khoản",
      title: `Hoàn tất chuyển khoản đơn ${r.code}`,
      body: `${r.listing.title} (${amount}). Xem QR người bán và tải ảnh biên lai trước khi hết giờ giữ suất.`,
      href: `/orders/${r.id}`,
      timestamp: r.createdAt,
    };
  }
  if (r.status === "AWAITING_SELLER_CONFIRM") {
    return {
      id: `buyer:${r.id}:AWAITING_SELLER_CONFIRM`,
      role: "buyer",
      urgent: false,
      tone: "lilac",
      tag: "Chờ duyệt biên lai",
      title: `Đang chờ ${r.seller.name} xác nhận tiền`,
      body: `Đơn ${r.code} · ${r.listing.title}. Mã QR nhận món sẽ tự mở ngay khi người bán xác nhận.`,
      href: `/orders/${r.id}`,
      timestamp: r.payment?.proofSubmittedAt ?? r.createdAt,
    };
  }
  if (r.status === "RESERVED") {
    return {
      id: `buyer:${r.id}:RESERVED`,
      role: "buyer",
      urgent: true,
      tone: "lime",
      tag: "Sẵn sàng nhận món",
      title: `Mã QR đơn ${r.code} đã sẵn sàng`,
      body: `${r.listing.title} · ${r.seller.name} · Nhận ${pickup}.`,
      href: `/orders/${r.id}`,
      timestamp: r.payment?.confirmedAt ?? r.createdAt,
    };
  }
  if (r.status === "CANCELLED" && (r.cancelReason === "PAYMENT_REJECTED" || r.cancelReason === "SELLER_WITHDREW")) {
    return {
      id: `buyer:${r.id}:CANCELLED:${r.cancelReason}`,
      role: "buyer",
      urgent: false,
      tone: "danger",
      tag: "Đơn đã hủy",
      title:
        r.cancelReason === "PAYMENT_REJECTED"
          ? `Thanh toán đơn ${r.code} chưa được xác nhận`
          : `${r.seller.name} đã gỡ tin món ${r.listing.title}`,
      body: r.payment?.rejectReason
        ? `Lý do: ${r.payment.rejectReason}`
        : `Đơn ${r.code} đã đóng. Bạn có thể chọn món khác quanh bạn.`,
      href: `/orders/${r.id}`,
      timestamp: r.closedAt ?? r.createdAt,
    };
  }
  if (r.status === "COMPLETED") {
    return {
      id: `buyer:${r.id}:COMPLETED`,
      role: "buyer",
      urgent: false,
      tone: "neutral",
      tag: "Hoàn tất",
      title: `Bạn đã nhận món ${r.listing.title}`,
      body: `Đơn ${r.code} · Cảm ơn bạn đã cứu ${r.quantity} phần ăn ngon!`,
      href: `/orders/${r.id}`,
      timestamp: r.completedAt ?? r.createdAt,
    };
  }
  return null;
}

/** Build live notification feed from existing MVP sales & reservation endpoints. */
export async function fetchNotifications(): Promise<NotificationItem[]> {
  const [salesRes, upcomingRes, historyRes] = await Promise.allSettled([
    saveMeal.mySales("AWAITING_SELLER_CONFIRM,RESERVED,PENDING_PAYMENT"),
    saveMeal.myReservations("upcoming"),
    saveMeal.myReservations("history"),
  ]);

  const items: NotificationItem[] = [];
  if (salesRes.status === "fulfilled") {
    for (const r of salesRes.value.data) {
      const item = mapSellerReservation(r);
      if (item) items.push(item);
    }
  }
  if (upcomingRes.status === "fulfilled") {
    for (const r of upcomingRes.value.data) {
      const item = mapBuyerReservation(r);
      if (item) items.push(item);
    }
  }
  if (historyRes.status === "fulfilled") {
    const recentCutoff = Date.now() - 48 * 3_600_000;
    for (const r of historyRes.value.data.slice(0, 6)) {
      const ts = Date.parse(r.closedAt ?? r.completedAt ?? r.createdAt);
      if (Number.isFinite(ts) && ts < recentCutoff) continue;
      const item = mapBuyerReservation(r);
      if (item) items.push(item);
    }
  }

  items.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return Date.parse(b.timestamp) - Date.parse(a.timestamp);
  });
  return items;
}

export function countUnreadNotifications(items: NotificationItem[], seen: Set<string>): number {
  let count = 0;
  for (const item of items) {
    if (!seen.has(item.id)) count += 1;
  }
  return count;
}
