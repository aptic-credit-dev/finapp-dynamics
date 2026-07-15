import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ProblemError, type ProblemDetails } from '@finapp/kernel';
import type { Request, Response } from 'express';

/**
 * The one error edge: everything leaving the API leaves as RFC 9457 `application/problem+json`.
 *
 * Three cases, in order:
 *  1. `ProblemError` — a deliberate, described refusal. Passes through as-is.
 *  2. `HttpException` — the framework's own (a 404 for an unrouted path, a 400 from a pipe). Its STATUS
 *     is preserved and only its shape is translated. Collapsing these into 500 would tell a caller the
 *     server broke when in fact they asked for something that does not exist — and would hide every
 *     routing mistake behind an alarm.
 *  3. Anything else — a bare 500 carrying only a correlation id. Stack traces, driver messages, and SQL
 *     never reach a caller: a constraint violation would happily name a table, a column, and sometimes
 *     another tenant's value. The detail goes to the log under the same correlation id.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const correlationId = request.header('x-correlation-id');

    const problem = this.toProblem(exception, correlationId);
    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, correlationId: string | undefined): ProblemDetails {
    if (exception instanceof ProblemError) {
      return exception.toJSON();
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return new ProblemError({
        type: `https://finapp.dynamics/problems/${slugFor(status)}`,
        title: STATUS_TITLES[status] ?? 'Error',
        status,
        // The framework's own message only. A pipe's validation message is safe; anything richer would
        // have been raised as a ProblemError by the code that knew what it was refusing and why.
        detail: exception.message,
        ...(correlationId === undefined ? {} : { correlationId }),
      }).toJSON();
    }

    console.error('[unhandled]', { correlationId, error: exception });
    return ProblemError.internal(
      'The request could not be completed. Quote the correlation id when reporting this.',
      correlationId,
    ).toJSON();
  }
}

const STATUS_TITLES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

function slugFor(status: number): string {
  return (STATUS_TITLES[status] ?? 'error').toLowerCase().replaceAll(' ', '-');
}
