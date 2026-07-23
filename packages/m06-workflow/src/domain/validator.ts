/**
 * Workflow definition validator (ADR-021/022/024) — PURE, fail-closed. Accepts UNTRUSTED input (a tenant's
 * definition JSON) and returns every problem it finds (never throws on bad input). A definition only becomes
 * VALIDATED, and then PUBLISHED (frozen), if this returns `ok: true`. It enforces: shape, unique keys, valid
 * MVP node types, graph structure (one START, reachable END, arity, reachability), safe conditions (compiled
 * by the sandboxed interpreter — no code/SQL/shell), balanced parallelism, and hard size limits.
 */
import {
  DEFINITION_LIMITS,
  VARIABLE_TYPES,
  type DefinitionError,
  type ValidationResult,
} from './definition.ts';
import { NODE_ARITY, isMvpNodeType, isNodeType, type NodeType } from './node-types.ts';
import { compileExpression, ExpressionError } from './expression.ts';

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Validate an untrusted definition document. Collects ALL errors so the author sees every problem at once. */
export function validateDefinition(raw: unknown): ValidationResult {
  const errors: DefinitionError[] = [];
  const err = (path: string, code: string, message: string): void => {
    errors.push({ path, code, message });
  };

  if (!isObject(raw)) {
    return { ok: false, errors: [{ path: '', code: 'NOT_OBJECT', message: 'definition must be an object' }] };
  }

  // --- top level ----------------------------------------------------------------------------------
  if (raw['schemaVersion'] !== 1) err('schemaVersion', 'BAD_SCHEMA_VERSION', 'schemaVersion must be 1');
  if (typeof raw['code'] !== 'string' || !DEFINITION_LIMITS.codePattern.test(raw['code'])) {
    err('code', 'BAD_CODE', 'code must be a lowercase slug (a-z0-9_, 2-64 chars)');
  }
  if (typeof raw['name'] !== 'string' || raw['name'].trim() === '')
    err('name', 'BAD_NAME', 'name is required');

  // --- variables ----------------------------------------------------------------------------------
  const variables: unknown[] = Array.isArray(raw['variables']) ? raw['variables'] : [];
  if (!Array.isArray(raw['variables'])) err('variables', 'BAD_VARIABLES', 'variables must be an array');
  if (variables.length > DEFINITION_LIMITS.maxVariables) {
    err('variables', 'TOO_MANY_VARIABLES', `at most ${String(DEFINITION_LIMITS.maxVariables)} variables`);
  }
  const declaredVars: string[] = [];
  const varNames = new Set<string>();
  variables.forEach((v, i) => {
    if (!isObject(v) || typeof v['name'] !== 'string') {
      err(`variables[${String(i)}]`, 'BAD_VARIABLE', 'variable needs a string name');
      return;
    }
    const name = v['name'];
    if (varNames.has(name)) err(`variables[${String(i)}]`, 'DUP_VARIABLE', `duplicate variable "${name}"`);
    varNames.add(name);
    declaredVars.push(name);
    if (!(VARIABLE_TYPES as readonly string[]).includes(v['type'] as string)) {
      err(`variables[${String(i)}].type`, 'BAD_VARIABLE_TYPE', `unknown variable type`);
    }
    if (v['type'] === 'enum' && (!Array.isArray(v['enumValues']) || v['enumValues'].length === 0)) {
      err(`variables[${String(i)}].enumValues`, 'MISSING_ENUM', 'enum variable needs enumValues');
    }
  });

  // --- nodes --------------------------------------------------------------------------------------
  const nodes: unknown[] = Array.isArray(raw['nodes']) ? raw['nodes'] : [];
  if (!Array.isArray(raw['nodes'])) err('nodes', 'BAD_NODES', 'nodes must be an array');
  if (nodes.length > DEFINITION_LIMITS.maxNodes) {
    err('nodes', 'TOO_MANY_NODES', `at most ${String(DEFINITION_LIMITS.maxNodes)} nodes`);
  }
  const nodeType = new Map<string, NodeType>();
  const nodeKeys = new Set<string>();
  nodes.forEach((nd, i) => {
    if (!isObject(nd) || typeof nd['key'] !== 'string') {
      err(`nodes[${String(i)}]`, 'BAD_NODE', 'node needs a string key');
      return;
    }
    const key = nd['key'];
    if (!DEFINITION_LIMITS.nodeKeyPattern.test(key))
      err(`nodes[${String(i)}].key`, 'BAD_NODE_KEY', `invalid node key "${key}"`);
    if (nodeKeys.has(key)) err(`nodes[${String(i)}].key`, 'DUP_NODE', `duplicate node key "${key}"`);
    nodeKeys.add(key);
    const type = nd['type'];
    if (typeof type !== 'string' || !isNodeType(type)) {
      err(`nodes[${String(i)}].type`, 'BAD_NODE_TYPE', `unknown node type "${String(type)}"`);
      return;
    }
    if (!isMvpNodeType(type)) {
      err(
        `nodes[${String(i)}].type`,
        'NON_MVP_NODE',
        `node type "${type}" is reserved but not yet executable`,
      );
    }
    nodeType.set(key, type);
  });

  // --- transitions --------------------------------------------------------------------------------
  const transitions: unknown[] = Array.isArray(raw['transitions']) ? raw['transitions'] : [];
  if (!Array.isArray(raw['transitions']))
    err('transitions', 'BAD_TRANSITIONS', 'transitions must be an array');
  if (transitions.length > DEFINITION_LIMITS.maxTransitions) {
    err(
      'transitions',
      'TOO_MANY_TRANSITIONS',
      `at most ${String(DEFINITION_LIMITS.maxTransitions)} transitions`,
    );
  }
  const transKeys = new Set<string>();
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  transitions.forEach((tr, i) => {
    if (
      !isObject(tr) ||
      typeof tr['key'] !== 'string' ||
      typeof tr['from'] !== 'string' ||
      typeof tr['to'] !== 'string'
    ) {
      err(`transitions[${String(i)}]`, 'BAD_TRANSITION', 'transition needs string key/from/to');
      return;
    }
    const { key, from, to } = tr as { key: string; from: string; to: string };
    if (transKeys.has(key))
      err(`transitions[${String(i)}].key`, 'DUP_TRANSITION', `duplicate transition key "${key}"`);
    transKeys.add(key);
    if (!nodeKeys.has(from))
      err(`transitions[${String(i)}].from`, 'DANGLING_FROM', `unknown from-node "${from}"`);
    if (!nodeKeys.has(to)) err(`transitions[${String(i)}].to`, 'DANGLING_TO', `unknown to-node "${to}"`);
    outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    if (nodeKeys.has(from) && nodeKeys.has(to)) {
      const list = adjacency.get(from) ?? [];
      list.push(to);
      adjacency.set(from, list);
    }
    // Conditions must be SAFE expressions over declared variables (ADR-024).
    if (tr['condition'] !== undefined) {
      if (typeof tr['condition'] !== 'string') {
        err(`transitions[${String(i)}].condition`, 'BAD_CONDITION', 'condition must be a string');
      } else if (tr['condition'].length > DEFINITION_LIMITS.maxConditionLength) {
        err(
          `transitions[${String(i)}].condition`,
          'CONDITION_TOO_LONG',
          'condition exceeds the length limit',
        );
      } else {
        try {
          compileExpression(tr['condition'], declaredVars);
        } catch (e) {
          const msg =
            e instanceof ExpressionError ? `${e.code}: ${e.message}` : 'invalid condition expression';
          err(`transitions[${String(i)}].condition`, 'UNSAFE_CONDITION', msg);
        }
      }
    }
  });

  // --- structural: START / END / arity ------------------------------------------------------------
  const startKeys = [...nodeType.entries()].filter(([, t]) => t === 'START').map(([k]) => k);
  const endKeys = [...nodeType.entries()].filter(([, t]) => t === 'END').map(([k]) => k);
  if (startKeys.length !== 1) err('nodes', 'START_COUNT', 'a definition must have exactly one START node');
  if (endKeys.length < 1) err('nodes', 'NO_END', 'a definition must have at least one END node');

  for (const [key, type] of nodeType) {
    const arity = NODE_ARITY[type];
    const outd = outDegree.get(key) ?? 0;
    const ind = inDegree.get(key) ?? 0;
    if (ind < arity.minIn)
      err(`node:${key}`, 'ARITY_IN', `${type} '${key}' needs >= ${String(arity.minIn)} incoming`);
    if (arity.maxIn !== null && ind > arity.maxIn)
      err(`node:${key}`, 'ARITY_IN', `${type} '${key}' allows <= ${String(arity.maxIn)} incoming`);
    if (outd < arity.minOut)
      err(`node:${key}`, 'ARITY_OUT', `${type} '${key}' needs >= ${String(arity.minOut)} outgoing`);
    if (arity.maxOut !== null && outd > arity.maxOut)
      err(`node:${key}`, 'ARITY_OUT', `${type} '${key}' allows <= ${String(arity.maxOut)} outgoing`);

    // EXCLUSIVE_GATEWAY must have exactly one unconditional (default) outgoing edge so routing is total.
    if (type === 'EXCLUSIVE_GATEWAY') {
      const defaults = transitions.filter(
        (tr) => isObject(tr) && tr['from'] === key && tr['condition'] === undefined,
      ).length;
      if (defaults !== 1)
        err(
          `node:${key}`,
          'GATEWAY_DEFAULT',
          `EXCLUSIVE_GATEWAY '${key}' needs exactly one default (unconditioned) edge`,
        );
    }

    // Structured parallelism: a split names its matching join and its branch count is bounded.
    if (type === 'PARALLEL_SPLIT') {
      if (outd > DEFINITION_LIMITS.maxParallelBranches) {
        err(
          `node:${key}`,
          'TOO_MANY_BRANCHES',
          `PARALLEL_SPLIT '${key}' exceeds ${String(DEFINITION_LIMITS.maxParallelBranches)} branches`,
        );
      }
      const cfg = nodes.find((n) => isObject(n) && n['key'] === key);
      const joinKey = isObject(cfg) && isObject(cfg['config']) ? cfg['config']['joinKey'] : undefined;
      if (typeof joinKey !== 'string' || nodeType.get(joinKey) !== 'PARALLEL_JOIN') {
        err(
          `node:${key}`,
          'SPLIT_NO_JOIN',
          `PARALLEL_SPLIT '${key}' must reference a matching PARALLEL_JOIN via config.joinKey`,
        );
      }
    }
  }

  // --- reachability (from the single START) -------------------------------------------------------
  const start = startKeys.length === 1 ? startKeys[0] : undefined;
  if (start !== undefined && errors.filter((e) => e.code.startsWith('DANGLING')).length === 0) {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of adjacency.get(cur) ?? []) stack.push(nxt);
    }
    for (const key of nodeKeys) {
      if (!seen.has(key)) err(`node:${key}`, 'UNREACHABLE', `node '${key}' is not reachable from START`);
    }
    if (!endKeys.some((k) => seen.has(k)))
      err('nodes', 'END_UNREACHABLE', 'no END node is reachable from START');
  }

  return { ok: errors.length === 0, errors };
}
