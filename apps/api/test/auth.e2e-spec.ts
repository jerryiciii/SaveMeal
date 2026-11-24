import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthKeys } from '../src/auth/auth-keys';
import { signJwt } from '../src/auth/crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  bearer,
  createAuthTestApp,
  login,
  refreshCookieFrom,
  skipResendWindow,
  uniqueIp,
  uniquePhone,
  type CapturingOtpSender,
} from './auth-helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/;

describe('Auth (AUTH-1..4) and the auth guard', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  const requestOtp = (identifier: string, channel = 'SMS', ip = uniqueIp()) =>
    http().post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ channel, identifier });

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('AUTH-1 · POST /auth/otp/request', () => {
    it('200 with the contract shape and sends a 6-digit code to the normalised phone', async () => {
      const phone = uniquePhone();
      const local = `0${phone.slice(3)}`; // "09…" form
      const res = await requestOtp(local).expect(200);
      expect(res.body).toEqual({
        data: {
          requestId: expect.stringMatching(UUID),
          expiresAt: expect.stringMatching(API_TIME),
          resendAfterSec: 60,
          codeLength: 6,
        },
      });
      expect(otp.lastCodeFor(phone)).toMatch(/^\d{6}$/);
    });

    it('looks the same whether or not the account exists (no enumeration)', async () => {
      const existing = uniquePhone();
      await login(app, otp, existing);
      await skipResendWindow(app);
      const a = await requestOtp(existing).expect(200);
      const b = await requestOtp(uniquePhone()).expect(200);
      expect(Object.keys(a.body.data)).toEqual(Object.keys(b.body.data));
      expect(a.body.data.resendAfterSec).toBe(b.body.data.resendAfterSec);
    });

    it('stores neither the identifier nor the code in clear', async () => {
      const phone = uniquePhone();
      const res = await requestOtp(phone).expect(200);
      const row = await prisma.otpRequest.findUniqueOrThrow({ where: { id: res.body.data.requestId } });
      const raw = JSON.stringify(row);
      expect(raw).not.toContain(phone.slice(1));
      expect(raw).not.toContain(otp.lastCodeFor(phone));
    });

    it.each([
      [{ channel: 'SMS', identifier: '12345' }, 'identifier'],
      [{ channel: 'EMAIL', identifier: 'not-an-email' }, 'identifier'],
      [{ channel: 'FAX', identifier: '0901234567' }, 'channel'],
      [{ channel: 'SMS' }, 'identifier'],
    ])('400 VALIDATION_FAILED for %p', async (body, field) => {
      const res = await http().post('/api/v1/auth/otp/request').send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toHaveProperty(field);
    });

    it('429 RATE_LIMITED with Retry-After on a resend within 60 s', async () => {
      const phone = uniquePhone();
      await requestOtp(phone).expect(200);
      const res = await requestOtp(phone).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    });

    it('429 after 5 requests per hour per identifier', async () => {
      const phone = uniquePhone();
      for (let i = 0; i < 5; i++) {
        const res = await requestOtp(phone).expect(200);
        // Age the request past the resend window without leaving the hour.
        await prisma.otpRequest.update({
          where: { id: res.body.data.requestId },
          data: { createdAt: new Date(Date.now() - (10 - i) * 60_000) },
        });
      }
      const res = await requestOtp(phone).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });

    it('429 after 20 requests per hour from one IP', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 20; i++) await requestOtp(uniquePhone(), 'SMS', ip).expect(200);
      const res = await requestOtp(uniquePhone(), 'SMS', ip).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      await requestOtp(uniquePhone(), 'SMS', uniqueIp()).expect(200);
    });
  });

  describe('AUTH-2 · POST /auth/otp/verify', () => {
    it('creates the account on first verify and sets the refresh cookie', async () => {
      const phone = uniquePhone();
      const requested = await requestOtp(phone).expect(200);
      const res = await http()
        .post('/api/v1/auth/otp/verify')
        .send({ requestId: requested.body.data.requestId, code: otp.lastCodeFor(phone) })
        .expect(200);
      expect(res.body.data).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        accessTokenExpiresAt: expect.stringMatching(API_TIME),
        isNewUser: true,
        user: {
          id: expect.stringMatching(UUID),
          displayName: null,
          phone,
          email: null,
          avatar: null,
          role: 'USER',
          status: 'ACTIVE',
          seller: { name: null, type: null, verified: false, defaultPickup: null, bankQrImage: null },
          stats: { portionsHandedOver: 0, reservationsActive: 0, listingsActive: 0 },
          createdAt: expect.stringMatching(API_TIME),
        },
      });
      const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('lb_rt='))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      const expiresIn = new Date(res.body.data.accessTokenExpiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(14 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(15 * 60_000);
    });

    it('signs in an existing account with isNewUser false, also by email', async () => {
      const phone = uniquePhone();
      const first = await login(app, otp, phone);
      const second = await login(app, otp, phone);
      expect(second).toMatchObject({ isNewUser: false, userId: first.userId });

      const email = `buyer${Date.now()}@example.vn`;
      const viaEmail = await login(app, otp, email, 'EMAIL');
      expect(viaEmail.isNewUser).toBe(true);
      const me = await http().get('/api/v1/me').set(bearer(viaEmail)).expect(200);
      expect(me.body.data).toMatchObject({ email, phone: null });
    });

    it('400 OTP_INVALID counts down attemptsLeft, then 429 OTP_TOO_MANY_ATTEMPTS even for the right code', async () => {
      const phone = uniquePhone();
      const { body } = await requestOtp(phone).expect(200);
      const code = otp.lastCodeFor(phone);
      const wrong = code === '000000' ? '111111' : '000000';
      for (const left of [4, 3, 2, 1, 0]) {
        const res = await http()
          .post('/api/v1/auth/otp/verify')
          .send({ requestId: body.data.requestId, code: wrong })
          .expect(400);
        expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: left } });
      }
      const locked = await http().post('/api/v1/auth/otp/verify').send({ requestId: body.data.requestId, code }).expect(429);
      expect(locked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    });

    it('400 OTP_EXPIRED for an expired or already used code', async () => {
      const phone = uniquePhone();
      const { body } = await requestOtp(phone).expect(200);
      const code = otp.lastCodeFor(phone);
      await http().post('/api/v1/auth/otp/verify').send({ requestId: body.data.requestId, code }).expect(200);
      const reused = await http().post('/api/v1/auth/otp/verify').send({ requestId: body.data.requestId, code }).expect(400);
      expect(reused.body.error.code).toBe('OTP_EXPIRED');

      const phone2 = uniquePhone();
      const second = await requestOtp(phone2).expect(200);
      await prisma.otpRequest.update({ where: { id: second.body.data.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await http()
        .post('/api/v1/auth/otp/verify')
        .send({ requestId: second.body.data.requestId, code: otp.lastCodeFor(phone2) })
        .expect(400);
      expect(expired.body.error.code).toBe('OTP_EXPIRED');
    });

    it('400 OTP_INVALID for an unknown request and VALIDATION_FAILED for a malformed body', async () => {
      const unknown = await http()
        .post('/api/v1/auth/otp/verify')
        .send({ requestId: '5f0c6a2e-8f43-4b8e-9a51-0c4b6f1a2d3e', code: '123456' })
        .expect(400);
      expect(unknown.body.error.code).toBe('OTP_INVALID');
      const bad = await http().post('/api/v1/auth/otp/verify').send({ requestId: 'x', code: '12' }).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(bad.body.error.details.fields).sort()).toEqual(['code', 'requestId']);
    });

    it('403 ACCOUNT_SUSPENDED for a suspended account', async () => {
      const phone = uniquePhone();
      const session = await login(app, otp, phone);
      await prisma.account.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });
      await skipResendWindow(app);
      const { body } = await requestOtp(phone).expect(200);
      const res = await http()
        .post('/api/v1/auth/otp/verify')
        .send({ requestId: body.data.requestId, code: otp.lastCodeFor(phone) })
        .expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('AUTH-3 · POST /auth/refresh', () => {
    it('rotates the token: a new access token and a new cookie', async () => {
      const session = await login(app, otp, uniquePhone());
      const res = await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
      expect(res.body.data).toEqual({
        accessToken: expect.any(String),
        accessTokenExpiresAt: expect.stringMatching(API_TIME),
      });
      const rotated = refreshCookieFrom(res);
      expect(rotated).not.toBe(session.cookie);
      await http().get('/api/v1/me').set('Authorization', `Bearer ${res.body.data.accessToken}`).expect(200);
      await http().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(200);
    });

    it('reusing a rotated token revokes the whole family, but not other sessions', async () => {
      const phone = uniquePhone();
      const session = await login(app, otp, phone);
      const other = await login(app, otp, phone);
      const rotated = refreshCookieFrom(
        await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(200),
      );
      const reuse = await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      expect(reuse.body.error.code).toBe('REFRESH_INVALID');
      const victim = await http().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
      expect(victim.body.error.code).toBe('REFRESH_INVALID');
      await http().post('/api/v1/auth/refresh').set('Cookie', other.cookie).expect(200);
    });

    it('401 REFRESH_INVALID without a cookie, with an unknown one, or when expired', async () => {
      expect((await http().post('/api/v1/auth/refresh').expect(401)).body.error.code).toBe('REFRESH_INVALID');
      await http().post('/api/v1/auth/refresh').set('Cookie', 'lb_rt=garbage').expect(401);
      const session = await login(app, otp, uniquePhone());
      await prisma.refreshToken.updateMany({ where: { accountId: session.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
    });

    it('403 ACCOUNT_SUSPENDED for a suspended account', async () => {
      const session = await login(app, otp, uniquePhone());
      await prisma.account.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });
      const res = await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('only one of two concurrent rotations of the same token succeeds', async () => {
      const session = await login(app, otp, uniquePhone());
      const results = await Promise.all(
        [0, 1, 2, 3].map(() => http().post('/api/v1/auth/refresh').set('Cookie', session.cookie)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(3);
    });
  });

  describe('AUTH-4 · POST /auth/logout', () => {
    it('204, revokes the family, clears the cookie and is idempotent', async () => {
      const session = await login(app, otp, uniquePhone());
      const res = await http().post('/api/v1/auth/logout').set('Cookie', session.cookie).send({}).expect(204);
      const cleared = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('lb_rt='))!;
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
      await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      await http().post('/api/v1/auth/logout').set('Cookie', session.cookie).send({}).expect(204);
      await http().post('/api/v1/auth/logout').send({}).expect(204);
    });

    it('allDevices revokes every session of the account and needs a Bearer token', async () => {
      const phone = uniquePhone();
      const a = await login(app, otp, phone);
      const b = await login(app, otp, phone);
      const anon = await http().post('/api/v1/auth/logout').send({ allDevices: true }).expect(401);
      expect(anon.body.error.code).toBe('UNAUTHENTICATED');
      await http().post('/api/v1/auth/logout').set(bearer(a)).send({ allDevices: true }).expect(204);
      await http().post('/api/v1/auth/refresh').set('Cookie', a.cookie).expect(401);
      await http().post('/api/v1/auth/refresh').set('Cookie', b.cookie).expect(401);
    });

    it('is allowed for a suspended account', async () => {
      const session = await login(app, otp, uniquePhone());
      await prisma.account.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });
      await http().post('/api/v1/auth/logout').set(bearer(session)).set('Cookie', session.cookie).send({}).expect(204);
    });
  });

  describe('auth guard', () => {
    it('401 UNAUTHENTICATED without a token or with a bad one', async () => {
      expect((await http().get('/api/v1/me').expect(401)).body.error.code).toBe('UNAUTHENTICATED');
      await http().get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
      await http().get('/api/v1/me').set('Authorization', 'Basic abc').expect(401);
    });

    it('401 TOKEN_EXPIRED for an expired access token', async () => {
      const session = await login(app, otp, uniquePhone());
      const now = Math.floor(Date.now() / 1000);
      const expired = signJwt(app.get(AuthKeys).jwt, { sub: session.userId, role: 'USER', sid: 'x', iat: now - 1000, exp: now - 1 });
      const res = await http().get('/api/v1/me').set('Authorization', `Bearer ${expired}`).expect(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('a SUSPENDED account may read ME-1 but gets 403 ACCOUNT_SUSPENDED elsewhere', async () => {
      const session = await login(app, otp, uniquePhone());
      await prisma.account.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });
      const me = await http().get('/api/v1/me').set(bearer(session)).expect(200);
      expect(me.body.data.status).toBe('SUSPENDED');
      const patch = await http().patch('/api/v1/me').set(bearer(session)).send({ displayName: 'Minh' }).expect(403);
      expect(patch.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('public routes ignore invalid tokens', async () => {
      await http().get('/api/v1/config').set('Authorization', 'Bearer garbage').expect(200);
    });
  });
});
