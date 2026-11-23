import { Injectable } from '@nestjs/common';
import type { Env } from './env';

/** Typed, validated configuration. Built once from the environment (see parseEnv). */
@Injectable()
export class AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly databaseUrl: string;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly features: { payments: boolean; googleLogin: boolean };

  constructor(env: Env) {
    this.nodeEnv = env.NODE_ENV;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.logLevel = env.LOG_LEVEL;
    this.features = { payments: env.PAYMENTS_ENABLED, googleLogin: env.GOOGLE_LOGIN_ENABLED };
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
