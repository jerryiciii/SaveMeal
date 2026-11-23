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
    expect(config.auth).toEqual({
      otpTtlSec: 300,
      otpResendSec: 60,
      otpMaxAttempts: 5,
      accessTokenTtlSec: 900,
      refreshTokenTtlSec: 30 * 86400,
    });
    expect(config.map.attribution).toBe('© OpenStreetMap contributors');
    expect(config.isProduction).toBe(false);
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
