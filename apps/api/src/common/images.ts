import type { Image } from '@savemeal/shared';

const DEFAULT_MEDIA_PUBLIC_BASE_URL = '/api/v1/media';

let mediaPublicBaseUrl = DEFAULT_MEDIA_PUBLIC_BASE_URL;

/** Configures the public base URL prefix for stored images (called once during app setup). */
export function setMediaPublicBaseUrl(baseUrl: string): void {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  mediaPublicBaseUrl = normalized || DEFAULT_MEDIA_PUBLIC_BASE_URL;
}

/**
 * Public URL of a stored image. Defaults to `/api/v1/media/<key>` (local disk served under the
 * /api/v1 prefix) or the configured external storage public base URL (e.g. Supabase Storage).
 */
export function imageUrl(storageKey: string): string {
  return `${mediaPublicBaseUrl}/${storageKey}`;
}

export function toImage(row: { id: string; storageKey: string; width: number; height: number }): Image {
  return { id: row.id, url: imageUrl(row.storageKey), width: row.width, height: row.height };
}
