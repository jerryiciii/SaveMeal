// Pure listing rules from DOMAIN v1.3 §3 and §5 (no I/O, unit-tested).
import type { ChecklistKey, DeclarationKey, ListingStatus } from '@savemeal/shared';
import { CHECKLIST_KEYS, DECLARATION_KEYS } from '@savemeal/shared';

const HOUR = 3600_000;

export type ChecklistInput = {
  title: string | null;
  imageCount: number;
  price: number | null;
  originalPrice: number | null;
  quantityTotal: number | null;
  origin: string | null;
  preparedAt: Date | null;
  storage: string | null;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  pickupAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  bankQrImageId?: string | null;
};

/**
 * The required-info checklist (D§5). A key is "missing" when its info is absent or malformed.
 * Whether the window has already ended is time-dependent and reported at publish as
 * PICKUP_WINDOW_INVALID instead.
 */
export function missingChecklist(
  l: ChecklistInput,
  now: Date,
  maxWindowHours: number,
  paymentsEnabled = false,
): ChecklistKey[] {
  const missing = new Set<ChecklistKey>();
  if (l.imageCount < 1) missing.add('PHOTO');
  if (!l.title || l.title.trim().length < 3 || l.title.length > 80) missing.add('NAME');
  if (l.price === null || l.price < 0 || (l.originalPrice !== null && l.price > l.originalPrice)) missing.add('PRICE');
  if (l.quantityTotal === null || l.quantityTotal < 1 || l.quantityTotal > 50) missing.add('PORTIONS');
  if (!l.origin || !l.origin.trim()) missing.add('ORIGIN');
  if (!l.preparedAt || l.preparedAt.getTime() > now.getTime()) missing.add('PREPARED_AT');
  if (!l.storage) missing.add('STORAGE');
  if (
    !l.pickupStart ||
    !l.pickupEnd ||
    l.pickupStart.getTime() >= l.pickupEnd.getTime() ||
    l.pickupEnd.getTime() - l.pickupStart.getTime() > maxWindowHours * HOUR
  ) {
    missing.add('PICKUP_WINDOW');
  }
  if (!l.pickupAddress || l.pickupLat === null || l.pickupLng === null) missing.add('PICKUP_LOCATION');
  if (paymentsEnabled && l.price !== null && l.price > 0 && !l.bankQrImageId) {
    missing.add('PAYMENT_QR');
  }
  return CHECKLIST_KEYS.filter((k) => missing.has(k));
}

/** The declaration keys that are not `true` (all 6 are required, D§5). */
export function missingDeclarations(declaration: Partial<Record<string, unknown>> | undefined): DeclarationKey[] {
  return DECLARATION_KEYS.filter((k) => declaration?.[k] !== true);
}

/**
 * Platform sanity limit `pickup_end − prepared_at ≤ MAX_LISTING_AGE_HOURS[category]`. It stops
 * obvious mistakes and is NOT a food-safety threshold (spec §5).
 */
export function isTooOld(preparedAt: Date, pickupEnd: Date, maxAgeHours: number): boolean {
  return pickupEnd.getTime() - preparedAt.getTime() > maxAgeHours * HOUR;
}

/** Every ListingInput field (LIST-3/LIST-4). */
export const ALL_FIELDS = [
  'title',
  'description',
  'category',
  'imageIds',
  'origin',
  'preparedAt',
  'storage',
  'storageNote',
  'ingredients',
  'allergens',
  'originalPrice',
  'price',
  'quantityTotal',
  'pickupStart',
  'pickupEnd',
  'pickup',
  'bankQrImageId',
] as const;
export type ListingField = (typeof ALL_FIELDS)[number];

/** D§3: what can still change on a PUBLISHED listing (safety facts are locked). */
export const PUBLISHED_EDITABLE: readonly ListingField[] = [
  'title',
  'description',
  'imageIds',
  'quantityTotal',
  'price',
  'pickupEnd',
];

export function editableFields(status: ListingStatus): ListingField[] {
  if (status === 'DRAFT') return [...ALL_FIELDS];
  if (status === 'PUBLISHED') return [...PUBLISHED_EDITABLE];
  return [];
}

export const TERMINAL: readonly ListingStatus[] = ['EXPIRED', 'WITHDRAWN', 'BLOCKED'];
