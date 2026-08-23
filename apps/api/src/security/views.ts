/**
 * Safe DTO shapers for `/api/v1/security` + `/api/v1/grc` + `/api/v1/privacy`. They expose ids, keys, states, classifications,
 * approved algorithm ids and opaque references. They NEVER expose a secret value, ciphertext, a token, a credential or raw
 * restricted content — a secret exposes only its opaque secret_ref. RLS keeps a caller to its own tenant's rows.
 */
import type {
  SecretRow,
  DlpPolicyRow,
  GrcControlRow,
  GrcControlListRow,
  GrcAssessmentListRow,
  PrivacyClassificationRow,
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
