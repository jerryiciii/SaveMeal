import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** PAY-2 · POST /reservations/:reservationId/payment-proof */
export class SubmitPaymentProofDto {
  /** Checked in service so missing/blank returns 422 PROOF_REQUIRED per contract §12. */
  @IsOptional()
  @IsString()
  proofImageId?: string;
}

/** PAY-4 · POST /reservations/:reservationId/payment/reject */
export class RejectPaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}
