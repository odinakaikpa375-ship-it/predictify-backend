import request from "supertest";
import { createApp } from "../../src/index";
import { closeDb, getDb } from "../../src/db/client";

// Mock the queue connection
jest.mock("../../src/queue", () => ({
  redisConnection: {
    status: "ready",
    on: jest.fn(),
    quit: jest.fn(),
  },
}));

// Mock the services
jest.mock("../../src/services/authChallengeService", () => ({
  createChallenge: jest.fn().mockResolvedValue({
    nonce: "test-nonce",
    expiresAt: new Date(Date.now() + 1000 * 60 * 5),
  }),
}));

jest.mock("../../src/services/authVerifyService", () => ({
  verifyChallengeAndIssueJwt: jest.fn().mockResolvedValue({
    ok: true,
    value: {
      accessToken: "access-token-123",
      refreshToken: "refresh-token-123",
      user: { id: "1", stellarAddress: "GB3KKY..." },
    },
  }),
}));

jest.mock("../../src/services/refreshTokenService", () => ({
  rotateRefreshToken: jest.fn().mockResolvedValue({
    ok: true,
    value: {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    },
  }),
  revokeFamily: jest.fn().mockResolvedValue(undefined),
}));

describe("Integration Test: /api/auth", () => {
  let app: any;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("POST /api/auth/challenge", () => {
    it("returns 400 if stellarAddress is missing", async () => {
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toHaveProperty("type", "BadRequest");
      expect(response.body.error.message).toBe("stellarAddress is required");
      expect(response.headers).toHaveProperty("x-request-id");
    });

    it("returns 201 with nonce if stellarAddress is provided", async () => {
      const validAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

      const response = await request(app)
        .post("/api/auth/challenge")
        .send({ stellarAddress: validAddress })
        .expect(201);

      expect(response.body).toHaveProperty("nonce", "test-nonce");
      expect(response.body).toHaveProperty("expiresAt");
      expect(response.headers).toHaveProperty("x-request-id");
    });
  });

  describe("POST /api/auth/verify", () => {
    it("returns 422 for invalid body schema", async () => {
      const response = await request(app)
        .post("/api/auth/verify")
        .send({
          stellarAddress: "invalid", // Not a valid ed25519 pub key
          nonce: "",
          signature: "",
        })
        .expect(422);

      expect(response.body.error).toHaveProperty("type", "ValidationError");
      expect(response.headers).toHaveProperty("x-request-id");
    });

    it("returns 200 and tokens for valid request", async () => {
      const response = await request(app)
        .post("/api/auth/verify")
        .send({
          stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          nonce: "test-nonce",
          signature: "test-sig",
        })
        .expect(200);
      
      expect(response.body).toHaveProperty("accessToken", "access-token-123");
      expect(response.body).toHaveProperty("refreshToken", "refresh-token-123");
      expect(response.headers).toHaveProperty("x-request-id");
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("returns 400 if refreshToken is missing", async () => {
      const response = await request(app)
        .post("/api/auth/refresh")
        .send({})
        .expect(400);

      expect(response.body.error).toHaveProperty("type", "BadRequest");
      expect(response.headers).toHaveProperty("x-request-id");
    });

    it("returns 200 with new tokens if valid token provided", async () => {
      const response = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: "valid-token" })
        .expect(200);

      expect(response.body).toHaveProperty("accessToken", "new-access-token");
      expect(response.body).toHaveProperty("refreshToken", "new-refresh-token");
      expect(response.headers).toHaveProperty("x-request-id");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns 400 if refreshToken is missing", async () => {
      const response = await request(app)
        .post("/api/auth/logout")
        .send({})
        .expect(400);

      expect(response.body.error).toHaveProperty("type", "BadRequest");
      expect(response.headers).toHaveProperty("x-request-id");
    });

    it("returns 204 if valid token provided", async () => {
      await request(app)
        .post("/api/auth/logout")
        .send({ refreshToken: "valid-token" })
        .expect(204);
    });
  });

  describe("POST /api/auth/wallet/logout", () => {
    it("returns 400 if refreshToken is missing", async () => {
      const response = await request(app)
        .post("/api/auth/wallet/logout")
        .send({})
        .expect(400);

      expect(response.body.error).toHaveProperty("type", "BadRequest");
      expect(response.headers).toHaveProperty("x-request-id");
    });

    it("returns 204 if valid token provided", async () => {
      await request(app)
        .post("/api/auth/wallet/logout")
        .send({ refreshToken: "valid-token" })
        .expect(204);
    });
  });
});
