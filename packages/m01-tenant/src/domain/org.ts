import { validateOrgCode } from './tenant-code.ts';

/**
 * Organisational scope and environment rules — pure.
 *
 * The hierarchy is tenant → entity (subsidiary/legal entity) → department → branch, per
 * docs/03-platform/SAAS_FOUNDATION.md. Entities and departments may nest within their own kind; branches
 * do not.
 */

export const ENVIRONMENT_TYPES = ['production', 'sandbox', 'uat', 'training', 'demonstration'] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

export function isEnvironmentType(value: string): value is EnvironmentType {
  return (ENVIRONMENT_TYPES as readonly string[]).includes(value);
}

export const ENVIRONMENT_STATUSES = ['planned', 'active', 'suspended', 'retired'] as const;
export type EnvironmentStatus = (typeof ENVIRONMENT_STATUSES)[number];

export const PROVISIONING_STATUSES = ['not_started', 'in_progress', 'provisioned', 'failed'] as const;
export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];

export const ORG_STATUSES = ['active', 'inactive', 'removed'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export function isOrgStatus(value: string): value is OrgStatus {
  return (ORG_STATUSES as readonly string[]).includes(value);
}

export type OrgNodeKind = 'entity' | 'department' | 'branch';

export interface EffectiveDates {
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | null;
}

/**
 * An open-ended period (`effectiveTo` null) is normal and means "still in force" — not "unknown".
 * A period that ends before it starts is always a data-entry error.
 */
export function validateEffectiveDates(dates: EffectiveDates): string | null {
  const to = dates.effectiveTo;
  if (to === undefined || to === null) return null;
  if (to.getTime() <= dates.effectiveFrom.getTime()) {
    return 'effectiveTo must be strictly after effectiveFrom.';
  }
  return null;
}

export interface OrgNodeInput {
  readonly kind: OrgNodeKind;
  readonly code: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | null;
}

/**
 * Validates an organisational node. Returns every problem, not just the first — a form that reveals its
 * errors one at a time is a form people give up on.
 */
export function validateOrgNode(input: OrgNodeInput): string[] {
  const problems: string[] = [];

  const codeProblem = validateOrgCode(input.kind, input.code);
  if (codeProblem !== null) problems.push(codeProblem);

  if (input.name.trim() === '') problems.push(`${input.kind} name is required.`);
  if (input.name.length > 200) problems.push(`${input.kind} name must be 200 characters or fewer.`);

  const dateProblem = validateEffectiveDates(input);
  if (dateProblem !== null) problems.push(dateProblem);

  // Branches sit under an entity, not under other branches: a branch is a physical place, and a place
  // inside another place is a department.
  if (input.kind === 'branch' && input.parentId !== undefined && input.parentId !== null) {
    problems.push('A branch cannot have a parent branch. Branches attach to an entity.');
  }

  return problems;
}

/**
 * Rejects a cycle in a self-referencing hierarchy, given the ancestor chain of the proposed parent.
 *
 * Postgres cannot express this: a composite FK guarantees the parent exists in the same tenant, but
 * nothing stops A → B → A. A cycle makes every recursive scope query hang or blow the stack, so it is
 * checked before the write.
 */
export function wouldCreateCycle(
  nodeId: string,
  parentId: string | null,
  ancestorsOfParent: readonly string[],
): boolean {
  if (parentId === null) return false;
  if (parentId === nodeId) return true;
  return ancestorsOfParent.includes(nodeId);
}

export interface EnvironmentInput {
  readonly code: string;
  readonly environmentType: string;
  readonly isDefault: boolean;
}

export function validateEnvironment(input: EnvironmentInput): string[] {
  const problems: string[] = [];

  const codeProblem = validateOrgCode('environment', input.code);
  if (codeProblem !== null) problems.push(codeProblem);

  if (!isEnvironmentType(input.environmentType)) {
    problems.push(`Environment type must be one of: ${ENVIRONMENT_TYPES.join(', ')}.`);
  }

  return problems;
}
