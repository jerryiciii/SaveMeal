import { SELLER_TYPES, type SellerType } from '@savemeal/shared';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PickupLocationDto } from '../common/dto/pickup-location.dto';

export class UpdateNearbyAlertsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number | null;

  @IsOptional()
  @IsInt()
  @IsIn([1, 3, 5])
  radiusKm?: number;
}

export class UpdateSellerDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  name?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(SELLER_TYPES)
  type?: SellerType | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @ValidateNested()
  @Type(() => PickupLocationDto)
  defaultPickup?: PickupLocationDto | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  bankQrImageId?: string | null;
}

/** ME-2 */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  displayName?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  avatarImageId?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateSellerDto)
  seller?: UpdateSellerDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateNearbyAlertsDto)
  nearbyAlerts?: UpdateNearbyAlertsDto;
}

/** ME-3 */
export class DeleteMeDto {
  @Equals('XOA TAI KHOAN', { message: 'confirm must be exactly "XOA TAI KHOAN"' })
  confirm: string;
}
