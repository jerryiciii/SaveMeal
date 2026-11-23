import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { AppConfig } from '../config/app-config';

/**
 * Local-disk storage for processed images (pilot). Keys look like "2026/11/<uuid>.webp" and are
 * served read-only under /api/v1/media/<key> (see app.setup).
 */
@Injectable()
export class MediaStorage {
  constructor(private readonly config: AppConfig) {}

  newKey(now = new Date()): string {
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${now.getUTCFullYear()}/${month}/${randomUUID()}.webp`;
  }

  /** Absolute path of a key; refuses keys that escape the upload directory. */
  pathOf(key: string): string {
    const full = normalize(join(this.config.uploadDir, key));
    if (!full.startsWith(normalize(this.config.uploadDir) + sep)) throw new Error('invalid storage key');
    return full;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
}
