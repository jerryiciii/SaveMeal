import { randomInt, timingSafeEqual } from 'node:crypto';

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TRANSFER_CONTENT_PATTERN = /SM[A-Z0-9]{8}/i;
const APIKEY_HEADER_PATTERN = /^apikey\s+(.+)$/i;

/** Unique payment memo code: "SM" + 8 random uppercase alphanumeric characters. */
export function generateTransferContent(): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += ALPHANUM[randomInt(ALPHANUM.length)];
  }
  return `SM${suffix}`;
}

/** Extracts the first SaveMeal transfer code (`SM[A-Z0-9]{8}`) from a bank memo, uppercased. */
export function extractTransferContent(text: string): string | null {
  if (!text) return null;
  const match = TRANSFER_CONTENT_PATTERN.exec(text);
  return match ? match[0].toUpperCase() : null;
}

export type SePayQrParams = {
  bankCode: string;
  accountNo: string;
  amount: number;
  transferContent: string;
};

/** Builds a SePay VietQR image URL with pre-filled account, amount, and transfer memo. */
export function buildSePayQrUrl({ bankCode, accountNo, amount, transferContent }: SePayQrParams): string {
  return (
    `https://qr.sepay.vn/img?acc=${encodeURIComponent(accountNo)}` +
    `&bank=${encodeURIComponent(bankCode)}` +
    `&amount=${amount}` +
    `&des=${encodeURIComponent(transferContent)}` +
    `&template=compact`
  );
}

/** Constant-time verification of SePay's `Authorization: Apikey <secret>` header. */
export function verifySePayApiKey(authHeader: string | undefined, expectedSecret: string): boolean {
  if (!authHeader || !expectedSecret) return false;
  const match = APIKEY_HEADER_PATTERN.exec(authHeader.trim());
  if (!match) return false;
  const provided = Buffer.from(match[1]!.trim(), 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
