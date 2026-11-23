import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { bearer, login, uniquePhone, type CapturingOtpSender, type Session } from './auth-helpers';

const HOUR = 3600_000;

export const DECLARATION = {
  NOT_EXPIRED: true,
  STORED_PROPERLY: true,
  NOT_SPOILED: true,
  NOT_SERVED_LEFTOVERS: true,
  INFO_DECLARED: true,
  PICKUP_WINDOW_OK: true,
};

export async function jpeg(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#e08040' } }).jpeg().toBuffer();
}

/** Signs up a seller whose default pickup point is `at` (isolates geo tests per suite). */
export async function seller(
  app: INestApplication,
  otp: CapturingOtpSender,
  at: { lat: number; lng: number } = { lat: 16.0478, lng: 108.2431 },
  name = 'Tiệm test',
): Promise<Session> {
  const session = await login(app, otp, uniquePhone());
  await request(app.getHttpServer())
    .patch('/api/v1/me')
    .set(bearer(session))
    .send({ displayName: 'Chủ tiệm', seller: { name, type: 'BAKERY', defaultPickup: { address: 'Đà Nẵng', ...at } } })
    .expect(200);
  return session;
}

export async function uploadImage(app: INestApplication, session: Session, purpose = 'LISTING'): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/images')
    .set(bearer(session))
    .field('purpose', purpose)
    .attach('file', await jpeg(), { filename: 'banh.jpg', contentType: 'image/jpeg' })
    .expect(201);
  return res.body.data.id as string;
}

/** A complete ListingInput (spec §7.3 demo values) with a window starting in 30 min. */
export function completeInput(imageIds: string[], overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    title: '5 phần bánh còn nguyên',
    category: 'BAKERY',
    description: 'Bánh làm trong ngày',
    imageIds,
    origin: 'Làm tại tiệm sáng nay',
    preparedAt: new Date(now - 3 * HOUR).toISOString(),
    storage: 'ROOM_TEMP',
    originalPrice: 25000,
    price: 15000,
    quantityTotal: 5,
    pickupStart: new Date(now + 0.5 * HOUR).toISOString(),
    pickupEnd: new Date(now + 1.5 * HOUR).toISOString(),
    ...overrides,
  };
}

export async function draft(app: INestApplication, session: Session, overrides: Record<string, unknown> = {}) {
  const image = await uploadImage(app, session);
  const res = await request(app.getHttpServer())
    .post('/api/v1/listings')
    .set(bearer(session))
    .send(completeInput([image], overrides))
    .expect(201);
  return res.body.data as { id: string; [k: string]: unknown };
}

export async function published(app: INestApplication, session: Session, overrides: Record<string, unknown> = {}) {
  const d = await draft(app, session, overrides);
  const res = await request(app.getHttpServer())
    .post(`/api/v1/listings/${d.id}/publish`)
    .set(bearer(session))
    .send({ declaration: DECLARATION })
    .expect(200);
  return res.body.data as { id: string; [k: string]: unknown };
}
