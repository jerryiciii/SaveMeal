import { createHmac } from 'node:crypto';
import {
  base64url,
  decrypt,
  deriveKey,
  encrypt,
  hmacHex,
  randomDigits,
  randomToken,
  safeEqual,
  signJwt,
  verifyJwt,
} from './crypto';

const key = deriveKey('x'.repeat(32), 'jwt');
const claims = { sub: 'acc-1', role: 'USER', sid: 'fam-1', iat: 1000, exp: 2000 };

describe('auth crypto', () => {
  it('derives distinct keys per purpose', () => {
    expect(deriveKey('root', 'a').equals(deriveKey('root', 'b'))).toBe(false);
    expect(deriveKey('root', 'a').equals(deriveKey('root', 'a'))).toBe(true);
    expect(hmacHex(deriveKey('root', 'a'), 'v')).toHaveLength(64);
  });

  it('makes random tokens and digit codes of the right shape', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    for (let i = 0; i < 50; i++) expect(randomDigits(6)).toMatch(/^\d{6}$/);
  });

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('round-trips AES-GCM and rejects tampering', () => {
    const k = deriveKey('root', 'enc');
    const box = encrypt(k, '+84900000002');
    expect(box).not.toContain('84900000002');
    expect(decrypt(k, box)).toBe('+84900000002');
    const [iv, tag, ct] = box.split('.');
    const tampered = [iv, tag, Buffer.from('zz' + ct!, 'base64url').toString('base64url')].join('.');
    expect(() => decrypt(k, tampered)).toThrow();
    expect(() => decrypt(deriveKey('other', 'enc'), box)).toThrow();
  });

  describe('HS256 JWT', () => {
    it('verifies a token it signed', () => {
      expect(verifyJwt(key, signJwt(key, claims), 1500)).toEqual({ ok: true, claims });
    });

    it('reports expiry separately', () => {
      expect(verifyJwt(key, signJwt(key, claims), 2000)).toEqual({ ok: false, reason: 'expired' });
    });

    it('rejects another key, a forged payload and alg:none', () => {
      const token = signJwt(key, claims);
      expect(verifyJwt(deriveKey('y'.repeat(32), 'jwt'), token, 1500)).toEqual({ ok: false, reason: 'invalid' });
      const [h, , s] = token.split('.');
      const forged = `${h}.${base64url(JSON.stringify({ ...claims, role: 'ADMIN' }))}.${s}`;
      expect(verifyJwt(key, forged, 1500).ok).toBe(false);
      const none = `${base64url('{"alg":"none","typ":"JWT"}')}.${base64url(JSON.stringify(claims))}.`;
      expect(verifyJwt(key, none, 1500).ok).toBe(false);
      const hs512Header = base64url('{"alg":"HS512","typ":"JWT"}');
      const body = `${hs512Header}.${base64url(JSON.stringify(claims))}`;
      const hs512 = `${body}.${createHmac('sha512', key).update(body).digest('base64url')}`;
      expect(verifyJwt(key, hs512, 1500).ok).toBe(false);
    });

    it('rejects garbage', () => {
      expect(verifyJwt(key, 'nope', 1500).ok).toBe(false);
      expect(verifyJwt(key, 'a.b.c', 1500).ok).toBe(false);
    });
  });
});
