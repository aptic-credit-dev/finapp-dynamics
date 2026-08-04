/**
 * The M04 admin-console domain — PURE vocabulary, state machines and the platform-vs-tenant scope classifier. No I/O,
 * so it is exhaustively unit-tested and shared by the services, the DB CHECKs (mirrored) and the API scope guard. M04
 * is ORCHESTRATION ONLY: it owns only its admin-operation lifecycle + saved-view/preference state; the tenant/identity/
 * role/audit data it administers lives in m01/m02/m03 and is reached through their public services.
 */
import { M04_PLATFORM_PERMISSIONS } from './permissions.ts';

export class AdminError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
  }
}

export const M04_LIMITS = { maxPageSize: 200, defaultPageSize: 50, maxReasonLength: 2000 } as const;

// --- admin scope (platform vs tenant) ----------------------------------------------------------
export const ADMIN_SCOPES = ['tenant', 'platform'] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];
export function isAdminScope(s: string): s is AdminScope {
  return (ADMIN_SCOPES as readonly string[]).includes(s);
}

/** The scope a permission belongs to — a PLATFORM permission is control-plane, a tenant admin never holds it. */
export function scopeOfPermission(permission: string): AdminScope {
  return (M04_PLATFORM_PERMISSIONS as readonly string[]).includes(permission) ? 'platform' : 'tenant';
}

// --- admin operation (the one M04-owned orchestration aggregate) -------------------------------
export const OPERATION_TYPES = [
  'tenant_suspend',
  'tenant_reactivate',
  'tenant_update',
  'account_activate',
  'account_deactivate',
  'role_assign',
  'role_revoke',
  'permission_grant',
  'permission_revoke',
  'sod_update',
  'workflow_publish',
  'rule_publish',
  'notification_configure',
  'audit_export',
  'audit_integrity_verify',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];
export function isOperationType(s: string): s is OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(s);
}

export const OPERATION_STATUSES = ['requested', 'executing', 'completed', 'failed', 'cancelled'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
const OPERATION_MACHINE: Record<string, string[]> = {
  requested: ['executing', 'cancelled'],
  executing: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};
export interface TransitionResult {
  readonly ok: boolean;
  readonly to?: string;
  readonly reason?: string;
}
export function checkOperationTransition(from: string, to: string): TransitionResult {
  const forState = OPERATION_MACHINE[from];
  if (forState === undefined) return { ok: false, reason: `unknown state "${from}"` };
  if (!forState.includes(to)) return { ok: false, reason: `cannot move "${from}" -> "${to}"` };
  return { ok: true, to };
}
export function isOperationTerminal(s: string): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled';
}

// --- reason codes (deterministic, explainable) -------------------------------------------------
export const REASON_CODES = {
  requested: 'operation_requested',
  executed: 'operation_executed',
  failed: 'operation_failed',
  cancelled: 'operation_cancelled',
  duplicateSuppressed: 'duplicate_suppressed',
  platformScopeRequired: 'platform_scope_required',
  tenantScopeRequired: 'tenant_scope_required',
  crossTenantDenied: 'cross_tenant_denied',
  immutableSystemRole: 'immutable_system_role',
  platformRoleDenied: 'platform_role_denied',
  staleVersion: 'stale_version',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// --- saved views / preferences -----------------------------------------------------------------
export const SAVED_VIEW_AREAS = [
  'tenants',
  'identities',
  'roles',
  'sod',
  'workflow',
  'rules',
  'notifications',
  'audit',
  'dashboard',
] as const;
export type SavedViewArea = (typeof SAVED_VIEW_AREAS)[number];
export function isSavedViewArea(s: string): s is SavedViewArea {
  return (SAVED_VIEW_AREAS as readonly string[]).includes(s);
}

// --- pagination (bounded) ----------------------------------------------------------------------
export interface Page {
  readonly limit: number;
  readonly offset: number;
}
/** Clamp caller-supplied paging to safe bounds — dashboards/lists never return unbounded result sets. */
export function clampPage(limit: number | undefined, offset: number | undefined): Page {
  const l = limit === undefined || !Number.isFinite(limit) ? M04_LIMITS.defaultPageSize : Math.floor(limit);
  const o = offset === undefined || !Number.isFinite(offset) ? 0 : Math.floor(offset);
  return {
    limit: Math.max(1, Math.min(M04_LIMITS.maxPageSize, l)),
    offset: Math.max(0, o),
  };
}
