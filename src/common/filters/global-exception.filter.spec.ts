import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { GlobalExceptionFilter } from "./global-exception.filter";

describe("GlobalExceptionFilter", () => {
  const createHttpContext = () => {
    const status = jest.fn();
    const json = jest.fn();
    const response = {
      status,
      json,
    } as unknown as Response;
    status.mockReturnValue(response);

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves Premium metadata on a 403 response", () => {
    const { host, status, json } = createHttpContext();
    const exception = new ForbiddenException({
      code: "PREMIUM_REQUIRED",
      message: "Premium required",
      feature: "installment_expenses",
      isPremium: false,
    });

    new GlobalExceptionFilter().catch(exception, host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      statusCode: 403,
      message: "Premium required",
      code: "PREMIUM_REQUIRED",
      feature: "installment_expenses",
    });
  });

  it("keeps the previous envelope for a common HTTP error", () => {
    const { host, json } = createHttpContext();

    new GlobalExceptionFilter().catch(
      new BadRequestException("Invalid request"),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: "Invalid request",
    });
  });

  it("does not expose non-string metadata or arbitrary fields", () => {
    const { host, json } = createHttpContext();
    const exception = new ForbiddenException({
      message: "Forbidden",
      code: 123,
      feature: { name: "credit_cards_catalog" },
      isPremium: true,
      internal: "sensitive",
      stack: "hidden",
    });

    new GlobalExceptionFilter().catch(exception, host);

    expect(json).toHaveBeenCalledWith({
      statusCode: 403,
      message: "Forbidden",
    });
  });

  it("keeps the previous envelope for an internal error", () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    const { host, status, json } = createHttpContext();

    new GlobalExceptionFilter().catch(new Error("Database unavailable"), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: "Internal server error",
    });
  });
});
