import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "string") {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === "object" &&
        "message" in exceptionResponse
      ) {
        const responseMessage = (
          exceptionResponse as { message?: string | string[] }
        ).message;
        message =
          responseMessage ??
          (statusCode >= 500 ? "Internal server error" : exception.message);
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error("Unhandled non-Error exception", String(exception));
    }

    response.status(statusCode).json({
      statusCode,
      message,
    });
  }
}
