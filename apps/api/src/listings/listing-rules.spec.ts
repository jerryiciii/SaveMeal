import {
  editableFields,
  isTooOld,
  missingChecklist,
  missingDeclarations,
  type ChecklistInput,
} from './listing-rules';

const now = new Date('2026-11-23T08:00:00Z');
const H = 3600_000;
const complete: ChecklistInput = {
  title: '5 phần bánh còn nguyên',
  imageCount: 1,
  price: 15000,
  originalPrice: 25000,
  quantityTotal: 5,
  origin: 'Làm tại tiệm',
  preparedAt: new Date(now.getTime() - 2 * H),
  storage: 'ROOM_TEMP',
  pickupStart: new Date(now.getTime() + H),
  pickupEnd: new Date(now.getTime() + 2 * H),
  pickupAddress: '12 Ngô Thì Sĩ',
  pickupLat: 16.0478,
  pickupLng: 108.2431,
};

describe('missingChecklist (D§5)', () => {
  it('is empty for a complete listing', () => {
    expect(missingChecklist(complete, now, 4)).toEqual([]);
  });

  it('lists every missing key in checklist order for an empty draft', () => {
    const empty: ChecklistInput = {
      title: 'Bánh',
      imageCount: 0,
      price: null,
      originalPrice: null,
      quantityTotal: null,
      origin: null,
      preparedAt: null,
      storage: null,
      pickupStart: null,
      pickupEnd: null,
      pickupAddress: null,
      pickupLat: null,
      pickupLng: null,
    };
    expect(missingChecklist(empty, now, 4)).toEqual([
      'PHOTO',
      'PRICE',
      'PORTIONS',
      'ORIGIN',
      'PREPARED_AT',
      'STORAGE',
      'PICKUP_WINDOW',
      'PICKUP_LOCATION',
    ]);
  });

  it.each<[string, Partial<ChecklistInput>, string]>([
    ['price above the reference price', { price: 30000 }, 'PRICE'],
    ['a free item is fine', { price: 0, originalPrice: null }, ''],
    ['a short name', { title: 'Bá' }, 'NAME'],
    ['51 portions', { quantityTotal: 51 }, 'PORTIONS'],
    ['blank origin', { origin: '   ' }, 'ORIGIN'],
    ['prepared in the future', { preparedAt: new Date(now.getTime() + H) }, 'PREPARED_AT'],
    ['an inverted window', { pickupStart: new Date(now.getTime() + 3 * H) }, 'PICKUP_WINDOW'],
    ['a window over 4 h', { pickupEnd: new Date(now.getTime() + 6 * H) }, 'PICKUP_WINDOW'],
    ['no coordinates', { pickupLat: null }, 'PICKUP_LOCATION'],
  ])('%s', (_name, change, expected) => {
    expect(missingChecklist({ ...complete, ...change }, now, 4)).toEqual(expected ? [expected] : []);
  });
});

describe('missingDeclarations', () => {
  const all = {
    NOT_EXPIRED: true,
    STORED_PROPERLY: true,
    NOT_SPOILED: true,
    NOT_SERVED_LEFTOVERS: true,
    INFO_DECLARED: true,
    PICKUP_WINDOW_OK: true,
  };
  it('requires all six to be exactly true', () => {
    expect(missingDeclarations(all)).toEqual([]);
    expect(missingDeclarations({ ...all, NOT_SPOILED: false, INFO_DECLARED: 'yes' })).toEqual([
      'NOT_SPOILED',
      'INFO_DECLARED',
    ]);
    expect(missingDeclarations(undefined)).toHaveLength(6);
  });
});

describe('isTooOld (sanity limit, not a safety threshold)', () => {
  it('compares pickup end with prepared time', () => {
    expect(isTooOld(new Date(0), new Date(24 * H), 24)).toBe(false);
    expect(isTooOld(new Date(0), new Date(24 * H + 1), 24)).toBe(true);
  });
});

describe('editableFields (D§3)', () => {
  it('allows everything on a draft, only the safe fields once published, nothing when closed', () => {
    expect(editableFields('DRAFT')).toContain('category');
    expect(editableFields('PUBLISHED').sort()).toEqual(
      ['description', 'imageIds', 'pickupEnd', 'price', 'quantityTotal', 'title'].sort(),
    );
    for (const status of ['EXPIRED', 'WITHDRAWN', 'BLOCKED'] as const) expect(editableFields(status)).toEqual([]);
  });
});
