// Display helpers (CLAUDE.md §9): money as "18.000đ", times as "17:30–18:30".
// Pure functions, no runtime dependencies.

export const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** The en dash used in time windows. */
export const EN_DASH = '–';

/** Formats an integer VND amount: 18000 → "18.000đ", 0 → "0đ", -5000 → "-5.000đ". */
export function formatVnd(amount: number): string {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new RangeError(`formatVnd expects an integer VND amount, got ${amount}`);
  }
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}đ`;
}

/** Order-code prefix (D§9 D13) and pickup QR payload prefix (D§6). */
export const ORDER_CODE_PREFIX = 'SM';
export const PICKUP_QR_PREFIX = 'SM1.';

/**
 * Formats the 4-digit order code for display: "4281" → "SM–4281". Accepts input that is already
 * prefixed (any dash or none) and normalises it.
 */
export function formatOrderCode(code: string | number): string {
  const digits = normalizeOrderCode(code);
  if (!/^\d{4}$/.test(digits)) {
    throw new RangeError(`formatOrderCode expects 4 digits, got "${code}"`);
  }
  return `${ORDER_CODE_PREFIX}${EN_DASH}${digits}`;
}

/**
 * Strips an optional "SM" prefix, dashes (ASCII, en and em) and whitespace, as RES-7 accepts:
 * "SM–4281", "sm-4281", " 42 81 " → "4281". Does not validate the length.
 */
export function normalizeOrderCode(input: string | number): string {
  return String(input)
    .trim()
    .replace(/^sm/i, '')
    .replace(/[\s\-–—]/g, '');
}

const timeFormatter =new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Formats an instant as local Đà Nẵng time "HH:mm". */
export function formatTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`formatTime expects a valid date, got "${String(value)}"`);
  }
  return timeFormatter.format(date);
}

/** Formats a pickup window in local time: "17:30–18:30". */
export function formatTimeWindow(start: string | Date, end: string | Date): string {
  return `${formatTime(start)}${EN_DASH}${formatTime(end)}`;
}
