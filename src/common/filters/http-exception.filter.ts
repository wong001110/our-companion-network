import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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
    }

    response.status(status).json({
      error: {
        code,
        message: Array.isArray(message) ? message.join(', ') : message,
        requestId: randomUUID(),
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
