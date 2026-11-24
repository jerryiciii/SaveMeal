export type PlatformFeeConfig = {
  percent: number;
  thresholdVnd: number;
  flatVnd: number;
};

/**
 * Buyer-paid platform fee (DOMAIN v1.2 §6):
 * - foodAmount <= 0: 0
 * - foodAmount > thresholdVnd: Math.round((foodAmount * percent) / 100)
 * - 0 < foodAmount <= thresholdVnd: flatVnd
 */
export function calculatePlatformFee(foodAmount: number, cfg: PlatformFeeConfig): number {
  if (foodAmount <= 0) return 0;
  if (foodAmount > cfg.thresholdVnd) return Math.round((foodAmount * cfg.percent) / 100);
  return cfg.flatVnd;
}
