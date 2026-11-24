import { REPORT_TYPES, type ReportType } from '@savemeal/shared';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);
const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** REP-1 request body. */
export class CreateReportDto {
  @IsIn(REPORT_TYPES)
  type: ReportType;

  @IsOptional()
  @nullable()
  @IsUUID()
  listingId?: string | null;

  @IsOptional()
  @nullable()
  @IsUUID()
  reservationId?: string | null;

  @IsOptional()
  @nullable()
  @IsUUID()
  accountId?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID(undefined, { each: true })
  imageIds?: string[];
}
