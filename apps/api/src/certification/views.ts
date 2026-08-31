/**
 * API views for m42-certification. Bounded projections — ids, keys, states, domain/aspect, verdict, version. NO raw evidence
 * body, secret, credential or log ever crosses the API. Evidence is exposed as OPAQUE references only.
 */
import type {
  ProgrammeRow,
  AssessmentRow,
  FindingRow,
  WaiverRow,
  ReadinessRow,
  ClosureRow,
  SignoffListRow,
} from '@finapp/m42-certification';

export function programmeView(p: ProgrammeRow) {
  return {
    id: p.id,
    scope: p.scope,
    programmeKey: p.programme_key,
    stageKey: p.stage_key,
    title: p.title,
    state: p.state,
    lastDecision: p.last_decision,
    currentDecisionNo: p.current_decision_no,
    version: p.version,
  };
}

export function assessmentView(a: AssessmentRow) {
  return {
    id: a.id,
    programmeId: a.programme_id,
    domainKey: a.domain_key,
    aspectKey: a.aspect_key,
    status: a.status,
    evidenceRef: a.evidence_ref,
    version: a.version,
  };
}

export function findingView(f: FindingRow) {
  return {
    id: f.id,
    programmeId: f.programme_id,
    domainKey: f.domain_key,
    aspectKey: f.aspect_key,
    severity: f.severity,
    status: f.status,
    title: f.title,
    version: f.version,
  };
}

export function waiverView(w: WaiverRow) {
  return {
    id: w.id,
    programmeId: w.programme_id,
    findingId: w.finding_id,
    isAbsolute: w.is_absolute,
    state: w.state,
    validTo: w.valid_to,
    version: w.version,
  };
}

export function readinessView(r: ReadinessRow) {
  return {
    id: r.id,
    programmeId: r.programme_id,
    kind: r.kind,
    refKey: r.ref_key,
    result: r.result,
    signedOff: r.signed_off_by !== null,
    version: r.version,
  };
}

// Read-only sign-off projection — role/domain/disposition + the opaque signer id; no secret/PII.
export function signoffView(s: SignoffListRow) {
  return {
    roleKey: s.role_key,
    domainKey: s.domain_key,
    signedBy: s.signed_by,
    disposition: s.disposition,
  };
}

// Read-only closure projection — the derived decision on the immutable closure artifact (metadata only).
export function closureView(c: ClosureRow) {
  return { id: c.id, programmeId: c.programme_id, decision: c.decision };
}
