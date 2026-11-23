import type { Image } from '@savemeal/shared';

/**
 * Public URL path of a stored image. Images are served by the API under the /api/v1 prefix so
 * the PWA reaches them through the same-origin rewrite (served from IMG-1 storage in M3).
 */
export function imageUrl(storageKey: string): string {
  return `/api/v1/media/${storageKey}`;
}

export function toImage(row: { id: string; storageKey: string; width: number; height: number }): Image {
  return { id: row.id, url: imageUrl(row.storageKey), width: row.width, height: row.height };
}
