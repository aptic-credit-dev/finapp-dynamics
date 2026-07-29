export { EVENT_FAMILY_PATTERN, isValidEventFamily, DATA_CLASSIFICATIONS } from './envelope.ts';
export type { DomainEventEnvelope, DataClassification } from './envelope.ts';

export { DOMAIN_EVENT_FAMILIES } from './events.ts';
export type { DomainEvent, DomainEventFamily } from './events.ts';

export {
  TENANT_LIFECYCLE_FAMILY,
  TENANT_LIFECYCLE_VERSION,
  TENANT_LIFECYCLE_EVENT_TYPES,
} from './tenant-events.ts';
export type {
  TenantLifecycleEvent,
  TenantLifecycleEventType,
  TenantLifecyclePayload,
  TenantStatusChangePayload,
  TenantUpdatedPayload,
  TenantEnvironmentCreatedPayload,
  TenantOrgNodeCreatedPayload,
} from './tenant-events.ts';

export {
  IDENTITY_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_VERSION,
  IDENTITY_LIFECYCLE_EVENT_TYPES,
  PLATFORM_TENANT,
} from './identity-events.ts';
export type {
  IdentityLifecycleEvent,
  IdentityLifecycleEventType,
  IdentityLifecyclePayload,
  IdentityStatusChangePayload,
  IdentityUpdatedPayload,
  AccountStatusChangePayload,
  MembershipStatusChangePayload,
  MembershipScopeChangedPayload,
  AuthenticationSubjectLinkedPayload,
} from './identity-events.ts';

export { AUTH_LIFECYCLE_FAMILY, AUTH_LIFECYCLE_VERSION, AUTH_LIFECYCLE_EVENT_TYPES } from './auth-events.ts';
export type {
  AuthLifecycleEvent,
  AuthLifecycleEventType,
  AuthLifecyclePayload,
  AuthenticationOutcomePayload,
  SessionLifecyclePayload,
  CredentialLifecyclePayload,
  AccountLockoutPayload,
} from './auth-events.ts';

export {
  AUTHZ_LIFECYCLE_FAMILY,
  AUTHZ_LIFECYCLE_VERSION,
  AUTHZ_LIFECYCLE_EVENT_TYPES,
} from './authz-events.ts';
export type {
  AuthzLifecycleEvent,
  AuthzLifecycleEventType,
  AuthzLifecyclePayload,
  RoleLifecyclePayload,
  RolePermissionsChangedPayload,
  AssignmentLifecyclePayload,
  SodPayload,
  BootstrapPayload,
} from './authz-events.ts';
export {
  WORKFLOW_LIFECYCLE_FAMILY,
  WORKFLOW_LIFECYCLE_VERSION,
  WORKFLOW_LIFECYCLE_EVENT_TYPES,
} from './workflow-events.ts';
export type {
  WorkflowLifecycleEvent,
  WorkflowLifecycleEventType,
  WorkflowLifecyclePayload,
  WorkflowDefinitionPayload,
  WorkflowInstancePayload,
  WorkflowTaskPayload,
  WorkflowSlaPayload,
  WorkflowIncidentPayload,
} from './workflow-events.ts';
export {
  RULES_LIFECYCLE_FAMILY,
  RULES_LIFECYCLE_VERSION,
  RULES_LIFECYCLE_EVENT_TYPES,
} from './rules-events.ts';
export type {
  RulesLifecycleEvent,
  RulesLifecycleEventType,
  RulesLifecyclePayload,
  RuleSetLifecyclePayload,
  RuleEvaluationPayload,
  RuleTestPayload,
} from './rules-events.ts';
export {
  NOTIFICATION_LIFECYCLE_FAMILY,
  NOTIFICATION_LIFECYCLE_VERSION,
  NOTIFICATION_LIFECYCLE_EVENT_TYPES,
} from './notification-events.ts';
export type {
  NotificationLifecycleEvent,
  NotificationLifecycleEventType,
  NotificationLifecyclePayload,
  NotificationTemplateLifecyclePayload,
  NotificationRequestPayload,
  EscalationPayload,
  InboxNotificationPayload,
} from './notification-events.ts';
export {
  DOCUMENT_LIFECYCLE_FAMILY,
  DOCUMENT_LIFECYCLE_VERSION,
  DOCUMENT_LIFECYCLE_EVENT_TYPES,
} from './document-events.ts';
export type {
  DocumentLifecycleEvent,
  DocumentLifecycleEventType,
  DocumentEventPayload,
  DocumentLifecyclePayload,
  DocumentAccessPayload,
  DocumentRelationshipPayload,
} from './document-events.ts';
export {
  FEEDBACK_LIFECYCLE_FAMILY,
  FEEDBACK_LIFECYCLE_VERSION,
  FEEDBACK_LIFECYCLE_EVENT_TYPES,
} from './feedback-events.ts';
export type {
  FeedbackLifecycleEvent,
  FeedbackLifecycleEventType,
  FeedbackEventPayload,
  FeedbackLifecyclePayload,
  FeedbackIngestionPayload,
  FeedbackCaseHandoffPayload,
} from './feedback-events.ts';
export {
  CASE_LIFECYCLE_FAMILY,
  CASE_LIFECYCLE_VERSION,
  CASE_LIFECYCLE_EVENT_TYPES,
  CASE_CONVERTED_TO_MATTER_FAMILY,
  CASE_CONVERTED_TO_MATTER_VERSION,
  CASE_CONVERTED_TO_MATTER_EVENT_TYPES,
} from './case-events.ts';
export type {
  CaseLifecycleEvent,
  CaseLifecycleEventType,
  CaseLifecyclePayload,
  CaseConvertedToMatterEvent,
  CaseConvertedToMatterEventType,
  CaseConvertedToMatterPayload,
  CaseEventPayload,
} from './case-events.ts';
export {
  LEGAL_LIFECYCLE_FAMILY,
  LEGAL_LIFECYCLE_VERSION,
  LEGAL_LIFECYCLE_EVENT_TYPES,
} from './legal-events.ts';
export type { LegalLifecycleEvent, LegalLifecycleEventType, LegalLifecyclePayload } from './legal-events.ts';
export {
  LITIGATION_LIFECYCLE_FAMILY,
  LITIGATION_LIFECYCLE_VERSION,
  LITIGATION_LIFECYCLE_EVENT_TYPES,
} from './litigation-events.ts';
export type {
  LitigationLifecycleEvent,
  LitigationLifecycleEventType,
  LitigationLifecyclePayload,
} from './litigation-events.ts';
export {
  RECOVERY_LIFECYCLE_FAMILY,
  RECOVERY_LIFECYCLE_VERSION,
  RECOVERY_LIFECYCLE_EVENT_TYPES,
} from './recovery-events.ts';
export type {
  RecoveryLifecycleEvent,
  RecoveryLifecycleEventType,
  RecoveryLifecyclePayload,
} from './recovery-events.ts';
export {
  LEGALDOCS_LIFECYCLE_FAMILY,
  LEGALDOCS_LIFECYCLE_VERSION,
  LEGALDOCS_LIFECYCLE_EVENT_TYPES,
} from './legaldocs-events.ts';
export type {
  LegalDocsLifecycleEvent,
  LegalDocsLifecycleEventType,
  LegalDocsLifecyclePayload,
} from './legaldocs-events.ts';
