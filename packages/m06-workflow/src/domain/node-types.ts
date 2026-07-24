/**
 * Workflow node types (ADR-021) — PURE. The engine is generic: a workflow is DATA (a published definition),
 * and these are the primitive node kinds a definition may use. SUB_WORKFLOW and COMPENSATION are RESERVED
 * (declared so definitions/enums are stable) but their execution is deferred; validation rejects them as
 * non-MVP so no definition can depend on unbuilt behaviour.
 */
export const NODE_TYPES = [
  'START',
  'END',
  'HUMAN_TASK',
  'APPROVAL_TASK',
  'SYSTEM_TASK',
  'EXCLUSIVE_GATEWAY',
  'PARALLEL_SPLIT',
  'PARALLEL_JOIN',
  'TIMER_WAIT',
  'EVENT_WAIT',
  'ESCALATION',
  'CANCEL',
  'SUB_WORKFLOW',
  'COMPENSATION',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Node types executable in the Stage 2.2 MVP. SUB_WORKFLOW / COMPENSATION are reserved-but-deferred. */
export const MVP_NODE_TYPES: readonly NodeType[] = [
  'START',
  'END',
  'HUMAN_TASK',
  'APPROVAL_TASK',
  'SYSTEM_TASK',
  'EXCLUSIVE_GATEWAY',
  'PARALLEL_SPLIT',
  'PARALLEL_JOIN',
  'TIMER_WAIT',
  'EVENT_WAIT',
  'ESCALATION',
  'CANCEL',
];

/** Node types that create a `workflow_task` row (a unit of human work). SYSTEM_TASK runs automatically. */
export const HUMAN_TASK_NODE_TYPES: readonly NodeType[] = ['HUMAN_TASK', 'APPROVAL_TASK'];

export function isNodeType(x: unknown): x is NodeType {
  return typeof x === 'string' && (NODE_TYPES as readonly string[]).includes(x);
}

export function isMvpNodeType(x: NodeType): boolean {
  return MVP_NODE_TYPES.includes(x);
}

export function isHumanTaskNode(x: NodeType): boolean {
  return HUMAN_TASK_NODE_TYPES.includes(x);
}

/**
 * Structural arity a node type must satisfy in a definition graph. `maxIn`/`maxOut` `null` means unbounded.
 * The validator (Commit 3) enforces these; e.g. START has no incoming edge, END no outgoing, a gateway
 * must fan out. This is what makes an invalid graph fail closed at validate/publish time.
 */
export interface NodeArity {
  readonly minIn: number;
  readonly maxIn: number | null;
  readonly minOut: number;
  readonly maxOut: number | null;
}

export const NODE_ARITY: Readonly<Record<NodeType, NodeArity>> = {
  START: { minIn: 0, maxIn: 0, minOut: 1, maxOut: 1 },
  END: { minIn: 1, maxIn: null, minOut: 0, maxOut: 0 },
  HUMAN_TASK: { minIn: 1, maxIn: null, minOut: 1, maxOut: null },
  APPROVAL_TASK: { minIn: 1, maxIn: null, minOut: 2, maxOut: null },
  SYSTEM_TASK: { minIn: 1, maxIn: null, minOut: 1, maxOut: null },
  EXCLUSIVE_GATEWAY: { minIn: 1, maxIn: null, minOut: 2, maxOut: null },
  PARALLEL_SPLIT: { minIn: 1, maxIn: null, minOut: 2, maxOut: null },
  PARALLEL_JOIN: { minIn: 2, maxIn: null, minOut: 1, maxOut: 1 },
  TIMER_WAIT: { minIn: 1, maxIn: null, minOut: 1, maxOut: 1 },
  EVENT_WAIT: { minIn: 1, maxIn: null, minOut: 1, maxOut: 1 },
  ESCALATION: { minIn: 1, maxIn: null, minOut: 1, maxOut: null },
  CANCEL: { minIn: 1, maxIn: null, minOut: 0, maxOut: 1 },
  SUB_WORKFLOW: { minIn: 1, maxIn: null, minOut: 1, maxOut: 1 },
  COMPENSATION: { minIn: 1, maxIn: null, minOut: 1, maxOut: 1 },
};
