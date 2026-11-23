import { formatTime, formatTimeWindow, formatVnd } from './format';

describe('formatVnd', () => {
  it.each([
    [18000, '18.000đ'],
    [0, '0đ'],
    [500, '500đ'],
    [5000, '5.000đ'],
    [1234567, '1.234.567đ'],
    [-5000, '-5.000đ'],
  ])('formats %p as %p', (amount, expected) => {
    expect(formatVnd(amount)).toBe(expected);
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatVnd(18000.5)).toThrow(RangeError);
    expect(() => formatVnd(Number.NaN)).toThrow(RangeError);
  });
});

describe('time formatting in Asia/Ho_Chi_Minh', () => {
  it('formats UTC instants as local (UTC+7) time', () => {
    expect(formatTime('2026-11-23T10:30:00Z')).toBe('17:30');
    expect(formatTime(new Date('2026-11-23T17:30:00+07:00'))).toBe('17:30');
  });

  it('formats a pickup window with an en dash', () => {
    expect(formatTimeWindow('2026-11-23T10:30:00Z', '2026-11-23T11:30:00Z')).toBe('17:30–18:30');
  });

  it('crosses midnight correctly', () => {
    expect(formatTime('2026-11-23T17:05:00Z')).toBe('00:05');
  });

  it('rejects invalid dates', () => {
    expect(() => formatTime('not-a-date')).toThrow(RangeError);
  });
});
