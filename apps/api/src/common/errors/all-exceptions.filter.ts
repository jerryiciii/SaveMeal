import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@savemeal/shared';
import type { Request, Response } from 'express';
import { getRequestId } from '../request-id';
import { AppException } from './app-exception';
import { defaultMessage } from './error-messages';

/** Maps framework HTTP errors (unknown route, body parser, guards) onto catalogue codes. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED';
    // Only multipart uploads reach here (JSON body errors are handled in app.setup).
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'IMAGE_TOO_LARGE';
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return 'IMAGE_TYPE_UNSUPPORTED';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
    case HttpStatus.METHOD_NOT_ALLOWED:
      return 'NOT_FOUND';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}

/** HTTP status that goes with a framework-mapped code (405 → 404). */
function statusForMappedCode(code: ErrorCode, original: number): number {
  if (code === 'INTERNAL') return HttpStatus.INTERNAL_SERVER_ERROR;
  if (code === 'NOT_FOUND') return HttpStatus.NOT_FOUND;
  if (code === 'VALIDATION_FAILED') return HttpStatus.BAD_REQUEST;
  return original;
}

/**
 * Produces the exact contract error envelope for every failure, and never leaks a stack trace or
 * internal message to the client. 5xx errors are logged server-side with the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(request);

    let status: number;
    let body: ApiErrorBody['error'];

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, requestId };
      if (exception.details !== undefined) body.details = exception.details;
    } else if (exception instanceof HttpException) {
      const code = codeForStatus(exception.getStatus());
      status = statusForMappedCode(code, exception.getStatus());
      body = { code, message: defaultMessage(code), requestId };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = { code: 'INTERNAL', message: defaultMessage('INTERNAL'), requestId };
    }

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${requestId} ${err.name}: ${err.message}`, err.stack);
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const retryAfter = exception instanceof AppException && exception.retryAfterSec ? exception.retryAfterSec : 60;
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(status).json({ error: body } satisfies ApiErrorBody);
  }
}
