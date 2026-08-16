-- ---------------------------------------------------------------------------------------------------
-- M42-certification — ENTERPRISE INTEGRATION / CERTIFICATION / PRODUCTION RELEASE (Stage 6I, mvp:false). The FINAL Stage-6
-- module and the Stage-6 CLOSURE GATE. A GOVERNANCE RUNTIME + EVIDENCE/CLOSURE layer: it RECORDS certification programmes,
-- domain assessments (the 12 Stage-6 modules M30-M41 x 8 aspects), findings, exceptions/waivers, evidence references, migration/
-- UAT/pilot/release readiness, role sign-offs, and issues a deny-by-default GO/CONDITIONAL_GO/NO_GO decision (ADR-012) + a
-- Stage-6 closure artifact. It ASSESSES M30-M41 BY CONTRACT (opaque refs; reads no owning-module private table) and DUPLICATES
-- no audit/workflow/approval/security/analytics/outbox/scheduler/secrets engine. It RECORDS evidence + governance state and
-- EXECUTES no release/deployment/migration/DR/journal/secret-rotation. A GO is DERIVED from governed evidence, never set by a
-- caller. INDEPENDENCE (ADR-012): a GO needs all mandatory role sign-offs, NO self-sign-off of one's own assessed domain,
-- requester != certifier, AI/system/automation NEVER self-certify, and an ISSUED decision/closure is IMMUTABLE (trigger; a
-- correction is a NEW decision/version). Evidence is stored as OPAQUE references only (m09/document/SHA) — never a secret,
-- credential, full log, raw report body or restricted payload. Uses the certification_ prefix and owns the certification.*
-- event families through the ONE m06 outbox. reference_tables 43 -> 13 governed core. Every tenant table: composite
-- (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m42), version on mutable aggregates.
-- No DELETE grant anywhere (ADR-010). Sign-off/decision/condition/evidence/review/history/closure + idempotency are append-only
-- (INSERT+SELECT, 0002). PostgreSQL 16 compatible.
-- ---------------------------------------------------------------------------------------------------

-- The platform_certification.* permission namespace (already declared in naming-map; NO GAP-4). Three-segment. Every controlled
-- operation authorizes one (default deny). platform_certification.control.administer is the cross-tenant CONTROL-PLANE
-- permission a tenant admin never holds by default (a platform-scope Stage-6 programme). waiver.approve / signoff.approve /
-- decision.issue are privileged CONTROLLED actions. NO platform_certification.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('platform_certification.programme.read', 'm42-certification', 'certification_programme', false),
  ('platform_certification.programme.manage', 'm42-certification', 'certification_programme', false),
  ('platform_certification.assessment.read', 'm42-certification', 'certification_assessment', false),
  ('platform_certification.assessment.manage', 'm42-certification', 'certification_assessment', false),
  ('platform_certification.finding.read', 'm42-certification', 'certification_finding', false),
  ('platform_certification.finding.manage', 'm42-certification', 'certification_finding', false),
  ('platform_certification.waiver.request', 'm42-certification', 'certification_waiver', false),
  ('platform_certification.waiver.approve', 'm42-certification', 'certification_waiver', true),
  ('platform_certification.signoff.approve', 'm42-certification', 'certification_signoff', true),
  ('platform_certification.decision.issue', 'm42-certification', 'certification_decision', true),
  ('platform_certification.evidence.read', 'm42-certification', 'certification_evidence', false),
  ('platform_certification.control.administer', 'm42-certification', 'certification', true);

-- certification_programme — a certification PROGRAMME (the unit that certifies a stage; scope platform|tenant). Lifecycle
-- draft -> assessing -> in_review -> decided -> closed. current_decision_no points at the last issued decision. Mutable
-- aggregate (version CAS). RECORDS governance state; it EXECUTES nothing.
CREATE TABLE certification_programme (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'platform', programme_key text NOT NULL, stage_key text NOT NULL, title text NOT NULL,
  state text NOT NULL DEFAULT 'draft', last_decision text, current_decision_no integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT certification_programme_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_programme_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_programme_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT certification_programme_key_ck CHECK (programme_key <> '' AND stage_key <> '' AND title <> ''),
  CONSTRAINT certification_programme_state_ck CHECK (state IN ('draft','assessing','in_review','decided','closed')),
  CONSTRAINT certification_programme_decision_ck CHECK (last_decision IS NULL OR last_decision IN ('go','conditional_go','no_go')),
  CONSTRAINT certification_programme_no_ck CHECK (current_decision_no >= 0));
