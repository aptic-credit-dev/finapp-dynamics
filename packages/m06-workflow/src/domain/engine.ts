/**
 * Deterministic runtime engine (ADR-021/023) — PURE. Given a (validated, frozen) definition spec, a current
 * node, and the instance's variable environment, it decides WHAT happens next: which edge an exclusive
 * gateway takes, which branches a parallel split fans to, whether a node parks the token (task/timer/event),
 * runs a system handler, joins, ends, escalates, or cancels. It performs NO I/O — the service layer executes
 * the returned directive (persisting token moves, creating tasks, scheduling timers, emitting) inside one
 * transaction under a per-instance advisory lock. Determinism here is what makes execution replay-safe.
 */
import { compileExpression, type WorkflowValue } from './expression.ts';
import { isNodeType, type NodeType } from './node-types.ts';
import type { WorkflowDefinitionSpec, WorkflowNodeDef, WorkflowTransitionDef } from './definition.ts';

export interface OutgoingEdge {
  readonly transitionKey: string;
  readonly to: string;
  readonly condition?: string;
}

/** What the engine decides at a node once a token arrives there. The service layer performs the effect. */
export type EngineDirective =
  | { readonly kind: 'advance'; readonly targets: readonly { transitionKey: string; to: string }[] }
  | {
      readonly kind: 'split';
      readonly targets: readonly { transitionKey: string; to: string }[];
      readonly joinKey: string;
    }
  | { readonly kind: 'join' }
  | {
      readonly kind: 'wait_task';
      readonly taskType: 'HUMAN_TASK' | 'APPROVAL_TASK';
      readonly nodeKey: string;
    }
  | {
      readonly kind: 'run_system';
      readonly handler: string;
      readonly next: { transitionKey: string; to: string };
    }
  | { readonly kind: 'wait_timer'; readonly nodeKey: string }
  | { readonly kind: 'wait_event'; readonly nodeKey: string }
  | {
      readonly kind: 'escalate';
      readonly nodeKey: string;
      readonly targets: readonly { transitionKey: string; to: string }[];
    }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'end' };

export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'EngineError';
    this.code = code;
    Object.setPrototypeOf(this, EngineError.prototype);
  }
}

function nodeByKey(spec: WorkflowDefinitionSpec, key: string): WorkflowNodeDef | undefined {
  return spec.nodes.find((n) => n.key === key);
}

export function outgoingEdges(spec: WorkflowDefinitionSpec, nodeKey: string): OutgoingEdge[] {
  return spec.transitions
    .filter((tr) => tr.from === nodeKey)
    .map((tr: WorkflowTransitionDef) =>
      tr.condition === undefined
        ? { transitionKey: tr.key, to: tr.to }
        : { transitionKey: tr.key, to: tr.to, condition: tr.condition },
    );
}

function nodeTypeOf(spec: WorkflowDefinitionSpec, nodeKey: string): NodeType {
  const node = nodeByKey(spec, nodeKey);
  if (node === undefined) throw new EngineError('UNKNOWN_NODE', `no node '${nodeKey}'`);
  if (!isNodeType(node.type)) throw new EngineError('BAD_NODE_TYPE', `node '${nodeKey}' has an invalid type`);
  return node.type;
}

/**
 * Resolve an EXCLUSIVE_GATEWAY: evaluate each conditioned edge in definition order and take the first whose
 * condition is true; otherwise take the single default (unconditioned) edge. The validator guarantees exactly
 * one default exists, so routing is total (deterministic, never stuck).
 */
export function resolveExclusiveGateway(
  edges: readonly OutgoingEdge[],
  declaredVars: readonly string[],
  env: Record<string, WorkflowValue>,
): { transitionKey: string; to: string } {
  let defaultEdge: OutgoingEdge | undefined;
  for (const edge of edges) {
    if (edge.condition === undefined) {
      defaultEdge = edge;
      continue;
    }
    if (compileExpression(edge.condition, declaredVars).evaluate(env)) {
      return { transitionKey: edge.transitionKey, to: edge.to };
    }
  }
  if (defaultEdge === undefined) {
    throw new EngineError(
      'NO_DEFAULT',
      'exclusive gateway has no default edge (should have been rejected at validate)',
    );
  }
  return { transitionKey: defaultEdge.transitionKey, to: defaultEdge.to };
}

