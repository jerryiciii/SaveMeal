// Small, dependency-free crypto helpers for auth: HMAC hashing, random tokens, AES-256-GCM and
// HS256 JWTs. Keys are derived per purpose from one root secret.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** A purpose-specific 32-byte key: HMAC-SHA256(root, label). */
export function deriveKey(root: string, label: string): Buffer {
  return createHmac('sha256', root).update(`savemeal:${label}`).digest();
}

export function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Uniform random numeric code, zero-padded: randomDigits(6) → "042817". */
export function randomDigits(length: number): string {
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

/** Constant-time string comparison (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM: returns "iv.tag.ciphertext" (base64url). */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(key: Buffer, payload: string): string {
  const [iv, tag, ciphertext] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !ciphertext) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export type JwtClaims = { sub: string; role: string; sid: string; iat: number; exp: number };

const JWT_HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signJwt(key: Buffer, claims: JwtClaims): string {
  const body = `${JWT_HEADER}.${base64url(JSON.stringify(claims))}`;
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

export type JwtResult = { ok: true; claims: JwtClaims } | { ok: false; reason: 'invalid' | 'expired' };

/** Verifies an HS256 JWT. Only the exact header we issue is accepted (no `alg` confusion). */
export function verifyJwt(key: Buffer, token: string, nowSec = Math.floor(Date.now() / 1000)): JwtResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== JWT_HEADER) return { ok: false, reason: 'invalid' };
  const expected = createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!safeEqual(expected, parts[2]!)) return { ok: false, reason: 'invalid' };
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as JwtClaims;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || typeof claims.sid !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  if (claims.exp <= nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
