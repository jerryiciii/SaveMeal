import {
  ALLERGENS,
  CATEGORIES,
  DECLARATION_KEYS,
  LISTING_SORTS,
  LISTING_TABS,
  LISTING_VIEWS,
  PICKUP_DAYS,
  STORAGES,
  WITHDRAW_REASONS,
  type Allergen,
  type Category,
  type DeclarationKey,
  type ListingSort,
  type ListingTab,
  type ListingView,
  type PickupDay,
  type Storage,
  type WithdrawReason,
} from '@savemeal/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PickupLocationDto } from '../common/dto/pickup-location.dto';

const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);
const TIME_WITH_OFFSET = { strict: true, strictSeparator: true };

/** ListingInput fields other than title and category, all optional. */
class ListingFieldsDto {
  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('4', { each: true })
  imageIds?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  origin?: string;

  @IsOptional()
  @IsISO8601(TIME_WITH_OFFSET)
  preparedAt?: string;

  @IsOptional()
  @IsIn(STORAGES)
  storage?: Storage;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(200)
  storageNote?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(300)
  ingredients?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(ALLERGENS, { each: true })
  allergens?: Allergen[];

  @IsOptional()
  @nullable()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  originalPrice?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantityTotal?: number;

  @IsOptional()
  @IsISO8601(TIME_WITH_OFFSET)
  pickupStart?: string;

  @IsOptional()
  @IsISO8601(TIME_WITH_OFFSET)
  pickupEnd?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PickupLocationDto)
  pickup?: PickupLocationDto;

  @IsOptional()
  @nullable()
  @IsUUID()
  bankQrImageId?: string | null;
}

/** LIST-4: any subset of ListingInput. */
export class UpdateListingDto extends ListingFieldsDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: Category;
}

/** LIST-3: a partial ListingInput where only title and category are required. */
export class CreateListingDto extends ListingFieldsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title: string;

  @IsIn(CATEGORIES)
  category: Category;
}

/** LIST-6 */
export class DeclarationDto implements Partial<Record<DeclarationKey, boolean>> {
  @IsOptional() @IsBoolean() NOT_EXPIRED?: boolean;
  @IsOptional() @IsBoolean() STORED_PROPERLY?: boolean;
  @IsOptional() @IsBoolean() NOT_SPOILED?: boolean;
  @IsOptional() @IsBoolean() NOT_SERVED_LEFTOVERS?: boolean;
  @IsOptional() @IsBoolean() INFO_DECLARED?: boolean;
  @IsOptional() @IsBoolean() PICKUP_WINDOW_OK?: boolean;
}

export class PublishListingDto {
  @IsObject()
  @ValidateNested()
  @Type(() => DeclarationDto)
  declaration: DeclarationDto;
}

export const DECLARATION_FIELDS: readonly DeclarationKey[] = DECLARATION_KEYS;

/** LIST-7 */
export class WithdrawListingDto {
  @IsIn(WITHDRAW_REASONS)
  reason: WithdrawReason;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

/** LIST-1 query. csv params are checked against their enums in the service. */
export class SearchListingsQuery {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.5) @Max(10) radiusKm?: number;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) priceMax?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() free?: boolean;
  @IsOptional() @IsIn(PICKUP_DAYS) pickupDay?: PickupDay;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'must be HH:mm' }) pickupFrom?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'must be HH:mm' }) pickupTo?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() includeSoldOut?: boolean;
  @IsOptional() @IsIn(LISTING_SORTS) sort?: ListingSort;
  @IsOptional() @IsIn(LISTING_VIEWS) view?: ListingView;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

/** LIST-8 query. */
export class MyListingsQuery {
  @IsOptional() @IsIn(LISTING_TABS) tab?: ListingTab;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
