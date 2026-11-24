import { createHash, randomBytes, randomInt } from 'node:crypto';
import { normalizeOrderCode, PICKUP_QR_PREFIX } from '@savemeal/shared';

const TOKEN_BYTES = 32;
const BASE64URL_RE = /^[A-Za-z0-9_-]{16,128}$/;

export type GeneratedPickupToken = {
  raw: string;
  qrPayload: string;
  hash: string;
};

/** SHA-256 hex digest of a raw pickup token (stored in pickup_tokens.token_hash, 64 chars). */
export function hashPickupToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Generates a random, single-use pickup token carrying no personal data (DOMAIN §6). */
export function generatePickupToken(): GeneratedPickupToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, qrPayload: `${PICKUP_QR_PREFIX}${raw}`, hash: hashPickupToken(raw) };
}

/** Extracts the raw token from `SM1.<token>`, or returns null if malformed. */
export function parseQrPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith(PICKUP_QR_PREFIX)) return null;
  const raw = trimmed.slice(PICKUP_QR_PREFIX.length);
  return BASE64URL_RE.test(raw) ? raw : null;
}

/** Random 4-digit order code ("0000"–"9999"). */
export function generateOrderCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/** Normalises "SM–4281", "sm-4281", " 42 81 " → "4281", or null if not 4 digits. */
export function parseManualCode(input: string): string | null {
  const digits = normalizeOrderCode(input);
  return /^\d{4}$/.test(digits) ? digits : null;
}

/** D§6: expires_at = min(now + PICKUP_TOKEN_TTL_MIN, pickup_end + NO_SHOW_GRACE_MIN). */
export function computePickupTokenExpiry(now: Date, pickupEnd: Date, ttlMin: number, graceMin: number): Date {
  const byTtl = now.getTime() + ttlMin * 60_000;
  const byWindow = pickupEnd.getTime() + graceMin * 60_000;
  return new Date(Math.min(byTtl, byWindow));
}
