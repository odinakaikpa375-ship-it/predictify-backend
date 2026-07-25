import express from "express";
import request from "supertest";
import { closeDb, pool } from "../../src/db/client";

jest.mock("../../src/queue", () => ({
  redisConnection: {
    on: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn(),
  },
  webhookQueueName: "webhook-deliveries",
  backupVerificationQueueName: "backup-verification",
  reconciliationQueueName: "reconciliation",
  marketResolutionQueueName: "market-resolution",
  webhookQueue: {},
  backupVerificationQueue: {},
  reconciliationQueue: {},
  marketResolutionQueue: {},
}));

jest.mock("../../src/cache/marketsCache", () => ({
  marketCacheKeys: {
    all: "markets:all",
    byId: (marketId: string) => `markets:${marketId}`,
  },
  invalidateMarketCache: jest.fn().mockResolvedValue(undefined),
}));

import { marketsRouter } from "../../src/routes/markets";

function createMarketsApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/markets", marketsRouter);
  return app;
}

async function seedMarkets(rows: Array<{
  id: string;
  question: string;
  status: string;
  resolutionTime: string;
  archived?: boolean;
  version?: number;
}>) {
  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO markets (
          id,
          question,
          status,
          resolution_time,
          indexed_ledger,
          archived,
          version,
          featured,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [
        row.id,
        row.question,
        row.status,
        row.resolutionTime,
        1,
        row.archived ?? false,
        row.version ?? 1,
        false,
      ],
    );
  }
}

describe("GET /api/markets integration", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE markets RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await closeDb();
  });

  it("returns markets persisted in the database", async () => {
    await seedMarkets([
      {
        id: "market-live",
        question: "Will the integration test pass?",
        status: "active",
        resolutionTime: "2026-07-01T00:00:00.000Z",
      },
    ]);

    const res = await request(createMarketsApp()).get("/api/markets");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          id: "market-live",
          question: "Will the integration test pass?",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  });

  it("omits archived markets from the public listing", async () => {
    await seedMarkets([
      {
        id: "market-active",
        question: "Visible market",
        status: "active",
        resolutionTime: "2026-07-02T00:00:00.000Z",
      },
      {
        id: "market-archived",
        question: "Hidden market",
        status: "archived",
        resolutionTime: "2026-07-03T00:00:00.000Z",
        archived: true,
      },
    ]);

    const res = await request(createMarketsApp()).get("/api/markets");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: "market-active" });
  });

  it("respects the limit query parameter", async () => {
    await seedMarkets([
      {
        id: "market-one",
        question: "First",
        status: "active",
        resolutionTime: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "market-two",
        question: "Second",
        status: "active",
        resolutionTime: "2026-07-02T00:00:00.000Z",
      },
      {
        id: "market-three",
        question: "Third",
        status: "active",
        resolutionTime: "2026-07-03T00:00:00.000Z",
      },
    ]);

    const res = await request(createMarketsApp()).get("/api/markets?limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((market: { id: string }) => market.id)).toHaveLength(2);
  });

  it("returns a single market by id from the database", async () => {
    await seedMarkets([
      {
        id: "market-detail",
        question: "Single detail lookup",
        status: "active",
        resolutionTime: "2026-07-04T00:00:00.000Z",
      },
    ]);

    const res = await request(createMarketsApp()).get("/api/markets/market-detail");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        id: "market-detail",
        question: "Single detail lookup",
        status: "active",
        resolutionTime: "2026-07-04T00:00:00.000Z",
        version: 1,
      },
    });
  });
});
