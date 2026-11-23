/** Display helpers (CLAUDE.md §9). Move to @savemeal/shared once it exists. */

export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** 18000 → "18.000đ" */
export function formatVnd(amount: number): string {
  const grouped = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped}đ`;
}

/** Map pin label: 0 → "0đ", 15000 → "15k", 12500 → "12,5k", 999 → "999đ" */
export function formatPinPrice(amount: number): string {
  if (amount < 1000) return `${amount}đ`;
  const k = amount / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1).replace(".", ",")}k`;
}

/** Card price: free items read "FREE" in Figma V1 cards. */
export function formatCardPrice(amount: number): string {
  return amount === 0 ? "FREE" : formatVnd(amount);
}

/** "4281" | "LB-4281" | "lb 4281" → "LB–4281" (en dash) */
export function formatOrderCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  return `LB–${digits}`;
}

function hm(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "17:30–18:30" in Đà Nẵng time */
export function formatPickupWindow(startIso: string, endIso: string): string {
  return `${hm(startIso)}–${hm(endIso)}`;
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(date);
}

/** "Hôm nay" | "Ngày mai" | "dd/MM" relative to `now` in Đà Nẵng time */
export function formatPickupDay(startIso: string, now: Date = new Date()): string {
  const day = localDateKey(new Date(startIso));
  if (day === localDateKey(now)) return "Hôm nay";
  if (day === localDateKey(new Date(now.getTime() + 24 * 3600 * 1000))) return "Ngày mai";
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

/** 650 → "650 m", 1200 → "1,2 km" */
export function formatDistance(meters: number | null): string | null {
  if (meters === null) return null;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}
