import { BUYER_CANCEL_REASONS, RESERVATION_TABS, type BuyerCancelReason, type ReservationTab } from '@savemeal/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  listingId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  holdMinutes?: number;
}

export class MyReservationsQueryDto {
  @IsOptional()
  @IsIn(RESERVATION_TABS)
  tab?: ReservationTab;

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

export class CancelReservationDto {
  @IsIn(BUYER_CANCEL_REASONS)
  reason: BuyerCancelReason;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

export class MySalesQueryDto {
  /** Comma-separated ReservationStatus; defaults to RESERVED. */
  @IsOptional()
  @IsString()
  status?: string;

  /** Local date YYYY-MM-DD (Đà Nẵng); defaults to today. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsUUID()
  listingId?: string;

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

export class PickupLookupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qrPayload?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}

export class PickupConfirmDto {
  @IsUUID()
  reservationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  qrPayload?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}
