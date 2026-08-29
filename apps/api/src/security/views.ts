/**
 * Safe DTO shapers for `/api/v1/security` + `/api/v1/grc` + `/api/v1/privacy`. They expose ids, keys, states, classifications,
 * approved algorithm ids and opaque references. They NEVER expose a secret value, ciphertext, a token, a credential or raw
 * restricted content — a secret exposes only its opaque secret_ref. RLS keeps a caller to its own tenant's rows.
 */
import type {
  SecretRow,
  SecretDetailRow,
  SecretVersionListRow,
  RevealListRow,
  SecretMetadata,
  DlpPolicyRow,
  DlpPolicyListRow,
  DlpFindingListRow,
  IncidentListRow,
  GrcControlRow,
  GrcControlListRow,
  GrcAssessmentListRow,
  PrivacyClassificationRow,
  PrivacyClassificationListRow,
  PrivacyRecordListRow,
} from '@finapp/m41-security';

export function secretView(s: SecretRow) {
  return {
    id: s.id,
    materialKind: s.material_kind,
    scope: s.scope,
    secretKey: s.secret_key,
    secretRef: s.secret_ref,
    algorithm: s.algorithm,
    state: s.state,
    currentVersionNo: s.current_version_no,
    version: s.version,
  };
}

// Secret DETAIL (admin console Overview) — the aggregate metadata + lifecycle timestamps. Exposes only the opaque
// secret_ref + an approved algorithm id + lifecycle state/version; NEVER a value, ciphertext, token or credential.
export function secretDetailView(s: SecretDetailRow) {
  return {
    id: s.id,
    materialKind: s.material_kind,
    scope: s.scope,
    secretKey: s.secret_key,
    secretRef: s.secret_ref,
    algorithm: s.algorithm,
    state: s.state,
    currentVersionNo: s.current_version_no,
    version: s.version,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}
// A secret VERSION (rotation history). Opaque provider_ref + state/version_no + lifecycle timestamps only. There is no
// material on a version row, so this projection cannot carry a secret value.
export function secretVersionView(v: SecretVersionListRow) {
  return {
    id: v.id,
    secretId: v.secret_id,
    versionNo: v.version_no,
    state: v.state,
    providerRef: v.provider_ref,
    activatedAt: v.activated_at,
    createdAt: v.created_at,
  };
}
// A REVEAL GRANT (maker-checker evidence). Requester/approver/purpose/expiry/status only — never any material, and
// there is no mechanism here to retrieve one (the reveal records the grant; material would be delivered out-of-band
// by an approved provider, which is unavailable in the framework-only default).
export function revealView(r: RevealListRow) {
  return {
    id: r.id,
    secretId: r.secret_id,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    purpose: r.purpose,
    reasonCode: r.reason_code,
    granted: r.granted,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}
// Provider HEALTH/STATUS for a secret — availability metadata only (Available / Unavailable + reasonCode). Never a
// credential, token, provider auth material, environment value or secret content. Preserves the fail-closed default.
export function secretProviderStatusView(m: SecretMetadata) {
  return { available: m.available, reasonCode: m.reasonCode };
}

export function dlpPolicyView(p: DlpPolicyRow) {
  return {
    id: p.id,
    policyKey: p.policy_key,
    classification: p.classification,
    action: p.action,
    state: p.state,
    version: p.version,
  };
}

export function grcControlListView(c: GrcControlListRow) {
  return {
    id: c.id,
    controlKey: c.control_key,
    framework: c.framework,
    title: c.title,
    scope: c.scope,
    state: c.state,
    version: c.version,
  };
}
export function grcAssessmentView(a: GrcAssessmentListRow) {
  return {
    id: a.id,
    controlId: a.control_id,
    status: a.status,
    evidenceRef: a.evidence_ref,
    reasonCode: a.reason_code,
    assessedBy: a.assessed_by,
    createdAt: a.created_at,
  };
}
export function grcControlView(c: GrcControlRow) {
  return { id: c.id, controlKey: c.control_key, framework: c.framework, state: c.state, version: c.version };
}

export function privacyClassificationView(p: PrivacyClassificationRow) {
  return {
    id: p.id,
    classificationKey: p.classification_key,
    level: p.level,
    state: p.state,
    version: p.version,
  };
}

// ---- read-model DTOs (bounded projections; no raw restricted content, no personal data — a privacy record
// exposes only its OPAQUE subject reference). ----
export function dlpPolicyListView(p: DlpPolicyListRow) {
  return {
    id: p.id,
    policyKey: p.policy_key,
    classification: p.classification,
    action: p.action,
    scope: p.scope,
    state: p.state,
    version: p.version,
    createdAt: p.created_at,
  };
}
export function dlpFindingView(f: DlpFindingListRow) {
  return {
    id: f.id,
    policyId: f.policy_id,
    classification: f.classification,
    action: f.action,
    reasonCode: f.reason_code,
    sourceRef: f.source_ref,
    findingCount: f.finding_count,
    createdAt: f.created_at,
  };
}
export function incidentView(i: IncidentListRow) {
  return {
    id: i.id,
    incidentKey: i.incident_key,
    severity: i.severity,
    category: i.category,
    state: i.state,
    reasonCode: i.reason_code,
    evidenceRef: i.evidence_ref,
    createdAt: i.created_at,
  };
}
export function privacyClassificationListView(p: PrivacyClassificationListRow) {
  return {
    id: p.id,
    classificationKey: p.classification_key,
    level: p.level,
    scope: p.scope,
    retentionDays: p.retention_days,
    state: p.state,
    version: p.version,
    createdAt: p.created_at,
  };
}
export function privacyRecordView(r: PrivacyRecordListRow) {
  return {
    id: r.id,
    subjectRef: r.subject_ref,
    classification: r.classification,
    action: r.action,
    reasonCode: r.reason_code,
    evidenceRef: r.evidence_ref,
    createdAt: r.created_at,
  };
}
