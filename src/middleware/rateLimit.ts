/* eslint-disable @typescript-eslint/no-namespace */
/**
 * @module rateLimit
 *
 * Provides configurable Express rate-limit middleware with audit-trail
 * enrichment and support for authenticated per-user limits.
 */

import rateLimit, { type Options, type RateLimitRequestHandler } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { createAuditLog, type RateLimitContext } from "../services/auditService";

declare global {
  namespace Express {
    interface Request {
      rateLimitContext?: RateLimitContext;
      correlationId?: string;
    }
  }
}

type AuthenticatedRequest = Request & {
  user?: {
    sub?: string;
    address?: string;
    id?: string;
  };
};

function getClientIp(req: Request): string {
  return req.socket?.remoteAddress ?? "unknown";
}

function getResetAt(res: Response, windowMs: number): string {
  const resetHeader = res.getHeader("RateLimit-Reset");
  if (resetHeader !== undefined) {
    const resetSeconds = Number(resetHeader);
    if (Number.isFinite(resetSeconds)) {
      return new Date(resetSeconds * 1000).toISOString();
    }
  }

  return new Date(Date.now() + windowMs).toISOString();
}

function getRetryAfter(res: Response, windowMs: number): number {
  const retryAfter = Number(res.getHeader("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter);
  }

  const resetHeader = Number(res.getHeader("RateLimit-Reset"));
  if (Number.isFinite(resetHeader)) {
    return Math.max(1, Math.ceil(resetHeader - Date.now() / 1000));
  }

  return Math.max(1, Math.ceil(windowMs / 1000));
}

function attachContext(
  req: Request,
  res: Response,
  blocked: boolean,
  limit: number,
  windowMs: number,
): RateLimitContext {
  const remainingHeader = Number(res.getHeader("RateLimit-Remaining"));
  const remaining = Number.isFinite(remainingHeader)
    ? Math.max(0, remainingHeader)
    : blocked
      ? 0
      : limit;

  const context: RateLimitContext = {
    limit,
    remaining,
    resetAt: getResetAt(res, windowMs),
    blocked,
  };

  req.rateLimitContext = context;
  return context;
}

function getAuthenticatedUserKey(req: Request): string | undefined {
  const authenticatedRequest = req as AuthenticatedRequest;
  const identity =
    authenticatedRequest.user?.address ??
    authenticatedRequest.user?.sub ??
    authenticatedRequest.user?.id;

  if (typeof identity !== "string" || identity.trim().length === 0) {
    return undefined;
  }

  return `user:${identity.trim()}`;
}

export function createRateLimiter(options: Partial<Options> = {}): RateLimitRequestHandler {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const configuredLimit = options.limit;
  const limit = typeof configuredLimit === "number" ? configuredLimit : 100;

  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipFailedRequests: false,
    ...options,
    keyGenerator: options.keyGenerator ?? ((req: Request) => getClientIp(req)),
    handler: (req: Request, res: Response) => {
      const correlationId = (req.correlationId ??= uuidv4());
      const context = attachContext(req, res, true, limit, windowMs);
      const retryAfter = getRetryAfter(res, windowMs);

      res.setHeader("Retry-After", String(retryAfter));
      void createAuditLog({
        action: "rate_limit.blocked",
        ip: getClientIp(req),
        correlationId,
        rateLimitContext: context,
      }).catch(() => undefined);

      res.status(429).json({
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests",
          retryAfter,
          resetAt: context.resetAt,
        },
      });
    },
  });

  return ((req: Request, res: Response, next: NextFunction) => {
    req.correlationId ??= uuidv4();
    limiter(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }

      attachContext(req, res, false, limit, windowMs);
      next();
    });
  }) as RateLimitRequestHandler;
}

export function createPerUserRateLimiter(options: Partial<Options> = {}): RateLimitRequestHandler {
  return createRateLimiter({
    windowMs: 60 * 1000,
    limit: 60,
    ...options,
    keyGenerator: (req: Request) => {
      const overrideKey = options.keyGenerator?.(req);
      if (typeof overrideKey === "string" && overrideKey.trim().length > 0) {
        return overrideKey;
      }

      return getAuthenticatedUserKey(req) ?? `ip:${getClientIp(req)}`;
    },
  });
}
