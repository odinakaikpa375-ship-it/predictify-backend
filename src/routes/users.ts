/**
 * @module routes/users
 *
 * Public user-facing routes:
 *
 *   GET /api/users/me
 *     Returns the authenticated user's own profile.  Requires a valid JWT
 *     (responds 403 on missing/invalid token via `requireAuthForbidden`).
 *
 *   GET /api/users/:address/predictions
 *     Returns a cursor-paginated list of predictions for the given Stellar
 *     address.  The address must be a valid Stellar public key (G…).
 *     Query: status?, cursor?, limit (default 20, max 100)
 *
 *   GET /api/users/:stellarAddress/profile
 *     Returns the public profile for any Stellar address.
 *     404 when no matching user row exists.
 *
 * All routes are wrapped by `accessLog` which:
 *   - Resolves / generates a correlation ID (X-Correlation-Id → X-Request-Id
 *     → req.id → new UUID) and stamps it on `res.locals.correlationId`.
 *   - Echoes the correlation ID back via the X-Correlation-Id response header.
 *   - Emits a structured `users_access_log` entry on every response finish.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getUserByAddress,
  getUserPredictions,
  getCurrentUserProfile,
  getUserProfile,
} from "../services/userService";
import { requireAuthForbidden } from "../middleware/requireAuth";
import { AuthenticatedRequest } from "../middleware/auth";
import { accessLog } from "../middleware/accessLog";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";
import { clampLimit, DEFAULT_PAGE_SIZE } from "../utils/cursor";
import { RouteErrorFactory } from "../errors";
import { requestTimeout } from "../middleware/timeout";
import { usersMetricsMiddleware } from "../metrics/usersMetrics";

export const usersRouter = Router();

/** Zod schema for a valid Stellar public key (56-char G… address). */
const stellarAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address");

// ---------------------------------------------------------------------------
// Access log — must be the first middleware so every handler inherits the
// correlation ID via res.locals.correlationId.
// ---------------------------------------------------------------------------
usersRouter.use(accessLog);

// ---------------------------------------------------------------------------
// Per-request timeout with graceful abort on /api/users
// ---------------------------------------------------------------------------
usersRouter.use(requestTimeout(15000)); // 15 seconds timeout

// ---------------------------------------------------------------------------
// Per-endpoint Prometheus metrics for /api/users
// ---------------------------------------------------------------------------
usersRouter.use(usersMetricsMiddleware);

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------
usersRouter.get("/me", requireAuthForbidden, async (req: AuthenticatedRequest, res, next) => {
  const correlationId = res.locals.correlationId as string;

  try {
    const userId = req.user!.id;
    const result = await getCurrentUserProfile(userId);

    if (!result.ok) {
      throw result.error;
    }

    const profile = result.value;
    logger.info(
      {
        correlationId,
        userId,
        stellarAddress: profile.stellarAddress,
        ...profile.totals,
      },
      "user_me_profile_loaded",
    );
    return res.json({ data: profile });
  } catch (e) {
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/:address/predictions
// ---------------------------------------------------------------------------
/**
 * Returns a cursor-paginated list of predictions for the given Stellar address.
 *
 * Query parameters:
 *   - status  (optional) — filter by prediction status enum
 *   - cursor  (optional) — opaque base64url token from the previous page's `nextCursor`
 *   - limit   (optional, default 20, max 100) — page size
 *
 * Response:
 *   { data: UserPredictionRow[], nextCursor: string | null }
 *
 * Pagination:
 *   `nextCursor` is null on the last page.  Pass it verbatim as `?cursor=` to
 *   fetch the next page.  Cursors are versioned; a stale cursor from before a
 *   schema migration is safely rejected and restarts from page one rather than
 *   silently returning a wrong offset.
 *
 * Errors:
 *   400 invalid_address  — path param is not a valid G… Stellar address
 *   400 validation_error — query params fail the zod schema
 *   404 not_found        — no user row for that address
 */
usersRouter.get(
  "/:address/predictions",
  async (req: Request, res: Response, next: NextFunction) => {
    // Prefer the access-log correlation ID; fall back to ALS for non-route callers.
    const correlationId = (res.locals.correlationId as string | undefined) ?? getRequestId();
    const reqId = correlationId;

    try {
      const address = req.params.address as string;

      // Validate the Stellar address at the route boundary before touching the DB.
      const addrParse = stellarAddressSchema.safeParse(address);
      if (!addrParse.success) {
        logger.warn({ correlationId, reqId, address }, "predictions_invalid_address");
        return res.status(400).json({
          error: { code: "invalid_address", requestId: reqId },
        });
      }

      // Validate and coerce query parameters with zod.
      const querySchema = z.object({
        status: z.enum(["pending", "confirmed", "won", "lost", "claimed"]).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
      });

      const queryParse = querySchema.safeParse(req.query);
      if (!queryParse.success) {
        logger.warn(
          { correlationId, reqId, address, issues: queryParse.error.issues },
          "predictions_invalid_query",
        );
        return res.status(400).json({
          error: {
            code: "validation_error",
            message: queryParse.error.issues[0]?.message ?? "invalid query parameters",
            requestId: reqId,
          },
        });
      }

      const { status, cursor, limit: rawLimit } = queryParse.data;
      // clampLimit is a belt-and-suspenders guard; zod already enforces 1–100.
      const limit = clampLimit(rawLimit);

      logger.debug(
        { correlationId, reqId, address, status, limit, hasCursor: !!cursor },
        "predictions_request",
      );

      const user = await getUserByAddress(address);
      if (!user) {
        logger.debug({ correlationId, reqId, address }, "predictions_user_not_found");
        return res.status(404).json({ error: { code: "not_found", requestId: reqId } });
      }

      const page = await getUserPredictions(user.id, { status, limit, cursor });

      logger.info(
        {
          correlationId,
          reqId,
          address,
          userId: user.id,
          count: page.data.length,
          hasNext: !!page.nextCursor,
        },
        "predictions_page_served",
      );

      return res.json({ data: page.data, nextCursor: page.nextCursor });
    } catch (e) {
      return next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/users/:stellarAddress/profile
// ---------------------------------------------------------------------------
usersRouter.get(
  "/:stellarAddress/profile",
  async (req, res, next) => {
    const correlationId = (res.locals.correlationId as string | undefined) ?? getRequestId();
    const reqId = correlationId;

    const parseResult = stellarAddressSchema.safeParse(req.params.stellarAddress);
    if (!parseResult.success) {
      logger.warn(
        {
          correlationId,
          reqId,
          stellarAddress: req.params.stellarAddress,
          issues: parseResult.error.issues,
        },
        "user_profile_validation_failed",
      );
      // Use next() so the error flows through the global error handler.
      return next(
        RouteErrorFactory.validation(
          parseResult.error.issues[0]?.message ?? "invalid stellar address",
        ),
      );
    }

    const stellarAddress = parseResult.data;

    try {
      logger.debug({ correlationId, reqId, stellarAddress }, "user_profile_lookup");

      const profile = await getUserProfile(stellarAddress);

      if (!profile) {
        logger.debug({ correlationId, reqId, stellarAddress }, "user_profile_not_found");
        return next(RouteErrorFactory.notFound("no user found with that stellar address"));
      }

      logger.info(
        {
          correlationId,
          reqId,
          stellarAddress,
          predictionCount: profile.predictions.length,
        },
        "user_profile_found",
      );

      return res.json({ data: profile });
    } catch (err) {
      return next(err);
    }
  },
);
