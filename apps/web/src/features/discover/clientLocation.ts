/**
 * Client-only buyer location holder (CLAUDE.md §7 privacy rule).
 * The buyer's chosen coordinates NEVER leave the client except per-request as
 * LIST-1 `lat`/`lng` query parameters and are never stored server-side.
 */

export type ClientPoint = { lat: number; lng: number };

const STORAGE_KEY = "sm-client-location";
let memoryPoint: ClientPoint | null = null;

function session(): globalThis.Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function getClientLocation(): ClientPoint | null {
  const ss = session();
  if (ss) {
    try {
      const raw = ss.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ClientPoint>;
        if (typeof parsed.lat === "number" && typeof parsed.lng === "number" && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
          return { lat: parsed.lat, lng: parsed.lng };
        }
      }
    } catch {
      // ignore corrupted sessionStorage
    }
  }
  return memoryPoint;
}

export function setClientLocation(point: ClientPoint): void {
  memoryPoint = point;
  const ss = session();
  if (!ss) return;
  try {
    ss.setItem(STORAGE_KEY, JSON.stringify(point));
  } catch {
    // ignore storage quota errors
  }
}

export function clearClientLocation(): void {
  memoryPoint = null;
  const ss = session();
  if (!ss) return;
  try {
    ss.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
