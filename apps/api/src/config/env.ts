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

const optionalTrimmed = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

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

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000, 1),
    DATABASE_URL: z.string().min(1, 'is required'),
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

    // Feature flags (CLAUDE.md §8): default OFF.
    PAYMENTS_ENABLED: boolFlag(false),
    GOOGLE_LOGIN_ENABLED: boolFlag(false),

    // Payments (DOMAIN v1.2 §6, §11).
    PAYMENT_PROVIDER: z.enum(['mock', 'sepay']).default('mock'),
    SEPAY_BANK_CODE: optionalTrimmed,
    SEPAY_ACCOUNT_NO: optionalTrimmed,
    SEPAY_ACCOUNT_NAME: optionalTrimmed,
    SEPAY_WEBHOOK_SECRET: optionalTrimmed,
    MIN_PAYMENT_HOLD_MIN: int(5, 1),
    DEFAULT_PAYMENT_HOLD_MIN: int(10, 1),
    PLATFORM_FEE_PERCENT: int(5, 0),
    PLATFORM_FEE_THRESHOLD_VND: int(20000, 0),
    PLATFORM_FEE_FLAT_VND: int(2000, 0),

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

    // Express `trust proxy` setting: 'loopback' for local dev/test, or '1' behind a cloud reverse
    // proxy so rate-limiters read the real client IP from X-Forwarded-For.
    TRUST_PROXY: z
      .string()
      .optional()
      .transform((value): boolean | number | string => {
        if (value === undefined || value.trim() === '') return 'loopback';
        const v = value.trim();
        if (v.toLowerCase() === 'true') return true;
        if (v.toLowerCase() === 'false') return false;
        if (/^\d+$/.test(v)) return Number(v);
        return v;
      }),

    // Auth. AUTH_SECRET keys the JWT signature, the HMACs of OTP codes and identifiers, and the
    // encryption of pending OTP identifiers. Required in production; a random per-boot secret is
    // used in development/test when it is unset (tokens then die on restart).
    AUTH_SECRET: z.string().optional(),
    // Optional bearer secret for SYS-3 (`GET /internal/cron/daily`, e.g. Vercel Cron).
    CRON_SECRET: optionalTrimmed,
    // How OTP codes are delivered. `console` logs them (development only).
    OTP_PROVIDER: z.enum(['console', 'resend', 'brevo']).default('console'),
    OTP_EMAIL_FROM: optionalTrimmed,
    OTP_EMAIL_FROM_NAME: optionalTrimmed.transform((value) => value ?? 'SaveMeal'),
    RESEND_API_KEY: optionalTrimmed,
    BREVO_API_KEY: optionalTrimmed,

    // Where uploaded images are stored (`local` disk for dev/pilot, or `supabase` Storage).
    MEDIA_STORAGE: z.enum(['local', 'supabase']).default('local'),
    UPLOAD_DIR: z.string().min(1).default('uploads'),
    SUPABASE_URL: optionalTrimmed,
    SUPABASE_SERVICE_ROLE_KEY: optionalTrimmed,
    SUPABASE_STORAGE_BUCKET: optionalTrimmed.transform((value) => value ?? 'savemeal-media'),
    MEDIA_PUBLIC_BASE_URL: optionalTrimmed,
  })
  .superRefine((env, ctx) => {
    if (env.OTP_PROVIDER === 'resend' || env.OTP_PROVIDER === 'brevo') {
      if (!env.OTP_EMAIL_FROM || !z.string().email().safeParse(env.OTP_EMAIL_FROM).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_EMAIL_FROM'],
          message: `must be a valid email when OTP_PROVIDER is "${env.OTP_PROVIDER}"`,
        });
      }
    }
    if (env.OTP_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'is required when OTP_PROVIDER is "resend"',
      });
    }
    if (env.OTP_PROVIDER === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BREVO_API_KEY'],
        message: 'is required when OTP_PROVIDER is "brevo"',
      });
    }

    if (env.MEDIA_STORAGE === 'supabase') {
      if (!env.SUPABASE_URL || !z.string().url().safeParse(env.SUPABASE_URL).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_URL'],
          message: 'must be a valid URL when MEDIA_STORAGE is "supabase"',
        });
      }
      if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_SERVICE_ROLE_KEY'],
          message: 'is required when MEDIA_STORAGE is "supabase"',
        });
      }
    }

    if (env.MEDIA_PUBLIC_BASE_URL !== undefined && !z.string().url().safeParse(env.MEDIA_PUBLIC_BASE_URL).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEDIA_PUBLIC_BASE_URL'],
        message: 'must be a valid URL',
      });
    }

    if (env.DEFAULT_PAYMENT_HOLD_MIN < env.MIN_PAYMENT_HOLD_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEFAULT_PAYMENT_HOLD_MIN'],
        message: 'must be >= MIN_PAYMENT_HOLD_MIN',
      });
    }

    if (env.PAYMENTS_ENABLED && env.PAYMENT_PROVIDER === 'sepay') {
      if (!env.SEPAY_BANK_CODE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEPAY_BANK_CODE'],
          message: 'is required when PAYMENTS_ENABLED=true and PAYMENT_PROVIDER="sepay"',
        });
      }
      if (!env.SEPAY_ACCOUNT_NO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEPAY_ACCOUNT_NO'],
          message: 'is required when PAYMENTS_ENABLED=true and PAYMENT_PROVIDER="sepay"',
        });
      }
      if (!env.SEPAY_ACCOUNT_NAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEPAY_ACCOUNT_NAME'],
          message: 'is required when PAYMENTS_ENABLED=true and PAYMENT_PROVIDER="sepay"',
        });
      }
      if (!env.SEPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEPAY_WEBHOOK_SECRET'],
          message: 'is required when PAYMENTS_ENABLED=true and PAYMENT_PROVIDER="sepay"',
        });
      }
    }

    if (env.CRON_SECRET !== undefined && env.CRON_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRON_SECRET'],
        message: 'must be at least 16 characters when set',
      });
    }

    if (env.NODE_ENV !== 'production') return;
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_SECRET'], message: 'is required (≥ 32 chars) in production' });
    }
    if (env.OTP_PROVIDER === 'console') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OTP_PROVIDER'], message: '"console" is not allowed in production' });
    }
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
