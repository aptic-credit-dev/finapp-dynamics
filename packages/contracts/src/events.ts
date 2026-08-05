import type { TenantLifecycleEvent } from './tenant-events.ts';
import { TENANT_LIFECYCLE_FAMILY } from './tenant-events.ts';
import type { IdentityLifecycleEvent } from './identity-events.ts';
import { IDENTITY_LIFECYCLE_FAMILY } from './identity-events.ts';
import type { AuthLifecycleEvent } from './auth-events.ts';
import { AUTH_LIFECYCLE_FAMILY } from './auth-events.ts';
import type { AuthzLifecycleEvent } from './authz-events.ts';
import { AUTHZ_LIFECYCLE_FAMILY } from './authz-events.ts';
import type { WorkflowLifecycleEvent } from './workflow-events.ts';
import { WORKFLOW_LIFECYCLE_FAMILY } from './workflow-events.ts';
import type { RulesLifecycleEvent } from './rules-events.ts';
import { RULES_LIFECYCLE_FAMILY } from './rules-events.ts';
import type { NotificationLifecycleEvent } from './notification-events.ts';
import { NOTIFICATION_LIFECYCLE_FAMILY } from './notification-events.ts';
import type { DocumentLifecycleEvent } from './document-events.ts';
import { DOCUMENT_LIFECYCLE_FAMILY } from './document-events.ts';
import type { FeedbackLifecycleEvent } from './feedback-events.ts';
import { FEEDBACK_LIFECYCLE_FAMILY } from './feedback-events.ts';
import type { CaseLifecycleEvent, CaseConvertedToMatterEvent } from './case-events.ts';
import { CASE_LIFECYCLE_FAMILY, CASE_CONVERTED_TO_MATTER_FAMILY } from './case-events.ts';
import type { LegalLifecycleEvent } from './legal-events.ts';
import { LEGAL_LIFECYCLE_FAMILY } from './legal-events.ts';
import type { LitigationLifecycleEvent } from './litigation-events.ts';
import { LITIGATION_LIFECYCLE_FAMILY } from './litigation-events.ts';
import type { RecoveryLifecycleEvent } from './recovery-events.ts';
import { RECOVERY_LIFECYCLE_FAMILY } from './recovery-events.ts';
import type { LegalDocsLifecycleEvent } from './legaldocs-events.ts';
import { LEGALDOCS_LIFECYCLE_FAMILY } from './legaldocs-events.ts';
import type { FinanceLifecycleEvent } from './finance-events.ts';
import { FINANCE_LIFECYCLE_FAMILY } from './finance-events.ts';
import type { ReconciliationLifecycleEvent } from './reconciliation-events.ts';
import { RECONCILIATION_LIFECYCLE_FAMILY } from './reconciliation-events.ts';
import type { GlreconLifecycleEvent } from './glrecon-events.ts';
import { GLRECON_LIFECYCLE_FAMILY } from './glrecon-events.ts';
import type { JournalLifecycleEvent } from './journal-events.ts';
import { JOURNAL_LIFECYCLE_FAMILY } from './journal-events.ts';
import type { PostingRequestLifecycleEvent } from './posting-request-events.ts';
import { POSTING_REQUEST_LIFECYCLE_FAMILY } from './posting-request-events.ts';
import type { ApprovalLifecycleEvent } from './approval-events.ts';
import { APPROVAL_LIFECYCLE_FAMILY } from './approval-events.ts';
import type {
  AiRequestLifecycleEvent,
  AiOutputLifecycleEvent,
  AiGovernanceLifecycleEvent,
} from './ai-events.ts';
import {
  AI_REQUEST_LIFECYCLE_FAMILY,
  AI_OUTPUT_LIFECYCLE_FAMILY,
  AI_GOVERNANCE_LIFECYCLE_FAMILY,
} from './ai-events.ts';

/**
 * THE typed domain-event union.
 *
 * Stage 0 declared this `never` — no business events existed. Stage 1A appended `tenant.lifecycle`;
 * Stage 1B appends `identity.lifecycle`. Each arrives in the same change as the module that owns it
 * (CLAUDE.md: events ship with their module). The reference baseline has 81 families.
 *
 * TO ADD A FAMILY (with the module that owns it — never ahead of it):
 *   1. Register it in manifests/event-registry.yaml under its owning module.
 *   2. Declare its payloads and envelope alias in its own `*-events.ts`.
 *   3. Append the alias to `DomainEvent` and its family name to `DOMAIN_EVENT_FAMILIES`, at the TAIL.
 *      Never renumber or reorder — consumers and the outbox key off the family name.
 */
export type DomainEvent =
  | TenantLifecycleEvent
  | IdentityLifecycleEvent
  | AuthLifecycleEvent
  | AuthzLifecycleEvent
  | WorkflowLifecycleEvent
  | RulesLifecycleEvent
  | NotificationLifecycleEvent
  | DocumentLifecycleEvent
  | FeedbackLifecycleEvent
  | CaseLifecycleEvent
  | CaseConvertedToMatterEvent
  | LegalLifecycleEvent
  | LitigationLifecycleEvent
  | RecoveryLifecycleEvent
  | LegalDocsLifecycleEvent
  | FinanceLifecycleEvent
  | ReconciliationLifecycleEvent
  | GlreconLifecycleEvent
  | JournalLifecycleEvent
  | PostingRequestLifecycleEvent
  | ApprovalLifecycleEvent
  | AiRequestLifecycleEvent
  | AiOutputLifecycleEvent
  | AiGovernanceLifecycleEvent;

/** Every family currently declared. Kept in step with the union; asserted by the contracts smoke suite. */
export const DOMAIN_EVENT_FAMILIES: readonly string[] = [
  TENANT_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_FAMILY,
  AUTH_LIFECYCLE_FAMILY,
  AUTHZ_LIFECYCLE_FAMILY,
  WORKFLOW_LIFECYCLE_FAMILY,
  RULES_LIFECYCLE_FAMILY,
  NOTIFICATION_LIFECYCLE_FAMILY,
  DOCUMENT_LIFECYCLE_FAMILY,
  FEEDBACK_LIFECYCLE_FAMILY,
  CASE_LIFECYCLE_FAMILY,
  CASE_CONVERTED_TO_MATTER_FAMILY,
  LEGAL_LIFECYCLE_FAMILY,
  LITIGATION_LIFECYCLE_FAMILY,
  RECOVERY_LIFECYCLE_FAMILY,
  LEGALDOCS_LIFECYCLE_FAMILY,
  FINANCE_LIFECYCLE_FAMILY,
  RECONCILIATION_LIFECYCLE_FAMILY,
  GLRECON_LIFECYCLE_FAMILY,
  JOURNAL_LIFECYCLE_FAMILY,
  POSTING_REQUEST_LIFECYCLE_FAMILY,
  APPROVAL_LIFECYCLE_FAMILY,
  AI_REQUEST_LIFECYCLE_FAMILY,
  AI_OUTPUT_LIFECYCLE_FAMILY,
  AI_GOVERNANCE_LIFECYCLE_FAMILY,
];

/** Narrowing helper — stays accurate as families are appended. */
export type DomainEventFamily = DomainEvent['family'];
