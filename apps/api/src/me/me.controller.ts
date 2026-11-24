import { Body, Controller, Delete, Get, HttpCode, Patch, Res } from '@nestjs/common';
import type { Me } from '@savemeal/shared';
import type { Response } from 'express';
import { AllowSuspended, CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { clearRefreshCookie } from '../auth/cookies';
import { DeleteMeDto, UpdateMeDto } from './me.dto';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** ME-1 · GET /me (USER; also allowed while SUSPENDED, contract §0). */
  @Get()
  @AllowSuspended()
  async get(@CurrentAccount() account: AuthAccount): Promise<{ data: Me }> {
    return { data: await this.me.getMe(account.id) };
  }

  /** ME-2 · PATCH /me */
  @Patch()
  async update(@CurrentAccount() account: AuthAccount, @Body() body: UpdateMeDto): Promise<{ data: Me }> {
    return { data: await this.me.update(account.id, body) };
  }

  /** ME-3 · DELETE /me */
  @Delete()
  @HttpCode(204)
  async remove(
    @CurrentAccount() account: AuthAccount,
    @Body() _body: DeleteMeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.me.delete(account.id);
    clearRefreshCookie(res);
  }
}
