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

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? defaultMessage(code), ERROR_HTTP_STATUS[code]);
    this.code = code;
    this.details = details;
  }
}
