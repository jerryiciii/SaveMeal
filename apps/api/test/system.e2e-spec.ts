import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';

const REQUEST_ID = /^req_[0-9a-f]{32}$/;

describe('SYS-1 · GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 with status, db and version (public, no token)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok', db: 'ok', version: '1.3.0' } });
    expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8/);
    expect(res.headers['x-request-id']).toMatch(REQUEST_ID);
  });

  it('really queries PostgreSQL', async () => {
    const prisma = app.get(PrismaService);
    const [row] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    expect(row?.version).toMatch(/^PostgreSQL 16\./);
  });

  it('accepts a token-less call even when an Authorization header is garbage', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').set('Authorization', 'Bearer nope').expect(200);
  });

  it('is only served under the /api/v1 prefix', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('SYS-1 when the database is down', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({}, (builder) =>
      builder.overrideProvider(PrismaService).useValue({
        ping: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
        $disconnect: () => Promise.resolve(),
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('500 INTERNAL in the error envelope, without leaking the cause', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL', message: expect.any(String), requestId: res.headers['x-request-id'] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|5432|stack/i);
  });
});
