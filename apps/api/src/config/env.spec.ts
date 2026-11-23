import { AppConfig } from './app-config';
import { parseEnv } from './env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('defaults to port 4000 with both feature flags off', () => {
    const config = new AppConfig(parseEnv(base));
    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.features).toEqual({ payments: false, googleLogin: false });
    expect(config.isProduction).toBe(false);
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

  it('rejects an invalid flag value', () => {
    expect(() => parseEnv({ ...base, PAYMENTS_ENABLED: 'yes' })).toThrow(/PAYMENTS_ENABLED/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('reads integer overrides and rejects bad ones', () => {
    expect(parseEnv({ ...base, PORT: '4100' }).PORT).toBe(4100);
    expect(() => parseEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
