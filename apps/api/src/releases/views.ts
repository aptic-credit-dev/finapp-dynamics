/**
 * Safe DTO shapers for `/api/v1/releases` (the governance/QA/release surface). They expose ids, keys, an artifact kind/opaque
 * ref, statuses and versions. Evidence views expose only WHETHER a signature reference is set — never the reference content.
 * RLS keeps a caller to its own tenant's rows.
 */
import type { ArtifactRow, EnvironmentRow, ReleaseRow, GateRow, EvidenceRow } from '@finapp/m37-govrelease';

export function artifactView(a: ArtifactRow) {
  return {
    id: a.id,
    scope: a.scope,
    artifactKey: a.artifact_key,
    artifactKind: a.artifact_kind,
    artifactRef: a.artifact_ref,
    name: a.name,
    status: a.status,
    version: a.version,
  };
}

export function environmentView(e: EnvironmentRow) {
  return {
    id: e.id,
    scope: e.scope,
    envKey: e.env_key,
    tier: e.tier,
    requiresApproval: e.requires_approval,
    status: e.status,
    version: e.version,
  };
}

export function releaseView(r: ReleaseRow) {
  return {
    id: r.id,
    artifactId: r.artifact_id,
    environmentId: r.environment_id,
    scope: r.scope,
    releaseKey: r.release_key,
    fromVersion: r.from_version,
    toVersion: r.to_version,
    state: r.state,
    qaPassed: r.qa_passed,
    version: r.version,
  };
}

export function gateView(g: GateRow) {
  return {
    id: g.id,
    releaseId: g.release_id,
    gateKey: g.gate_key,
    kind: g.kind,
    required: g.required,
    status: g.status,
    version: g.version,
  };
}

export function evidenceView(e: EvidenceRow) {
  return {
    id: e.id,
    releaseId: e.release_id,
    evidenceKind: e.evidence_kind,
    evidenceRef: e.evidence_ref,
    hasSignature: e.signature_ref !== null,
  };
}
