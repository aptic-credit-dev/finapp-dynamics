import { defineSuite } from '@finapp/test-runner';
import {
  DB,
  AUDIT,
  AUTHZ,
  OUTBOX,
  KERNEL_TOKENS,
  runInContext,
  currentContext,
  isRequestContext,
  requireTenantContext,
  ProblemError,
  validateEndpointSpec,
  Endpoint,
  endpointRegistrations,
  resetEndpointRegistrations,
  type RequestContext,
  type SystemContext,
} from '@finapp/kernel';

/**
 * Kernel PURE smoke suite — the deterministic safety core of the kernel.
 *
 * No database, no DI container, no HTTP. What is asserted here is what must hold before a single
 * business table exists: contexts do not leak, ambiguity fails closed, and a route cannot be declared
 * without a permission and a registered-shape audit code.
 */
export default defineSuite('kernel', (t) => {
  // --- DI tokens -----------------------------------------------------------------------------------
  t.equal(KERNEL_TOKENS.length, 4, 'exactly four kernel tokens');
  t.ok(KERNEL_TOKENS.includes(DB), 'DB is a kernel token');
  t.ok(KERNEL_TOKENS.includes(AUDIT), 'AUDIT is a kernel token');
  t.ok(KERNEL_TOKENS.includes(AUTHZ), 'AUTHZ is a kernel token');
  t.ok(KERNEL_TOKENS.includes(OUTBOX), 'OUTBOX is a kernel token');
  t.equal(new Set(KERNEL_TOKENS).size, 4, 'kernel tokens are distinct — no two services share a binding');

  // --- RequestContext ------------------------------------------------------------------------------
  const tenantCtx: RequestContext = {
    tenantId: 'tenant-a',
    userId: 'user-1',
    correlationId: 'corr-1',
    permissions: ['cases.case.read'],
  };
  const systemCtx: SystemContext = { reason: 'outbox drain', correlationId: 'corr-2' };

  t.equal(currentContext(), undefined, 'no ambient context outside runInContext');

  runInContext(tenantCtx, () => {
    t.equal(currentContext(), tenantCtx, 'ambient context is the one entered');
    t.ok(isRequestContext(currentContext()), 'a tenant context is a RequestContext');
    t.equal(requireTenantContext().tenantId, 'tenant-a', 'requireTenantContext returns the tenant');
  });

  t.equal(currentContext(), undefined, 'context does not survive the runInContext call');

  runInContext(systemCtx, () => {
    t.ok(!isRequestContext(currentContext()), 'a system context is not a RequestContext');
    // The fail-closed rule: system context must never satisfy code that wants a tenant.
    t.throws(() => requireTenantContext(), 'requireTenantContext rejects a system context');
  });

  t.throws(() => requireTenantContext(), 'requireTenantContext rejects the absence of any context');

  // Nesting must not let an inner context leak back out to the outer one.
  runInContext(tenantCtx, () => {
    const inner: RequestContext = { ...tenantCtx, tenantId: 'tenant-b', correlationId: 'corr-3' };
    runInContext(inner, () => {
      t.equal(requireTenantContext().tenantId, 'tenant-b', 'inner context wins while inside it');
    });
    t.equal(requireTenantContext().tenantId, 'tenant-a', 'outer context restored after nesting');
  });

  // --- ProblemError --------------------------------------------------------------------------------
  const forbidden = ProblemError.forbidden('Approver must differ from the requester.', 'corr-9');
  t.equal(forbidden.status, 403, 'forbidden carries HTTP 403');
  t.equal(forbidden.correlationId, 'corr-9', 'a problem carries its correlation id');
  t.ok(forbidden instanceof Error, 'ProblemError is an Error');
  t.equal(ProblemError.notFound('x').status, 404, 'notFound carries HTTP 404');
  t.equal(ProblemError.conflict('x').status, 409, 'conflict carries HTTP 409');
  t.equal(ProblemError.internal('x').status, 500, 'internal carries HTTP 500');

  // `cause` must never reach the wire — it is where server-side detail lives.
  const wrapped = new ProblemError(
    { type: 'https://finapp.dynamics/problems/internal', title: 'Internal Server Error', status: 500 },
    { cause: new Error('connection string user=admin password=hunter2') },
  );
  t.ok(!JSON.stringify(wrapped).includes('hunter2'), 'ProblemError.toJSON does not serialise cause');
  t.ok(
    !JSON.stringify(wrapped).includes('undefined'),
    'toJSON omits absent fields rather than emitting undefined',
  );

  // --- @Endpoint -----------------------------------------------------------------------------------
  t.deepEqual(
    validateEndpointSpec({ permission: 'cases.case.update', auditCode: 'CASE_UPDATED' }),
    [],
    'a well-formed endpoint spec has no problems',
  );
  t.equal(
    validateEndpointSpec({ permission: 'Cases.Case.Update', auditCode: 'CASE_UPDATED' }).length,
    1,
    'a PascalCase permission is rejected',
  );
  t.equal(
    validateEndpointSpec({ permission: 'cases.update', auditCode: 'CASE_UPDATED' }).length,
    1,
    'a permission missing the entity segment is rejected',
  );
  t.equal(
    validateEndpointSpec({ permission: 'cases.case.update', auditCode: 'CaseUpdated' }).length,
    1,
    'a PascalCase audit code is rejected (ADR-005 requires SCREAMING_SNAKE)',
  );
  t.equal(
    validateEndpointSpec({ permission: 'cases.case.update', auditCode: '' }).length,
    1,
    'an empty audit code is rejected',
  );
  t.equal(
    validateEndpointSpec({ permission: '', auditCode: '' }).length,
    2,
    'every problem is reported, not just the first',
  );

  t.throws(
    () => Endpoint({ permission: 'nope', auditCode: 'nope' }),
    'Endpoint() throws at declaration time on a malformed spec rather than registering it',
  );

  resetEndpointRegistrations();
  t.equal(endpointRegistrations().length, 0, 'the endpoint registry starts empty');
  // Applied via a direct call rather than `@` syntax — decorator syntax is unsupported under
  // node --experimental-strip-types, which is exactly why the kernel never applies one itself.
  const descriptor: PropertyDescriptor = { value: () => undefined };
  Endpoint({ permission: 'cases.case.update', auditCode: 'CASE_UPDATED' })(
    { constructor: { name: 'CaseController' } },
    'update',
    descriptor,
  );
  t.equal(endpointRegistrations().length, 1, 'a valid endpoint registers');
  t.equal(endpointRegistrations()[0]?.auditCode, 'CASE_UPDATED', 'the registration carries its audit code');
  t.equal(
    endpointRegistrations()[0]?.target,
    'CaseController',
    'the registration carries its declaring class',
  );
  resetEndpointRegistrations();
});
