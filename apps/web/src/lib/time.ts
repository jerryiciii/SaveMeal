/** Đà Nẵng local-time helpers for forms (the API speaks ISO 8601 with offsets). */

const TZ = "Asia/Ho_Chi_Minh";

/** "YYYY-MM-DD" in Đà Nẵng for `now` + `dayOffset` days. */
export function vnDate(dayOffset = 0, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now.getTime() + dayOffset * 86_400_000));
}

/** "HH:mm" in Đà Nẵng for an ISO instant. */
export function vnTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Local day + "HH:mm" → ISO with +07:00 (Vietnam has no DST). */
export function vnIso(day: string, hhmm: string): string {
  return `${day}T${hhmm}:00+07:00`;
}

/** 0 = today, 1 = tomorrow, otherwise null, for an ISO instant. */
export function vnDayOffset(iso: string, now: Date = new Date()): 0 | 1 | null {
  const d = vnDate(0, new Date(iso));
  if (d === vnDate(0, now)) return 0;
  if (d === vnDate(1, now)) return 1;
  return null;
}

/** Next half hour from now as "HH:mm" (default pickup start). */
export function nextHalfHour(now: Date = new Date()): string {
  const ms = Math.ceil(now.getTime() / 1_800_000) * 1_800_000;
  return vnTime(new Date(ms).toISOString());
}

export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
