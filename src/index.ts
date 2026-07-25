import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { metricsMiddleware } from "./metrics/httpMetrics";
import { idempotency } from "./middleware/idempotency";
import { defaultBodySizeLimitMiddleware, webhookBodySizeLimitMiddleware } from "./middleware/bodySize";
import { healthRouter } from "./routes/health";
import dependenciesRouter from "./routes/healthz/dependencies";
import { createReadyRouter } from "./routes/health/ready";
import { dependenciesRouter } from "./routes/health/dependencies";
import { redisConnection } from "./queue";
import { authRouter } from "./routes/auth";
import { marketsRouter } from "./routes/markets";
import { predictionsRouter } from "./routes/predictions";
import { usersRouter } from "./routes/users";
import { usersHealthRouter } from "./routes/users/health";
import { userPortfolioRouter } from "./routes/users/portfolio";
import { devicesRouter } from "./routes/devices";
import { adminFeatureFlagsRouter } from "./routes/admin/featureFlags";
import { adminUsersRouter } from "./routes/adminUsers";
import { adminNotesRouter } from "./routes/admin/users/notes";
import { leaderboardRouter } from "./routes/leaderboard";
import { globalLeaderboardRouter } from "./routes/leaderboard/global";
import { devicesRouter } from "./routes/devices";
import { createDocsRouter } from "./routes/docs";
import { sessionsRouter } from "./routes/me/sessions";
import { notificationsRouter } from "./routes/notifications";
import { socialRouter } from "./routes/social";
import { webhooksRouter } from "./routes/webhooks";
import { adminAuditRouter } from "./routes/admin/audit";
import { adminAuditExportRouter } from "./routes/admin/audit/export";
import { adminMarketsRouter } from "./routes/admin/markets";
import { adminSchemaVersionsRouter } from "./routes/admin/schema-versions";
import { errorHandler } from "./middleware/errorHandler";
import { stopIndexerHealthProbe } from "./jobs/indexerHealthProbe";
import { requestContextStorage } from "./lib/requestContext";
import { REQUEST_ID_HEADER } from "./lib/http";
import { register } from "./metrics/registry";
import { connectWithRetry, closeDb, db } from "./db/client";
import { stopScheduler } from "./services/scheduler";
import { startIndexerHealthProbe, stopIndexerHealthProbe } from "./jobs/indexerHealthProbe";
import { WebhookWorker } from "./workers/webhookWorker";
import { marketResolverWorker } from "./workers/marketResolver";
import { backupVerificationWorker } from "./workers/backupVerificationWorker";
import { reconciliationWorker } from "./workers/reconciliationWorker";
import { rateLimitStatusRouter } from "./routes/rate-limit/status";
import { adminRateLimitInspectRouter } from "./routes/admin/rate-limit/inspect";
import { quotaRequestsRouter } from "./routes/quota/requests";
import { startSlowQueryAlerter, stopSlowQueryAlerter } from "./workers/slowQueryAlerter";
import { scheduledReportsRouter } from "./routes/reports/scheduled";

const docsEnabled = env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true";

const REQUEST_ID_MAX_LENGTH = 64;

export interface CreateAppOptions {
  webhooks?: {
    store: WebhookStore;
    dispatcher: IWebhookDispatcher;
  };
}

function sanitizeRequestId(raw: string): string | undefined {
  const sanitized = raw
    .slice(0, REQUEST_ID_MAX_LENGTH)
    .replace(/[^A-Za-z0-9\-_.]/g, "");
  return sanitized.length > 0 ? sanitized : undefined;
}

