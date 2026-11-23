import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const SAFE_INCOMING_ID = /^[A-Za-z0-9_.:-]{8,64}$/;

type WithRequestId = Request & { requestId?: string };

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`;
}

/**
 * Every response carries X-Request-Id (contract §0). A well-formed incoming id (e.g. from a proxy)
 * is reused so logs can be correlated; anything else is replaced.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && SAFE_INCOMING_ID.test(incoming) ? incoming : newRequestId();
  (req as WithRequestId).requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

export function getRequestId(req: Request): string {
  return (req as WithRequestId).requestId ?? newRequestId();
}
