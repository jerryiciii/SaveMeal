import {
  PAYMENT_STATUSES,
  PAYOUT_STATUSES,
  type PaymentStatus,
  type PayoutStatus,
} from '@savemeal/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const SELLER_PAYOUT_FILTER_STATUSES = ['PENDING_PAYOUT', 'SETTLED'] as const;

export class MyPayoutsQueryDto {
  @IsOptional()
  @IsIn(SELLER_PAYOUT_FILTER_STATUSES)
  payoutStatus?: (typeof SELLER_PAYOUT_FILTER_STATUSES)[number];

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class UpdatePayoutAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  bankCode: string;

  @IsString()
  @MinLength(4)
  @MaxLength(40)
  accountNo: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountName: string;
}

export class AdminPaymentsQueryDto {
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;

  @IsOptional()
  @IsIn(PAYOUT_STATUSES)
  payoutStatus?: PayoutStatus;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AdminMarkRefundedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

export class AdminSettlePayoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

export class SePayWebhookDto {
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value)))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  id: string;

  @IsString()
  @IsIn(['in', 'out'])
  transferType: 'in' | 'out';

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transferAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
