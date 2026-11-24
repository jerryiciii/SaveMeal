import type { Payment as PrismaPayment } from '@prisma/client';
import type { Payment } from '@savemeal/shared';
import { toApiTime, toApiTimeOrNull } from '../common/time';

export function toPayment(row: PrismaPayment): Payment {
  return {
    id: row.id,
    reservationId: row.reservationId,
    provider: row.provider,
    status: row.status,
    payoutStatus: row.payoutStatus,
    foodAmount: row.foodAmount,
    platformFee: row.platformFee,
    payableAmount: row.payableAmount,
    sellerNet: row.sellerNet,
    bankCode: row.bankCode,
    accountNo: row.accountNo,
    accountName: row.accountName,
    transferContent: row.transferContent,
    qrImageUrl: row.qrImageUrl,
    checkoutUrl: row.checkoutUrl,
    expiresAt: toApiTime(row.expiresAt),
    paidAt: toApiTimeOrNull(row.paidAt),
    refundedAt: toApiTimeOrNull(row.refundedAt),
    settledAt: toApiTimeOrNull(row.settledAt),
  };
}
