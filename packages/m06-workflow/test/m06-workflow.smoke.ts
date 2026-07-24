import { defineSuite } from '@finapp/test-runner';
import {
  M06_PERMISSIONS,
  ALL_M06_PERMISSIONS,
  ALL_M06_AUDIT_CODES,
  WORKFLOW_AUDIT_PREFIX,
  NODE_TYPES,
  MVP_NODE_TYPES,
  NODE_ARITY,
  isNodeType,
  isMvpNodeType,
  checkDefinitionTransition,
  isDefinitionContentFrozen,
  DEFINITION_STATUSES,
  checkInstanceTransition,
  INSTANCE_STATUSES,
  checkTaskTransition,
  TASK_STATUSES,
  splitTokenCount,
  newJoinState,
  recordArrival,
  joinReady,
  findParallelImbalances,
  validateDefinition,
  directiveForNode,
  resolveExclusiveGateway,
  outgoingEdges,
  businessSecondsBetween,
  businessDeadline,
  type WorkflowDefinitionSpec,
} from '@finapp/m06-workflow';

/** A minimal, valid definition used as the base for the validator tests. */
function validDefinition(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    code: 'simple_approval',
    name: 'Simple approval',
    variables: [{ name: 'amount', type: 'number' }],
    nodes: [
      { key: 'start', type: 'START' },
      { key: 'approve', type: 'APPROVAL_TASK' },
      { key: 'end_ok', type: 'END' },
      { key: 'end_no', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 'start', to: 'approve' },
      { key: 't1', from: 'approve', to: 'end_ok', condition: 'amount < 1000' },
      { key: 't2', from: 'approve', to: 'end_no' },
    ],
  };
}

function hasCode(result: { errors: readonly { code: string }[] }, code: string): boolean {
  return result.errors.some((e) => e.code === code);
}

/**
 * M06 PURE smoke — domain contracts (Commit 2). No database. Proves the registered vocabularies are
 * well-formed and the three lifecycle state machines + parallel token accounting behave deterministically,
 * refusing every illegal transition. Later commits extend this file as their PURE surface lands.
 */
