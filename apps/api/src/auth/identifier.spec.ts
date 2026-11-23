import { maskIdentifier, normalizeIdentifier } from './identifier';

describe('normalizeIdentifier', () => {
  it.each([
    ['0901234567', '+84901234567'],
    ['090 123 4567', '+84901234567'],
    ['090.123.4567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['+84901234567', '+84901234567'],
    ['0084901234567', '+84901234567'],
    ['+14155552671', '+14155552671'],
  ])('SMS %p → %p', (raw, expected) => {
    expect(normalizeIdentifier('SMS', raw)).toBe(expected);
  });

  it.each(['', '12345', '090123456', '+840901234567', 'abc', '+84 0 1234 5678', 'a@b.vn'])(
    'rejects SMS %p',
    (raw) => {
      expect(normalizeIdentifier('SMS', raw)).toBeNull();
    },
  );

  it('normalises emails and rejects malformed ones', () => {
    expect(normalizeIdentifier('EMAIL', '  An.Nguyen@Gmail.COM ')).toBe('an.nguyen@gmail.com');
    expect(normalizeIdentifier('EMAIL', 'no-at-sign')).toBeNull();
    expect(normalizeIdentifier('EMAIL', 'a@b')).toBeNull();
    expect(normalizeIdentifier('EMAIL', '0901234567')).toBeNull();
  });
});

describe('maskIdentifier', () => {
  it('hides most of a phone or email', () => {
    expect(maskIdentifier('+84900000002')).toBe('+849•••••002');
    expect(maskIdentifier('an.nguyen@gmail.com')).toBe('a•••@gmail.com');
  });
});
