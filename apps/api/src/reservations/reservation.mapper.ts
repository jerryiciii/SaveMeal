import type { Account, FoodListing, ListingImage, Reservation as PrismaReservation } from '@prisma/client';
import { formatOrderCode, type PickupToken, type Reservation } from '@savemeal/shared';
import { toImage } from '../common/images';
import { toApiTime, toApiTimeOrNull } from '../common/time';
import { pickupOf, sellerSummary } from '../listings/listing.mapper';

export type ReservationRow = PrismaReservation & {
  listing: FoodListing & { images: ListingImage[] };
  seller: Account;
  buyer: Account;
};

export type ReservationViewerRole = 'BUYER' | 'SELLER' | 'ADMIN';

export const RESERVATION_INCLUDE = {
  listing: {
    include: {
      images: { orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }] },
    },
  },
  seller: true,
  buyer: true,
};

export function toReservation(
  row: ReservationRow,
  viewerRole: ReservationViewerRole,
  pickupToken: PickupToken | null = null,
  now = new Date(),
): Reservation {
  const firstImage = row.listing.images[0];
  const isBuyer = viewerRole === 'BUYER';
  const showBuyerName = viewerRole === 'SELLER' || viewerRole === 'ADMIN';
  return {
    id: row.id,
    code: formatOrderCode(row.code),
    status: row.status,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalPrice: row.totalPrice,
    listing: {
      id: row.listing.id,
      title: row.listing.title,
      image: firstImage ? toImage(firstImage) : null,
      pickupStart: toApiTime(row.listing.pickupStart!),
      pickupEnd: toApiTime(row.listing.pickupEnd!),
      pickup: pickupOf(row.listing)!,
      status: row.listing.status,
    },
    seller: sellerSummary(row.seller),
    buyer: showBuyerName ? { displayName: row.buyer.displayName ?? 'Người mua' } : null,
    pickupToken: isBuyer && row.status === 'RESERVED' ? pickupToken : null,
    cancelReason: row.cancelReason,
    createdAt: toApiTime(row.createdAt),
    completedAt: toApiTimeOrNull(row.completedAt),
    closedAt: toApiTimeOrNull(row.closedAt),
    canCancel: isBuyer && row.status === 'RESERVED' && now.getTime() < row.listing.pickupEnd!.getTime(),
    canReport: isBuyer && row.status !== 'CANCELLED',
  };
}
