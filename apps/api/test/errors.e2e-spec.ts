import { Body, Controller, Get, HttpCode, Post, Query, type INestApplication } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import request from 'supertest';
import { AppException } from '../src/common/errors/app-exception';
import { createTestApp } from './app';

class ItemDto {
  @IsInt()
  @Min(1)
  qty: number;
}

class ProbeBodyDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items?: ItemDto[];
}

class ProbeQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number;
}

/** Test-only routes that exercise the global pipes, filter and middleware. */
@Controller('__probe')
class ProbeController {
  @Post('body')
  @HttpCode(200)
  body(@Body() dto: ProbeBodyDto) {
    return { data: dto };
  }

  @Get('query')
  query(@Query() dto: ProbeQueryDto) {
    return { data: { limit: dto.limit, type: typeof dto.limit } };
  }

  @Get('app-error')
  appError() {
    throw new AppException('FEATURE_DISABLED', { feature: 'payments' });
  }

  @Get('crash')
  crash() {
    throw new Error('secret internal detail');
  }
}

describe('error envelope, request id and validation (contract §0)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('X-Request-Id', () => {
    it('is set on success and error responses and matches error.requestId', async () => {
      const ok = await request(server()).get('/api/v1/health');
      expect(ok.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
      const err = await request(server()).get('/api/v1/nope').expect(404);
      expect(err.body.error.requestId).toBe(err.headers['x-request-id']);
    });

    it('reuses a well-formed incoming id and replaces a malformed one', async () => {
      const reused = await request(server()).get('/api/v1/health').set('X-Request-Id', 'proxy-123456789');
      expect(reused.headers['x-request-id']).toBe('proxy-123456789');
      const replaced = await request(server()).get('/api/v1/health').set('X-Request-Id', 'bad id <script>');
      expect(replaced.headers['x-request-id']).toMatch(/^req_/);
    });

    it('is unique per request', async () => {
      const a = await request(server()).get('/api/v1/health');
      const b = await request(server()).get('/api/v1/health');
      expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    });
  });

  describe('VALIDATION_FAILED', () => {
    it('400 with details.fields keyed by path', async () => {
      const res = await request(server())
        .post('/api/v1/__probe/body')
        .send({ title: 'ab', items: [{ qty: 1 }, { qty: 0 }] })
        .expect(400);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: expect.any(Object) } });
      expect(Object.keys(res.body.error.details.fields).sort()).toEqual(['items.1.qty', 'title']);
    });

    it('rejects unknown fields', async () => {
      const res = await request(server()).post('/api/v1/__probe/body').send({ title: 'abc', admin: true }).expect(400);
      expect(res.body.error.details.fields).toHaveProperty('admin');
    });

    it('validates and transforms query parameters', async () => {
      const ok = await request(server()).get('/api/v1/__probe/query?limit=20').expect(200);
      expect(ok.body.data).toEqual({ limit: 20, type: 'number' });
      const bad = await request(server()).get('/api/v1/__probe/query?limit=51').expect(400);
      expect(bad.body.error.details.fields).toHaveProperty('limit');
    });

    it('turns malformed JSON into the envelope instead of an HTML error', async () => {
      const res = await request(server())
        .post('/api/v1/__probe/body')
        .set('Content-Type', 'application/json')
        .send('{"title": ')
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { body: 'malformed JSON' } },
        requestId: res.headers['x-request-id'],
      });
    });

    it('rejects an oversized JSON body', async () => {
      const res = await request(server())
        .post('/api/v1/__probe/body')
        .send({ title: 'x'.repeat(200 * 1024) })
        .expect(400);
      expect(res.body.error.details.fields).toEqual({ body: 'too large' });
    });
  });

  it('AppException → catalogue status, code, Vietnamese message and details', async () => {
    const res = await request(server()).get('/api/v1/__probe/app-error').expect(403);
    expect(res.body).toEqual({
      error: {
        code: 'FEATURE_DISABLED',
        message: 'Tính năng này hiện chưa được bật.',
        details: { feature: 'payments' },
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('unknown route → 404 NOT_FOUND envelope', async () => {
    const res = await request(server()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), requestId: res.headers['x-request-id'] },
    });
  });

  it('unexpected error → 500 INTERNAL without stack or internal message', async () => {
    const res = await request(server()).get('/api/v1/__probe/crash').expect(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toMatch(/secret internal detail|at .*\.ts|stack/);
  });

  it('does not advertise the framework', async () => {
    const res = await request(server()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