export default defineSuite('m06-workflow', (t) => {
  // --- vocabularies -------------------------------------------------------------------------------
  const permRe = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;
  for (const p of ALL_M06_PERMISSIONS) {
    t.ok(permRe.test(p), `permission ${p} is a three-segment workflow.<entity>.<action>`);
    t.ok(p.startsWith('workflow.'), `permission ${p} is in the workflow namespace`);
  }
  t.equal(ALL_M06_PERMISSIONS.length, 24, '24 workflow permissions');
  t.equal(new Set(ALL_M06_PERMISSIONS).size, ALL_M06_PERMISSIONS.length, 'no duplicate permission');
  t.equal(
    M06_PERMISSIONS.engineAdminister,
    'workflow.engine.administer',
    'admin is three-segment (no workflow.admin)',
  );

  const codeRe = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
  for (const c of ALL_M06_AUDIT_CODES) {
    t.ok(codeRe.test(c), `audit code ${c} is SCREAMING_SNAKE`);
    t.ok(c.startsWith(WORKFLOW_AUDIT_PREFIX), `audit code ${c} carries the WORKFLOW_ prefix`);
  }
  t.equal(ALL_M06_AUDIT_CODES.length, 31, '31 workflow audit codes');
  t.equal(new Set(ALL_M06_AUDIT_CODES).size, ALL_M06_AUDIT_CODES.length, 'no duplicate audit code');

  // --- node types ---------------------------------------------------------------------------------
  t.equal(NODE_TYPES.length, 14, '14 node types declared');
  t.equal(MVP_NODE_TYPES.length, 12, '12 MVP node types (SUB_WORKFLOW/COMPENSATION reserved)');
  t.ok(!isMvpNodeType('SUB_WORKFLOW'), 'SUB_WORKFLOW is not MVP');
  t.ok(!isMvpNodeType('COMPENSATION'), 'COMPENSATION is not MVP');
  t.ok(isNodeType('APPROVAL_TASK'), 'APPROVAL_TASK is a node type');
  t.ok(!isNodeType('NONSENSE'), 'unknown node type rejected');
  t.equal(NODE_ARITY.START.maxIn, 0, 'START has no incoming edge');
  t.equal(NODE_ARITY.END.maxOut, 0, 'END has no outgoing edge');
  t.ok(NODE_ARITY.EXCLUSIVE_GATEWAY.minOut >= 2, 'a gateway fans out');
  t.equal(NODE_ARITY.PARALLEL_JOIN.minIn, 2, 'a join has at least two incoming');

  // --- definition lifecycle (ADR-022 immutability) ------------------------------------------------
  t.equal(DEFINITION_STATUSES.length, 6, 'six definition statuses');
  const validated = checkDefinitionTransition('DRAFT', 'validate');
  t.ok(validated.ok && validated.to === 'VALIDATED', 'DRAFT --validate--> VALIDATED');
  const published = checkDefinitionTransition('VALIDATED', 'publish');
  t.ok(published.ok && published.to === 'PUBLISHED', 'VALIDATED --publish--> PUBLISHED');
  t.ok(!checkDefinitionTransition('DRAFT', 'publish').ok, 'cannot publish an unvalidated draft');
  t.ok(!checkDefinitionTransition('PUBLISHED', 'revise').ok, 'cannot revise a published version');
  t.ok(!checkDefinitionTransition('ARCHIVED', 'activate').ok, 'ARCHIVED is terminal');
  t.ok(!isDefinitionContentFrozen('DRAFT'), 'draft content is editable');
  t.ok(isDefinitionContentFrozen('PUBLISHED'), 'published content is frozen');
  t.ok(isDefinitionContentFrozen('ACTIVE'), 'active content is frozen');

  // --- instance lifecycle -------------------------------------------------------------------------
  t.equal(INSTANCE_STATUSES.length, 8, 'eight instance statuses');
  const started = checkInstanceTransition('CREATED', 'start');
  t.ok(started.ok && started.to === 'RUNNING', 'CREATED --start--> RUNNING');
  t.ok(checkInstanceTransition('RUNNING', 'complete').ok, 'RUNNING may complete');
  t.ok(!checkInstanceTransition('COMPLETED', 'cancel').ok, 'a completed instance is terminal');
  t.ok(
    !checkInstanceTransition('SUSPENDED', 'complete').ok,
    'a suspended instance must resume before completing',
  );
  t.ok(checkInstanceTransition('SUSPENDED', 'resume').ok, 'a suspended instance may resume');

  // --- task lifecycle -----------------------------------------------------------------------------
  t.equal(TASK_STATUSES.length, 11, 'eleven task statuses');
  t.ok(checkTaskTransition('AVAILABLE', 'claim').ok, 'AVAILABLE --claim--> CLAIMED');
  t.ok(!checkTaskTransition('AVAILABLE', 'complete').ok, 'an unclaimed task cannot be completed');
  t.ok(
    !checkTaskTransition('COMPLETED', 'complete').ok,
    'a completed task cannot be re-completed (no double completion)',
  );
  t.ok(checkTaskTransition('CLAIMED', 'release').ok, 'a claimed task may be released back to AVAILABLE');
  t.ok(checkTaskTransition('CLAIMED', 'delegate').ok, 'a claimed task may be delegated');

  // --- parallel token accounting ------------------------------------------------------------------
  t.equal(splitTokenCount(3), 3, 'a 3-branch split mints 3 tokens');
  t.throws(() => splitTokenCount(1), 'a split needs >= 2 branches');
  let join = newJoinState(3);
  t.ok(!joinReady(join), 'join not ready with zero arrivals');
  join = recordArrival(join, 'b1');
  join = recordArrival(join, 'b1'); // idempotent retry
  t.ok(!joinReady(join), 'a duplicate branch arrival does not advance the join (idempotent)');
  join = recordArrival(join, 'b2');
  join = recordArrival(join, 'b3');
  t.ok(joinReady(join), 'join fires exactly when all distinct branches arrived');
  t.equal(
    findParallelImbalances([{ splitKey: 's', splitBranches: 2, joinKey: 'j', joinExpected: 2 }]).length,
    0,
    'balanced parallel region',
  );
  t.equal(
    findParallelImbalances([{ splitKey: 's', splitBranches: 3, joinKey: 'j', joinExpected: 2 }]).length,
    1,
    'imbalanced region detected',
  );

  // --- definition validator (ADR-021/022/024) -----------------------------------------------------
  t.ok(validateDefinition(validDefinition()).ok, 'a well-formed definition validates');
  t.ok(!validateDefinition(null).ok, 'a non-object is rejected');
  t.ok(hasCode(validateDefinition('nope'), 'NOT_OBJECT'), 'a string definition is NOT_OBJECT');

  // missing START
  const noStart = validDefinition();
  (noStart['nodes'] as unknown[]).splice(0, 1);
  (noStart['transitions'] as unknown[]).splice(0, 1);
  t.ok(
    hasCode(validateDefinition(noStart), 'START_COUNT'),
    'a definition without exactly one START is rejected',
  );

  // dangling transition target
  const dangling = validDefinition();
  (dangling['transitions'] as Record<string, unknown>[])[0]!['to'] = 'ghost';
  t.ok(hasCode(validateDefinition(dangling), 'DANGLING_TO'), 'a transition to an unknown node is rejected');

  // unsafe condition — code injection attempt
  const unsafe = validDefinition();
  (unsafe['transitions'] as Record<string, unknown>[])[1]!['condition'] = 'eval("1")';
  t.ok(hasCode(validateDefinition(unsafe), 'UNSAFE_CONDITION'), 'an unsafe/eval condition is rejected');

  // unknown variable in a condition
  const unknownVar = validDefinition();
  (unknownVar['transitions'] as Record<string, unknown>[])[1]!['condition'] = 'secret > 1';
  t.ok(
    hasCode(validateDefinition(unknownVar), 'UNSAFE_CONDITION'),
    'a condition referencing an undeclared variable is rejected',
  );

  // reserved, non-MVP node type
  const nonMvp = validDefinition();
  (nonMvp['nodes'] as Record<string, unknown>[])[1]!['type'] = 'SUB_WORKFLOW';
  t.ok(hasCode(validateDefinition(nonMvp), 'NON_MVP_NODE'), 'a reserved (non-MVP) node type is rejected');

  // exclusive gateway without a default edge
  const gateway = {
    schemaVersion: 1,
    code: 'gw',
    name: 'gw',
    variables: [{ name: 'x', type: 'number' }],
    nodes: [
      { key: 's', type: 'START' },
      { key: 'g', type: 'EXCLUSIVE_GATEWAY' },
      { key: 'a', type: 'END' },
      { key: 'b', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 's', to: 'g' },
      { key: 't1', from: 'g', to: 'a', condition: 'x > 1' },
      { key: 't2', from: 'g', to: 'b', condition: 'x <= 1' },
    ],
  };
  t.ok(
    hasCode(validateDefinition(gateway), 'GATEWAY_DEFAULT'),
    'an EXCLUSIVE_GATEWAY without a default edge is rejected',
  );

  // too many variables (limit)
  const tooManyVars = validDefinition();
  tooManyVars['variables'] = Array.from({ length: 101 }, (_v, i) => ({
    name: `v${String(i)}`,
    type: 'number',
  }));
  t.ok(
    hasCode(validateDefinition(tooManyVars), 'TOO_MANY_VARIABLES'),
    'the variable-count limit is enforced',
  );

  // --- deterministic runtime engine (ADR-023) -----------------------------------------------------
  const gwSpec: WorkflowDefinitionSpec = {
    schemaVersion: 1,
    code: 'gw_flow',
    name: 'gw',
    variables: [{ name: 'amount', type: 'number' }],
    nodes: [
      { key: 'start', type: 'START' },
      { key: 'gate', type: 'EXCLUSIVE_GATEWAY' },
      { key: 'big', type: 'END' },
      { key: 'small', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 'start', to: 'gate' },
      { key: 't1', from: 'gate', to: 'big', condition: 'amount >= 1000' },
      { key: 't2', from: 'gate', to: 'small' },
    ],
  };
  const startDir = directiveForNode(gwSpec, 'start', {});
  t.ok(startDir.kind === 'advance' && startDir.targets[0]?.to === 'gate', 'START advances to its successor');
  const bigDir = directiveForNode(gwSpec, 'gate', { amount: 5000 });
  t.ok(
    bigDir.kind === 'advance' && bigDir.targets[0]?.to === 'big',
    'gateway routes a large amount to the true branch',
  );
  const smallDir = directiveForNode(gwSpec, 'gate', { amount: 5 });
  t.ok(
    smallDir.kind === 'advance' && smallDir.targets[0]?.to === 'small',
    'gateway falls through to the default branch',
  );
  t.ok(directiveForNode(gwSpec, 'big', {}).kind === 'end', 'END consumes the token');
  t.equal(outgoingEdges(gwSpec, 'gate').length, 2, 'gateway has two outgoing edges');
  const chosen = resolveExclusiveGateway(outgoingEdges(gwSpec, 'gate'), ['amount'], { amount: 2000 });
  t.equal(chosen.to, 'big', 'resolveExclusiveGateway picks the first true condition');

  const taskSpec: WorkflowDefinitionSpec = {
    schemaVersion: 1,
    code: 'task_flow',
    name: 't',
    variables: [],
    nodes: [
      { key: 's', type: 'START' },
      { key: 'review', type: 'HUMAN_TASK' },
      { key: 'e', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 's', to: 'review' },
      { key: 't1', from: 'review', to: 'e' },
    ],
  };
  t.ok(directiveForNode(taskSpec, 'review', {}).kind === 'wait_task', 'a HUMAN_TASK parks the token (waits)');

  const parSpec: WorkflowDefinitionSpec = {
    schemaVersion: 1,
    code: 'par_flow',
    name: 'p',
    variables: [],
    nodes: [
      { key: 's', type: 'START' },
      { key: 'split', type: 'PARALLEL_SPLIT', config: { joinKey: 'join' } },
      { key: 'a', type: 'HUMAN_TASK' },
      { key: 'b', type: 'HUMAN_TASK' },
      { key: 'join', type: 'PARALLEL_JOIN' },
      { key: 'e', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 's', to: 'split' },
      { key: 't1', from: 'split', to: 'a' },
      { key: 't2', from: 'split', to: 'b' },
      { key: 't3', from: 'a', to: 'join' },
      { key: 't4', from: 'b', to: 'join' },
      { key: 't5', from: 'join', to: 'e' },
    ],
  };
  const splitDir = directiveForNode(parSpec, 'split', {});
  t.ok(
    splitDir.kind === 'split' && splitDir.targets.length === 2,
    'a PARALLEL_SPLIT fans out to all branches',
  );
  t.ok(splitDir.kind === 'split' && splitDir.joinKey === 'join', 'a PARALLEL_SPLIT names its matching join');
  t.ok(directiveForNode(parSpec, 'join', {}).kind === 'join', 'a PARALLEL_JOIN yields a join directive');

  // --- SLA business-time calendar (ADR-025) -------------------------------------------------------
  const mon = new Date('2026-01-05T00:00:00Z'); // a Monday
  t.equal(
    businessSecondsBetween(mon, new Date('2026-01-06T00:00:00Z'), {}),
    86400,
    '24h calendar counts a full day',
  );
  const fri = new Date('2026-01-09T00:00:00Z');
  t.equal(
    businessSecondsBetween(fri, new Date('2026-01-12T00:00:00Z'), { weekend: [0, 6] }),
    86400,
    'weekend days are skipped',
  );
  t.equal(
    businessSecondsBetween(mon, new Date('2026-01-06T00:00:00Z'), { holidays: ['2026-01-05'] }),
    0,
    'a holiday counts zero business time',
  );
  t.equal(
    businessSecondsBetween(mon, new Date('2026-01-06T00:00:00Z'), { openHour: 9, closeHour: 17 }),
    8 * 3600,
    'business hours bound the working day',
  );
  t.equal(
    businessDeadline(mon, 2 * 3600, {}).toISOString(),
    '2026-01-05T02:00:00.000Z',
    'businessDeadline lands 2h later on a 24h calendar',
  );
  const friEve = new Date('2026-01-09T23:00:00Z');
  t.ok(
    businessDeadline(friEve, 3 * 3600, { weekend: [0, 6] }).getTime() >
      new Date('2026-01-12T00:00:00Z').getTime(),
    'a deadline needing weekend hours rolls into Monday',
  );
});
