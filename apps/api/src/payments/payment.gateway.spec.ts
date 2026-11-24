import {
  buildSePayQrUrl,
  extractTransferContent,
  generateTransferContent,
  verifySePayApiKey,
} from './payment.gateway';

describe('payment.gateway', () => {
  describe('generateTransferContent', () => {
    it('generates SM followed by 8 uppercase alphanumeric characters', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const code = generateTransferContent();
        expect(code).toMatch(/^SM[A-Z0-9]{8}$/);
        codes.add(code);
      }
      expect(codes.size).toBeGreaterThan(15);
    });
  });

  describe('extractTransferContent', () => {
    it('extracts and uppercases the transfer code from a bank memo', () => {
      expect(extractTransferContent('MBVCB.55123456.SM4281A9F2.CT tu NGUYEN VAN A')).toBe('SM4281A9F2');
      expect(extractTransferContent('chuyen khoan sm12ab34cd')).toBe('SM12AB34CD');
    });

    it('returns null when no valid transfer code is present', () => {
      expect(extractTransferContent('')).toBeNull();
      expect(extractTransferContent('SM1234567')).toBeNull();
      expect(extractTransferContent('chuyen tien an trua')).toBeNull();
    });
  });

  describe('buildSePayQrUrl', () => {
    it('builds the SePay VietQR image URL with encoded params', () => {
      const url = buildSePayQrUrl({
        bankCode: 'MB',
        accountNo: '0123456789',
        amount: 17000,
        transferContent: 'SM4281A9F2',
      });
      expect(url).toBe(
        'https://qr.sepay.vn/img?acc=0123456789&bank=MB&amount=17000&des=SM4281A9F2&template=compact',
      );
    });
  });

  describe('verifySePayApiKey', () => {
    const secret = 'sepay_webhook_secret_12345';

    it('accepts matching Apikey header case-insensitively on the prefix', () => {
      expect(verifySePayApiKey(`Apikey ${secret}`, secret)).toBe(true);
      expect(verifySePayApiKey(`apikey ${secret}`, secret)).toBe(true);
      expect(verifySePayApiKey(`APIKEY ${secret}`, secret)).toBe(true);
    });

    it('rejects missing, malformed, or mismatched headers', () => {
      expect(verifySePayApiKey(undefined, secret)).toBe(false);
      expect(verifySePayApiKey('', secret)).toBe(false);
      expect(verifySePayApiKey(`Bearer ${secret}`, secret)).toBe(false);
      expect(verifySePayApiKey('Apikey wrong_secret', secret)).toBe(false);
      expect(verifySePayApiKey(`Apikey ${secret}x`, secret)).toBe(false);
      expect(verifySePayApiKey(`Apikey ${secret}`, '')).toBe(false);
    });
  });
});
