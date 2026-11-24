import { Injectable } from '@nestjs/common';
import { resolve } from 'node:path';
import type { Category } from '@savemeal/shared';
import type { Env, MaxListingAgeHours } from './env';

/** Typed, validated configuration. Built once from the environment (see parseEnv). */
@Injectable()
export class AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly databaseUrl: string;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly features: { payments: boolean; googleLogin: boolean };

  readonly listings: {
    maxActivePerSeller: number;
    maxWindowHours: number;
    maxListingAgeHours: MaxListingAgeHours;
  };

  readonly reservations: {
    maxQtyPerReservation: number;
    maxActivePerAccount: number;
    earlyPickupMin: number;
    noShowGraceMin: number;
    pickupTokenTtlMin: number;
  };

  readonly payments: {
    provider: Env['PAYMENT_PROVIDER'];
    minHoldMin: number;
    defaultHoldMin: number;
    fees: {
      percent: number;
      thresholdVnd: number;
      flatVnd: number;
      paidBy: 'BUYER';
    };
    sepay: {
      bankCode: string | null;
      accountNo: string | null;
      accountName: string | null;
      webhookSecret: string | null;
    };
  };

  readonly auth: {
    otpTtlSec: number;
    otpResendSec: number;
    otpMaxAttempts: number;
    accessTokenTtlSec: number;
    refreshTokenTtlSec: number;
  };

  readonly map: { styleUrl: string; attribution: string };
  readonly trustProxy: boolean | number | string;

  /** Root secret for auth keys; null means "generate a random one at boot" (non-production). */
  readonly authSecret: string | null;
  /** Optional bearer secret for SYS-3 (`GET /internal/cron/daily`). */
  readonly cronSecret: string | null;
  readonly otpProvider: Env['OTP_PROVIDER'];
  readonly otpEmail: {
    from: string | null;
    fromName: string;
    resendApiKey: string | null;
    brevoApiKey: string | null;
  };
  /** Absolute directory for uploaded images (used when mediaStorage === 'local'). */
  readonly uploadDir: string;
  readonly mediaStorage: Env['MEDIA_STORAGE'];
  readonly supabaseStorage: {
    url: string | null;
    serviceRoleKey: string | null;
    bucket: string;
  };
  /** Public base URL prefix for stored images (no trailing slash). */
  readonly mediaPublicBaseUrl: string;

  constructor(env: Env) {
    this.authSecret = env.AUTH_SECRET?.trim() ? env.AUTH_SECRET.trim() : null;
    this.cronSecret = env.CRON_SECRET ?? null;
    this.otpProvider = env.OTP_PROVIDER;
    this.otpEmail = {
      from: env.OTP_EMAIL_FROM ?? null,
      fromName: env.OTP_EMAIL_FROM_NAME,
      resendApiKey: env.RESEND_API_KEY ?? null,
      brevoApiKey: env.BREVO_API_KEY ?? null,
    };
    this.uploadDir = resolve(env.UPLOAD_DIR);
    this.mediaStorage = env.MEDIA_STORAGE;
    const supabaseUrl = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/+$/, '') : null;
    this.supabaseStorage = {
      url: supabaseUrl,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? null,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    };
    this.mediaPublicBaseUrl = env.MEDIA_PUBLIC_BASE_URL
      ? env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '')
      : env.MEDIA_STORAGE === 'supabase' && supabaseUrl
        ? `${supabaseUrl}/storage/v1/object/public/${env.SUPABASE_STORAGE_BUCKET}`
        : '/api/v1/media';
    this.nodeEnv = env.NODE_ENV;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.logLevel = env.LOG_LEVEL;
    this.features = { payments: env.PAYMENTS_ENABLED, googleLogin: env.GOOGLE_LOGIN_ENABLED };
    this.listings = {
      maxActivePerSeller: env.MAX_ACTIVE_LISTINGS,
      maxWindowHours: env.MAX_WINDOW_HOURS,
      maxListingAgeHours: env.MAX_LISTING_AGE_HOURS,
    };
    this.reservations = {
      maxQtyPerReservation: env.MAX_QTY_PER_RESERVATION,
      maxActivePerAccount: env.MAX_ACTIVE_RESERVATIONS_PER_ACCOUNT,
      earlyPickupMin: env.EARLY_PICKUP_MIN,
      noShowGraceMin: env.NO_SHOW_GRACE_MIN,
      pickupTokenTtlMin: env.PICKUP_TOKEN_TTL_MIN,
    };
    this.payments = {
      provider: env.PAYMENT_PROVIDER,
      minHoldMin: env.MIN_PAYMENT_HOLD_MIN,
      defaultHoldMin: env.DEFAULT_PAYMENT_HOLD_MIN,
      fees: {
        percent: env.PLATFORM_FEE_PERCENT,
        thresholdVnd: env.PLATFORM_FEE_THRESHOLD_VND,
        flatVnd: env.PLATFORM_FEE_FLAT_VND,
        paidBy: 'BUYER',
      },
      sepay: {
        bankCode: env.SEPAY_BANK_CODE ?? null,
        accountNo: env.SEPAY_ACCOUNT_NO ?? null,
        accountName: env.SEPAY_ACCOUNT_NAME ?? null,
        webhookSecret: env.SEPAY_WEBHOOK_SECRET ?? null,
      },
    };
    this.auth = {
      otpTtlSec: env.OTP_TTL_SEC,
      otpResendSec: env.OTP_RESEND_SEC,
      otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
      accessTokenTtlSec: env.ACCESS_TOKEN_TTL,
      refreshTokenTtlSec: env.REFRESH_TOKEN_TTL,
    };
    this.map = { styleUrl: env.MAP_STYLE_URL, attribution: env.MAP_ATTRIBUTION };
    this.trustProxy = env.TRUST_PROXY;
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /** Max hours from prepared_at to pickup_end for a category (sanity limit, not safety). */
  maxListingAgeHoursFor(category: Category): number {
    return this.listings.maxListingAgeHours[category] ?? this.listings.maxListingAgeHours.default;
  }
}
