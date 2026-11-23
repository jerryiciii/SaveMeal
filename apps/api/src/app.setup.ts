import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { AppException } from './common/errors/app-exception';
import { requestLoggerMiddleware } from './common/logging/request-logger';
import { getRequestId, requestIdMiddleware } from './common/request-id';
import { createValidationPipe } from './common/validation';

export const API_PREFIX = 'api/v1';

/** Body-parser failures (malformed JSON, too large) → the contract envelope, not Express HTML. */
function bodyParserErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (!err) return next();
  const fields: Record<string, string> =
    (err as { type?: string }).type === 'entity.too.large' ? { body: 'too large' } : { body: 'malformed JSON' };
  const exception = new AppException('VALIDATION_FAILED', { fields });
  res.status(exception.getStatus()).json({
    error: { code: exception.code, message: exception.message, details: exception.details, requestId: getRequestId(req) },
  });
}

/**
 * Applies everything the running app and the e2e tests share: prefix, request id, access log,
 * JSON body parsing, validation and the error envelope. Create the app with { bodyParser: false }.
 */
export function configureApp(app: INestApplication): INestApplication {
  const expressApp = app as NestExpressApplication;
  expressApp.disable('x-powered-by');
  expressApp.set('trust proxy', 'loopback');
  app.setGlobalPrefix(API_PREFIX);
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(express.json({ limit: '100kb' }));
  app.use(bodyParserErrorHandler);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
