import type { Account, FoodListing, ListingImage } from '@prisma/client';
import type {
  ListingCard,
  ListingDetail,
  ListingOwnerView,
  MapPin,
  PickupLocation,
  SellerSummary,
} from '@savemeal/shared';
import { toImage } from '../common/images';
import { toApiTimeOrNull } from '../common/time';
import { editableFields, missingChecklist } from './listing-rules';

export type ListingRow = FoodListing & { seller: Account; images: ListingImage[] };

/** Prisma include that every listing response needs. */
export const LISTING_INCLUDE = {
  seller: true,
  images: { orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }] },
};

export function sellerSummary(account: Account): SellerSummary {
  return {
    id: account.id,
    name: account.sellerName ?? account.displayName ?? 'Người bán',
    type: account.sellerType,
    verified: account.sellerVerifiedAt !== null,
  };
}

export function pickupOf(l: FoodListing): PickupLocation | null {
  return l.pickupAddress !== null && l.pickupLat !== null && l.pickupLng !== null
    ? { address: l.pickupAddress, lat: l.pickupLat, lng: l.pickupLng }
    : null;
}

// Drafts may lack any optional field; the owner view returns null for those (contract §0). Every
// PUBLISHED or later listing is complete (enforced by a DB check), so public shapes are full.
export function toCard(l: ListingRow, distanceMeters: number | null = null): ListingCard {
  const first = l.images[0];
  return {
    id: l.id,
    title: l.title,
    category: l.category,
    image: first ? toImage(first) : null,
    originalPrice: l.originalPrice,
    price: l.price!,
    isFree: l.price === 0,
    quantityAvailable: l.quantityAvailable,
    soldOut: l.status === 'PUBLISHED' && l.quantityAvailable === 0,
    pickupStart: toApiTimeOrNull(l.pickupStart)!,
    pickupEnd: toApiTimeOrNull(l.pickupEnd)!,
    pickup: pickupOf(l)!,
    distanceMeters: distanceMeters === null ? null : Math.round(distanceMeters),
    seller: sellerSummary(l.seller),
  };
}

export function toMapPin(l: ListingRow): MapPin {
  return {
    id: l.id,
    lat: l.pickupLat!,
    lng: l.pickupLng!,
    title: l.title,
    price: l.price!,
    isFree: l.price === 0,
    quantityAvailable: l.quantityAvailable,
    category: l.category,
  };
}

export function toDetail(l: ListingRow, myActiveReservationId: string | null = null): ListingDetail {
  return {
    ...toCard(l),
    description: l.description,
    images: l.images.map(toImage),
    origin: l.origin!,
    preparedAt: toApiTimeOrNull(l.preparedAt)!,
    storage: l.storage!,
    storageNote: l.storageNote,
    ingredients: l.ingredients,
    allergens: l.allergens,
    status: l.status,
    underReview: l.underReview,
    declaredAt: toApiTimeOrNull(l.declaredAt),
    myActiveReservationId,
  };
}

export type PortionCounts = { reserved: number; completed: number };

export function toOwnerView(
  l: ListingRow,
  counts: PortionCounts,
  now: Date,
  maxWindowHours: number,
): ListingOwnerView {
  return {
    ...toDetail(l),
    // null only on drafts
    quantityTotal: l.quantityTotal!,
    reservedCount: counts.reserved,
    completedCount: counts.completed,
    missing: missingChecklist({ ...l, imageCount: l.images.length }, now, maxWindowHours),
    editableFields: editableFields(l.status),
    closeReason: l.closeReason,
    blockedReason: l.blockedReason,
    createdAt: toApiTimeOrNull(l.createdAt)!,
    publishedAt: toApiTimeOrNull(l.publishedAt),
  };
}
