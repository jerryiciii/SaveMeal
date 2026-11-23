import type { INestApplication } from '@nestjs/common';
import type { OtpChannel } from '@savemeal/shared';
import request from 'supertest';
import { OTP_SENDER, type OtpSender } from '../src/auth/otp-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

/** Captures OTP codes instead of logging them. */
export class CapturingOtpSender implements OtpSender {
  readonly sent: { channel: OtpChannel; identifier: string; code: string }[] = [];

  async send(channel: OtpChannel, identifier: string, code: string): Promise<void> {
    this.sent.push({ channel, identifier, code });
  }

  lastCodeFor(identifier: string): string {
    const hit = [...this.sent].reverse().find((s) => s.identifier === identifier);
    if (!hit) throw new Error(`no OTP sent to ${identifier}`);
    return hit.code;
  }
}

export async function createAuthTestApp(): Promise<{ app: INestApplication; otp: CapturingOtpSender }> {
  const otp = new CapturingOtpSender();
  const app = await createTestApp({}, (builder) => builder.overrideProvider(OTP_SENDER).useValue(otp));
  return { app, otp };
}

let seq = 0;
/** A fresh, valid VN mobile number per call (E.164). */
export function uniquePhone(): string {
  seq += 1;
  return `+849${String(Date.now() % 1_000_000).padStart(6, '0')}${String(seq % 100).padStart(2, '0')}`;
}

/** A distinct client IP per call so per-IP OTP limits do not leak between tests. */
export function uniqueIp(): string {
  seq += 1;
  return `10.${(seq >> 16) & 255}.${(seq >> 8) & 255}.${seq & 255}`;
}

export type Session = { accessToken: string; cookie: string; refreshToken: string; userId: string; isNewUser: boolean };

/** Extracts `lb_rt=<value>` from a response's Set-Cookie header. */
export function refreshCookieFrom(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('lb_rt=') && !c.startsWith('lb_rt=;'));
  if (!cookie) throw new Error('no lb_rt cookie in response');
  return cookie.split(';')[0]!;
}

/** AUTH-1 + AUTH-2 for a phone (or email) and returns the session. */
export async function login(
  app: INestApplication,
  otp: CapturingOtpSender,
  identifier: string,
  channel: OtpChannel = 'SMS',
): Promise<Session> {
  const ask = () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', uniqueIp())
      .send({ channel, identifier });
  let requested = await ask();
  if (requested.status === 429) {
    // Signing in again within the 60 s resend window: simulate the wait.
    await skipResendWindow(app);
    requested = await ask();
  }
  if (requested.status !== 200) throw new Error(`OTP request failed: ${requested.status} ${JSON.stringify(requested.body)}`);
  const verified = await request(app.getHttpServer())
    .post('/api/v1/auth/otp/verify')
    .send({ requestId: requested.body.data.requestId, code: otp.lastCodeFor(identifier) })
    .expect(200);
  const cookie = refreshCookieFrom(verified);
  return {
    accessToken: verified.body.data.accessToken,
    cookie,
    refreshToken: cookie.slice('lb_rt='.length),
    userId: verified.body.data.user.id,
    isNewUser: verified.body.data.isNewUser,
  };
}

export const bearer = (session: { accessToken: string }) => ({ Authorization: `Bearer ${session.accessToken}` });

/** Simulates waiting out the 60 s OTP resend window by ageing recent OTP rows (test DB only). */
export async function skipResendWindow(app: INestApplication): Promise<void> {
  await app.get(PrismaService).$executeRaw`
    UPDATE otp_requests SET created_at = created_at - interval '61 seconds'
     WHERE created_at > now() - interval '61 seconds'`;
}
