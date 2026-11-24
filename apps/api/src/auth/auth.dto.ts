import { OTP_CHANNELS, type OtpChannel } from '@savemeal/shared';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** AUTH-1 */
export class OtpRequestDto {
  @IsIn(OTP_CHANNELS)
  channel: OtpChannel;

  @IsString()
  @MaxLength(254)
  identifier: string;
}

/** AUTH-2 */
export class OtpVerifyDto {
  @IsUUID()
  requestId: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

/** AUTH-4 */
export class LogoutDto {
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
