import {
  computePickupTokenExpiry,
  generateOrderCode,
  generatePickupToken,
  hashPickupToken,
  parseManualCode,
  parseQrPayload,
} from './pickup-token';

describe('pickup-token helpers', () => {
  it('generates a random SM1.<token> payload and 64-char SHA-256 hash', () => {
    const a = generatePickupToken();
    const b = generatePickupToken();
    expect(a.qrPayload.startsWith('SM1.')).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashPickupToken(a.raw));
    expect(a.raw).not.toBe(b.raw);
    expect(parseQrPayload(a.qrPayload)).toBe(a.raw);
  });

  it('rejects malformed QR payloads', () => {
    expect(parseQrPayload('')).toBeNull();
    expect(parseQrPayload('LB1.abcdef0123456789')).toBeNull();
    expect(parseQrPayload('SM1.short')).toBeNull();
    expect(parseQrPayload('SM1.has spaces inside token')).toBeNull();
  });

  it('normalises manual order codes and rejects invalid lengths', () => {
    expect(parseManualCode('SM–4281')).toBe('4281');
    expect(parseManualCode('sm-0042')).toBe('0042');
    expect(parseManualCode(' 12 34 ')).toBe('1234');
    expect(parseManualCode('123')).toBeNull();
    expect(parseManualCode('12345')).toBeNull();
    expect(parseManualCode('abcd')).toBeNull();
  });

  it('generates 4-digit codes', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateOrderCode()).toMatch(/^\d{4}$/);
    }
  });

  it('caps pickup token expiry at pickup_end + grace', () => {
    const now = new Date('2026-11-24T10:00:00Z');
    const farEnd = new Date('2026-11-24T11:00:00Z');
    const nearEnd = new Date('2026-11-24T09:50:00Z'); // +15m grace = 10:05 < 10:10
    expect(computePickupTokenExpiry(now, farEnd, 10, 15).toISOString()).toBe('2026-11-24T10:10:00.000Z');
    expect(computePickupTokenExpiry(now, nearEnd, 10, 15).toISOString()).toBe('2026-11-24T10:05:00.000Z');
  });
});
