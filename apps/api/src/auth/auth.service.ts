import { Injectable } from '@nestjs/common';
import { Prisma, type Account } from '@prisma/client';
import type { AuthSessionResponse } from '@savemeal/shared';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { MeService } from '../me/me.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { TokenService, type IssuedSession } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly me: MeService,
  ) {}

  /**
   * AUTH-2. Verifies the code, then signs in to the account for that phone/email, creating it on
   * the first verify (isNewUser). Suspended accounts are refused after the code check.
   */
  async verifyOtp(
    requestId: string,
    code: string,
    userAgent?: string,
  ): Promise<{ body: AuthSessionResponse; session: IssuedSession }> {
    const { channel, identifier } = await this.otp.verify(requestId, code);
    const where: Prisma.AccountWhereUniqueInput = channel === 'SMS' ? { phone: identifier } : { email: identifier };

    let account = await this.prisma.account.findUnique({ where });
    let isNewUser = false;
    if (!account) {
      try {
        account = await this.prisma.$transaction(async (tx) => {
          const created = await tx.account.create({ data: channel === 'SMS' ? { phone: identifier } : { email: identifier } });
          await logEvent(tx, {
            actorId: created.id,
            actorType: 'USER',
            event: 'ACCOUNT_CREATED',
            entityType: 'account',
            entityId: created.id,
            data: { channel },
          });
          return created;
        });
        isNewUser = true;
      } catch (error) {
        // A parallel verify for the same identifier created it first.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        account = (await this.prisma.account.findUnique({ where })) as Account;
      }
    }
    if (account.status === 'SUSPENDED') throw new AppException('ACCOUNT_SUSPENDED');

    const session = await this.tokens.issueSession(account, userAgent);
    const user = await this.me.getMe(account.id);
    return {
      body: {
        accessToken: session.accessToken,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        isNewUser,
        user,
      },
      session,
    };
  }
}
