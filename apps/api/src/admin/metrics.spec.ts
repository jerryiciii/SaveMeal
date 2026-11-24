import { computeAdminMetrics, computeMedian } from './metrics';

const H = 3_600_000;
const t0 = new Date('2026-11-23T08:00:00Z');

describe('computeMedian', () => {
  it('returns 0 for empty input', () => {
    expect(computeMedian([])).toBe(0);
  });

  it('returns the middle value for odd-length unsorted arrays', () => {
    expect(computeMedian([10, 2, 5.5])).toBe(5.5);
  });

  it('returns the mean of the two middle values for even-length arrays', () => {
    expect(computeMedian([12, 3, 8, 5])).toBe(6.5);
  });
});

describe('computeAdminMetrics (D§8)', () => {
  it('returns zeroed metrics when all inputs are empty', () => {
    expect(computeAdminMetrics({ reservations: [], listings: [], reports: [] })).toEqual({
      portionsHandedOver: 0,
      reservations: { created: 0, completed: 0, cancelled: 0, expired: 0 },
      completionRate: 0,
      listings: { published: 0, expiredWithStock: 0 },
      listingExpiredRate: 0,
      discount: { avgRate: 0, samples: 0 },
      reports: {
        total: 0,
        byType: {},
        open: 0,
        medianHandlingHours: 0,
        byAction: {},
      },
    });
  });

  it('computes reservation, listing, discount and report KPIs accurately', () => {
    const metrics = computeAdminMetrics({
      reservations: [
        // 2 completed with originalPrice: 40% and 50% discounts → avg 0.45
        { status: 'COMPLETED', quantity: 2, unitPrice: 15000, listingOriginalPrice: 25000 },
        { status: 'COMPLETED', quantity: 1, unitPrice: 10000, listingOriginalPrice: 20000 },
        // 1 completed without originalPrice → excluded from discount samples
        { status: 'COMPLETED', quantity: 1, unitPrice: 0, listingOriginalPrice: null },
        // 1 cancelled, 1 expired, 1 still reserved
        { status: 'CANCELLED', quantity: 1, unitPrice: 15000, listingOriginalPrice: 25000 },
        { status: 'EXPIRED', quantity: 2, unitPrice: 15000, listingOriginalPrice: 25000 },
        { status: 'RESERVED', quantity: 1, unitPrice: 15000, listingOriginalPrice: 25000 },
      ],
      listings: [
        { status: 'PUBLISHED', quantityAvailable: 3 },
        { status: 'EXPIRED', quantityAvailable: 2 },
        { status: 'EXPIRED', quantityAvailable: 0 }, // sold out before expiring → not expiredWithStock
        { status: 'WITHDRAWN', quantityAvailable: 1 },
      ],
      reports: [
        {
          type: 'UNSAFE_FOOD',
          status: 'RESOLVED',
          action: 'LISTING_BLOCKED',
          createdAt: t0,
          handledAt: new Date(t0.getTime() + 4 * H),
        },
        {
          type: 'WRONG_INFO',
          status: 'DISMISSED',
          action: 'NONE',
          createdAt: t0,
          handledAt: new Date(t0.getTime() + 7 * H),
        },
        {
          type: 'WRONG_INFO',
          status: 'OPEN',
          action: null,
          createdAt: t0,
          handledAt: null,
        },
      ],
    });

    expect(metrics).toEqual({
      portionsHandedOver: 4,
      reservations: { created: 6, completed: 3, cancelled: 1, expired: 1 },
      completionRate: 0.5,
      listings: { published: 4, expiredWithStock: 1 },
      listingExpiredRate: 0.25,
      discount: { avgRate: 0.45, samples: 2 },
      reports: {
        total: 3,
        byType: { UNSAFE_FOOD: 1, WRONG_INFO: 2 },
        open: 1,
        medianHandlingHours: 5.5,
        byAction: { LISTING_BLOCKED: 1, NONE: 1 },
      },
    });
  });

  it('counts IN_REVIEW reports as open and ignores zero originalPrice in discount', () => {
    const metrics = computeAdminMetrics({
      reservations: [
        { status: 'COMPLETED', quantity: 1, unitPrice: 0, listingOriginalPrice: 0 },
      ],
      listings: [],
      reports: [
        {
          type: 'OTHER',
          status: 'IN_REVIEW',
          action: null,
          createdAt: t0,
          handledAt: null,
        },
      ],
    });

    expect(metrics.discount).toEqual({ avgRate: 0, samples: 0 });
    expect(metrics.reports.open).toBe(1);
    expect(metrics.reports.medianHandlingHours).toBe(0);
  });
});
