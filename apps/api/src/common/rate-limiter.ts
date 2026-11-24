import { Injectable } from '@nestjs/common';
import { AppException } from './errors/app-exception';

/**
 * Simple in-memory sliding-window rate limiter for per-seller / per-reservation / per-account
 * short-window limits (contract §0: pickup lookup/confirm, pickup token rotation).
 */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();

  /** Records one hit for `key`; throws 429 RATE_LIMITED (with Retry-After) when `limit` is reached. */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): void {
    const cutoff = now - windowMs;
    const hits = (this.buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= limit) {
      const retryAfterMs = Math.max(1000, hits[0]! + windowMs - now);
      this.buckets.set(key, hits);
      throw AppException.rateLimited(retryAfterMs);
    }
    hits.push(now);
    this.buckets.set(key, hits);
  }

  /** Clears all buckets (useful in tests). */
  reset(): void {
    this.buckets.clear();
  }
}
