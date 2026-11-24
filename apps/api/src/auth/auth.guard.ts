import { createParamDecorator, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Account } from '@prisma/client';
import type { Request } from 'express';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

/** The signed-in account, loaded fresh from the database on every request. */
export type AuthAccount = Pick<Account, 'id' | 'role' | 'status' | 'displayName'> & { familyId: string };

type AuthedRequest = Request & { account?: AuthAccount };

const PUBLIC = 'auth:public';
const ALLOW_SUSPENDED = 'auth:allowSuspended';
const ADMIN_ONLY = 'auth:admin';

/** PUBLIC: no token needed; a valid token is still read and enriches the response. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Contract §0: a SUSPENDED account may still call AUTH-4 and ME-1. */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED, true);
/** role = ADMIN. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

/** The current account (required on protected routes, possibly undefined on public ones). */
export const CurrentAccount = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().account,
);

/**
 * Global guard. Every route needs a valid Bearer access token from an ACTIVE account unless it is
 * marked @Public(). Errors: 401 UNAUTHENTICATED / TOKEN_EXPIRED, 403 ACCOUNT_SUSPENDED / FORBIDDEN.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = (key: string) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) === true;
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = flag(PUBLIC);

    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!bearer) {
      if (isPublic) return true;
      throw new AppException('UNAUTHENTICATED');
    }

    const verified = this.tokens.verifyAccess(bearer);
    if (!verified.ok) {
      if (isPublic) return true; // A bad token on a public route is ignored, not an error.
      throw new AppException(verified.reason === 'expired' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: verified.claims.sub },
      select: { id: true, role: true, status: true, displayName: true },
    });
    if (!account || account.status === 'DELETED') {
      if (isPublic) return true;
      throw new AppException('UNAUTHENTICATED');
    }
    request.account = { ...account, familyId: verified.claims.sid };
    if (isPublic) return true;

    if (account.status === 'SUSPENDED' && !flag(ALLOW_SUSPENDED)) throw new AppException('ACCOUNT_SUSPENDED');
    if (flag(ADMIN_ONLY) && account.role !== 'ADMIN') throw new AppException('FORBIDDEN');
    return true;
  }
}
