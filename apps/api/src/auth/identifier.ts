import type { OtpChannel } from '@savemeal/shared';

/**
 * AUTH-1 identifier normalisation. Phones become E.164: a VN local "09…" becomes "+849…", and
 * spaces, dots, dashes and parentheses are ignored. Emails are trimmed and lower-cased.
 * Returns null when the identifier is not valid for the channel.
 */
export function normalizeIdentifier(channel: OtpChannel, raw: string): string | null {
  const value = raw.trim();
  if (channel === 'EMAIL') {
    const email = value.toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
  }
  let phone = value.replace(/[\s.\-()]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (/^0\d{9}$/.test(phone)) phone = `+84${phone.slice(1)}`;
  else if (/^84\d{9}$/.test(phone)) phone = `+${phone}`;
  if (phone.startsWith('+84')) return /^\+84[1-9]\d{8}$/.test(phone) ? phone : null;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

/** For logs: "+84900000002" → "+849•••••002", "a.b@x.vn" → "a•••@x.vn". */
export function maskIdentifier(identifier: string): string {
  if (identifier.includes('@')) {
    const [local, domain] = identifier.split('@');
    return `${local!.slice(0, 1)}•••@${domain}`;
  }
  return `${identifier.slice(0, 4)}•••••${identifier.slice(-3)}`;
}
