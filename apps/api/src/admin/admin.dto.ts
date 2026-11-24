import {
  ACCOUNT_STATUSES,
  LISTING_STATUSES,
  REPORT_ACTIONS,
  REPORT_STATUSES,
  REPORT_TYPES,
  RESERVATION_STATUSES,
  type AccountStatus,
  type ListingStatus,
  type ReportAction,
  type ReportStatus,
  type ReportType,
  type ReservationStatus,
} from '@savemeal/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const HANDLED_REPORT_STATUSES = ['IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;

class AdminPageQuery {
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

/** ADM-1 query */
export class AdminReportsQuery extends AdminPageQuery {
  @IsOptional() @IsIn(REPORT_STATUSES) status?: ReportStatus;
  @IsOptional() @IsIn(REPORT_TYPES) type?: ReportType;
}

/** ADM-2 body */
export class AdminUpdateReportDto {
  @IsIn(HANDLED_REPORT_STATUSES)
  status: Exclude<ReportStatus, 'OPEN'>;

  @IsIn(REPORT_ACTIONS)
  action: ReportAction;

  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  resolution: string;

  @IsBoolean()
  clearReview: boolean;
}

/** ADM-3 body */
export class AdminBlockListingDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason: string;
}

/** ADM-4 body */
export class AdminAccountStatusDto {
  @IsIn(ACCOUNT_STATUSES)
  status: AccountStatus;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason: string;
}

/** ADM-5 body */
export class AdminSellerVerificationDto {
  @IsBoolean()
  verified: boolean;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** ADM-6 query */
export class AdminAccountsQuery extends AdminPageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(ACCOUNT_STATUSES) status?: AccountStatus;
  @IsOptional() @Transform(toBool) @IsBoolean() sellerOnly?: boolean;
}

/** ADM-7 query */
export class AdminListingsQuery extends AdminPageQuery {
  @IsOptional() @IsIn(LISTING_STATUSES) status?: ListingStatus;
  @IsOptional() @Transform(toBool) @IsBoolean() underReview?: boolean;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
}

/** ADM-8 query */
export class AdminReservationsQuery extends AdminPageQuery {
  @IsOptional() @IsIn(RESERVATION_STATUSES) status?: ReservationStatus;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
}

/** ADM-9 query */
export class AdminMetricsQuery {
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  @IsOptional() @IsString() @MaxLength(40) to?: string;
  @IsOptional() @IsUUID() sellerId?: string;
}
