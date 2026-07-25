import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { createPerUserRateLimiter } from "../middleware/rateLimit";
import {
  rotateRefreshToken,
  revokeFamily,
} from "../services/refreshTokenService";
import { createChallenge } from "../services/authChallengeService";
import { verifyChallengeAndIssueJwt } from "../services/authVerifyService";
import { RouteErrorFactory } from "../errors";
import { conditionalGet } from "../middleware/etag";
import { accessLog } from "../middleware/accessLog";
import { requestTimeout } from "../middleware/timeout";

export const authRouter = Router();
authRouter.use(accessLog);
authRouter.use(requestTimeout(15000));

function getAuthRateLimitKey(req: { body?: unknown; socket?: { remoteAddress?: string | null } }): string {
  const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : undefined;
  const stellarAddress = typeof body?.stellarAddress === "string" ? body.stellarAddress.trim() : "";

  if (stellarAddress.length > 0) {
    return `auth:${stellarAddress}`;
  }

  return `ip:${req.socket?.remoteAddress ?? "unknown"}`;
}

authRouter.use(createPerUserRateLimiter({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => getAuthRateLimitKey(req),
}));

const refreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1),
});

function parseRefreshToken(body: unknown): string | null {
  const result = refreshTokenBodySchema.safeParse(body);
  return result.success ? result.data.refreshToken : null;
}

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = parseRefreshToken(req.body);

    if (!refreshToken) {
      throw RouteErrorFactory.badRequest("refreshToken is required and must be a string");
    }

    const result = await rotateRefreshToken(refreshToken);
    if (!result.ok) {
      throw result.error;
    }

    if (conditionalGet(result.value, req, res)) return;

    res.json(result.value);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const refreshToken = parseRefreshToken(req.body);

    if (!refreshToken) {
      throw RouteErrorFactory.badRequest("refreshToken is required and must be a string");
    }

    await revokeFamily(refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/wallet/logout", async (req, res, next) => {
  try {
    const refreshToken = parseRefreshToken(req.body);

    if (!refreshToken) {
      throw RouteErrorFactory.badRequest("refreshToken is required and must be a string");
    }

    await revokeFamily(refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const challengeBodySchema = z.object({
  stellarAddress: z.string().min(1),
});

authRouter.post("/challenge", async (req, res, next) => {
  try {
    const parsed = challengeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.badRequest("stellarAddress is required");
    }

    const result = await createChallenge(parsed.data.stellarAddress);
    const payload = {
      nonce: result.nonce,
      expiresAt: result.expiresAt.toISOString(),
    };

    if (conditionalGet(payload, req, res)) return;

    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
});

const verifyBodySchema = z.object({
  stellarAddress: z.string().refine(
    (addr) => StrKey.isValidEd25519PublicKey(addr),
    { message: "Invalid Stellar ed25519 public key" },
  ),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

authRouter.post("/verify", async (req, res, next) => {
  try {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation("Invalid request body", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const result = await verifyChallengeAndIssueJwt(
      parsed.data.stellarAddress,
      parsed.data.nonce,
      parsed.data.signature,
    );

    if (!result.ok) {
      throw result.error;
    }

    if (conditionalGet(result.value, req, res)) return;

    res.status(200).json(result.value);
  } catch (e) {
    next(e);
  }
});
