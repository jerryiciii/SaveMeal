import { calculatePlatformFee, type PlatformFeeConfig } from './fee';

describe('calculatePlatformFee', () => {
  const defaultCfg: PlatformFeeConfig = {
    percent: 5,
    thresholdVnd: 20_000,
    flatVnd: 2_000,
  };

  it('returns 0 for free items and non-positive amounts', () => {
    expect(calculatePlatformFee(0, defaultCfg)).toBe(0);
    expect(calculatePlatformFee(-5_000, defaultCfg)).toBe(0);
  });

  it('returns flatVnd for positive amounts at or below thresholdVnd', () => {
    expect(calculatePlatformFee(1_000, defaultCfg)).toBe(2_000);
    expect(calculatePlatformFee(15_000, defaultCfg)).toBe(2_000);
    expect(calculatePlatformFee(20_000, defaultCfg)).toBe(2_000);
  });

  it('returns rounded percentage for amounts strictly above thresholdVnd', () => {
    expect(calculatePlatformFee(20_001, defaultCfg)).toBe(1_000);
    expect(calculatePlatformFee(30_000, defaultCfg)).toBe(1_500);
    expect(calculatePlatformFee(50_000, defaultCfg)).toBe(2_500);
    expect(calculatePlatformFee(25_550, defaultCfg)).toBe(1_278);
  });

  it('respects custom fee configuration', () => {
    const custom: PlatformFeeConfig = { percent: 10, thresholdVnd: 10_000, flatVnd: 1_500 };
    expect(calculatePlatformFee(10_000, custom)).toBe(1_500);
    expect(calculatePlatformFee(12_000, custom)).toBe(1_200);
  });
});
