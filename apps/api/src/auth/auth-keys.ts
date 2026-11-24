import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { deriveKey } from './crypto';

/** Purpose-specific keys derived from AUTH_SECRET (or a random per-boot secret outside production). */
@Injectable()
export class AuthKeys {
  readonly jwt: Buffer;
  readonly hash: Buffer;
  readonly encrypt: Buffer;

  constructor(config: AppConfig) {
    let root = config.authSecret;
    if (!root) {
      if (config.isProduction) throw new Error('AUTH_SECRET is required in production');
      root = randomBytes(32).toString('hex');
      if (config.nodeEnv === 'development') {
        new Logger('Auth').warn('AUTH_SECRET is not set: using a random secret, so sessions end on restart.');
      }
    }
    this.jwt = deriveKey(root, 'jwt');
    this.hash = deriveKey(root, 'hash');
    this.encrypt = deriveKey(root, 'encrypt');
  }
}
