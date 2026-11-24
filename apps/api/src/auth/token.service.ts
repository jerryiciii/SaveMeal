import { Injectable } from '@nestjs/common';
import type { Account } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppException } from '../common/errors/app-exception';
import { toApiTime } from '../common/time';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthKeys } from './auth-keys';
import { hmacHex, randomToken, signJwt, verifyJwt, type JwtClaims } from './crypto';

export type AccessToken = { accessToken: string; accessTokenExpiresAt: string };
export type IssuedSession = AccessToken & { refreshToken: string; refreshExpiresAt: Date };

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly keys: AuthKeys,
  ) {}

  private hashRefresh(token: string): string {
    return hmacHex(this.keys.hash, `refresh:${token}`);
  }

  /** 15-minute HS256 access token with claims sub, role and sid (the refresh family). */
  signAccess(account: Pick<Account, 'id' | 'role'>, familyId: string): AccessToken {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.config.auth.accessTokenTtlSec;
    return {
      accessToken: signJwt(this.keys.jwt, { sub: account.id, role: account.role, sid: familyId, iat, exp }),
      accessTokenExpiresAt: toApiTime(new Date(exp * 1000)),
    };
  }

  verifyAccess(token: string): { ok: true; claims: JwtClaims } | { ok: false; reason: 'invalid' | 'expired' } {
    return verifyJwt(this.keys.jwt, token);
  }

  /** Starts a new refresh family (login). */
  async issueSession(account: Pick<Account, 'id' | 'role'>, userAgent?: string): Promise<IssuedSession> {
    const familyId = randomUUID();
    const refresh = await this.createRefresh(account.id, familyId, userAgent);
    return { ...this.signAccess(account, familyId), ...refresh };
  }

  private async createRefresh(accountId: string, familyId: string, userAgent?: string) {
    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(Date.now() + this.config.auth.refreshTokenTtlSec * 1000);
    await this.prisma.refreshToken.create({
      data: {
        accountId,
        familyId,
        tokenHash: this.hashRefresh(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: userAgent?.slice(0, 255),
      },
    });
    return { refreshToken, refreshExpiresAt };
  }

  /**
   * AUTH-3. Rotates the refresh token. Presenting an already-rotated (revoked) token is treated
   * as theft: the whole family is revoked (contract §0).
   */
  async rotate(presented: string | undefined, userAgent?: string): Promise<IssuedSession> {
    if (!presented) throw new AppException('REFRESH_INVALID');
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefresh(presented) },
      include: { account: { select: { id: true, role: true, status: true } } },
    });
    if (!row) throw new AppException('REFRESH_INVALID');
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new AppException('REFRESH_INVALID');
    }
    if (row.expiresAt.getTime() <= Date.now() || row.account.status === 'DELETED') {
      throw new AppException('REFRESH_INVALID');
    }
    if (row.account.status === 'SUSPENDED') throw new AppException('ACCOUNT_SUSPENDED');

    // Conditional update: of two concurrent rotations of the same token, only one wins.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) throw new AppException('REFRESH_INVALID');

    const refresh = await this.createRefresh(row.accountId, row.familyId, userAgent);
    return { ...this.signAccess(row.account, row.familyId), ...refresh };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAll(accountId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** AUTH-4: revokes the family of the presented refresh token, if it is known. */
  async revokeByToken(presented: string | undefined): Promise<void> {
    if (!presented) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashRefresh(presented) } });
    if (row) await this.revokeFamily(row.familyId);
  }
}
