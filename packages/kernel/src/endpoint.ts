/**
 * `@Endpoint` — the audited-route contract.
 *
 * Every mutating route carries a permission and an audit code (CLAUDE.md). Declaring them next to the
 * handler is what lets CI assert the rule structurally instead of trusting review: an unregistered
 * audit code fails CI (ADR-005), and a route with no permission cannot exist because the decorator
 * will not build one.
 *
 * Note on syntax: this module *defines* a decorator but never *applies* one. Decorator syntax is not
 * supported by `node --experimental-strip-types`, so keeping `@` usage out of the kernel is what lets
 * the PURE smoke suites import kernel source directly. Application happens in `apps/api`, which is
 * compiled by tsc. See docs/07-engineering/TEST_STRATEGY.md.
 */

export interface EndpointSpec {
  /** Permission the caller must hold, e.g. `cases.case.update`. Checked through AUTHZ, deny-by-default. */
  readonly permission: string;
  /** Registered SCREAMING_SNAKE audit code, e.g. `CASE_UPDATED`. Must exist in the audit registry. */
  readonly auditCode: string;
  /** Optional human description, surfaced in the generated API catalogue. */
  readonly description?: string;
}

export interface EndpointRegistration extends EndpointSpec {
  /** Class that declared the route. */
  readonly target: string;
  /** Method that handles the route. */
  readonly method: string;
}

const registrations: EndpointRegistration[] = [];

/** Permission namespaces are snake_case, `<domain>.<entity>.<action>` (manifests/naming-map.yaml). */
const PERMISSION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;
/** Audit codes are SCREAMING_SNAKE (ADR-005). */
const AUDIT_CODE_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

/**
 * Validates an endpoint spec's shape. Returns the reasons it is invalid; empty means valid.
 *
 * Shape only. That the permission and audit code actually belong to the declaring module, and that the
 * code is registered, is a boot-time check against manifests/naming-map.yaml + audit-code-registry.yaml
 * — it needs modules to exist, so it lands with the first module in Stage 1.
 */
export function validateEndpointSpec(spec: EndpointSpec): string[] {
  const problems: string[] = [];
  if (!PERMISSION_PATTERN.test(spec.permission)) {
    problems.push(
      `permission "${spec.permission}" must be snake_case <domain>.<entity>.<action> (manifests/naming-map.yaml)`,
    );
  }
  if (!AUDIT_CODE_PATTERN.test(spec.auditCode)) {
    problems.push(`auditCode "${spec.auditCode}" must be SCREAMING_SNAKE (ADR-005)`);
  }
  return problems;
}

/**
 * Declares a route as audited and permissioned.
 *
 * Throws at class-definition time on a malformed spec rather than registering something that would fail
 * later at boot: fail closed, and fail where the mistake is (CLAUDE.md).
 */
export function Endpoint(spec: EndpointSpec) {
  const problems = validateEndpointSpec(spec);
  if (problems.length > 0) {
    throw new Error(`Invalid @Endpoint: ${problems.join('; ')}`);
  }

  return function decorate(
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    registrations.push({
      ...spec,
      target: (target.constructor as { name: string }).name,
      method: String(propertyKey),
    });
    return descriptor;
  };
}

/** Every endpoint declared so far. Consumed by the boot-time check and the conformance suite. */
export function endpointRegistrations(): readonly EndpointRegistration[] {
  return registrations;
}

/** Test seam — drops all registrations. Not for production use. */
export function resetEndpointRegistrations(): void {
  registrations.length = 0;
}
