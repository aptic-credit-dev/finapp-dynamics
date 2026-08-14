/**
 * Safe DTO shapers for `/api/v1/automation` + `/api/v1/extensions`. They expose ids, keys, capability references, statuses,
 * trust tiers and versions. They NEVER expose a step's secret-config reference content or executable content. RLS keeps a
 * caller to its own tenant's rows.
 */
import type {
  AutomationRow,
  StepRow,
  ScheduleRow,
  RunRow,
  ExtensionRow,
  InstallationRow,
} from '@finapp/m38-automation';

export function automationView(a: AutomationRow) {
  return {
    id: a.id,
    scope: a.scope,
    automationKey: a.automation_key,
    name: a.name,
    triggerKind: a.trigger_kind,
    state: a.state,
    validationPassed: a.validation_passed,
    version: a.version,
  };
}

export function stepView(s: StepRow) {
  return {
    id: s.id,
    automationId: s.automation_id,
    stepNo: s.step_no,
    capabilityRef: s.capability_ref,
    requiredPermission: s.required_permission,
    hasSecretConfig: s.config_secret_ref !== null,
  };
}

export function scheduleView(s: ScheduleRow) {
  return {
    id: s.id,
    automationId: s.automation_id,
    scheduleKey: s.schedule_key,
    recurrence: s.recurrence,
    concurrencyPolicy: s.concurrency_policy,
    nextRunAt: s.next_run_at,
    status: s.status,
    version: s.version,
  };
}

export function runView(r: RunRow) {
  return {
    id: r.id,
    automationId: r.automation_id,
    runKey: r.run_key,
    attemptNo: r.attempt_no,
    status: r.status,
    reasonCode: r.reason_code,
    downstreamRef: r.downstream_ref,
  };
}

export function extensionView(e: ExtensionRow) {
  return {
    id: e.id,
    scope: e.scope,
    extensionKey: e.extension_key,
    name: e.name,
    trustTier: e.trust_tier,
    isolationLevel: e.isolation_level,
    state: e.state,
    version: e.version,
  };
}

export function installationView(i: InstallationRow) {
  return {
    id: i.id,
    extensionId: i.extension_id,
    installKey: i.install_key,
    status: i.status,
    version: i.version,
  };
}
