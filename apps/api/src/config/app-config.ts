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

  readonly auth: {
    otpTtlSec: number;
    otpResendSec: number;
    otpMaxAttempts: number;
    accessTokenTtlSec: number;
    refreshTokenTtlSec: number;
  };

  readonly map: { styleUrl: string; attribution: string };

  /** Root secret for auth keys; null means "generate a random one at boot" (non-production). */
  readonly authSecret: string | null;
  readonly otpProvider: Env['OTP_PROVIDER'];
  /** Absolute directory for uploaded images. */
  readonly uploadDir: string;

  constructor(env: Env) {
    this.authSecret = env.AUTH_SECRET?.trim() ? env.AUTH_SECRET.trim() : null;
    this.otpProvider = env.OTP_PROVIDER;
    this.uploadDir = resolve(env.UPLOAD_DIR);
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
    this.auth = {
      otpTtlSec: env.OTP_TTL_SEC,
      otpResendSec: env.OTP_RESEND_SEC,
      otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
      accessTokenTtlSec: env.ACCESS_TOKEN_TTL,
      refreshTokenTtlSec: env.REFRESH_TOKEN_TTL,
    };
    this.map = { styleUrl: env.MAP_STYLE_URL, attribution: env.MAP_ATTRIBUTION };
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /** Max hours from prepared_at to pickup_end for a category (sanity limit, not safety). */
  maxListingAgeHoursFor(category: Category): number {
    return this.listings.maxListingAgeHours[category] ?? this.listings.maxListingAgeHours.default;
  }
}
