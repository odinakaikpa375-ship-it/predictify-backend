import { Request, Response, NextFunction } from "express";

/**
 * Creates an Express middleware that enforces a maximum request duration.
 * If the route handler does not finish before `timeoutMs`, the request is
 * aborted gracefully with a 408 Request Timeout error envelope.
 *
 * @param timeoutMs - Time in milliseconds before the request times out
 */
export function requestTimeout(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    let settled = false;
    const controller = new AbortController();
    res.locals.abortSignal = controller.signal;

    const finish = () => {
      settled = true;
      clearTimeout(timer);
    };

    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;

      settled = true;
      abort();
      if (!res.headersSent) {
        const correlationId = (res.locals.correlationId as string) || "unknown";
        res.status(408).json({
          error: {
            code: "timeout",
            message: "Request timeout exceeded",
            requestId: correlationId,
          },
        });
      }
    }, timeoutMs);

    req.on("close", () => {
      abort();
    });

    res.on("finish", finish);
    res.on("close", finish);

    next();
  };
}
