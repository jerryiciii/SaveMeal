import type {
  AdminMetrics,
  ListingStatus,
  ReportAction,
  ReportStatus,
  ReportType,
  ReservationStatus,
} from '@savemeal/shared';

export type ReservationMetricRow = {
  status: ReservationStatus;
  quantity: number;
  unitPrice: number;
  listingOriginalPrice: number | null;
};

export type ListingMetricRow = {
  status: ListingStatus;
  quantityAvailable: number;
};

export type ReportMetricRow = {
  type: ReportType;
  status: ReportStatus;
  action: ReportAction | null;
  createdAt: Date;
  handledAt: Date | null;
};

const HOUR_MS = 3_600_000;

/** Rounds a ratio/rate to 4 decimal places (e.g. 0.775, 0.38). */
export function roundRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10_000) / 10_000;
}

/** Rounds a duration in hours to 2 decimal places (e.g. 5.5). */
export function roundHours(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Computes the statistical median of a numeric array, returning 0 when empty. */
export function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure KPI aggregation per docs/DOMAIN.md §8 and docs/API_CONTRACT.md §9 (ADM-9).
 * A handed-over portion is never reported as "waste avoided".
 */
export function computeAdminMetrics(input: {
  reservations: readonly ReservationMetricRow[];
  listings: readonly ListingMetricRow[];
  reports: readonly ReportMetricRow[];
}): AdminMetrics {
  let portionsHandedOver = 0;
  let completed = 0;
  let cancelled = 0;
  let expired = 0;
  let discountRateSum = 0;
  let discountSamples = 0;

  for (const r of input.reservations) {
    if (r.status === 'COMPLETED') {
      completed += 1;
      portionsHandedOver += r.quantity;
      if (r.listingOriginalPrice !== null && r.listingOriginalPrice > 0) {
        const rate = Math.max(0, (r.listingOriginalPrice - r.unitPrice) / r.listingOriginalPrice);
        discountRateSum += rate;
        discountSamples += 1;
      }
    } else if (r.status === 'CANCELLED') {
      cancelled += 1;
    } else if (r.status === 'EXPIRED') {
      expired += 1;
    }
  }

  const created = input.reservations.length;
  const completionRate = created > 0 ? roundRate(completed / created) : 0;

  const published = input.listings.length;
  let expiredWithStock = 0;
  for (const l of input.listings) {
    if (l.status === 'EXPIRED' && l.quantityAvailable > 0) {
      expiredWithStock += 1;
    }
  }
  const listingExpiredRate = published > 0 ? roundRate(expiredWithStock / published) : 0;

  const avgRate = discountSamples > 0 ? roundRate(discountRateSum / discountSamples) : 0;

  const byType: Partial<Record<ReportType, number>> = {};
  const byAction: Partial<Record<ReportAction, number>> = {};
  const handlingHours: number[] = [];
  let open = 0;

  for (const rep of input.reports) {
    byType[rep.type] = (byType[rep.type] ?? 0) + 1;
    if (rep.status === 'OPEN' || rep.status === 'IN_REVIEW') {
      open += 1;
    }
    if (rep.action !== null) {
      byAction[rep.action] = (byAction[rep.action] ?? 0) + 1;
    }
    if (rep.handledAt !== null) {
      const diffHours = Math.max(0, (rep.handledAt.getTime() - rep.createdAt.getTime()) / HOUR_MS);
      handlingHours.push(diffHours);
    }
  }

  return {
    portionsHandedOver,
    reservations: { created, completed, cancelled, expired },
    completionRate,
    listings: { published, expiredWithStock },
    listingExpiredRate,
    discount: { avgRate, samples: discountSamples },
    reports: {
      total: input.reports.length,
      byType,
      open,
      medianHandlingHours: roundHours(computeMedian(handlingHours)),
      byAction,
    },
  };
}
