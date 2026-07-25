import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ── Reusable component schemas ───────────────────────────────────────────────

export const ErrorBody = registry.register(
  "ErrorBody",
  z
    .object({
      error: z.object({ code: z.string(), requestId: z.string().optional() }),
    })
    .openapi("ErrorBody"),
);

export const ValidationErrorBody = registry.register(
  "ValidationErrorBody",
  z
    .object({
      error: z.object({ code: z.string(), details: z.any().optional() }),
    })
    .openapi("ValidationErrorBody"),
);

// ── Bearer auth security scheme ──────────────────────────────────────────────

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// ── /health ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/health",
  operationId: "healthCheck",
  tags: ["Health"],
  summary: "Liveness check",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ok") }),
        },
      },
    },
  },
});

// ── /healthz/dependencies ────────────────────────────────────────────────────

const DependencyHealth = z
  .object({
    status: z.enum(["ok", "degraded", "down"]),
    correlationId: z.string(),
    checkedAt: z.string().datetime(),
    dependencies: z.record(
      z.object({
        status: z.enum(["ok", "degraded", "down"]),
        latencyMs: z.number().optional(),
        error: z.string().optional(),
      }),
    ),
  })
  .openapi("DependencyHealth");

registry.registerPath({
  method: "get",
  path: "/healthz/dependencies",
  operationId: "healthDependencies",
  tags: ["Health"],
  summary: "External dependency health probes",
  responses: {
    200: {
      description: "All dependencies healthy",
      content: { "application/json": { schema: DependencyHealth } },
    },
    207: { description: "Some dependencies degraded" },
    503: { description: "One or more dependencies down" },
  },
});

// ── /api/users/health ────────────────────────────────────────────────────

const UsersHealthResponse = z
  .object({
    status: z.enum(["ok", "down"]),
    correlationId: z.string(),
    checkedAt: z.string().datetime(),
    dependencies: z.object({
      database: z.object({
        status: z.enum(["ok", "down"]),
        latencyMs: z.number(),
        error: z.string().optional(),
      }),
    }),
  })
  .openapi("UsersHealthResponse");

registry.registerPath({
  method: "get",
  path: "/api/users/health",
  operationId: "usersHealth",
  tags: ["Health"],
  summary: "User-facing dependency health probe",
  responses: {
    200: {
      description: "User service dependencies are healthy",
      content: { "application/json": { schema: UsersHealthResponse } },
    },
    503: {
      description: "User service dependency probe failed",
      content: { "application/json": { schema: UsersHealthResponse } },
    },
  },
});

// ── /metrics ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/metrics",
  operationId: "getMetrics",
  tags: ["Monitoring"],
  summary: "Prometheus metrics endpoint",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Prometheus text format metrics",
      content: { "text/plain": { schema: z.string() } },
    },
    401: {
      description: "Unauthorized (if METRICS_AUTH_TOKEN is set)",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /.well-known/jwks.json ───────────────────────────────────────────────────

const JwkKey = z
  .object({
    kid: z.string(),
    alg: z.literal("HS256"),
    kty: z.literal("oct"),
    use: z.literal("sig"),
  })
  .openapi("JwkKey");

const JwksResponse = z
  .object({
    keys: z.array(JwkKey),
  })
  .openapi("JwksResponse");

registry.registerPath({
  method: "get",
  path: "/.well-known/jwks.json",
  operationId: "getJwks",
  tags: ["JWKS"],
  summary: "JSON Web Key Set endpoint",
  description:
    "Returns the JSON Web Key Set containing metadata for all available JWT signing keys. " +
    "Follows RFC 7517 (JWK) and RFC 7513 (JWKS) where applicable, adapted for HMAC-based signing (HS256). " +
    "The actual secret values are never exposed - only key metadata is returned.",
  responses: {
    200: {
      description: "JWKS response with key metadata",
      content: { "application/json": { schema: JwksResponse } },
    },
  },
});

// ── /api/auth ────────────────────────────────────────────────────────────────

const ChallengeRequest = z
  .object({ stellarAddress: z.string() })
  .openapi("ChallengeRequest");
const ChallengeResponse = z
  .object({ nonce: z.string(), expiresAt: z.string().datetime() })
  .openapi("ChallengeResponse");

registry.registerPath({
  method: "post",
  path: "/api/auth/challenge",
  operationId: "authChallenge",
  tags: ["Auth"],
  summary: "Request a sign-in challenge nonce",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ChallengeRequest,
          examples: {
            challengeRequest: {
              value: {
                stellarAddress: "GABC1234567890DEFGHIJKLMNOPQRSTUVWX",
              },
            },
          },
        },
      },
    },
  },
  responses: {
    201: {
      description: "Challenge issued",
      content: {
        "application/json": {
          schema: ChallengeResponse,
          examples: {
            challengeIssued: {
              value: {
                nonce: "challenge-nonce-001",
                expiresAt: "2026-07-25T12:00:00.000Z",
              },
            },
          },
        },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
  },
});

const VerifyRequest = z
  .object({
    stellarAddress: z.string(),
    nonce: z.string(),
    signature: z.string(),
  })
  .openapi("VerifyRequest");
const TokenPair = z
  .object({ accessToken: z.string(), refreshToken: z.string() })
  .openapi("TokenPair");

