import { HttpException } from '@nestjs/common';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@savemeal/shared';
import { defaultMessage } from './error-messages';

/**
 * The one exception type business code throws. The global filter turns it into the contract
 * error envelope: { error: { code, message, details?, requestId } } with the catalogue status.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  /** Sent as the Retry-After header (429s); never part of the body. */
  retryAfterSec?: number;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? defaultMessage(code), ERROR_HTTP_STATUS[code]);
    this.code = code;
    this.details = details;
  }

  /** 429 RATE_LIMITED with a Retry-After header (contract §0). */
  static rateLimited(retryAfterMs: number, code: 'RATE_LIMITED' | 'OTP_TOO_MANY_ATTEMPTS' = 'RATE_LIMITED'): AppException {
    const exception = new AppException(code);
    exception.retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return exception;
  }
}
