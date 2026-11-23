import type { Request, Response } from 'express';

/** Contract §0: the refresh token travels only in this cookie. */
export const REFRESH_COOKIE = 'lb_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` (browsers accept Secure on localhost). */
export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: REFRESH_COOKIE_PATH });
}