export function createApp(_options: CreateAppOptions = {}): express.Express {
  const app = express();

  app.set("etag", false);

  if (env.TRUST_PROXY) {
    app.set("trust proxy", true);
  }

  if (docsEnabled) {
    app.use("/docs", createDocsRouter());
  }

  app.use(helmet());

  app.use(
    pinoHttp({
      logger,
      genReqId(req) {
        const inbound = req.headers[REQUEST_ID_HEADER];
        const raw = Array.isArray(inbound) ? inbound[0] : inbound;
        return (raw && sanitizeRequestId(raw)) ?? uuidv4();
      },
      customProps(req) {
        return { reqId: (req as { id?: string }).id };
      },
    }),
  );

  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const requestId = String((req as { id?: unknown }).id);
      res.setHeader(REQUEST_ID_HEADER, requestId);
      requestContextStorage.run({ requestId }, next);
    },
  );

  app.use("/api/admin/webhooks", webhookBodySizeLimitMiddleware);
  app.use(defaultBodySizeLimitMiddleware);

  app.use(metricsMiddleware);
  app.use("/health", healthRouter);
  app.use("/healthz/dependencies", dependenciesRouter);
  app.use("/api/health/ready", createReadyRouter({ db, redis: redisConnection }));
  app.use("/api/health/dependencies", dependenciesRouter);

  const mutationMethods = ["POST", "PATCH"] as const;
  app.use("/api", (req, res, next) =>
    mutationMethods.includes(req.method as (typeof mutationMethods)[number])
      ? idempotency(req, res, next)
      : next(),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/markets", marketsRouter);
  app.use("/api/predictions", predictionsRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/leaderboard/global", globalLeaderboardRouter);
  app.use("/api/rate-limit", rateLimitStatusRouter);
  app.use("/api/quota/requests", quotaRequestsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/users/health", usersHealthRouter);
  app.use("/api/users", socialRouter);
  app.use("/api/users", userPortfolioRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/me/devices", devicesRouter);
  app.use("/api/me/sessions", sessionsRouter);
  app.use("/api/admin/audit", adminAuditRouter);
  app.use("/api/admin/audit", adminAuditExportRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/users", adminNotesRouter);
  app.use("/api/admin/feature-flags", adminFeatureFlagsRouter);
  app.use("/api/admin/markets", adminMarketsRouter);
  app.use("/api/admin/schema-versions", adminSchemaVersionsRouter);
  app.use("/api/admin/rate-limit", adminRateLimitInspectRouter);
  app.use("/api/reports/scheduled", scheduledReportsRouter);

  app.get("/metrics", async (req, res) => {
    const metricsAuthToken = process.env.METRICS_AUTH_TOKEN;
    if (
      metricsAuthToken &&
      req.headers.authorization !== `Bearer ${metricsAuthToken}`
    ) {
      res.status(401).send("Unauthorized");
      return;
    }

    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();
  let webhookWorker: WebhookWorker | null = null;
  let probeHandle: ReturnType<typeof setInterval> | null = null;

  const stopWorkers = async (): Promise<void> => {
    logger.info("Stopping queue workers");
    stopSlowQueryAlerter();
    stopIndexerHealthProbe();
    if (probeHandle) {
      clearInterval(probeHandle);
      probeHandle = null;
    }
    await Promise.all([
      webhookWorker ? webhookWorker.stop() : Promise.resolve(),
      marketResolverWorker.stop(),
      backupVerificationWorker.stop(),
      reconciliationWorker.stop(),
    ]);
  };

  connectWithRetry()
    .then(() => {
      webhookWorker = new WebhookWorker(db);
      webhookWorker.start();
      marketResolverWorker.start();
      backupVerificationWorker.start();
      reconciliationWorker.start();
      startSlowQueryAlerter();
      probeHandle = startIndexerHealthProbe();

      app.listen(env.PORT, () => {
        logger.info({ port: env.PORT, env: env.NODE_ENV }, "predictify-backend listening");
        logger.info(`Swagger UI available at http://localhost:${env.PORT}/docs`);
      });

      process.on("SIGTERM", async () => {
        logger.info("SIGTERM received, shutting down");
        const forceExit = setTimeout(() => {
          logger.warn("Forced exit after shutdown timeout");
          process.exit(1);
        }, 5000).unref();

        await stopWorkers();
        stopScheduler();
        await closeDb();
        clearTimeout(forceExit);
        process.exit(0);
      });

      process.on("SIGINT", async () => {
        logger.info("SIGINT received, shutting down gracefully");
        const forceExit = setTimeout(() => {
          logger.warn("Forced exit after shutdown timeout");
          process.exit(1);
        }, 5000).unref();

        await stopWorkers();
        stopScheduler();
        await closeDb();
        clearTimeout(forceExit);
        process.exit(0);
      });
    })
    .catch((err) => {
      logger.fatal({ err }, "Failed to start server");
      process.exit(1);
    });
}
