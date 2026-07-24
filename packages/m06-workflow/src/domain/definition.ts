/**
 * Workflow definition format (ADR-021/022/024) — PURE. A definition is a declarative, versioned, immutable
 * JSON document (`spec jsonb`). These are the TypeScript shapes; `validator.ts` enforces them structurally
 * and rejects anything unsafe. No code, SQL, shell, or network can appear in a definition — conditions are
 * SAFE interpreted expressions (see expression.ts), everything else is data.
 */

export const WORKFLOW_SCHEMA_VERSION = 1;

/** Hard ceilings — the validator rejects a definition that exceeds any of them (bounds DoS / runaway graphs). */
export const DEFINITION_LIMITS = {
  maxNodes: 200,
  maxTransitions: 400,
  maxVariables: 100,
  maxParallelBranches: 32,
  maxSubWorkflowDepth: 5,
  maxLoopIterations: 1000,
  maxRetries: 10,
  maxTimerHorizonDays: 400,
  maxConditionLength: 2000,
  codePattern: /^[a-z][a-z0-9_]{1,63}$/,
  nodeKeyPattern: /^[A-Za-z_][A-Za-z0-9_]{0,63}$/,
} as const;

export const VARIABLE_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'ref'] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export interface WorkflowVariableDef {
  readonly name: string;
  readonly type: VariableType;
  readonly required?: boolean;
  /** Allowed values when `type` is `enum`. */
  readonly enumValues?: readonly string[];
}

export interface WorkflowNodeDef {
  readonly key: string;
  readonly type: string; // validated against NodeType + MVP allow-list
  readonly name?: string;
  /**
   * Node-type-specific config. Examples: SYSTEM_TASK `{ handler: string }` (allow-listed handler key);
   * PARALLEL_SPLIT `{ joinKey: string }` (its matching join); TIMER_WAIT `{ durationSeconds: number }`;
   * APPROVAL_TASK `{ policy: ... }`. Values are data only — never executable.
   */
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface WorkflowTransitionDef {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  /** A SAFE condition expression (expression.ts). Absent = an unconditional / default edge. */
  readonly condition?: string;
}

export const SLA_TYPES = ['response', 'completion', 'resolution'] as const;
export type SlaType = (typeof SLA_TYPES)[number];

export interface WorkflowSlaDef {
  readonly key: string;
  readonly slaType: SlaType;
  readonly nodeKey?: string;
  readonly targetSeconds: number;
  readonly warnPct?: number;
  readonly calendarRef?: string;
}

export const ASSIGNMENT_STRATEGIES = [
  'named_user',
  'role',
  'department',
  'branch',
  'entity',
  'escalation_chain',
  'unassigned_queue',
] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export interface WorkflowAssignmentRuleDef {
  readonly nodeKey: string;
  readonly strategy: AssignmentStrategy;
  readonly params?: Readonly<Record<string, unknown>>;
}

export const ESCALATION_TRIGGERS = ['warn', 'breach', 'inactivity'] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export interface WorkflowEscalationStep {
  readonly afterSeconds: number;
  readonly strategy: AssignmentStrategy;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface WorkflowEscalationRuleDef {
  readonly key: string;
  readonly nodeKey?: string;
  readonly trigger: EscalationTrigger;
  readonly ladder: readonly WorkflowEscalationStep[];
}

/** Approval policy for an APPROVAL_TASK node (ADR-026). Configured on the version (local approval config). */
export const APPROVAL_MODES = [
  'single',
  'sequential',
  'parallel',
  'unanimous',
  'quorum',
  'first_response',
] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export interface ApprovalPolicy {
  readonly mode: ApprovalMode;
  /** For quorum: how many approvals are required. */
  readonly quorum?: number;
  /** Whether the maker of the subject action may approve (default false — no self-approval, ADR-026). */
  readonly allowSelfApproval?: false;
}

export interface WorkflowDefinitionSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly variables: readonly WorkflowVariableDef[];
  readonly nodes: readonly WorkflowNodeDef[];
  readonly transitions: readonly WorkflowTransitionDef[];
  readonly sla?: readonly WorkflowSlaDef[];
  readonly assignment?: readonly WorkflowAssignmentRuleDef[];
  readonly escalation?: readonly WorkflowEscalationRuleDef[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A structured validation error — returned (never thrown) so all problems in a definition surface at once. */
export interface DefinitionError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly DefinitionError[];
}
