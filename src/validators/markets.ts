import { z } from "zod";

/**
 * Schema for GET /api/markets query parameters
 */
export const listMarketsQuerySchema = z.object({
  limit: z.coerce.number().int("Limit must be an integer").min(1, "Limit must be between 1 and 100").max(100, "Limit must be between 1 and 100").default(20),
  cursor: z.string().optional(),
  status: z.string().trim().optional(),
  category: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  sort: z.string().trim().optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export type ListMarketsQuery = z.infer<typeof listMarketsQuerySchema>;

/**
 * Schema for GET /api/markets/search query parameters
 */
export const searchMarketsQuerySchema = z.object({
  q: z
    .string({ required_error: "Search query parameter 'q' is required" })
    .trim()
    .min(1, "Search query parameter 'q' is required"),
  limit: z.coerce.number().int("Limit must be an integer").min(1, "Limit must be between 1 and 100").max(100, "Limit must be between 1 and 100").default(20),
  offset: z.coerce.number().int("Offset must be an integer").min(0, "Offset must be non-negative").optional(),
  page: z.coerce.number().int("Page must be an integer").min(1, "Page must be at least 1").optional(),
});

export type SearchMarketsQuery = z.infer<typeof searchMarketsQuerySchema>;

/**
 * Schema for GET /api/markets/featured query parameters
 */
export const featuredMarketsQuerySchema = z.object({
  limit: z.coerce.number().int("limit must be an integer between 1 and 20").min(1, "limit must be an integer between 1 and 20").max(20, "limit must be an integer between 1 and 20").optional(),
});

export type FeaturedMarketsQuery = z.infer<typeof featuredMarketsQuerySchema>;

/**
 * Schema for GET /api/markets/upcoming query parameters
 */
export const upcomingMarketsQuerySchema = z.object({
  limit: z.coerce.number().int("limit must be between 1 and 100").min(1, "limit must be between 1 and 100").max(100, "limit must be between 1 and 100").default(50),
});

export type UpcomingMarketsQuery = z.infer<typeof upcomingMarketsQuerySchema>;

/**
 * Schema for route parameters containing market ID (:id)
 */
export const marketParamsSchema = z.object({
  id: z.string().trim().min(1, "Market ID is required").max(255, "Market ID is too long"),
});

export type MarketParams = z.infer<typeof marketParamsSchema>;

/**
 * Schema for PATCH /api/markets/:id body payload
 */
export const patchMarketBodySchema = z
  .object({
    question: z.string().trim().min(1, "Question cannot be empty").optional(),
    metadata: z.record(z.unknown()).optional(),
    expectedVersion: z
      .number({ required_error: "expectedVersion is required" })
      .int("expectedVersion must be an integer")
      .nonnegative("expectedVersion must be non-negative"),
  })
  .strict();

export type PatchMarketBody = z.infer<typeof patchMarketBodySchema>;
