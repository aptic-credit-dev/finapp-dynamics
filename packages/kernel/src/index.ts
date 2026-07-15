export { DB, AUDIT, AUTHZ, OUTBOX, KERNEL_TOKENS } from './tokens.ts';
export type { KernelToken } from './tokens.ts';

export { runInContext, currentContext, isRequestContext, requireTenantContext } from './request-context.ts';
export type { RequestContext, SystemContext } from './request-context.ts';

export { ProblemError } from './problem-error.ts';
export type { ProblemDetails } from './problem-error.ts';

export {
  Endpoint,
  validateEndpointSpec,
  endpointRegistrations,
  resetEndpointRegistrations,
} from './endpoint.ts';
export type { EndpointSpec, EndpointRegistration } from './endpoint.ts';

export type { Db, Tx, QueryResult } from './db.ts';

// Contracts for the remaining kernel tokens. Each lives with its token; each is implemented exactly
// once, by its owning module (SHARED_SERVICE_OWNERSHIP.md): AUDIT -> m03, AUTHZ -> m02, OUTBOX -> m06.
export type { Audit, AuditEntry } from './audit.ts';
export type { Authz } from './authz.ts';
export type { Outbox } from './outbox.ts';

// NOTE: the PostgreSQL Db implementation is deliberately NOT exported here. It lives at
// `@finapp/kernel/pg` so the kernel root stays dependency-free and loadable under
// `node --experimental-strip-types` for the PURE smoke suites.
