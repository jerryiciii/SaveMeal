// Time helpers (ARCHITECTURE "Time"): store UTC, return ISO 8601 in +07:00, "today" is the local
// date in Đà Nẵng. Asia/Ho_Chi_Minh is a fixed UTC+7 offset with no daylight saving.

export const LOCAL_OFFSET_MIN = 7 * 60;
const OFFSET_MS = LOCAL_OFFSET_MIN * 60_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 2026-11-23T10:30:00.000Z → "2026-11-23T17:30:00+07:00" (contract §0: times in +07:00). */
export function toApiTime(date: Date): string {
  const local = new Date(date.getTime() + OFFSET_MS);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+07:00`
  );
}

/** Nullable variant for optional fields (contract §0: absent optionals are null). */
export function toApiTimeOrNull(date: Date | null | undefined): string | null {
  return date ? toApiTime(date) : null;
}

/** The local (Đà Nẵng) calendar date of an instant, as "YYYY-MM-DD". */
export function localDate(date: Date): string {
  return toApiTime(date).slice(0, 10);
}

/** The instant of a local wall-clock time `hh:mm` on the local date of `base` plus `dayOffset` days. */
export function localWallTime(base: Date, hh: number, mm: number, dayOffset = 0): Date {
  const local = new Date(base.getTime() + OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, hh, mm) - OFFSET_MS,
  );
}

/** Local midnight that starts the local date of `base` (+ dayOffset days). */
export function localDayStart(base: Date, dayOffset = 0): Date {
  return localWallTime(base, 0, 0, dayOffset);
}
