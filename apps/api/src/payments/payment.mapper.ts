import type { ListingImage, Payment as PrismaPayment } from '@prisma/client';
import type { Payment, PaymentStatus } from '@savemeal/shared';
import { toImage } from '../common/images';
import { toApiTime, toApiTimeOrNull } from '../common/time';

export type PaymentRow = PrismaPayment & {
  sellerQrImage?: ListingImage | null;
  proofImage?: ListingImage | null;
};

export const PAYMENT_INCLUDE = {
  sellerQrImage: true,
  proofImage: true,
};

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    reservationId: row.reservationId,
    status: row.status as PaymentStatus,
    amount: row.amount,
    sellerQrImage: row.sellerQrImage ? toImage(row.sellerQrImage) : null,
    proofImage: row.proofImage ? toImage(row.proofImage) : null,
    expiresAt: toApiTime(row.expiresAt),
    proofSubmittedAt: toApiTimeOrNull(row.proofSubmittedAt),
    confirmedAt: toApiTimeOrNull(row.confirmedAt),
    rejectedAt: toApiTimeOrNull(row.rejectedAt),
    rejectReason: row.rejectReason,
  };
}
