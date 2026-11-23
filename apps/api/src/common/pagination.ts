import type { PageInfo } from '@savemeal/shared';
import { AppException } from './errors/app-exception';

export const DEFAULT_LIMIT = 20;

/** Opaque offset cursor (contract §0: cursor/limit, nextCursor null at the end). */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    // fall through
  }
  throw new AppException('VALIDATION_FAILED', { fields: { cursor: 'invalid cursor' } });
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

/** Fetch `limit + 1` rows, then call this to trim and build the page info. */
export function paginate<T>(rows: T[], offset: number, limit: number): { items: T[]; page: PageInfo } {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    page: { nextCursor: hasMore ? encodeCursor(offset + limit) : null, limit },
  };
}
