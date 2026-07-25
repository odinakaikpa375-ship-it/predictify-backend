import { requestTimeout } from "../../src/middleware/timeout";
import { Request, Response, NextFunction } from "express";

describe("requestTimeout Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    jest.useFakeTimers();
    req = {
      on: jest.fn(),
    };
    res = {
      locals: { correlationId: "test-req-id" },
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls next()", () => {
    const middleware = requestTimeout(1000);
    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.locals?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("sends 408 when timeout is exceeded and headers are not sent", () => {
    const middleware = requestTimeout(1000);
    middleware(req as Request, res as Response, next);

    jest.advanceTimersByTime(1000);

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "timeout",
        message: "Request timeout exceeded",
        requestId: "test-req-id",
      },
    });
  });

  it("does not send 408 if headers are already sent", () => {
    const middleware = requestTimeout(1000);
    res.headersSent = true;
    middleware(req as Request, res as Response, next);

    jest.advanceTimersByTime(1000);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