/**
 * The directive for a node when a token arrives. `env` is only consulted for gateway routing. This is the
 * single deterministic decision function the service layer drives each step.
 */
export function directiveForNode(
  spec: WorkflowDefinitionSpec,
  nodeKey: string,
  env: Record<string, WorkflowValue>,
): EngineDirective {
  const type = nodeTypeOf(spec, nodeKey);
  const edges = outgoingEdges(spec, nodeKey);
  const declaredVars = spec.variables.map((v) => v.name);
  const node = nodeByKey(spec, nodeKey);
  const config = node?.config ?? {};

  switch (type) {
    case 'START': {
      const only = edges[0];
      if (only === undefined) throw new EngineError('START_NO_EDGE', 'START has no outgoing edge');
      return { kind: 'advance', targets: [{ transitionKey: only.transitionKey, to: only.to }] };
    }
    case 'END':
      return { kind: 'end' };
    case 'HUMAN_TASK':
      return { kind: 'wait_task', taskType: 'HUMAN_TASK', nodeKey };
    case 'APPROVAL_TASK':
      return { kind: 'wait_task', taskType: 'APPROVAL_TASK', nodeKey };
    case 'SYSTEM_TASK': {
      const handler = config['handler'];
      const next = edges[0];
      if (typeof handler !== 'string')
        throw new EngineError('NO_HANDLER', `SYSTEM_TASK '${nodeKey}' has no handler`);
      if (next === undefined)
        throw new EngineError('SYSTEM_NO_EDGE', `SYSTEM_TASK '${nodeKey}' has no outgoing edge`);
      return { kind: 'run_system', handler, next: { transitionKey: next.transitionKey, to: next.to } };
    }
    case 'EXCLUSIVE_GATEWAY': {
      const chosen = resolveExclusiveGateway(edges, declaredVars, env);
      return { kind: 'advance', targets: [chosen] };
    }
    case 'PARALLEL_SPLIT': {
      const joinKey = config['joinKey'];
      if (typeof joinKey !== 'string')
        throw new EngineError('SPLIT_NO_JOIN', `PARALLEL_SPLIT '${nodeKey}' has no joinKey`);
      return {
        kind: 'split',
        joinKey,
        targets: edges.map((e) => ({ transitionKey: e.transitionKey, to: e.to })),
      };
    }
    case 'PARALLEL_JOIN':
      return { kind: 'join' };
    case 'TIMER_WAIT':
      return { kind: 'wait_timer', nodeKey };
    case 'EVENT_WAIT':
      return { kind: 'wait_event', nodeKey };
    case 'ESCALATION':
      return {
        kind: 'escalate',
        nodeKey,
        targets: edges.map((e) => ({ transitionKey: e.transitionKey, to: e.to })),
      };
    case 'CANCEL':
      return { kind: 'cancel' };
    case 'SUB_WORKFLOW':
    case 'COMPENSATION':
      throw new EngineError('NON_MVP_NODE', `node type '${type}' is reserved but not executable in the MVP`);
  }
}

/** The node reached after a task at `nodeKey` completes down a chosen/eligible edge. */
export function edgeAfterTask(
  spec: WorkflowDefinitionSpec,
  nodeKey: string,
  transitionKey: string,
): { transitionKey: string; to: string } {
  const edge = outgoingEdges(spec, nodeKey).find((e) => e.transitionKey === transitionKey);
  if (edge === undefined)
    throw new EngineError('BAD_EDGE', `transition '${transitionKey}' is not an edge from '${nodeKey}'`);
  return { transitionKey: edge.transitionKey, to: edge.to };
}
