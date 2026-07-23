/**
 * @finapp/m06-workflow — the enterprise workflow engine (Stage 2.2).
 *
 * m06 consumes DB / AUDIT / AUTHZ through their kernel tokens and OWNS the single transactional OUTBOX
 * (ADR-004/023). The PURE domain layer (node types, lifecycle state machines, token accounting, the safe
 * condition-expression interpreter, and the definition validator) carries no I/O and is exhaustively unit
 * tested; the services layer runs everything inside `db.withTenant(ctx, tx => …)` with audit + outbox in the
 * same transaction. Nothing here is business-specific: a workflow is DATA (a published definition).
 */

// Vocabularies (registered in manifests/*.yaml)
export { M06_PERMISSIONS, ALL_M06_PERMISSIONS } from './permissions.ts';
export type { M06Permission } from './permissions.ts';
export { M06_AUDIT_CODES, ALL_M06_AUDIT_CODES, WORKFLOW_AUDIT_PREFIX } from './audit-codes.ts';
export type { M06AuditCode } from './audit-codes.ts';

// Domain — node types
export {
  NODE_TYPES,
  MVP_NODE_TYPES,
  HUMAN_TASK_NODE_TYPES,
  NODE_ARITY,
  isNodeType,
  isMvpNodeType,
  isHumanTaskNode,
} from './domain/node-types.ts';
export type { NodeType, NodeArity } from './domain/node-types.ts';

// Domain — lifecycles
export {
  checkTransition,
  isTerminal,
  DEFINITION_STATUSES,
  DEFINITION_ACTIONS,
  DEFINITION_MACHINE,
  checkDefinitionTransition,
  isDefinitionContentFrozen,
  INSTANCE_STATUSES,
  INSTANCE_ACTIONS,
  INSTANCE_MACHINE,
  checkInstanceTransition,
  TASK_STATUSES,
  TASK_ACTIONS,
  TASK_MACHINE,
  checkTaskTransition,
} from './domain/lifecycles.ts';
export type {
  Machine,
  Transition,
  TransitionResult,
  DefinitionStatus,
  DefinitionAction,
  InstanceStatus,
  InstanceAction,
  TaskStatus,
  TaskAction,
} from './domain/lifecycles.ts';

// Domain — parallel token accounting
export {
  splitTokenCount,
  newJoinState,
  recordArrival,
  joinReady,
  findParallelImbalances,
} from './domain/tokens.ts';
export type { JoinState, ParallelRegion } from './domain/tokens.ts';

// Domain — safe condition expressions (ADR-024)
export {
  compileExpression,
  ExpressionError,
  MAX_SOURCE_LENGTH,
  MAX_AST_NODES,
  MAX_IDENTIFIER_LENGTH,
  MAX_PARSE_DEPTH,
} from './domain/expression.ts';
export type { WorkflowValue, CompiledExpression, ExpressionErrorCode } from './domain/expression.ts';

// Domain — definition format + validator (ADR-021/022)
export {
  WORKFLOW_SCHEMA_VERSION,
  DEFINITION_LIMITS,
  VARIABLE_TYPES,
  SLA_TYPES,
  ASSIGNMENT_STRATEGIES,
  ESCALATION_TRIGGERS,
  APPROVAL_MODES,
} from './domain/definition.ts';
export type {
  WorkflowDefinitionSpec,
  WorkflowVariableDef,
  WorkflowNodeDef,
  WorkflowTransitionDef,
  WorkflowSlaDef,
  WorkflowAssignmentRuleDef,
  WorkflowEscalationRuleDef,
  WorkflowEscalationStep,
  ApprovalPolicy,
  ApprovalMode,
  VariableType,
  SlaType,
  AssignmentStrategy,
  EscalationTrigger,
  DefinitionError,
  ValidationResult,
} from './domain/definition.ts';
export { validateDefinition } from './domain/validator.ts';

// Domain — deterministic runtime engine (ADR-023)
export {
  outgoingEdges,
  resolveExclusiveGateway,
  directiveForNode,
  edgeAfterTask,
  EngineError,
} from './domain/engine.ts';
export type { EngineDirective, OutgoingEdge } from './domain/engine.ts';

// Persistence
export { WorkflowRepository } from './repository.ts';
export type { DefinitionRow, VersionRow, InstanceRow, TaskRow } from './repository.ts';
