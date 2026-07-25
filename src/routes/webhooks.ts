import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";
import { requireAdmin } from "../middleware/requireAdmin";
import type { WebhookDelivery, WebhookStore } from "../services/webhookStore";

export interface WebhooksRouterDeps {
  store: WebhookStore;
}

const webhooksQuerySchema = z.object({
  cursor: z
    .string()
    .min(1, { message: "cursor must not be empty when provided" })
    .optional(),
  limit: z
    .string()
    .regex(/^\d+$/, { message: "limit must be a positive integer" })
    .optional(),
});

function serializeDelivery(row: WebhookDelivery) {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    targetUrl: row.targetUrl,
    payloadBase64: row.payload.toString("base64"),
    signature: row.signature,
    headers: row.headers,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createWebhooksRouter(deps: WebhooksRouterDeps): Router {
  const router = Router();

  router.use(requireAdmin);

  router.get("/", async (req, res, next) => {
    const requestId = getRequestId();

    try {
      const parseResult = webhooksQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        const issue = parseResult.error.issues[0];
        logger.warn(
          {
            event: "webhooks_list_validation_failed",
            requestId,
            adminAddress: req.adminAddress,
            issues: parseResult.error.issues,
          },
          "Webhook list: invalid query parameters",
        );
        res.status(400).json({
          error: {
            code: "validation_error",
            message: issue?.message ?? "invalid query parameters",
            requestId,
          },
        });
        return;
      }

      const { cursor, limit } = parseResult.data;
      logger.info(
        {
          event: "webhooks_list_requested",
          requestId,
          adminAddress: req.adminAddress,
          cursor: cursor ?? null,
          limit: limit ?? null,
        },
        "Webhook list requested",
      );

      const page = await deps.store.listDeliveries(cursor, limit);

      logger.info(
        {
          event: "webhooks_list_returned",
          requestId,
          adminAddress: req.adminAddress,
          count: page.data.length,
          hasNextPage: page.nextCursor !== null,
        },
        "Webhook list returned",
      );

      res.json({
        data: page.data.map(serializeDelivery),
        nextCursor: page.nextCursor,
      });
    } catch (err) {
      logger.error(
        {
          event: "webhooks_list_error",
          requestId,
          adminAddress: req.adminAddress,
          error: err instanceof Error ? err.message : String(err),
        },
        "Webhook list encountered an unexpected error",
      );
      next(err);
    }
  });

  return router;
}
