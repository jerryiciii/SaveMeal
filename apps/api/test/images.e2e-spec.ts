import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createAuthTestApp, login, uniquePhone, type CapturingOtpSender, type Session } from './auth-helpers';
import { DECLARATION, completeInput, jpeg, uploadImage } from './listing-helpers';

describe('Images (IMG-1, IMG-2)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  let user: Session;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
    user = await login(app, otp, uniquePhone());
  });

  afterAll(async () => {
    await app.close();
  });

  const upload = (file: Buffer, type: string, purpose: string | null = 'LISTING', name = 'x.jpg') => {
    const req = http().post('/api/v1/images').set(bearer(user));
    if (purpose) req.field('purpose', purpose);
    return req.attach('file', file, { filename: name, contentType: type });
  };

  describe('IMG-1 · POST /images', () => {
    it('201: re-encodes to webp and strips EXIF/GPS (spec §3.3, CLAUDE.md §7)', async () => {
      const withGps = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#336699' } })
        .withExif({
          IFD0: { Make: 'PhoneCam', Copyright: 'Owner' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '16/1 3/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '108/1 14/1 0/1' },
        })
        .jpeg()
        .toBuffer();
      const inputMeta = await sharp(withGps).metadata();
      expect(inputMeta.exif).toBeDefined();
      // The input really carries EXIF, including a GPS IFD (IFD3) and identifying strings.
      expect(inputMeta.exif!.includes(Buffer.from('PhoneCam'))).toBe(true);
      const gpsPointer = [Buffer.from([0x88, 0x25]), Buffer.from([0x25, 0x88])]; // tag 0x8825 = GPSInfo
      expect(gpsPointer.some((tag) => inputMeta.exif!.includes(tag))).toBe(true);

      const res = await upload(withGps, 'image/jpeg').expect(201);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        url: expect.stringMatching(/^\/api\/v1\/media\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/),
        width: 1600,
        height: 800,
      });

      const served = await http().get(res.body.data.url).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(served.headers['content-type']).toBe('image/webp');
      const out = served.body as Buffer;
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(out.includes(Buffer.from('PhoneCam'))).toBe(false);
      expect(out.includes(Buffer.from('EXIF'))).toBe(false);
    });

    it('accepts png and webp, and keeps small images at their size', async () => {
      const png = await sharp({ create: { width: 30, height: 20, channels: 4, background: '#00ff0080' } }).png().toBuffer();
      const res = await upload(png, 'image/png', 'AVATAR', 'a.png').expect(201);
      expect(res.body.data).toMatchObject({ width: 30, height: 20 });
      const webp = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).webp().toBuffer();
      await upload(webp, 'image/webp', 'REPORT', 'a.webp').expect(201);
    });

    it('415 IMAGE_TYPE_UNSUPPORTED for other types or a fake jpeg', async () => {
      const gif = await upload(Buffer.from('GIF89a....'), 'image/gif').expect(415);
      expect(gif.body.error.code).toBe('IMAGE_TYPE_UNSUPPORTED');
      const fake = await upload(Buffer.from('not really an image'), 'image/jpeg').expect(415);
      expect(fake.body.error.code).toBe('IMAGE_TYPE_UNSUPPORTED');
    });

    it('413 IMAGE_TOO_LARGE above 5 MB', async () => {
      const big = Buffer.concat([await jpeg(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
      const res = await upload(big, 'image/jpeg').expect(413);
      expect(res.body.error.code).toBe('IMAGE_TOO_LARGE');
    });

    it('400 VALIDATION_FAILED without a valid purpose or without a file', async () => {
      const noPurpose = await upload(await jpeg(), 'image/jpeg', null).expect(400);
      expect(noPurpose.body.error.details.fields).toHaveProperty('purpose');
      const badPurpose = await upload(await jpeg(), 'image/jpeg', 'BATCH').expect(400);
      expect(badPurpose.body.error.details.fields).toHaveProperty('purpose');
      const noFile = await http().post('/api/v1/images').set(bearer(user)).field('purpose', 'LISTING').expect(400);
      expect(noFile.body.error.details.fields).toHaveProperty('file');
    });

    it('401 without a token', async () => {
      await http().post('/api/v1/images').field('purpose', 'LISTING').attach('file', await jpeg(), 'x.jpg').expect(401);
    });
  });

  describe('IMG-2 · DELETE /images/{id}', () => {
    it('204 for the uploader; the file is gone', async () => {
      const id = await uploadImage(app, user);
      const row = await prisma.listingImage.findUniqueOrThrow({ where: { id } });
      await http().delete(`/api/v1/images/${id}`).set(bearer(user)).expect(204);
      expect(await prisma.listingImage.findUnique({ where: { id } })).toBeNull();
      await http().get(`/api/v1/media/${row.storageKey}`).expect(404);
    });

    it('404 IMAGE_NOT_FOUND for someone else’s image or an unknown id', async () => {
      const other = await login(app, otp, uniquePhone());
      const id = await uploadImage(app, other);
      expect((await http().delete(`/api/v1/images/${id}`).set(bearer(user)).expect(404)).body.error.code).toBe('IMAGE_NOT_FOUND');
      await http().delete('/api/v1/images/00000000-0000-4000-8000-000000000000').set(bearer(user)).expect(404);
      await http().delete('/api/v1/images/nope').set(bearer(user)).expect(404);
    });

    it('409 IMAGE_IN_USE on a published listing or a report', async () => {
      await http().patch('/api/v1/me').set(bearer(user)).send({ seller: { defaultPickup: { address: 'Đà Nẵng', lat: 16.05, lng: 108.24 } } }).expect(200);
      const id = await uploadImage(app, user);
      const draft = await http().post('/api/v1/listings').set(bearer(user)).send(completeInput([id])).expect(201);
      await http().post(`/api/v1/listings/${draft.body.data.id}/publish`).set(bearer(user)).send({ declaration: DECLARATION }).expect(200);
      expect((await http().delete(`/api/v1/images/${id}`).set(bearer(user)).expect(409)).body.error.code).toBe('IMAGE_IN_USE');

      const evidence = await uploadImage(app, user, 'REPORT');
      await prisma.report.create({
        data: { reporterId: user.userId, reportedAccountId: user.userId, type: 'OTHER', description: 'test report', imageIds: [evidence] },
      });
      await http().delete(`/api/v1/images/${evidence}`).set(bearer(user)).expect(409);
    });
  });
});