ALTER TABLE certification_programme ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_programme FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_programme
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX certification_programme_key_uniq ON certification_programme (tenant_id, programme_key);
COMMENT ON TABLE certification_programme IS 'class=tenant_aggregate; m42 certification programme (records governance state; executes nothing)';

-- certification_assessment — a DOMAIN x ASPECT assessment cell (the Stage-6 matrix: 12 domains M30-M41 x 8 aspects). status
-- not_assessed -> pass|fail|waived. evidence_ref is an OPAQUE pointer (an m30-m41 cert report / CI / SHA) — never copied data.
-- Mutable aggregate (version CAS). UNIQUE per (programme, domain, aspect).
CREATE TABLE certification_assessment (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL,
  domain_key text NOT NULL, aspect_key text NOT NULL, status text NOT NULL DEFAULT 'not_assessed',
  evidence_ref text, reason_code text, assessed_by uuid,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT certification_assessment_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_assessment_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_assessment_domain_ck CHECK (domain_key IN ('m30','m31','m32','m33','m34','m35','m36','m37','m38','m39','m40','m41')),
  CONSTRAINT certification_assessment_aspect_ck CHECK (aspect_key IN ('architecture','security','tenancy_rls','sod_maker_checker','events_outbox','shared_service_boundaries','tests_ci','data_migration')),
  CONSTRAINT certification_assessment_status_ck CHECK (status IN ('not_assessed','pass','fail','waived')),
  CONSTRAINT certification_assessment_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_assessment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX certification_assessment_cell_uniq ON certification_assessment (tenant_id, programme_id, domain_key, aspect_key);
COMMENT ON TABLE certification_assessment IS 'class=tenant_aggregate; m42 domain x aspect assessment (opaque evidence_ref; no copied operational data)';

-- certification_finding — a governed FINDING against a domain/aspect. severity low..critical; status open -> resolved|waived.
-- A CRITICAL open finding BLOCKS a GO. Mutable aggregate (version CAS). Evidence is an OPAQUE ref.
CREATE TABLE certification_finding (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL,
  domain_key text NOT NULL, aspect_key text, severity text NOT NULL, status text NOT NULL DEFAULT 'open',
  title text NOT NULL, evidence_ref text, owner_ref text, due_at timestamptz, reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT certification_finding_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_finding_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_finding_domain_ck CHECK (domain_key IN ('m30','m31','m32','m33','m34','m35','m36','m37','m38','m39','m40','m41')),
  CONSTRAINT certification_finding_severity_ck CHECK (severity IN ('low','medium','high','critical')),
  CONSTRAINT certification_finding_status_ck CHECK (status IN ('open','resolved','waived')),
  CONSTRAINT certification_finding_title_ck CHECK (title <> ''),
  CONSTRAINT certification_finding_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_finding
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_finding IS 'class=tenant_aggregate; m42 certification finding (a critical open finding blocks GO)';

-- certification_waiver — a governed EXCEPTION/WAIVER against a finding. High risk: bounded scope + specific finding + reason +
-- EXPIRY + requester + approver, maker-checker/SoD (approved_by <> requested_by, a human — in-service; AI/system/automation
-- never approve). An ABSOLUTE control cannot be waived (is_absolute blocks approval, in-service). An EXPIRED waiver stops
-- satisfying the gate (valid_to). Mutable aggregate (version CAS).
CREATE TABLE certification_waiver (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL, finding_id uuid NOT NULL,
  scope text NOT NULL, reason text NOT NULL, is_absolute boolean NOT NULL DEFAULT false,
  requested_by uuid NOT NULL, approved_by uuid, state text NOT NULL DEFAULT 'requested', valid_to timestamptz,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT certification_waiver_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_waiver_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_waiver_scope_ck CHECK (scope <> '' AND reason <> ''),
  CONSTRAINT certification_waiver_state_ck CHECK (state IN ('requested','approved','rejected','expired')),
  CONSTRAINT certification_waiver_sod_ck CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT certification_waiver_approved_ck CHECK (state <> 'approved' OR (approved_by IS NOT NULL AND valid_to IS NOT NULL)),
  CONSTRAINT certification_waiver_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id),
  CONSTRAINT certification_waiver_finding_fkey FOREIGN KEY (tenant_id, finding_id) REFERENCES certification_finding (tenant_id, id));
ALTER TABLE certification_waiver ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_waiver FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_waiver
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_waiver IS 'class=tenant_aggregate; m42 waiver (maker-checker/SoD; expiry; absolute controls never waivable)';

-- certification_readiness — a MIGRATION / UAT / PILOT / RELEASE readiness record. M42 RECORDS readiness EVIDENCE; it EXECUTES no
-- migration/UAT/pilot/release. result pending -> pass|fail. A missing/failed mandatory readiness BLOCKS a GO. UAT/release
-- sign-off must be human (in-service). Mutable aggregate. UNIQUE per (programme, kind, ref_key). Refs are OPAQUE.
CREATE TABLE certification_readiness (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL,
  kind text NOT NULL, ref_key text NOT NULL, plan_ref text, evidence_ref text, rollback_ref text,
  result text NOT NULL DEFAULT 'pending', signed_off_by uuid, reason_code text,
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT certification_readiness_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_readiness_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_readiness_kind_ck CHECK (kind IN ('migration','uat','pilot','release')),
  CONSTRAINT certification_readiness_ref_ck CHECK (ref_key <> ''),
  CONSTRAINT certification_readiness_result_ck CHECK (result IN ('pending','pass','fail')),
  CONSTRAINT certification_readiness_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_readiness FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_readiness
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX certification_readiness_kind_uniq ON certification_readiness (tenant_id, programme_id, kind, ref_key);
COMMENT ON TABLE certification_readiness IS 'class=tenant_aggregate; m42 migration/uat/pilot/release readiness evidence (records, executes nothing)';

-- certification_signoff — APPEND-ONLY: a ROLE SIGN-OFF. Independence (ADR-012): a human signer; NO self-sign-off of one's own
-- assessed domain (enforced in-service: signer <> the domain's assessed_by); AI/system/automation never sign. All mandatory
-- roles must be present before a GO.
CREATE TABLE certification_signoff (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL,
  role_key text NOT NULL, domain_key text, signed_by uuid NOT NULL, disposition text NOT NULL DEFAULT 'approve',
  reason_code text, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_signoff_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_signoff_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_signoff_role_ck CHECK (role_key <> ''),
  CONSTRAINT certification_signoff_disp_ck CHECK (disposition IN ('approve','reject')),
  CONSTRAINT certification_signoff_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_signoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_signoff FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_signoff
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_signoff IS 'class=tenant_ledger; m42 role sign-off (append-only; independent human; no self-sign of own domain)';

-- certification_decision — APPEND-ONLY + IMMUTABLE: an ISSUED GO/CONDITIONAL_GO/NO_GO decision (ADR-012). decision_no
-- increments; the verdict is DERIVED from governed evidence (never caller-set). Maker-checker/SoD: issued_by <> requested_by,
-- a human (in-service; AI/system/automation never issue). An ISSUED decision is IMMUTABLE (trigger); a correction is a NEW row.
CREATE TABLE certification_decision (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL,
  decision_no integer NOT NULL, decision text NOT NULL, derived boolean NOT NULL DEFAULT true,
  requested_by uuid NOT NULL, issued_by uuid NOT NULL, evidence_ref text, rationale_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_decision_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_decision_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_decision_decision_ck CHECK (decision IN ('go','conditional_go','no_go')),
  CONSTRAINT certification_decision_no_ck CHECK (decision_no >= 1),
  CONSTRAINT certification_decision_sod_ck CHECK (issued_by <> requested_by),
  CONSTRAINT certification_decision_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_decision
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX certification_decision_no_uniq ON certification_decision (tenant_id, programme_id, decision_no);
-- An issued decision is IMMUTABLE — no field may be rewritten (a correction is a new decision_no).
CREATE OR REPLACE FUNCTION certification_decision_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'an issued certification decision is immutable (issue a new decision to supersede)' USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER certification_decision_immutable_trg BEFORE UPDATE ON certification_decision
  FOR EACH ROW EXECUTE FUNCTION certification_decision_immutable();
COMMENT ON TABLE certification_decision IS 'class=tenant_ledger; m42 issued GO/CONDITIONAL_GO/NO_GO (append-only; derived; immutable trigger)';

-- certification_condition — APPEND-ONLY: a bounded residual CONDITION attached to a CONDITIONAL_GO. Explicit, bounded,
-- evidence-backed, owned, time-bound where applicable. (Stage-7 live-infra hardening is the canonical example.)
CREATE TABLE certification_condition (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), decision_id uuid NOT NULL,
  condition_key text NOT NULL, description text NOT NULL, owner_ref text, due_at timestamptz, evidence_ref text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_condition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_condition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_condition_key_ck CHECK (condition_key <> '' AND description <> ''),
  CONSTRAINT certification_condition_decision_fkey FOREIGN KEY (tenant_id, decision_id) REFERENCES certification_decision (tenant_id, id));
ALTER TABLE certification_condition ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_condition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_condition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_condition IS 'class=tenant_ledger; m42 CONDITIONAL_GO residual condition (append-only; bounded, owned, time-bound)';

-- certification_evidence — APPEND-ONLY: an OPAQUE evidence REFERENCE (an m30-m41 cert report / CI run / SHA / m09 document).
-- NEVER a secret, credential, full log, raw report body or restricted payload — a reference + a bounded reason only.
CREATE TABLE certification_evidence (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL,
  subject_kind text NOT NULL, subject_id uuid, evidence_kind text NOT NULL, evidence_ref text NOT NULL, sha_ref text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_evidence_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_evidence_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_evidence_kind_ck CHECK (subject_kind <> '' AND evidence_kind <> '' AND evidence_ref <> ''),
  CONSTRAINT certification_evidence_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_evidence IS 'class=tenant_ledger; m42 opaque evidence reference (append-only; no raw body/secret/PII)';

-- certification_review — APPEND-ONLY: the maker-checker REVIEW ledger for controlled certification actions (waiver approval,
-- decision issuance, closure). SoD CHECK: decided_by <> requested_by.
CREATE TABLE certification_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_kind text NOT NULL, target_id uuid NOT NULL, decision text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_review_kind_ck CHECK (target_kind <> '' AND decision <> ''),
  CONSTRAINT certification_review_sod_ck CHECK (decided_by <> requested_by));
ALTER TABLE certification_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_review IS 'class=tenant_ledger; m42 maker-checker review (append-only; decided_by <> requested_by)';

-- certification_history — APPEND-ONLY: a bounded state-transition history over programmes/findings/waivers/readiness.
CREATE TABLE certification_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL, subject_id uuid NOT NULL, from_state text, to_state text NOT NULL, actor uuid, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_history_kind_ck CHECK (subject_kind <> '' AND to_state <> ''),
  CONSTRAINT certification_history_programme_fkey FOREIGN KEY (tenant_id, subject_id) REFERENCES certification_programme (tenant_id, id));
ALTER TABLE certification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE certification_history IS 'class=tenant_ledger; m42 state-transition history (append-only)';

-- certification_closure — APPEND-ONLY + IMMUTABLE: the STAGE-6 CLOSURE artifact. Bounded metadata (decision, assessed modules,
-- impl/cert refs, findings/signoffs/conditions summary, issued_at). NO embedded certification reports — opaque refs only. Once
-- issued it is IMMUTABLE (trigger).
CREATE TABLE certification_closure (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), programme_id uuid NOT NULL, decision_id uuid NOT NULL,
  stage_key text NOT NULL, decision text NOT NULL, assessed_modules text NOT NULL,
  findings_summary text, signoffs_summary text, conditions_summary text, impl_cert_refs text, artifact_ref text,
  issued_by uuid NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_closure_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_closure_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_closure_ck CHECK (stage_key <> '' AND assessed_modules <> ''),
  CONSTRAINT certification_closure_decision_ck CHECK (decision IN ('go','conditional_go','no_go')),
  CONSTRAINT certification_closure_programme_fkey FOREIGN KEY (tenant_id, programme_id) REFERENCES certification_programme (tenant_id, id),
  CONSTRAINT certification_closure_decision_fkey FOREIGN KEY (tenant_id, decision_id) REFERENCES certification_decision (tenant_id, id));
ALTER TABLE certification_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_closure FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_closure
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX certification_closure_programme_uniq ON certification_closure (tenant_id, programme_id);
CREATE OR REPLACE FUNCTION certification_closure_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'a stage closure artifact is immutable (a re-closure is a new decision + programme cycle)' USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER certification_closure_immutable_trg BEFORE UPDATE ON certification_closure
  FOR EACH ROW EXECUTE FUNCTION certification_closure_immutable();
COMMENT ON TABLE certification_closure IS 'class=tenant_ledger; m42 Stage-6 closure artifact (append-only; immutable; bounded metadata + opaque refs)';

-- certification_idempotency — APPEND-ONLY: idempotency keys for high-risk certification actions (decision issuance, closure).
CREATE TABLE certification_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), idempotency_key text NOT NULL, purpose text NOT NULL,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certification_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT certification_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT certification_idempotency_key_ck CHECK (idempotency_key <> '' AND purpose <> ''));
ALTER TABLE certification_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certification_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX certification_idempotency_uniq ON certification_idempotency (tenant_id, purpose, idempotency_key);
COMMENT ON TABLE certification_idempotency IS 'class=tenant_ledger; m42 idempotency keys (append-only)';
