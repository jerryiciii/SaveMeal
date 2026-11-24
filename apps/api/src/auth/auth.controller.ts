import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { AuthSessionResponse, OtpRequestResponse, RefreshResponse } from '@savemeal/shared';
import type { Request, Response } from 'express';
import { AppException } from '../common/errors/app-exception';
import { AllowSuspended, CurrentAccount, Public, type AuthAccount } from './auth.guard';
import { LogoutDto, OtpRequestDto, OtpVerifyDto } from './auth.dto';
import { AuthService } from './auth.service';
import { clearRefreshCookie, readCookie, REFRESH_COOKIE, setRefreshCookie } from './cookies';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  /** AUTH-1 · POST /auth/otp/request (PUBLIC) */
  @Post('otp/request')
  @Public()
  @HttpCode(200)
  async requestOtp(@Body() body: OtpRequestDto, @Req() req: Request): Promise<{ data: OtpRequestResponse }> {
    return { data: await this.otp.request(body.channel, body.identifier, req.ip) };
  }

  /** AUTH-2 · POST /auth/otp/verify (PUBLIC): sets the lb_rt refresh cookie. */
  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: AuthSessionResponse }> {
    const { body: data, session } = await this.auth.verifyOtp(body.requestId, body.code, req.get('user-agent'));
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    return { data };
  }

  /** AUTH-3 · POST /auth/refresh (cookie lb_rt): rotates the refresh cookie. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ data: RefreshResponse }> {
    try {
      const session = await this.tokens.rotate(readCookie(req, REFRESH_COOKIE), req.get('user-agent'));
      setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
      return { data: { accessToken: session.accessToken, accessTokenExpiresAt: session.accessTokenExpiresAt } };
    } catch (error) {
      if (error instanceof AppException && error.code === 'REFRESH_INVALID') clearRefreshCookie(res);
      throw error;
    }
  }

  /** AUTH-4 · POST /auth/logout: revokes the cookie's family (or every session) and clears it. */
  @Post('logout')
  @Public()
  @AllowSuspended()
  @HttpCode(204)
  async logout(
    @Body() body: LogoutDto,
    @CurrentAccount() account: AuthAccount | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (body.allDevices) {
      if (!account) throw new AppException('UNAUTHENTICATED');
      await this.tokens.revokeAll(account.id);
    } else {
      await this.tokens.revokeByToken(readCookie(req, REFRESH_COOKIE));
    }
    clearRefreshCookie(res);
  }
}
