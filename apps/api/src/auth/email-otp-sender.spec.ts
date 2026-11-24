import { Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception';
import { BrevoOtpSender, ResendOtpSender, type FetchFn } from './email-otp-sender';

function makeResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe('ResendOtpSender', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('sends an email OTP with the expected endpoint, headers, and Vietnamese payload', async () => {
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(makeResponse(200, '{"id":"msg_1"}'));
    const sender = new ResendOtpSender({
      apiKey: 're_test_key',
      from: 'SaveMeal <no-reply@savemeal.vn>',
      fetchFn: fetchMock,
    });

    await sender.send('EMAIL', 'buyer@example.com', '482910');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    });

    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload.from).toBe('SaveMeal <no-reply@savemeal.vn>');
    expect(payload.to).toEqual(['buyer@example.com']);
    expect(payload.subject).toBe('Mã xác minh SaveMeal: 482910');
    expect(payload.text).toEqual(expect.stringContaining('482910'));
    expect(payload.text).toEqual(expect.stringContaining('5 phút'));
    expect(payload.html).toEqual(expect.stringContaining('482910'));
    expect(payload.html).toEqual(expect.stringContaining('5 phút'));
  });

  it('rejects SMS channel with FEATURE_DISABLED without calling fetch', async () => {
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
    const sender = new ResendOtpSender({
      apiKey: 're_test_key',
      from: 'SaveMeal <no-reply@savemeal.vn>',
      fetchFn: fetchMock,
    });

    await expect(sender.send('SMS', '+84901234567', '482910')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws INTERNAL on provider 5xx and never logs the OTP code or full email', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(502, 'upstream gateway error'));
    const sender = new ResendOtpSender({
      apiKey: 're_test_key',
      from: 'SaveMeal <no-reply@savemeal.vn>',
      fetchFn: fetchMock,
    });

    const err = await sender.send('EMAIL', 'secret.buyer@example.com', '918273').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INTERNAL');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('502');
    expect(logged).not.toContain('918273');
    expect(logged).not.toContain('secret.buyer@example.com');
  });

  it('throws INTERNAL on network error', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockRejectedValue(new Error('network timeout'));
    const sender = new ResendOtpSender({
      apiKey: 're_test_key',
      from: 'SaveMeal <no-reply@savemeal.vn>',
      fetchFn: fetchMock,
    });

    await expect(sender.send('EMAIL', 'buyer@example.com', '123456')).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });
});

describe('BrevoOtpSender', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('sends an email OTP with the expected endpoint, headers, and Brevo payload', async () => {
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(makeResponse(201, '{"messageId":"1"}'));
    const sender = new BrevoOtpSender({
      apiKey: 'xkeysib-test',
      senderEmail: 'no-reply@savemeal.vn',
      senderName: 'SaveMeal Pilot',
      fetchFn: fetchMock,
    });

    await sender.send('EMAIL', 'buyer@example.com', '654321');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'api-key': 'xkeysib-test',
      'Content-Type': 'application/json',
    });

    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload.sender).toEqual({ name: 'SaveMeal Pilot', email: 'no-reply@savemeal.vn' });
    expect(payload.to).toEqual([{ email: 'buyer@example.com' }]);
    expect(payload.subject).toBe('Mã xác minh SaveMeal: 654321');
    expect(payload.textContent).toEqual(expect.stringContaining('654321'));
    expect(payload.textContent).toEqual(expect.stringContaining('5 phút'));
    expect(payload.htmlContent).toEqual(expect.stringContaining('654321'));
    expect(payload.htmlContent).toEqual(expect.stringContaining('5 phút'));
  });

  it('rejects SMS channel with FEATURE_DISABLED without calling fetch', async () => {
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
    const sender = new BrevoOtpSender({
      apiKey: 'xkeysib-test',
      senderEmail: 'no-reply@savemeal.vn',
      fetchFn: fetchMock,
    });

    await expect(sender.send('SMS', '+84901234567', '654321')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws INTERNAL on provider 5xx and never logs the OTP code or full email', async () => {
    const fetchMock = jest
      .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
      .mockResolvedValue(makeResponse(503, 'service unavailable'));
    const sender = new BrevoOtpSender({
      apiKey: 'xkeysib-test',
      senderEmail: 'no-reply@savemeal.vn',
      fetchFn: fetchMock,
    });

    const err = await sender.send('EMAIL', 'private.user@example.com', '774411').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INTERNAL');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('503');
    expect(logged).not.toContain('774411');
    expect(logged).not.toContain('private.user@example.com');
  });
});
