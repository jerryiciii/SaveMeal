import { ConsolePaymentMailer, ResendPaymentMailer, type FetchFn } from './payment-mailer';

describe('ResendPaymentMailer', () => {
  const baseOptions = {
    apiKey: 're_test_key',
    from: 'SaveMeal <no-reply@savemeal.vn>',
    appPublicUrl: 'https://savemeal.thezah.space/',
  };

  it('sends proof submitted email to seller via Resend API', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }),
    );
    const mailer = new ResendPaymentMailer({ ...baseOptions, fetchFn });

    await mailer.sendProofSubmittedToSeller({
      toEmail: 'seller@example.com',
      sellerName: 'Tiệm Bánh A',
      buyerName: 'Nguyễn Văn B',
      listingTitle: 'Bánh mì bơ tỏi',
      orderCode: 'SM–4281',
      amount: 15000,
      reservationId: 'res-1',
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const payload = JSON.parse(init?.body as string);
    expect(payload.to).toEqual(['seller@example.com']);
    expect(payload.subject).toContain('SM–4281');
    expect(payload.text).toContain('15.000đ');
    expect(payload.html).toContain('https://savemeal.thezah.space/sell/orders');
  });

  it('sends payment confirmed email to buyer', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_2' }), { status: 200 }),
    );
    const mailer = new ResendPaymentMailer({ ...baseOptions, fetchFn });

    await mailer.sendPaymentConfirmedToBuyer({
      toEmail: 'buyer@example.com',
      buyerName: 'Nguyễn Văn B',
      sellerName: 'Tiệm Bánh A',
      listingTitle: 'Bánh mì bơ tỏi',
      orderCode: 'SM–4281',
      amount: 15000,
      reservationId: 'res-1',
    });

    const payload = JSON.parse(fetchFn.mock.calls[0]![1]?.body as string);
    expect(payload.to).toEqual(['buyer@example.com']);
    expect(payload.subject).toContain('xác nhận');
    expect(payload.html).toContain('https://savemeal.thezah.space/orders/res-1');
  });

  it('sends payment rejected email to buyer with reason', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_3' }), { status: 200 }),
    );
    const mailer = new ResendPaymentMailer({ ...baseOptions, fetchFn });

    await mailer.sendPaymentRejectedToBuyer({
      toEmail: 'buyer@example.com',
      buyerName: 'Nguyễn Văn B',
      sellerName: 'Tiệm Bánh A',
      listingTitle: 'Bánh mì bơ tỏi',
      orderCode: 'SM–4281',
      amount: 15000,
      reason: 'Chưa nhận được tiền trong tài khoản',
      reservationId: 'res-1',
    });

    const payload = JSON.parse(fetchFn.mock.calls[0]![1]?.body as string);
    expect(payload.to).toEqual(['buyer@example.com']);
    expect(payload.text).toContain('Chưa nhận được tiền trong tài khoản');
  });

  it('sends reservation created email to seller with 0đ (Miễn phí) for free orders and /sell/orders CTA', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_4' }), { status: 200 }),
    );
    const mailer = new ResendPaymentMailer({ ...baseOptions, fetchFn });

    await mailer.sendReservationCreatedToSeller({
      toEmail: 'seller@example.com',
      sellerName: 'Tiệm Bánh A',
      buyerName: 'Nguyễn Văn B',
      listingTitle: 'Bánh mì miễn phí',
      orderCode: 'SM–4281',
      quantity: 2,
      totalPrice: 0,
      pickupWindow: '17:00–18:00 (25/11)',
      reservationId: 'res-4',
    });

    const payload = JSON.parse(fetchFn.mock.calls[0]![1]?.body as string);
    expect(payload.to).toEqual(['seller@example.com']);
    expect(payload.subject).toContain('SM–4281');
    expect(payload.text).toContain('0đ (Miễn phí)');
    expect(payload.text).toContain('2 phần');
    expect(payload.text).toContain('17:00–18:00 (25/11)');
    expect(payload.text).toContain('Nguyễn Văn B');
    expect(payload.html).toContain('https://savemeal.thezah.space/sell/orders');
  });

  it('sends reservation created email to buyer with pickup address and /orders/:id CTA', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_5' }), { status: 200 }),
    );
    const mailer = new ResendPaymentMailer({ ...baseOptions, fetchFn });

    await mailer.sendReservationCreatedToBuyer({
      toEmail: 'buyer@example.com',
      buyerName: 'Nguyễn Văn B',
      sellerName: 'Tiệm Bánh A',
      listingTitle: 'Bánh mì miễn phí',
      orderCode: 'SM–4281',
      quantity: 1,
      pickupWindow: '17:00–18:00 (25/11)',
      pickupAddress: '12 Ngô Thì Sĩ, Đà Nẵng',
      reservationId: 'res-5',
    });

    const payload = JSON.parse(fetchFn.mock.calls[0]![1]?.body as string);
    expect(payload.to).toEqual(['buyer@example.com']);
    expect(payload.subject).toContain('SM–4281');
    expect(payload.text).toContain('12 Ngô Thì Sĩ, Đà Nẵng');
    expect(payload.text).toContain('17:00–18:00 (25/11)');
    expect(payload.html).toContain('https://savemeal.thezah.space/orders/res-5');
  });

  it('sends nearby listing alert email with distance, price formatting, and /listings/:id CTA', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_6' }), { status: 200 }),
    );
    const mailer = new ResendPaymentMailer({ ...baseOptions, fetchFn });

    await mailer.sendNearbyListingAlert({
      toEmail: 'nearby@example.com',
      recipientName: 'Lan',
      listingId: 'list-123',
      listingTitle: 'Bánh ngọt cuối ngày',
      sellerName: 'Tiệm Bánh Mây',
      price: 0,
      quantityAvailable: 4,
      pickupWindow: '17:30–18:30 (25/11)',
      distanceKm: 1.24,
    });

    const payload = JSON.parse(fetchFn.mock.calls[0]![1]?.body as string);
    expect(payload.to).toEqual(['nearby@example.com']);
    expect(payload.subject).toContain('~1.2 km');
    expect(payload.subject).toContain('Bánh ngọt cuối ngày');
    expect(payload.text).toContain('Miễn phí');
    expect(payload.text).toContain('4 phần');
    expect(payload.text).toContain('17:30–18:30 (25/11)');
    expect(payload.text).toContain('https://savemeal.thezah.space/settings?disableAlerts=1');
    expect(payload.html).toContain('https://savemeal.thezah.space/listings/list-123');
    expect(payload.html).toContain('https://savemeal.thezah.space/settings?disableAlerts=1');
    expect(payload.html).toContain('Tắt thông báo món gần đây');
  });

  it('does not throw when Resend returns HTTP error or rejects (best-effort)', async () => {
    const errorFetch = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    const mailer1 = new ResendPaymentMailer({ ...baseOptions, fetchFn: errorFetch });
    await expect(
      mailer1.sendPaymentConfirmedToBuyer({
        toEmail: 'buyer@example.com',
        buyerName: 'B',
        sellerName: 'A',
        listingTitle: 'Bánh',
        orderCode: 'SM–1111',
        amount: 10000,
        reservationId: 'res-2',
      }),
    ).resolves.toBeUndefined();

    const networkFetch = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>().mockRejectedValue(
      new Error('ECONNRESET'),
    );
    const mailer2 = new ResendPaymentMailer({ ...baseOptions, fetchFn: networkFetch });
    await expect(
      mailer2.sendProofSubmittedToSeller({
        toEmail: 'seller@example.com',
        sellerName: 'A',
        buyerName: 'B',
        listingTitle: 'Bánh',
        orderCode: 'SM–1111',
        amount: 10000,
        reservationId: 'res-2',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('ConsolePaymentMailer', () => {
  it('resolves without throwing for all three notifications', async () => {
    const mailer = new ConsolePaymentMailer();
    await expect(
      mailer.sendProofSubmittedToSeller({
        toEmail: 'seller@example.com',
        sellerName: 'A',
        buyerName: 'B',
        listingTitle: 'Bánh',
        orderCode: 'SM–1000',
        amount: 15000,
        reservationId: 'res-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      mailer.sendPaymentConfirmedToBuyer({
        toEmail: 'buyer@example.com',
        buyerName: 'B',
        sellerName: 'A',
        listingTitle: 'Bánh',
        orderCode: 'SM–1000',
        amount: 15000,
        reservationId: 'res-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      mailer.sendPaymentRejectedToBuyer({
        toEmail: 'buyer@example.com',
        buyerName: 'B',
        sellerName: 'A',
        listingTitle: 'Bánh',
        orderCode: 'SM–1000',
        amount: 15000,
        reason: 'Sai số tiền',
        reservationId: 'res-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      mailer.sendReservationCreatedToSeller({
        toEmail: 'seller@example.com',
        sellerName: 'A',
        buyerName: 'B',
        listingTitle: 'Bánh',
        orderCode: 'SM–1000',
        quantity: 1,
        totalPrice: 0,
        pickupWindow: '17:00–18:00 (25/11)',
        reservationId: 'res-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      mailer.sendReservationCreatedToBuyer({
        toEmail: 'buyer@example.com',
        buyerName: 'B',
        sellerName: 'A',
        listingTitle: 'Bánh',
        orderCode: 'SM–1000',
        quantity: 1,
        pickupWindow: '17:00–18:00 (25/11)',
        pickupAddress: 'Đà Nẵng',
        reservationId: 'res-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      mailer.sendNearbyListingAlert({
        toEmail: 'nearby@example.com',
        recipientName: 'Lan',
        listingId: 'list-1',
        listingTitle: 'Bánh',
        sellerName: 'A',
        price: 15000,
        quantityAvailable: 3,
        pickupWindow: '17:00–18:00 (25/11)',
        distanceKm: 0.8,
      }),
    ).resolves.toBeUndefined();
  });
});
