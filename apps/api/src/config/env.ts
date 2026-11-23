import { CATEGORIES, type Category } from '@savemeal/shared';
import { z } from 'zod';

/** Parses "true"/"false"/"1"/"0" (and unset → default). Anything else is a config error. */
const boolFlag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be true or false' });
      return z.NEVER;
    });

const int = (defaultValue: number, min = 0) => z.coerce.number().int().min(min).default(defaultValue);

/** "15m", "30d", "900s", "12h" → seconds. */
export function parseDurationSec(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`invalid duration "${value}" (use e.g. 15m, 30d)`);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

const duration = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value, ctx) => {
      try {
        return parseDurationSec(value);
      } catch (error) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
        return z.NEVER;
      }
    });

/** Max hours between prepared_at and pickup_end, per category, with a default. */
export type MaxListingAgeHours = { default: number } & Partial<Record<Category, number>>;

/**
 * D§5/§11: a platform sanity limit to stop obvious mistakes. It is NOT a food-safety threshold
 * (spec §5 forbids one time/temperature threshold that calls food safe).
 */
export const DEFAULT_MAX_LISTING_AGE_HOURS: MaxListingAgeHours = { default: 24, PACKAGED: 72 };

const maxListingAgeSchema = z
  .object({ default: z.number().positive() })
  .extend(Object.fromEntries(CATEGORIES.map((c) => [c, z.number().positive().optional()])))
  .strict();

const maxListingAgeHours = z
  .string()
  .optional()
  .transform((value, ctx): MaxListingAgeHours => {
    if (value === undefined || value.trim() === '') return DEFAULT_MAX_LISTING_AGE_HOURS;
    let json: unknown;
    try {
      json = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be JSON, e.g. {"default":24,"PACKAGED":72}' });
      return z.NEVER;
    }
    const parsed = maxListingAgeSchema.safeParse(json);
    if (!parsed.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'needs a positive "default" and known categories only' });
      return z.NEVER;
    }
    return parsed.data as MaxListingAgeHours;
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1),
  DATABASE_URL: z.string().min(1, 'is required'),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  // Feature flags (CLAUDE.md §8): default OFF; both features are Later.
  PAYMENTS_ENABLED: boolFlag(false),
  GOOGLE_LOGIN_ENABLED: boolFlag(false),

  // DOMAIN §11 defaults.
  MAX_ACTIVE_LISTINGS: int(5, 1),
  MAX_WINDOW_HOURS: int(4, 1),
  MAX_LISTING_AGE_HOURS: maxListingAgeHours,
  MAX_QTY_PER_RESERVATION: int(2, 1),
  MAX_ACTIVE_RESERVATIONS_PER_ACCOUNT: int(3, 1),
  EARLY_PICKUP_MIN: int(30),
  NO_SHOW_GRACE_MIN: int(15),
  PICKUP_TOKEN_TTL_MIN: int(10, 1),
  OTP_TTL_SEC: int(300, 1),
  OTP_RESEND_SEC: int(60),
  OTP_MAX_ATTEMPTS: int(5, 1),
  ACCESS_TOKEN_TTL: duration('15m'),
  REFRESH_TOKEN_TTL: duration('30d'),

  // SYS-2 `map` (D§9 D11: MapLibre with OpenStreetMap-based tiles). The default is OpenFreeMap's
  // free, key-less "liberty" style; override per deployment.
  MAP_STYLE_URL: z.string().url().default('https://tiles.openfreemap.org/styles/liberty'),
  MAP_ATTRIBUTION: z.string().min(1).default('© OpenStreetMap contributors'),
});

export type Env = z.output<typeof envSchema>;

/** Validates process env. Throws one readable error listing every invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}