registry.registerPath({
  method: "post",
  path: "/api/auth/verify",
  operationId: "authVerify",
  tags: ["Auth"],
  summary: "Verify challenge signature and obtain JWT",
  request: {
    body: {
      content: {
        "application/json": {
          schema: VerifyRequest,
          examples: {
            verifyRequest: {
              value: {
                stellarAddress: "GABC1234567890DEFGHIJKLMNOPQRSTUVWX",
                nonce: "challenge-nonce-001",
                signature: "ed25519-signature-hex",
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Tokens issued",
      content: {
        "application/json": {
          schema: TokenPair,
          examples: {
            tokensIssued: {
              value: {
                accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJnb29nbGUtdXNlcjEifQ.signature",
                refreshToken: "refresh-token-001",
              },
            },
          },
        },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Invalid signature",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

const RefreshRequest = z
  .object({ refreshToken: z.string().min(1) })
  .openapi("RefreshRequest");

registry.registerPath({
  method: "post",
  path: "/api/auth/refresh",
  operationId: "authRefresh",
  tags: ["Auth"],
  summary: "Rotate a refresh token",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RefreshRequest,
          examples: {
            refreshTokenRequest: {
              value: {
                refreshToken: "refresh-token-001",
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "New token pair",
      content: {
        "application/json": {
          schema: TokenPair,
          examples: {
            refreshedTokens: {
              value: {
                accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJnb29nbGUtdXNlcjEifQ.signature",
                refreshToken: "refresh-token-002",
              },
            },
          },
        },
      },
    },
    400: {
      description: "Missing token",
      content: { "application/json": { schema: ErrorBody } },
    },
    401: {
      description: "Invalid token",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Reuse detected \u2014 family revoked",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/logout",
  operationId: "authLogout",
  tags: ["Auth"],
  summary: "Revoke the entire refresh-token family",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RefreshRequest,
          examples: {
            logoutRequest: {
              value: {
                refreshToken: "refresh-token-001",
              },
            },
          },
        },
      },
    },
  },
  responses: {
    204: { description: "Logged out" },
    400: {
      description: "Missing token",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/markets ─────────────────────────────────────────────────────────────

const Market = z
  .object({
    id: z.string(),
    question: z.string(),
    status: z.string(),
    metadata: z.any().optional(),
    version: z.number().int(),
    createdAt: z.string().datetime(),
  })
  .openapi("Market");

const MarketSearchResult = z
  .object({
    data: z.array(Market),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    page: z.number().int(),
    fallback: z.boolean(),
    pagination: z.object({
      limit: z.number().int(),
      offset: z.number().int(),
      page: z.number().int(),
      total: z.number().int(),
      fallback: z.boolean(),
    }),
    meta: z.object({
      limit: z.number().int(),
      offset: z.number().int(),
      page: z.number().int(),
      total: z.number().int(),
      fallback: z.boolean(),
    }),
  })
  .openapi("MarketSearchResult");

registry.registerPath({
  method: "get",
  path: "/api/markets/recommendations",
  operationId: "getMarketRecommendations",
  tags: ["Markets"],
  summary: "Get personalized market recommendations",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Array of recommended markets",
      content: {
        "application/json": { schema: z.object({ data: z.array(Market) }) },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/markets",
  operationId: "listMarkets",
  tags: ["Markets"],
  summary: "List all markets",
  responses: {
    200: {
      description: "Array of markets",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(Market) }),
          examples: {
            default: {
              value: {
                data: [
                  {
                    id: "market-001",
                    question: "Will the US win the 2026 FIFA World Cup?",
                    status: "active",
                    metadata: {
                      category: "sports",
                      resolutionSource: "official",
                    },
                    version: 1,
                    createdAt: "2026-01-10T12:00:00.000Z",
                  },
                  {
                    id: "market-002",
                    question: "Will Stellar launch a new protocol upgrade in 2026?",
                    status: "active",
                    metadata: {
                      category: "technology",
                      resolutionSource: "community",
                    },
                    version: 2,
                    createdAt: "2026-02-14T07:30:00.000Z",
                  },
                ],
              },
            },
          },
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/markets/search",
  operationId: "searchMarkets",
  tags: ["Markets"],
  summary: "Full-text search across markets",
  request: {
    query: z.object({
      q: z.string().min(1),
      limit: z.coerce.number().int().positive().default(20).optional(),
      offset: z.coerce.number().int().nonnegative().default(0).optional(),
      page: z.coerce.number().int().positive().optional(),
    }),
  },
  responses: {
    200: {
      description: "Search results",
      content: {
        "application/json": { schema: MarketSearchResult },
      },
    },
    400: {
      description: "Missing query parameter",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/markets/tags",
  operationId: "getMarketTags",
  tags: ["Markets"],
  summary: "Get market tags with counts",
  responses: {
    200: {
      description: "Market tags with counts",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                tag: z.string(),
                count: z.number(),
              }),
            ),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/markets/{id}",
  operationId: "getMarketById",
  tags: ["Markets"],
  summary: "Get a market by ID",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Market",
      content: {
        "application/json": {
          schema: z.object({ data: Market }),
          examples: {
            default: {
              value: {
                data: {
                  id: "market-001",
                  question: "Will the US win the 2026 FIFA World Cup?",
                  status: "active",
                  metadata: {
                    category: "sports",
                    resolutionSource: "official",
                  },
                  version: 1,
                  createdAt: "2026-01-10T12:00:00.000Z",
                },
              },
            },
          },
        },
      },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

const PatchMarketRequest = z
  .object({
    question: z.string().optional(),
    metadata: z.any().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .openapi("PatchMarketRequest");

const FeaturedMarket = z
  .object({
    id: z.string(),
    question: z.string(),
    status: z.string(),
    resolutionOutcome: z.string().nullable().optional(),
    resolutionTime: z.string().datetime(),
    winningOutcome: z.string().nullable().optional(),
    metadata: z.any().nullable().optional(),
    featuredAt: z.string().datetime().nullable(),
    featuredBy: z.string().nullable(),
  })
  .openapi("FeaturedMarket");

const FeatureMarketResponse = z
  .object({
    marketId: z.string(),
    featured: z.boolean(),
    featuredAt: z.string().datetime().nullable(),
    featuredBy: z.string().nullable(),
    changed: z.boolean(),
  })
  .openapi("FeatureMarketResponse");

registry.registerPath({
  method: "patch",
  path: "/api/markets/{id}",
  operationId: "updateMarket",
  tags: ["Markets"],
  summary: "Update a market (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: PatchMarketRequest } } },
  },
  responses: {
    200: {
      description: "Updated market",
      content: { "application/json": { schema: z.object({ data: Market }) } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    409: {
      description: "Version conflict",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/markets/{id}/prediction-count ───────────────────────────────────────

const PredictionCountResponse = z
  .object({
    data: z.object({
      marketId: z.string(),
      count: z.number().int().nonnegative(),
      computedAt: z.string().datetime(),
      cached: z.boolean(),
    }),
  })
  .openapi("PredictionCountResponse");

registry.registerPath({
  method: "get",
  path: "/api/markets/{id}/prediction-count",
  operationId: "getMarketPredictionCount",
  tags: ["Markets"],
  summary: "Get total prediction count for a market",
  description:
    "Returns the total number of predictions placed on the given market. " +
    "Results are cached in Redis for 60 seconds. The `cached` field " +
    "indicates whether the value came from the cache.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Prediction count",
      content: { "application/json": { schema: PredictionCountResponse } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    404: {
      description: "Market not found",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/leaderboard ─────────────────────────────────────────────────────────

const LeaderboardEntry = z
  .object({
    rank: z.number().int(),
    stellarAddress: z.string(),
    score: z.number(),
  })
  .openapi("LeaderboardEntry");

registry.registerPath({
  method: "get",
  path: "/api/leaderboard",
  operationId: "getLeaderboard",
  tags: ["Leaderboard"],
  summary: "Get global leaderboard",
  request: {
    query: z.object({
      limit: z.coerce.number().int().positive().max(100).default(50),
      offset: z.coerce.number().int().nonnegative().default(0),
      refresh: z.coerce.boolean().default(false),
    }),
  },
  responses: {
    200: {
      description: "Leaderboard entries",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(LeaderboardEntry),
            meta: z.object({
              limit: z.number(),
              offset: z.number(),
              count: z.number(),
              refresh: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/leaderboard/user/{stellarAddress}",
  operationId: "getLeaderboardUser",
  tags: ["Leaderboard"],
  summary: "Get leaderboard entry for a specific user",
  request: { params: z.object({ stellarAddress: z.string() }) },
  responses: {
    200: {
      description: "Entry",
      content: {
        "application/json": { schema: z.object({ data: LeaderboardEntry }) },
      },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/rate-limit/status ──────────────────────────────────────────────────────

const AnonRateLimitStatus = z
  .object({
    data: z.object({
      type: z.literal("anonymous"),
      clientIp: z.string(),
      limit: z.number().int(),
      used: z.number().int(),
      remaining: z.number().int(),
      windowMs: z.number().int(),
      resetAt: z.string().datetime(),
    }),
  })
  .openapi("AnonRateLimitStatus");

const AuthRateLimitStatus = z
  .object({
    data: z.object({
      type: z.literal("authenticated"),
      limit: z.number().int(),
      windowMs: z.number().int(),
      bypasses: z.literal(true),
    }),
  })
  .openapi("AuthRateLimitStatus");

registry.registerPath({
  method: "get",
  path: "/api/rate-limit/status",
  operationId: "getRateLimitStatus",
  tags: ["Rate Limiting"],
  summary: "Get the current anonymous rate-limit status for the caller",
  responses: {
    200: {
      description: "Rate-limit status (type differs for anonymous vs authenticated callers)",
      content: {
        "application/json": {
          schema: z.union([AnonRateLimitStatus, AuthRateLimitStatus]),
        },
      },
    },
  },
});

// ── /api/markets/featured ────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/markets/featured",
  operationId: "getFeaturedMarkets",
  tags: ["Markets"],
  summary: "List currently featured markets for the home page",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(20).optional(),
    }),
  },
  responses: {
    200: {
      description: "Featured markets ordered by most recently featured first",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(FeaturedMarket) }),
        },
      },
    },
    400: {
      description: "Invalid query parameters",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/admin/markets/{id}/feature ──────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/admin/markets/{id}/feature",
  operationId: "featureAdminMarket",
  tags: ["Admin"],
  summary: "Feature a market on the home page (admin only, idempotent)",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Market featured (or already featured — `changed` indicates mutation)",
      content: {
        "application/json": {
          schema: z.object({ data: FeatureMarketResponse }),
        },
      },
    },
    400: {
      description: "Validation error or market is archived",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Market not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/admin/markets/{id}/feature",
  operationId: "unfeatureAdminMarket",
  tags: ["Admin"],
  summary: "Unfeature a market from the home page (admin only, idempotent)",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Market unfeatured (or already unfeatured — `changed` indicates mutation)",
      content: {
        "application/json": {
          schema: z.object({ data: FeatureMarketResponse }),
        },
      },
    },
    400: {
      description: "Validation error or market is archived",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Market not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

const FeatureFlag = z
  .object({
    key: z.string(),
    enabled: z.boolean(),
    description: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })
  .openapi("FeatureFlag");

const FeatureFlagListResponse = z
  .object({ data: z.array(FeatureFlag) })
  .openapi("FeatureFlagListResponse");

const FeatureFlagResponse = z
  .object({ data: FeatureFlag })
  .openapi("FeatureFlagResponse");

const CreateFeatureFlagRequest = z
  .object({
    key: z.string(),
    enabled: z.boolean(),
    description: z.string().max(280).nullable().optional(),
  })
  .openapi("CreateFeatureFlagRequest");

const UpdateFeatureFlagRequest = z
  .object({
    enabled: z.boolean().optional(),
    description: z.string().max(280).nullable().optional(),
  })
  .openapi("UpdateFeatureFlagRequest");

registry.registerPath({
  method: "get",
  path: "/api/admin/feature-flags",
  operationId: "listAdminFeatureFlags",
  tags: ["Admin"],
  summary: "List configured feature flags",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of feature flags",
      content: {
        "application/json": { schema: FeatureFlagListResponse },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/feature-flags",
  operationId: "createAdminFeatureFlag",
  tags: ["Admin"],
  summary: "Create a new feature flag",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateFeatureFlagRequest } } },
  },
  responses: {
    201: {
      description: "Feature flag created",
      content: {
        "application/json": { schema: FeatureFlagResponse },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    409: {
      description: "Feature flag already exists",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/feature-flags/{key}",
  operationId: "getAdminFeatureFlag",
  tags: ["Admin"],
  summary: "Get a configured feature flag",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ key: z.string().min(1).max(64) }) },
  responses: {
    200: {
      description: "Feature flag details",
      content: {
        "application/json": { schema: FeatureFlagResponse },
      },
    },
    400: {
      description: "Invalid feature flag key",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Feature flag not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/feature-flags/{key}",
  operationId: "updateAdminFeatureFlag",
  tags: ["Admin"],
  summary: "Update a feature flag",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ key: z.string().min(1).max(64) }),
    body: { content: { "application/json": { schema: UpdateFeatureFlagRequest } } },
  },
  responses: {
    200: {
      description: "Feature flag updated",
      content: {
        "application/json": { schema: FeatureFlagResponse },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Feature flag not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/admin/feature-flags/{key}",
  operationId: "deleteAdminFeatureFlag",
  tags: ["Admin"],
  summary: "Delete a feature flag",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ key: z.string().min(1).max(64) }) },
  responses: {
    204: { description: "Feature flag deleted" },
    400: {
      description: "Invalid feature flag key",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Feature flag not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/notifications ──────────────────────────────────────────────────────

const NotificationChannel = z
  .enum(["email", "webhook"])
  .openapi("NotificationChannel");
const NotificationCategory = z
  .enum(["market_resolved", "claim_ready", "dispute_opened"])
  .openapi("NotificationCategory");
const NotificationPreference = z
  .object({
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: z.boolean(),
  })
  .openapi("NotificationPreference");
const NotificationPreferencesResponse = z
  .object({ data: z.object({ preferences: z.array(NotificationPreference) }) })
  .openapi("NotificationPreferencesResponse");
const PatchNotificationPreferencesRequest = z
  .object({ preferences: z.array(NotificationPreference).min(1) })
  .openapi("PatchNotificationPreferencesRequest");

const NotificationId = z.string().uuid().openapi("NotificationId");

const MarkNotificationsReadRequest = z
  .object({
    notificationIds: z.array(NotificationId).optional(),
    markAllAsRead: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => (data.notificationIds?.length ?? 0) > 0 || data.markAllAsRead === true,
    {
      message: "Either notificationIds (non-empty array) or markAllAsRead=true is required",
      path: ["notificationIds"],
    },
  )
  .openapi("MarkNotificationsReadRequest");

const MarkNotificationsReadResponse = z
  .object({
    data: z.object({
      updatedCount: z.number().int().nonnegative(),
    }),
  })
  .openapi("MarkNotificationsReadResponse");

registry.registerPath({
  method: "get",
  path: "/api/notifications/preferences",
  operationId: "getNotificationPreferences",
  tags: ["Notifications"],
  summary: "Get the authenticated user\u2019s notification preferences",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Notification preferences",
      content: {
        "application/json": { schema: NotificationPreferencesResponse },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/notifications/preferences",
  operationId: "patchNotificationPreferences",
  tags: ["Notifications"],
  summary: "Update notification preferences for the authenticated user",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: PatchNotificationPreferencesRequest },
      },
    },
  },
  responses: {
    200: {
      description: "Updated notification preferences",
      content: {
        "application/json": { schema: NotificationPreferencesResponse },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/notifications/mark-read",
  operationId: "markNotificationsRead",
  tags: ["Notifications"],
  summary: "Mark notifications as read for the authenticated user",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: MarkNotificationsReadRequest },
      },
    },
  },
  responses: {
    200: {
      description: "Notifications marked as read",
      content: {
        "application/json": { schema: MarkNotificationsReadResponse },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/users ───────────────────────────────────────────────────────────────

const PredictionStatus = z.enum([
  "pending",
  "confirmed",
  "won",
  "lost",
  "claimed",
]);

const Prediction = z
  .object({
    id: z.string().uuid(),
    marketId: z.string(),
    status: PredictionStatus,
    createdAt: z.string().datetime(),
  })
  .openapi("Prediction");

const CurrentUserProfile = z
  .object({
    stellarAddress: z.string(),
    createdAt: z.string().datetime(),
    totals: z.object({
      prediction_count: z.number().int(),
      claim_count: z.number().int(),
    }),
  })
  .openapi("CurrentUserProfile");

const UserProfile = z
  .object({
    id: z.string().uuid(),
    stellarAddress: z.string(),
    joinedAt: z.string().datetime(),
    predictions: z.array(Prediction),
    totals: z.object({
      prediction_count: z.number().int(),
      claim_count: z.number().int(),
    }),
  })
  .openapi("UserProfile");

const FollowResult = z
  .object({
    follower: z.string(),
    followee: z.string(),
    followedAt: z.string().datetime(),
  })
  .openapi("FollowResult");

registry.registerPath({
  method: "get",
  path: "/api/users/me",
  operationId: "getCurrentUser",
  tags: ["Users"],
  summary: "Get the authenticated user\u2019s profile",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current user profile",
      content: {
        "application/json": {
          schema: z.object({ data: CurrentUserProfile }),
          examples: {
            currentUser: {
              value: {
                data: {
                  stellarAddress: "GABC1234567890DEFGHIJKLMNOPQRSTUVWX",
                  createdAt: "2026-06-27T12:00:00.000Z",
                  totals: {
                    prediction_count: 2,
                    claim_count: 0,
                  },
                },
              },
            },
          },
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/users/{address}/predictions",
  operationId: "getUserPredictions",
  tags: ["Users"],
  summary: "List predictions for a Stellar address",
  request: {
    params: z.object({ address: z.string() }),
    query: z.object({
      status: PredictionStatus.optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: {
      description: "Paginated predictions",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(Prediction),
            nextCursor: z.string().nullable(),
          }),
          examples: {
            samplePage: {
              value: {
                data: [
                  {
                    id: "11111111-1111-1111-1111-111111111111",
                    marketId: "market-abc-123",
                    status: "confirmed",
                    createdAt: "2026-06-27T12:00:00.000Z",
                  },
                ],
                nextCursor: "djF8MjR8...",
              },
            },
          },
        },
      },
    },
    400: {
      description: "Invalid address",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/users/{stellarAddress}/profile",
  operationId: "getUserProfile",
  tags: ["Users"],
  summary: "Get a user\u2019s public profile",
  request: { params: z.object({ stellarAddress: z.string() }) },
  responses: {
    200: {
      description: "User profile",
      content: {
        "application/json": {
          schema: z.object({ data: UserProfile }),
          examples: {
            publicProfile: {
              value: {
                data: {
                  id: "22222222-2222-2222-2222-222222222222",
                  stellarAddress: "GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV",
                  joinedAt: "2025-01-01T12:00:00.000Z",
                  predictions: [
                    {
                      id: "33333333-3333-3333-3333-333333333333",
                      marketId: "market-def-456",
                      status: "won",
                      createdAt: "2026-06-27T12:00:00.000Z",
                    },
                  ],
                  totals: {
                    prediction_count: 1,
                    claim_count: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
    400: {
      description: "Invalid Stellar address",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/predictions ──────────────────────────────────────────────────────────

/**
 * PredictionRow — the shape returned by GET /api/predictions.
 * Includes the joined market question and resolution time for display.
 */
const PredictionRow = z
  .object({
    id: z.string().uuid(),
    marketId: z.string(),
    question: z.string(),
    outcome: z.string(),
    amount: z.string(),
    txHash: z.string(),
    status: PredictionStatus,
    result: z.string().nullable(),
    createdAt: z.string().datetime(),
    resolutionTime: z.string().datetime(),
  })
  .openapi("PredictionRow");

const PredictionsListResponse = z
  .object({
    data: z.array(PredictionRow),
    /** Opaque cursor for the next page, or null if this is the last page. */
    nextCursor: z.string().nullable(),
  })
  .openapi("PredictionsListResponse");

/**
 * GET /api/predictions
 *
 * Returns a cursor-paginated list of predictions belonging to the
 * authenticated user.
 *
 * Keyset pagination on (createdAt DESC, id DESC) — stable and efficient
 * even as new rows are inserted between page loads.
 *
 * Filters: marketId, status, outcome (all optional).
 * Pagination: cursor + limit (default 20, max 100).
 */
registry.registerPath({
  method: "get",
  path: "/api/predictions",
  operationId: "listPredictions",
  tags: ["Predictions"],
  summary: "List the authenticated user\u2019s predictions",
  description:
    "Returns a cursor-paginated list of predictions placed by the caller. " +
    "Sort order is `createdAt DESC, id DESC`. " +
    "Pass the returned `nextCursor` as `?cursor=` to fetch the next page. " +
    "`nextCursor` is `null` when no further pages exist.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      /** Filter to a specific market. */
      marketId: z.string().min(1).max(128).optional(),
      /** Filter by prediction lifecycle status. */
      status: PredictionStatus.optional(),
      /** Filter by chosen outcome value (e.g. "yes" / "no"). */
      outcome: z.string().min(1).max(64).optional(),
      /** Opaque cursor from the previous page\u2019s `nextCursor`. */
      cursor: z.string().optional(),
      /** Page size — default 20, max 100. */
      limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated list of predictions",
      content: {
        "application/json": {
          schema: PredictionsListResponse,
          examples: {
            success: {
              value: {
                data: [
                  {
                    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                    marketId: "market_123",
                    question: "Will Bitcoin hit 100k in 2026?",
                    outcome: "yes",
                    amount: "50.0000000",
                    txHash: "8c253240be423ef8109d94101e40a02bc8f297b819f0ff4f4c20b8e906059e66",
                    status: "won",
                    result: "yes",
                    createdAt: "2026-05-01T12:00:00.000Z",
                    resolutionTime: "2026-06-01T12:00:00.000Z",
                  },
                ],
                nextCursor: "cursor_abc123",
              },
            },
          },
        },
      },
    },
    400: {
      description: "Validation error — invalid query parameters",
      content: {
        "application/json": {
          schema: ValidationErrorBody,
          examples: {
            invalidLimit: {
              value: {
                error: {
                  code: "VALIDATION_ERROR",
                  details: "Limit must be between 1 and 100",
                },
              },
            },
          },
        },
      },
    },
    401: {
      description: "Unauthorized — missing or invalid JWT",
      content: {
        "application/json": {
          schema: ErrorBody,
          examples: {
            unauthorized: {
              value: {
                error: {
                  code: "UNAUTHORIZED",
                  requestId: "req_xyz789",
                },
              },
            },
          },
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/users/{addr}/follow",
  operationId: "followUser",
  tags: ["Social"],
  summary: "Follow a user",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ addr: z.string() }) },
  responses: {
    200: {
      description: "Follow relationship created",
      content: {
        "application/json": {
          schema: z.object({ data: FollowResult }),
          examples: {
            followCreated: {
              value: {
                data: {
                  follower: "GABC1234567890DEFGHIJKLMNOPQRSTUVWX",
                  followee: "GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV",
                  followedAt: "2026-06-27T12:00:00.000Z",
                },
              },
            },
          },
        },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/users/{addr}/follow",
  operationId: "unfollowUser",
  tags: ["Social"],
  summary: "Unfollow a user",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ addr: z.string() }) },
  responses: {
    200: {
      description: "Follow relationship removed",
      content: {
        "application/json": {
          schema: z.object({ data: FollowResult }),
          examples: {
            followRemoved: {
              value: {
                data: {
                  follower: "GABC1234567890DEFGHIJKLMNOPQRSTUVWX",
                  followee: "GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV",
                  followedAt: "2026-06-27T12:00:00.000Z",
                },
              },
            },
          },
        },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

const AdminUserView = z
  .object({
    user: z
      .object({
        id: z.string(),
        stellarAddress: z.string(),
        createdAt: z.string().datetime(),
      })
      .nullable(),
    predictions: z.array(
      z.object({
        id: z.string(),
        marketId: z.string(),
        outcome: z.string(),
        amount: z.string(),
        createdAt: z.string().datetime(),
      }),
    ),
    claims: z.array(
      z.object({
        id: z.string(),
        marketId: z.string(),
        amount: z.string(),
        status: z.string(),
        createdAt: z.string().datetime(),
      }),
    ),
    disputes: z.array(
      z.object({
        id: z.string(),
        marketId: z.string(),
        reason: z.string(),
        status: z.string(),
        createdAt: z.string().datetime(),
      }),
    ),
    totals: z.object({
      predictions: z.number().int(),
      claims: z.number().int(),
      disputes: z.number().int(),
    }),
  })
  .openapi("AdminUserView");

registry.registerPath({
  method: "get",
  path: "/api/admin/users/{address}",
  operationId: "getAdminUser",
  tags: ["Admin"],
  summary: "Get aggregated user data for admin support",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ address: z.string() }) },
  responses: {
    200: {
      description: "Admin user view",
      content: { "application/json": { schema: z.object({ data: AdminUserView }) } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/admin/audit ────────────────────────────────────────────────────────

const AuditEntry = z
  .object({
    id: z.string().uuid(),
    action: z.string(),
    actor: z.string().optional(),
    targetAddress: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .openapi("AuditEntry");

registry.registerPath({
  method: "get",
  path: "/api/admin/audit",
  operationId: "getAdminAuditLog",
  tags: ["Admin"],
  summary: "List audit log entries (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      action: z.string().optional(),
      actor: z.string().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().positive().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated audit log",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(AuditEntry),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    400: {
      description: "Invalid query parameters",
      content: { "application/json": { schema: ErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/audit/export",
  operationId: "exportAdminAuditLog",
  tags: ["Admin"],
  summary: "Export audit log as NDJSON",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      action: z.string().optional(),
      actor: z.string().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: "Audit log export stream in NDJSON format",
      content: {
        "application/x-ndjson": { schema: z.string() },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/admin/plugins ─────────────────────────────────────────────────────

const PluginView = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    enabled: z.boolean(),
    config: z.any(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("PluginView");

const CreatePluginRequest = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .openapi("CreatePluginRequest");

const UpdatePluginRequest = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).nullable().optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .openapi("UpdatePluginRequest");

const DeletePluginResult = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
  })
  .openapi("DeletePluginResult");

// GET /api/admin/plugins
registry.registerPath({
  method: "get",
  path: "/api/admin/plugins",
  operationId: "listAdminPlugins",
  tags: ["Admin"],
  summary: "List all plugins (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      enabled: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated list of plugins",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(PluginView),
            total: z.number().int(),
          }),
        },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// POST /api/admin/plugins
registry.registerPath({
  method: "post",
  path: "/api/admin/plugins",
  operationId: "createAdminPlugin",
  tags: ["Admin"],
  summary: "Create a new plugin (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: CreatePluginRequest } },
    },
  },
  responses: {
    201: {
      description: "Plugin created",
      content: {
        "application/json": { schema: z.object({ data: PluginView }) },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    409: {
      description: "Plugin name already exists",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// GET /api/admin/plugins/{id}
registry.registerPath({
  method: "get",
  path: "/api/admin/plugins/{id}",
  operationId: "getAdminPlugin",
  tags: ["Admin"],
  summary: "Get a single plugin by ID (admin only)",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Plugin details",
      content: {
        "application/json": { schema: z.object({ data: PluginView }) },
      },
    },
    400: {
      description: "Invalid ID",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Plugin not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// PATCH /api/admin/plugins/{id}
registry.registerPath({
  method: "patch",
  path: "/api/admin/plugins/{id}",
  operationId: "updateAdminPlugin",
  tags: ["Admin"],
  summary: "Update a plugin (admin only)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: UpdatePluginRequest } },
    },
  },
  responses: {
    200: {
      description: "Plugin updated",
      content: {
        "application/json": { schema: z.object({ data: PluginView }) },
      },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Plugin not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// DELETE /api/admin/plugins/{id}
registry.registerPath({
  method: "delete",
  path: "/api/admin/plugins/{id}",
  operationId: "deleteAdminPlugin",
  tags: ["Admin"],
  summary: "Delete a plugin (admin only)",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Plugin deleted",
      content: {
        "application/json": { schema: z.object({ data: DeletePluginResult }) },
      },
    },
    400: {
      description: "Invalid ID",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    404: {
      description: "Plugin not found",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/admin/rate-limit/inspect/:address ─────────────────────────────────

const AdminRateLimitInspect = z
  .object({
    address: z.string().describe("Target Stellar address"),
    limit: z.number().int().describe("Configured request cap in the window"),
    used: z.number().int().describe("Requests currently active in the window"),
    remaining: z.number().int().describe("Requests remaining in the current window"),
    windowMs: z.number().int().describe("Sliding-window length in milliseconds"),
    resetAt: z.string().datetime().describe("ISO-8601 timestamp when the window resets"),
  })
  .openapi("AdminRateLimitInspect");

registry.registerPath({
  method: "get",
  path: "/api/admin/rate-limit/inspect/{address}",
  operationId: "inspectAdminRateLimit",
  tags: ["Admin"],
  summary: "Inspect current rate-limit state for an address (admin only)",
  description:
    "Returns the current sliding-window rate-limit usage for a target Stellar address. " +
    "Admin-only and read-only.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current rate-limit state for the requested address",
      content: { "application/json": { schema: z.object({ data: AdminRateLimitInspect }) } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/admin/health/detail ─────────────────────────────────────────────────

const CheckStatus = z
  .enum(["ok", "degraded", "error"])
  .openapi("CheckStatus");

const DbPoolStats = z
  .object({
    total: z.number().int().describe("Total connections in pool"),
    idle: z.number().int().describe("Idle (available) connections"),
    waiting: z.number().int().describe("Clients waiting for a connection"),
  })
  .openapi("DbPoolStats");

const DbPoolCheck = z
  .object({
    status: CheckStatus,
    latencyMs: z.number().int(),
    stats: DbPoolStats,
    error: z.string().optional(),
  })
  .openapi("DbPoolCheck");

const IndexerCheck = z
  .object({
    status: CheckStatus,
    latencyMs: z.number().int(),
    lastIndexedLedger: z.number().int().nullable(),
    chainTip: z.number().int().nullable(),
    lagLedgers: z.number().int().nullable(),
    error: z.string().optional(),
  })
  .openapi("IndexerCheck");

const RpcCheck = z
  .object({
    status: CheckStatus,
    latencyMs: z.number().int(),
    latestLedger: z.number().int().nullable(),
    error: z.string().optional(),
  })
  .openapi("RpcCheck");

const AdminHealthDetail = z
  .object({
    dbPool: DbPoolCheck,
    indexer: IndexerCheck,
    rpc: RpcCheck,
    checkedAt: z.string().datetime(),
  })
  .openapi("AdminHealthDetail");

registry.registerPath({
  method: "get",
  path: "/api/admin/health/detail",
  operationId: "getAdminHealthDetail",
  tags: ["Admin"],
  summary: "Detailed runtime health (admin only)",
  description:
    "Returns DB pool stats, indexer cursor/lag, and Soroban RPC status. " +
    "Returns 207 when any sub-check is degraded or errored.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "All checks healthy",
      content: { "application/json": { schema: AdminHealthDetail } },
    },
    207: {
      description: "One or more checks degraded or errored",
      content: { "application/json": { schema: AdminHealthDetail } },
    },
    403: {
      description: "Forbidden — missing or non-admin JWT",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/quota/requests ──────────────────────────────────────────────────

const QuotaType = z.enum(["prediction_limit", "daily_prediction_limit", "claim_limit"]).openapi("QuotaType");

const CreateQuotaRequestSchema = z
  .object({
    quotaType: QuotaType,
    requestedValue: z.number().int().min(1),
    reason: z.string().min(10).max(1000),
  })
  .openapi("CreateQuotaRequest");

const QuotaRequestSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    quotaType: z.string(),
    requestedValue: z.number().int(),
    reason: z.string(),
    status: z.string(),
    reviewedBy: z.string().nullable(),
    reviewNotes: z.string().nullable(),
    reviewedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("QuotaRequest");

registry.registerPath({
  method: "post",
  path: "/api/quota/requests",
  operationId: "createQuotaRequest",
  tags: ["Quota"],
  summary: "Submit a quota increase request",
  description:
    "Authenticated users can request an increase to their rate limits. " +
    "Each user may have at most 5 pending requests at a time.",
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateQuotaRequestSchema } } },
  },
  responses: {
    201: {
      description: "Quota request created",
      content: {
        "application/json": { schema: z.object({ data: QuotaRequestSchema }) },
      },
    },
    400: {
      description: "Validation error or too many pending requests",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    422: {
      description: "Validation error",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/quota/requests",
  operationId: "listQuotaRequests",
  tags: ["Quota"],
  summary: "List quota requests for the authenticated user",
  description: "Returns all quota requests submitted by the authenticated user, newest first.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of quota requests",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(QuotaRequestSchema) }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorBody } },
    },
    403: {
      description: "Forbidden",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

// ── /api/leaderboard/global ──────────────────────────────────────────────────

/**
 * GlobalLeaderboardEntry — a single row in the global leaderboard.
 * Aggregated across ALL markets (no time-window filter).
 */
const GlobalLeaderboardEntry = registry.register(
  "GlobalLeaderboardEntry",
  z
    .object({
      user_id: z.string().uuid().describe("Internal user UUID"),
      stellar_address: z.string().describe("User's Stellar public key (G…)"),
      total_predictions: z
        .number()
        .int()
        .nonnegative()
        .describe("Total predictions placed across all markets"),
      correct_predictions: z
        .number()
        .int()
        .nonnegative()
        .describe("Predictions whose outcome matched the resolved market outcome"),
      accuracy_percentage: z
        .number()
        .min(0)
        .max(100)
        .describe("Accuracy as a percentage (0–100), rounded to 2 d.p."),
      total_markets: z
        .number()
        .int()
        .nonnegative()
        .describe("Number of distinct markets in which the user participated"),
      rank: z
        .number()
        .int()
        .positive()
        .describe(
          "1-based global rank, ordered by accuracy DESC then total_predictions DESC",
        ),
    })
    .openapi("GlobalLeaderboardEntry"),
);

registry.registerPath({
  method: "get",
  path: "/api/leaderboard/global",
  operationId: "getGlobalLeaderboard",
  tags: ["Leaderboard"],
  summary: "Global leaderboard across all markets",
  description:
    "Returns a paginated leaderboard ranking all users by their prediction " +
    "accuracy and volume across **every** market on the platform. " +
    "Results are cached for 5 minutes. " +
    "Pass `refresh=true` to force an immediate materialized-view refresh " +
    "(expensive; intended for admin/debug use).",
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .positive()
        .max(100)
        .default(50)
        .describe("Maximum entries to return (1–100, default 50)"),
      offset: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(0)
        .describe("Zero-based row offset for pagination (default 0)"),
      refresh: z.coerce
        .boolean()
        .default(false)
        .describe(
          "When true, triggers REFRESH MATERIALIZED VIEW CONCURRENTLY before querying",
        ),
    }),
  },
  responses: {
    200: {
      description: "Paginated global leaderboard",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(GlobalLeaderboardEntry),
            meta: z.object({
              limit: z.number().int(),
              offset: z.number().int(),
              count: z.number().int(),
              refresh: z.boolean(),
            }),
          }),
        },
      },
    },
    400: {
      description: "Invalid query parameters",
      content: { "application/json": { schema: ValidationErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/leaderboard/global/user/{stellarAddress}",
  operationId: "getGlobalLeaderboardEntry",
  tags: ["Leaderboard"],
  summary: "Get a single user's global leaderboard entry",
  description:
    "Looks up the global leaderboard rank and stats for a specific Stellar " +
    "address. Returns 404 when the address has never placed a prediction.",
  request: {
    params: z.object({
      stellarAddress: z
        .string()
        .describe("The user's Stellar public key (G…)"),
    }),
  },
  responses: {
    200: {
      description: "User's global leaderboard entry",
      content: {
        "application/json": {
          schema: z.object({ data: GlobalLeaderboardEntry }),
        },
      },
    },
    404: {
      description: "Address not found on the global leaderboard",
      content: { "application/json": { schema: ErrorBody } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/json": { schema: ErrorBody } },
    },
    500: {
      description: "Internal server error",
      content: { "application/json": { schema: ErrorBody } },
    },
  },
});
