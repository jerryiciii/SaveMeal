import { Controller, Get, Headers } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { JobsService, type CleanupResult } from './jobs.service';

export type DailyCronResult = {
  listingsExpired: number;
  reservationsExpired: number;
  cleanup: CleanupResult;
  metricsRebuilt: number;
};

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@Controller('internal/cron')
@Public()
export class CronController {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobsService,
  ) {}

  /** SYS-3 · GET /internal/cron/daily (CRON). Runs JOB-1..4 sequentially. */
  @Get('daily')
  async daily(@Headers('authorization') authHeader?: string): Promise<{ data: DailyCronResult }> {
    const secret = this.config.cronSecret;
    if (!secret) {
      throw new AppException('FORBIDDEN');
    }

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    if (!token || !safeEqual(token, secret)) {
      throw new AppException('UNAUTHENTICATED');
    }

    const listingsExpired = await this.jobs.expireListings();
    const reservationsExpired = await this.jobs.expireReservations();
    const cleanup = await this.jobs.cleanupExpiredData();
    const metricsRebuilt = await this.jobs.rebuildMetrics();

    return {
      data: {
        listingsExpired,
        reservationsExpired,
        cleanup,
        metricsRebuilt,
      },
    };
  }
}
