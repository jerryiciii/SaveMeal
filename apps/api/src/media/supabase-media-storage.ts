import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppException } from '../common/errors/app-exception';

export type FetchFn = typeof fetch;

export interface SupabaseMediaStorageOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  fetchFn?: FetchFn;
}

function validateKey(key: string): string {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new Error('invalid storage key');
  }
  return key;
}

async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Supabase Storage REST API driver compatible with MediaStorage.
 * Stores processed WebP images in a public bucket under keys like "2026/11/<uuid>.webp".
 */
export class SupabaseMediaStorage {
  private readonly logger = new Logger(SupabaseMediaStorage.name);
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly bucket: string;
  private readonly fetchFn: FetchFn;

  constructor(options: SupabaseMediaStorageOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = options.serviceRoleKey;
    this.bucket = options.bucket;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  newKey(now = new Date()): string {
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${now.getUTCFullYear()}/${month}/${randomUUID()}.webp`;
  }

  publicUrl(key: string): string {
    const safeKey = validateKey(key);
    return `${this.baseUrl}/storage/v1/object/public/${this.bucket}/${safeKey}`;
  }

  private objectUrl(key: string): string {
    const safeKey = validateKey(key);
    return `${this.baseUrl}/storage/v1/object/${this.bucket}/${safeKey}`;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const url = this.objectUrl(key);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          apikey: this.serviceRoleKey,
          'Content-Type': 'image/webp',
          'x-upsert': 'true',
        },
        body: new Uint8Array(data),
      });
    } catch (err) {
      this.logger.error(
        `Supabase storage write failed for ${key}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AppException('INTERNAL');
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      this.logger.error(
        `Supabase storage write failed for ${key} with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
      );
      throw new AppException('INTERNAL');
    }
  }

  async remove(key: string): Promise<void> {
    const url = this.objectUrl(key);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          apikey: this.serviceRoleKey,
        },
      });
    } catch (err) {
      this.logger.error(
        `Supabase storage remove failed for ${key}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AppException('INTERNAL');
    }

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      this.logger.error(
        `Supabase storage remove failed for ${key} with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
      );
      throw new AppException('INTERNAL');
    }
  }
}
