/**
 * admin/health.ts
 *
 * GET /api/admin/health/detail
 *
 * Returns detailed runtime health including:
 *  - DB connection pool stats (total / idle / waiting connections) + liveness
 *  - Indexer cursor (last indexed ledger, chain tip, lag)
 *  - Soroban RPC reachability and latest ledger
 *
 * Security:
 *  - Requires a valid admin JWT (role: "admin") via the requireAdmin middleware.
 *  - Rate-limited to 30 requests per minute per admin token.
 *    The ceiling is injectable via createAdminHealthRouter() for tests.
 *
 * HTTP status codes:
 *  - 200 OK            all checks passed
 *  - 207 Multi-Status  one or more checks degraded/errored
 *  - 403 Forbidden     missing/invalid/non-admin JWT
 *  - 429 Too Many Requests
 *
 * Does NOT write to the audit log — it is a read-only diagnostic endpoint.
 */

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { rpc as stellarRpc } from "@stellar/stellar-sdk";
import { requireAdmin } from "../../middleware/requireAdmin";
import { pool } from "../../db/client";
import { env } from "../../config/env";
import { getAdminHealthDetail, type CheckStatus } from "../../services/adminHealthService";

export interface AdminHealthRouterOptions {
  /** Requests per minute per admin token. Default: 30 */
  rateLimitPerMinute?: number;
}

/** Derive the HTTP status from the collection of check statuses. */

function toHttpStatus(checks: CheckStatus[]): 200 | 207 {
  return checks.every((s) => s === "ok") ? 200 : 207;
}

export function createAdminHealthRouter(opts: AdminHealthRouterOptions = {}): Router {
  const router = Router();
  const limit = opts.rateLimitPerMinute ?? 30;

  // ── Rate limiter ────────────────────────────────────────────────────────────
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit,
      keyGenerator: (req) =>
        (req.headers.authorization as string | undefined) ?? req.ip ?? "unknown",
      standardHeaders: "draft-6",
      legacyHeaders: false,
      message: { error: { code: "rate_limit_exceeded" } },
    }),
  );

  // ── Admin guard ─────────────────────────────────────────────────────────────
  router.use(requireAdmin);

  // ── GET /detail ─────────────────────────────────────────────────────────────
  router.get("/detail", async (_req, res, next) => {
    try {
      const rpcServer = new stellarRpc.Server(env.SOROBAN_RPC_URL, {
        allowHttp: env.SOROBAN_RPC_URL.startsWith("http://"),
      });

      const detail = await getAdminHealthDetail(pool, rpcServer);

      const httpStatus = toHttpStatus([
        detail.dbPool.status,
        detail.indexer.status,
        detail.rpc.status,
      ]);

      res.status(httpStatus).json(detail);
    } catch (e) {
      next(e);
    }
  });

  return router;
}

// Default export wired into src/index.ts
export const adminHealthRouter = createAdminHealthRouter();
