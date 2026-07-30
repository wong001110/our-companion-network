import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || message;
      code = this.errorCode(status, exceptionResponse);
    } else {
      const diagnostic = exception instanceof Error ? exception.message : 'Unknown request exception';
      // Log only a bounded, credential-redacted operational diagnostic. The
      // request ID lets Railway logs be correlated without exposing a Prisma
      // error, SQL detail, or user data to the desktop client.
      const route = request.route?.path ?? request.path;
      console.error(`[api] requestId=${requestId} ${request.method} ${route} unexpected failure: ${diagnostic.replace(/\w+:\/\/[^\s]+/g, '[REDACTED_URL]').slice(0, 500)}`);
    }

    response.status(status).json({
      error: {
        code,
        message: Array.isArray(message) ? message.join(', ') : message,
        requestId,
      },
    });
  }

  private errorCode(status: number, response: unknown): string {
    const supplied = typeof response === 'object' && response !== null ? (response as { code?: unknown }).code : undefined;
    if (typeof supplied === 'string') return supplied;
    return ({
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
      [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION_FAILED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    } as Record<number, string>)[status] ?? 'INTERNAL_ERROR';
  }
}
