import { IsLatitude, IsLongitude, IsString, MaxLength, MinLength } from 'class-validator';

/** Contract §1 PickupLocation. */
export class PickupLocationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  address: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}
