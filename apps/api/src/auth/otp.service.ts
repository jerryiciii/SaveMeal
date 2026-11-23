import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { OtpChannel, OtpRequestResponse } from '@savemeal/shared';
import { AppException } from '../common/errors/app-exception';
import { toApiTime } from '../common/time';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthKeys } from './auth-keys';
import { decrypt, encrypt, hmacHex, randomDigits, safeEqual } from './crypto';
import { normalizeIdentifier } from './identifier';
import { OTP_SENDER, type OtpSender } from './otp-sender';

export const OTP_CODE_LENGTH = 6;
const HOUR_MS = 3600_000;
/** Contract §0 rate limits for OTP requests. */
const PER_IDENTIFIER_PER_HOUR = 5;
const PER_IP_PER_HOUR = 20;

export type VerifiedOtp = { channel: OtpChannel; identifier: string };

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly keys: AuthKeys,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  private hashIdentifier(channel: OtpChannel, identifier: string): string {
    return hmacHex(this.keys.hash, `otp-id:${channel}:${identifier}`);
  }

  private hashCode(requestId: string, code: string): string {
    return hmacHex(this.keys.hash, `otp-code:${requestId}:${code}`);
  }

  /**
   * AUTH-1. The response is identical whether or not an account exists (no enumeration).
   * Limits: 1 per OTP_RESEND_SEC and 5 per hour per identifier, 20 per hour per IP. The checks
   * and the insert run under a per-identifier advisory lock so parallel requests cannot race.
   */
  async request(channel: OtpChannel, rawIdentifier: string, ip: string | undefined): Promise<OtpRequestResponse> {
    const identifier = normalizeIdentifier(channel, rawIdentifier);
    if (!identifier) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { identifier: channel === 'SMS' ? 'must be a valid phone number' : 'must be a valid email' },
      });
    }
    const identifierHash = this.hashIdentifier(channel, identifier);
    const ipHash = ip ? hmacHex(this.keys.hash, `otp-ip:${ip}`) : null;
    const { otpTtlSec, otpResendSec } = this.config.auth;
    const code = randomDigits(OTP_CODE_LENGTH);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identifierHash}))`;
      const now = new Date();
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      const recent = await tx.otpRequest.findMany({
        where: { identifierHash, createdAt: { gt: hourAgo } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const last = recent[0];
      if (last && now.getTime() - last.createdAt.getTime() < otpResendSec * 1000) {
        throw AppException.rateLimited(otpResendSec * 1000 - (now.getTime() - last.createdAt.getTime()));
      }
      if (recent.length >= PER_IDENTIFIER_PER_HOUR) {
        throw AppException.rateLimited(recent[recent.length - 1]!.createdAt.getTime() + HOUR_MS - now.getTime());
      }
      if (ipHash) {
        const perIp = await tx.otpRequest.findMany({
          where: { ipHash, createdAt: { gt: hourAgo } },
          orderBy: { createdAt: 'asc' },
          take: PER_IP_PER_HOUR,
          select: { createdAt: true },
        });
        if (perIp.length >= PER_IP_PER_HOUR) {
          throw AppException.rateLimited(perIp[0]!.createdAt.getTime() + HOUR_MS - now.getTime());
        }
      }
      const id = randomUUID();
      return tx.otpRequest.create({
        data: {
          id,
          channel,
          identifierHash,
          identifierEnc: encrypt(this.keys.encrypt, identifier),
          ipHash,
          codeHash: this.hashCode(id, code),
          expiresAt: new Date(now.getTime() + otpTtlSec * 1000),
        },
      });
    });

    await this.sender.send(channel, identifier, code);
    return {
      requestId: row.id,
      expiresAt: toApiTime(row.expiresAt),
      resendAfterSec: otpResendSec,
      codeLength: OTP_CODE_LENGTH,
    };
  }

  /**
   * AUTH-2 code check. Wrong codes count attempts atomically; after OTP_MAX_ATTEMPTS the request
   * is locked (429). A correct code consumes the request exactly once.
   */
  async verify(requestId: string, code: string): Promise<VerifiedOtp> {
    const max = this.config.auth.otpMaxAttempts;
    const row = await this.prisma.otpRequest.findUnique({ where: { id: requestId } });
    if (!row) throw new AppException('OTP_INVALID', { attemptsLeft: 0 });
    if (row.consumedAt || row.expiresAt.getTime() <= Date.now()) throw new AppException('OTP_EXPIRED');
    if (row.attempts >= max) throw new AppException('OTP_TOO_MANY_ATTEMPTS');

    if (!safeEqual(this.hashCode(row.id, code), row.codeHash)) {
      const [bumped] = await this.prisma.$queryRaw<{ attempts: number }[]>`
        UPDATE otp_requests SET attempts = attempts + 1
         WHERE id = ${row.id}::uuid AND attempts < ${max} AND consumed_at IS NULL
        RETURNING attempts`;
      if (!bumped) throw new AppException('OTP_TOO_MANY_ATTEMPTS');
      throw new AppException('OTP_INVALID', { attemptsLeft: Math.max(0, max - bumped.attempts) });
    }

    const consumed = await this.prisma.$executeRaw`
      UPDATE otp_requests SET consumed_at = now()
       WHERE id = ${row.id}::uuid AND consumed_at IS NULL AND expires_at > now() AND attempts < ${max}`;
    if (consumed !== 1) throw new AppException('OTP_EXPIRED');
    return { channel: row.channel, identifier: decrypt(this.keys.encrypt, row.identifierEnc) };
  }
}

