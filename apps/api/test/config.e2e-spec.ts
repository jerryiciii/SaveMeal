import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';

describe('SYS-2 · GET /api/v1/config', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 with the contract shape and DOMAIN §11 defaults (public, no token)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/config').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^req_/);
    expect(res.body).toEqual({
      data: {
        features: { payments: false, googleLogin: false },
        enums: {
          categories: ['BAKERY', 'MEAL', 'DRINK', 'PACKAGED', 'OTHER'],
          storage: ['ROOM_TEMP', 'CHILLED', 'FROZEN'],
          allergens: ['GLUTEN', 'MILK', 'EGG', 'PEANUT', 'TREE_NUT', 'SOY', 'FISH', 'SHELLFISH', 'SESAME'],
          sellerTypes: ['INDIVIDUAL', 'SHOP', 'CAFE', 'BAKERY', 'CANTEEN'],
          reportTypes: ['WRONG_INFO', 'UNSAFE_FOOD', 'NOT_RECEIVED', 'SELLER_ABSENT', 'OTHER'],
          cancelReasons: ['BUYER_LATE', 'BUYER_WRONG_QTY', 'BUYER_CHANGED_PLAN', 'BUYER_OTHER'],
        },
        limits: {
          maxQtyPerReservation: 2,
          maxActiveReservations: 3,
          radiusKmOptions: [1, 3, 5],
          maxRadiusKm: 10,
          maxImagesPerListing: 4,
          maxWindowHours: 4,
          pickupTokenTtlMin: 10,
          earlyPickupMin: 30,
          minPaymentHoldMin: 5,
          defaultPaymentHoldMin: 10,
        },
        fees: {
          percent: 5,
          thresholdVnd: 20000,
          flatVnd: 2000,
          paidBy: 'BUYER',
        },
        defaultCenter: { lat: 16.0544, lng: 108.2022, label: 'Đà Nẵng' },
        popularSearches: ['Bánh mì', 'Bánh ngọt', 'Cơm trưa', 'Món miễn phí'],
        map: { styleUrl: expect.stringMatching(/^https:\/\//), attribution: '© OpenStreetMap contributors' },
      },
    });
  });

  it('never exposes Later-only features as on', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/config').expect(200);
    expect(res.body.data.features).toEqual({ payments: false, googleLogin: false });
  });
});

describe('SYS-2 with flags and limits overridden by env', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    process.env.MAX_QTY_PER_RESERVATION = '3';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('reflects the configured values', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/config').expect(200);
    expect(res.body.data.features.payments).toBe(true);
    expect(res.body.data.limits.maxQtyPerReservation).toBe(3);
  });
});
