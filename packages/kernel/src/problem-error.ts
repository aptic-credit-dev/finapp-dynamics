/**
 * The one error type crossing a module boundary — an RFC 9457 `application/problem+json` payload.
 *
 * Safety default: when a check is ambiguous we deny and surface a clear reason (CLAUDE.md). A denial
 * must say *why* without leaking whether the resource exists, who owns it, or anything about another
 * tenant — so the human-facing `detail` is deliberately separate from `cause`, which stays server-side.
 */
export interface ProblemDetails {
  /** Stable URI reference identifying the problem type. */
  readonly type: string;
  /** Short, human-readable summary. Does not change between occurrences. */
  readonly title: string;
  /** HTTP status code. */
  readonly status: number;
  /** Human-readable explanation specific to this occurrence. Safe to return to the caller. */
  readonly detail?: string;
  /** URI reference identifying the specific occurrence. */
  readonly instance?: string;
  /** Correlation id, so a caller reporting a failure can be traced to its audit trail. */
  readonly correlationId?: string;
}

export class ProblemError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string | undefined;
  readonly instance: string | undefined;
  readonly correlationId: string | undefined;

  constructor(problem: ProblemDetails, options?: { cause?: unknown }) {
    super(problem.detail ?? problem.title, options);
    this.name = 'ProblemError';
    this.type = problem.type;
    this.title = problem.title;
    this.status = problem.status;
    this.detail = problem.detail;
    this.instance = problem.instance;
    this.correlationId = problem.correlationId;
  }

  /** The wire representation. Only fields on `ProblemDetails` are ever serialised — `cause` is not. */
  toJSON(): ProblemDetails {
    const out: Record<string, unknown> = { type: this.type, title: this.title, status: this.status };
    if (this.detail !== undefined) out['detail'] = this.detail;
    if (this.instance !== undefined) out['instance'] = this.instance;
    if (this.correlationId !== undefined) out['correlationId'] = this.correlationId;
    return out as unknown as ProblemDetails;
  }

  /**
   * The caller is not a proven actor: no assertion, a bad one, or one that resolves to nothing.
   *
   * Kept distinct from `forbidden` on purpose. 401 means "we do not know who you are"; 403 means "we know,
   * and the answer is no". Collapsing them costs the difference between a caller who should authenticate
   * and one who should stop asking — and makes actor-resolution failures indistinguishable from
   * permission failures in a log.
   */
  static unauthorized(detail: string, correlationId?: string): ProblemError {
    return new ProblemError({
      type: 'https://finapp.dynamics/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }

  static forbidden(detail: string, correlationId?: string): ProblemError {
    return new ProblemError({
      type: 'https://finapp.dynamics/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }

  static notFound(detail: string, correlationId?: string): ProblemError {
    return new ProblemError({
      type: 'https://finapp.dynamics/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }

  static conflict(detail: string, correlationId?: string): ProblemError {
    return new ProblemError({
      type: 'https://finapp.dynamics/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }

  static internal(detail: string, correlationId?: string): ProblemError {
    return new ProblemError({
      type: 'https://finapp.dynamics/problems/internal',
      title: 'Internal Server Error',
      status: 500,
      detail,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }
}
