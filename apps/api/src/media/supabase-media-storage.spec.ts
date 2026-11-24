import { Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception';
import { SupabaseMediaStorage, type FetchFn } from './supabase-media-storage';

function makeResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe('SupabaseMediaStorage', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('generates UTC year/month UUID webp keys', () => {
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_test',
      bucket: 'media',
    });

    const key = storage.newKey(new Date('2026-04-15T00:00:00Z'));
    expect(key).toMatch(/^2026\/04\/[0-9a-f-]{36}\.webp$/);
  });

  it('builds publicUrl cleanly and trims trailing slashes on supabaseUrl', () => {
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co///',
      serviceRoleKey: 'srk_test',
      bucket: 'savemeal-media',
    });

    expect(storage.publicUrl('2026/11/abc.webp')).toBe(
      'https://demo.supabase.co/storage/v1/object/public/savemeal-media/2026/11/abc.webp',
    );
  });

  it('rejects invalid keys containing path traversal', async () => {
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_test',
      bucket: 'media',
      fetchFn: fetchMock,
    });

    expect(() => storage.publicUrl('../secret.webp')).toThrow('invalid storage key');
    await expect(storage.write('/etc/passwd', Buffer.from('x'))).rejects.toThrow('invalid storage key');
    await expect(storage.remove('2026/../../secret.webp')).rejects.toThrow('invalid storage key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes an object with expected URL, headers, and Uint8Array body', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(200, '{"Key":"media/2026/11/abc.webp"}'));
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_secret',
      bucket: 'media',
      fetchFn: fetchMock,
    });

    const payload = Buffer.from([1, 2, 3, 4]);
    await storage.write('2026/11/abc.webp', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://demo.supabase.co/storage/v1/object/media/2026/11/abc.webp');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer srk_secret',
      apikey: 'srk_secret',
      'Content-Type': 'image/webp',
      'x-upsert': 'true',
    });
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(payload);
  });

  it('throws INTERNAL when write returns non-2xx', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(500, 'storage error'));
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_secret',
      bucket: 'media',
      fetchFn: fetchMock,
    });

    const err = await storage.write('2026/11/abc.webp', Buffer.from('img')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INTERNAL');
  });

  it('removes an object with DELETE and auth headers', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(200, '{"message":"Successfully deleted"}'));
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_secret',
      bucket: 'media',
      fetchFn: fetchMock,
    });

    await storage.remove('2026/11/abc.webp');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://demo.supabase.co/storage/v1/object/media/2026/11/abc.webp');
    expect(init?.method).toBe('DELETE');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer srk_secret',
      apikey: 'srk_secret',
    });
  });

  it('treats 404 on remove as idempotent success', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(404, '{"error":"not_found"}'));
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_secret',
      bucket: 'media',
      fetchFn: fetchMock,
    });

    await expect(storage.remove('2026/11/missing.webp')).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('throws INTERNAL when remove fails with non-404 error', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(503, 'service unavailable'));
    const storage = new SupabaseMediaStorage({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'srk_secret',
      bucket: 'media',
      fetchFn: fetchMock,
    });

    await expect(storage.remove('2026/11/abc.webp')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });
});
