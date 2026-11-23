import { localDate, localDayStart, localWallTime, toApiTime, toApiTimeOrNull } from './time';

describe('time helpers (Asia/Ho_Chi_Minh, UTC+7)', () => {
  it('formats instants in +07:00 without milliseconds', () => {
    expect(toApiTime(new Date('2026-11-23T10:30:15.123Z'))).toBe('2026-11-23T17:30:15+07:00');
    expect(toApiTime(new Date('2026-11-23T17:05:00Z'))).toBe('2026-11-24T00:05:00+07:00');
    expect(new Date(toApiTime(new Date('2026-11-23T10:30:15Z'))).toISOString()).toBe('2026-11-23T10:30:15.000Z');
  });

  it('returns null for absent values', () => {
    expect(toApiTimeOrNull(null)).toBeNull();
    expect(toApiTimeOrNull(undefined)).toBeNull();
  });

  it('computes the local date across UTC midnight', () => {
    expect(localDate(new Date('2026-11-23T16:59:59Z'))).toBe('2026-11-23');
    expect(localDate(new Date('2026-11-23T17:00:00Z'))).toBe('2026-11-24');
  });

  it('builds local wall-clock instants', () => {
    const base = new Date('2026-11-23T02:00:00Z'); // 09:00 local
    expect(localWallTime(base, 17, 0).toISOString()).toBe('2026-11-23T10:00:00.000Z');
    expect(localWallTime(base, 8, 30, 1).toISOString()).toBe('2026-11-24T01:30:00.000Z');
    expect(localDayStart(base).toISOString()).toBe('2026-11-22T17:00:00.000Z');
  });
});
