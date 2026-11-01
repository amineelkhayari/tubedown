import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { MediaProcessingError } from '../media/media-error';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) { res.destroy(); return; }
    let status = 500;
    let error = 'Internal server error.';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      error = Array.isArray(message) ? message.join('; ') : message ?? exception.message;
    } else if (exception instanceof MediaProcessingError) {
      status = 422;
      error = exception.message;
      this.logger.warn(`Media processing error: ${error}`);
    } else if (typeof exception === 'object' && exception && 'status' in exception && [400, 413, 415].includes(Number(exception.status))) {
      status = Number(exception.status);
      error = status === 413 ? 'Request body exceeds 4 KiB.' : 'Invalid request body.';
    } else this.logger.error('Unhandled request error', exception instanceof Error ? exception.stack : undefined);
    res.status(status).json({ statusCode: status, error });
  }
}
