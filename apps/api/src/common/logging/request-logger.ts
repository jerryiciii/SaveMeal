import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestId } from '../request-id';
import { redactUrlForLog } from './redact';

const logger = new Logger('HTTP');

/**
 * One access-log line per request: request id, method, URL (coordinates rounded to 2 decimals),
 * status and duration. Bodies, headers and cookies are never logged.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logger.log(
      `${getRequestId(req)} ${req.method} ${redactUrlForLog(req.originalUrl)} ${res.statusCode} ${ms.toFixed(1)}ms`,
    );
  });
  next();
}
