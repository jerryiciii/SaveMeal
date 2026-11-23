import { SELLER_TYPES, type SellerType } from '@savemeal/shared';
import { Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PickupLocationDto } from '../common/dto/pickup-location.dto';

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
}

/** ME-3 */
export class DeleteMeDto {
  @Equals('XOA TAI KHOAN', { message: 'confirm must be exactly "XOA TAI KHOAN"' })
  confirm: string;
}
