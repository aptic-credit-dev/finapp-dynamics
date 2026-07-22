/**
 * Audit domain vocabulary — PURE. The enumerations that make an audit record queryable and comparable:
 * who acted (actor type), what kind of thing happened (category), and how it ended (outcome). Everything
 * here is deterministic and side-effect-free so it can be unit-tested without a database.
 */

// --- actor model ----------------------------------------------------------------------------------
/**
 * The kind of principal an action is attributed to. The current authorization boundary distinguishes a
 * human `user` from a `system` process (SystemContext carries no identity); the finer machine/administrative
 * types are representable now and populated as the boundary is enriched to carry them (see the completion
 * report — finer actor typing from request context is a documented follow-on).
 */
export const ACTOR_TYPES = [
  'user',
  'platform_admin',
  'tenant_admin',
  'service_account',
  'system_process',
  'integration',
  'scheduled_job',
  'migration',
  'anonymous',
  'impersonated',
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export function isActorType(v: string): v is ActorType {
  return (ACTOR_TYPES as readonly string[]).includes(v);
}

// --- outcome --------------------------------------------------------------------------------------
/** How a controlled action ended. `denied` and `indeterminate` are authorization outcomes (fail closed). */
export const OUTCOMES = ['success', 'failure', 'denied', 'error', 'indeterminate'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export function isOutcome(v: string): v is Outcome {
  return (OUTCOMES as readonly string[]).includes(v);
}

// --- category -------------------------------------------------------------------------------------
/** The investigative category of an event. Broad, stable buckets an investigator filters by. */
export const CATEGORIES = [
  'authentication',
  'authorization',
  'tenant_administration',
  'identity_administration',
  'role_administration',
  'permission_administration',
  'configuration',
  'data_access',
  'data_creation',
  'data_amendment',
  'state_transition',
  'approval',
  'rejection',
  'escalation',
  'assignment',
  'export',
  'download',
  'upload',
  'document_access',
  'notification',
  'integration',
  'security_event',
  'administrative_override',
  'sod_exception',
  'bootstrap',
  'system_operation',
  'failure',
] as const;
export type Category = (typeof CATEGORIES)[number];
export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

// --- module derivation ----------------------------------------------------------------------------
/**
 * Which module an audit code belongs to, derived from its registered prefix (manifests/naming-map.yaml
 * audit_prefixes). This is the "which module initiated the action" axis, taken from the code the caller
 * already had to register — no second source of truth. An unknown prefix returns 'unknown' rather than
 * throwing: an audit write must never break the business transaction it describes (fail safe, not closed).
 */
const PREFIX_TO_MODULE: readonly (readonly [string, string])[] = [
  ['TENANT_', 'm01-tenant'],
  ['IDENTITY_', 'm02-identity'],
  ['AUTH_', 'm02-auth'],
  ['RBAC_', 'm02-rbac'],
  ['AUDIT_', 'm03-audit'],
];
export function moduleForCode(code: string): string {
  for (const [prefix, module] of PREFIX_TO_MODULE) {
    if (code.startsWith(prefix)) return module;
  }
  return 'unknown';
}

/**
 * A best-effort category for a code on the compatibility `write()` path, from action keywords in the code.
 * Callers using the richer `record()` API state the category explicitly; this only classifies the legacy
 * minimal entry. Defaults to `state_transition` — the safe, common bucket for a lifecycle action.
 */
export function categoryForCode(code: string): Category {
  const c = code.toUpperCase();
  if (c.startsWith('AUTH_')) return 'authentication';
  if (c.startsWith('RBAC_')) {
    if (c.includes('ASSIGN')) return 'assignment';
    if (c.includes('SOD')) return 'sod_exception';
    if (c.includes('BOOTSTRAP')) return 'bootstrap';
    return 'role_administration';
  }
  if (c.startsWith('IDENTITY_')) return 'identity_administration';
  if (c.startsWith('TENANT_')) return 'tenant_administration';
  if (c.includes('CREATED')) return 'data_creation';
  if (c.includes('UPDATED') || c.includes('CHANGED')) return 'data_amendment';
  if (c.includes('APPROV')) return 'approval';
  if (c.includes('REJECT')) return 'rejection';
  if (c.includes('ESCALAT')) return 'escalation';
  if (c.includes('EXPORT')) return 'export';
  return 'state_transition';
}
