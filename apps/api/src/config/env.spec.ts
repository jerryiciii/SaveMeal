import { AppConfig } from './app-config';
import { parseDurationSec, parseEnv } from './env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('applies the DOMAIN §11 defaults with both feature flags off', () => {
    const config = new AppConfig(parseEnv(base));
    expect(config.port).toBe(4000);
    expect(config.features).toEqual({ payments: false, googleLogin: false });
    expect(config.listings).toEqual({
      maxActivePerSeller: 5,
      maxWindowHours: 4,
      maxListingAgeHours: { default: 24, PACKAGED: 72 },
    });
    expect(config.reservations).toEqual({
      maxQtyPerReservation: 2,
      maxActivePerAccount: 3,
      earlyPickupMin: 30,
      noShowGraceMin: 15,
      pickupTokenTtlMin: 10,
    });
    expect(config.payments).toEqual({
      provider: 'mock',
      minHoldMin: 5,
      defaultHoldMin: 10,
      fees: {
        percent: 0,
        thresholdVnd: 0,
        flatVnd: 0,
        paidBy: 'BUYER',
      },
      sepay: {
        bankCode: null,
        accountNo: null,
        accountName: null,
        webhookSecret: null,
      },
    });
    expect(config.auth).toEqual({
      otpTtlSec: 300,
      otpResendSec: 60,
      otpMaxAttempts: 5,
      accessTokenTtlSec: 900,
      refreshTokenTtlSec: 30 * 86400,
    });
    expect(config.map.styleUrl).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(config.map.attribution).toBe('© OpenStreetMap contributors');
    expect(config.trustProxy).toBe('loopback');
    expect(config.otpProvider).toBe('console');
    expect(config.otpEmail).toEqual({
      from: null,
      fromName: 'SaveMeal',
      resendApiKey: null,
      brevoApiKey: null,
    });
    expect(config.mediaStorage).toBe('local');
    expect(config.mediaPublicBaseUrl).toBe('/api/v1/media');
    expect(config.cronSecret).toBeNull();
    expect(config.isProduction).toBe(false);
  });

  it('validates optional CRON_SECRET (min 16 chars when non-empty)', () => {
    expect(new AppConfig(parseEnv({ ...base, CRON_SECRET: '' })).cronSecret).toBeNull();
    expect(new AppConfig(parseEnv({ ...base, CRON_SECRET: '   ' })).cronSecret).toBeNull();
    expect(() => parseEnv({ ...base, CRON_SECRET: 'short-secret' })).toThrow(/CRON_SECRET/);

    const secret = 'cron-secret-123456';
    expect(new AppConfig(parseEnv({ ...base, CRON_SECRET: ` ${secret} ` })).cronSecret).toBe(secret);
  });

  it.each([
    [undefined, 'loopback'],
    ['', 'loopback'],
    ['1', 1],
    ['2', 2],
    ['true', true],
    ['false', false],
    ['loopback', 'loopback'],
  ])('parses TRUST_PROXY=%p as %p', (raw, expected) => {
    const config = new AppConfig(parseEnv({ ...base, ...(raw !== undefined ? { TRUST_PROXY: raw } : {}) }));
    expect(config.trustProxy).toBe(expected);
  });

  it('resolves the listing-age sanity limit per category', () => {
    const config = new AppConfig(parseEnv(base));
    expect(config.maxListingAgeHoursFor('PACKAGED')).toBe(72);
    expect(config.maxListingAgeHoursFor('BAKERY')).toBe(24);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['TRUE', true],
    ['false', false],
    ['0', false],
    ['', false],
  ])('parses flag value %p as %p', (raw, expected) => {
    const config = new AppConfig(parseEnv({ ...base, PAYMENTS_ENABLED: raw, GOOGLE_LOGIN_ENABLED: raw }));
    expect(config.features).toEqual({ payments: expected, googleLogin: expected });
  });

  it('rejects invalid values with the variable name', () => {
    expect(() => parseEnv({ ...base, PAYMENTS_ENABLED: 'yes' })).toThrow(/PAYMENTS_ENABLED/);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => parseEnv({ ...base, MAX_QTY_PER_RESERVATION: '0' })).toThrow(/MAX_QTY_PER_RESERVATION/);
    expect(() => parseEnv({ ...base, MAP_STYLE_URL: 'not a url' })).toThrow(/MAP_STYLE_URL/);
  });

  it('accepts a MAX_LISTING_AGE_HOURS override and rejects unknown categories', () => {
    expect(parseEnv({ ...base, MAX_LISTING_AGE_HOURS: '{"default":12,"MEAL":6}' }).MAX_LISTING_AGE_HOURS).toEqual({
      default: 12,
      MEAL: 6,
    });
    expect(() => parseEnv({ ...base, MAX_LISTING_AGE_HOURS: '{"default":12,"PIZZA":1}' })).toThrow(
      /MAX_LISTING_AGE_HOURS/,
    );
    expect(() => parseEnv({ ...base, MAX_LISTING_AGE_HOURS: '{"MEAL":6}' })).toThrow(/MAX_LISTING_AGE_HOURS/);
    expect(() => parseEnv({ ...base, MAX_LISTING_AGE_HOURS: 'nope' })).toThrow(/MAX_LISTING_AGE_HOURS/);
  });

  it('validates OTP_PROVIDER=resend requirements', () => {
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'resend' })).toThrow(/OTP_EMAIL_FROM/);
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() =>
      parseEnv({ ...base, OTP_PROVIDER: 'resend', OTP_EMAIL_FROM: 'not-an-email', RESEND_API_KEY: 're_123' }),
    ).toThrow(/OTP_EMAIL_FROM/);
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'resend', OTP_EMAIL_FROM: 'no-reply@savemeal.vn' })).toThrow(
      /RESEND_API_KEY/,
    );

    const config = new AppConfig(
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        AUTH_SECRET: 'a'.repeat(32),
        OTP_PROVIDER: 'resend',
        OTP_EMAIL_FROM: 'no-reply@savemeal.vn',
        OTP_EMAIL_FROM_NAME: 'SaveMeal Pilot',
        RESEND_API_KEY: 're_test_123',
      }),
    );
    expect(config.otpProvider).toBe('resend');
    expect(config.otpEmail).toEqual({
      from: 'no-reply@savemeal.vn',
      fromName: 'SaveMeal Pilot',
      resendApiKey: 're_test_123',
      brevoApiKey: null,
    });
  });

  it('validates OTP_PROVIDER=brevo requirements and forbids console in production', () => {
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'brevo' })).toThrow(/OTP_EMAIL_FROM/);
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY/);
    expect(() => parseEnv({ ...base, OTP_PROVIDER: 'brevo', OTP_EMAIL_FROM: 'no-reply@savemeal.vn' })).toThrow(
      /BREVO_API_KEY/,
    );
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', AUTH_SECRET: 'a'.repeat(32), OTP_PROVIDER: 'console' }),
    ).toThrow(/OTP_PROVIDER/);

    const config = new AppConfig(
      parseEnv({
        ...base,
        OTP_PROVIDER: 'brevo',
        OTP_EMAIL_FROM: 'no-reply@savemeal.vn',
        BREVO_API_KEY: 'xkeysib_test_123',
      }),
    );
    expect(config.otpProvider).toBe('brevo');
    expect(config.otpEmail).toEqual({
      from: 'no-reply@savemeal.vn',
      fromName: 'SaveMeal',
      resendApiKey: null,
      brevoApiKey: 'xkeysib_test_123',
    });
  });

  it('validates MEDIA_STORAGE=supabase and derives mediaPublicBaseUrl', () => {
    expect(() => parseEnv({ ...base, MEDIA_STORAGE: 'supabase' })).toThrow(/SUPABASE_URL/);
    expect(() => parseEnv({ ...base, MEDIA_STORAGE: 'supabase' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() =>
      parseEnv({
        ...base,
        MEDIA_STORAGE: 'supabase',
        SUPABASE_URL: 'not-a-url',
        SUPABASE_SERVICE_ROLE_KEY: 'svc_key',
      }),
    ).toThrow(/SUPABASE_URL/);
    expect(() => parseEnv({ ...base, MEDIA_PUBLIC_BASE_URL: 'not-a-url' })).toThrow(/MEDIA_PUBLIC_BASE_URL/);

    const derived = new AppConfig(
      parseEnv({
        ...base,
        MEDIA_STORAGE: 'supabase',
        SUPABASE_URL: 'https://demo.supabase.co/',
        SUPABASE_SERVICE_ROLE_KEY: 'svc_key',
      }),
    );
    expect(derived.mediaStorage).toBe('supabase');
    expect(derived.supabaseStorage).toEqual({
      url: 'https://demo.supabase.co',
      serviceRoleKey: 'svc_key',
      bucket: 'savemeal-media',
    });
    expect(derived.mediaPublicBaseUrl).toBe('https://demo.supabase.co/storage/v1/object/public/savemeal-media');

    const overridden = new AppConfig(
      parseEnv({
        ...base,
        MEDIA_STORAGE: 'supabase',
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'svc_key',
        SUPABASE_STORAGE_BUCKET: 'custom-bucket',
        MEDIA_PUBLIC_BASE_URL: 'https://cdn.savemeal.vn/media/',
      }),
    );
    expect(overridden.supabaseStorage.bucket).toBe('custom-bucket');
    expect(overridden.mediaPublicBaseUrl).toBe('https://cdn.savemeal.vn/media');
  });

  it('validates PAYMENT_PROVIDER=sepay credentials only when PAYMENTS_ENABLED=true', () => {
    // When PAYMENTS_ENABLED=false, sepay credentials are not required.
    const disabled = new AppConfig(parseEnv({ ...base, PAYMENTS_ENABLED: 'false', PAYMENT_PROVIDER: 'sepay' }));
    expect(disabled.payments.provider).toBe('sepay');

    // When PAYMENTS_ENABLED=true and PAYMENT_PROVIDER=mock, sepay credentials are not required.
    const mockEnabled = new AppConfig(parseEnv({ ...base, PAYMENTS_ENABLED: 'true', PAYMENT_PROVIDER: 'mock' }));
    expect(mockEnabled.features.payments).toBe(true);
    expect(mockEnabled.payments.provider).toBe('mock');

    // When PAYMENTS_ENABLED=true and PAYMENT_PROVIDER=sepay, all four SePay vars are required.
    expect(() => parseEnv({ ...base, PAYMENTS_ENABLED: 'true', PAYMENT_PROVIDER: 'sepay' })).toThrow(
      /SEPAY_BANK_CODE[\s\S]*SEPAY_ACCOUNT_NO[\s\S]*SEPAY_ACCOUNT_NAME[\s\S]*SEPAY_WEBHOOK_SECRET/,
    );

    const sepayEnabled = new AppConfig(
      parseEnv({
        ...base,
        PAYMENTS_ENABLED: 'true',
        PAYMENT_PROVIDER: 'sepay',
        SEPAY_BANK_CODE: 'MB',
        SEPAY_ACCOUNT_NO: '0123456789',
        SEPAY_ACCOUNT_NAME: 'SAVEMEAL',
        SEPAY_WEBHOOK_SECRET: 'whsec_test',
      }),
    );
    expect(sepayEnabled.payments.sepay).toEqual({
      bankCode: 'MB',
      accountNo: '0123456789',
      accountName: 'SAVEMEAL',
      webhookSecret: 'whsec_test',
    });

    expect(() => parseEnv({ ...base, MIN_PAYMENT_HOLD_MIN: '15', DEFAULT_PAYMENT_HOLD_MIN: '10' })).toThrow(
      /DEFAULT_PAYMENT_HOLD_MIN/,
    );
  });
});

describe('parseDurationSec', () => {
  it.each([
    ['15m', 900],
    ['30d', 2592000],
    ['90s', 90],
    ['2h', 7200],
  ])('%s = %i s', (value, seconds) => {
    expect(parseDurationSec(value)).toBe(seconds);
  });

  it('rejects malformed durations', () => {
    expect(() => parseDurationSec('15')).toThrow();
    expect(() => parseEnv({ ...base, ACCESS_TOKEN_TTL: 'soon' })).toThrow(/ACCESS_TOKEN_TTL/);
  });
});
