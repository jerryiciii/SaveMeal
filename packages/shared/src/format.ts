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

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
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
