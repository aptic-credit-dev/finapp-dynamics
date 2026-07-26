-- ---------------------------------------------------------------------------------------------------
-- M09-docs — enterprise document & records management (Stage 2.5).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No table
-- grants DELETE (records dispose by an authorized workflow that leaves a tombstone; ADR-010/050). Legal-hold,
-- disposition and scan evidence are append-only (INSERT + SELECT only, granted in 0002).
--
-- Large binary content is NOT stored in PostgreSQL — a document_version holds only an opaque STORAGE REFERENCE
-- plus metadata (filename, media type, byte size, content hash); the bytes live in an object store behind the
-- storage port (ADR-045). Committed version content columns are immutable (frozen by the service + content
-- hash; status promotion is the only UPDATE). Document types and retention policies are versioned, immutable
-- `spec` JSON with one ACTIVE per code (ADR-045). m09 publishes document.lifecycle through the ONE outbox m06
-- owns; it never creates a second outbox.
-- ---------------------------------------------------------------------------------------------------

-- Seed m09's permissions into the global permission catalogue (owned by m02, a global reference table).
-- Document ACL grants SUPPLEMENT these RBAC permissions; they never replace M02 (ADR-048). Privileged:
-- type/retention/legal-hold management, access grant/revoke, forced checkout release, disposition approve/
-- execute, scan override, and the platform authority. There is no vague `documents.admin` (ADR-047).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('documents.document.read', 'm09-docs', 'document', false),
  ('documents.document.create', 'm09-docs', 'document', false),
  ('documents.document.update_metadata', 'm09-docs', 'document', false),
  ('documents.document.upload_version', 'm09-docs', 'document_version', false),
  ('documents.document.activate', 'm09-docs', 'document', false),
  ('documents.document.archive', 'm09-docs', 'document', false),
  ('documents.document.withdraw', 'm09-docs', 'document', true),
  ('documents.document.download', 'm09-docs', 'document_version', false),
  ('documents.type.read', 'm09-docs', 'document_type', false),
  ('documents.type.manage', 'm09-docs', 'document_type', true),
  ('documents.retention.read', 'm09-docs', 'retention_policy', false),
  ('documents.retention.manage', 'm09-docs', 'retention_policy', true),
  ('documents.access.read', 'm09-docs', 'document_access_grant', false),
  ('documents.access.grant', 'm09-docs', 'document_access_grant', true),
  ('documents.access.revoke', 'm09-docs', 'document_access_grant', true),
  ('documents.checkout.acquire', 'm09-docs', 'document_checkout', false),
  ('documents.checkout.release', 'm09-docs', 'document_checkout', false),
  ('documents.checkout.force_release', 'm09-docs', 'document_checkout', true),
  ('documents.legal_hold.read', 'm09-docs', 'document_legal_hold', false),
  ('documents.legal_hold.manage', 'm09-docs', 'document_legal_hold', true),
  ('documents.disposition.read', 'm09-docs', 'document_disposition', false),
  ('documents.disposition.request', 'm09-docs', 'document_disposition', false),
  ('documents.disposition.approve', 'm09-docs', 'document_disposition', true),
  ('documents.disposition.execute', 'm09-docs', 'document_disposition', true),
  ('documents.scan.override', 'm09-docs', 'document_version', true),
  ('documents.relationship.manage', 'm09-docs', 'document_relationship', false),
  ('documents.platform.administer', 'm09-docs', 'document_engine', true);

-- document_type — a versioned, immutable-after-publish type definition. `spec` holds allowed media types, max
-- size, required metadata schema, default classification, retention policy code, approval/signature/scan flags.
CREATE TABLE document_type (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  code           text        NOT NULL,
  version_number integer     NOT NULL DEFAULT 1,
  name           text        NOT NULL,
  scope          text        NOT NULL DEFAULT 'tenant',
  status         text        NOT NULL DEFAULT 'DRAFT',
  spec           jsonb       NOT NULL,
  content_hash   text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  published_at   timestamptz,
  published_by   uuid,
  CONSTRAINT document_type_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_type_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_type_code_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT document_type_scope_ck CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT document_type_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT document_type_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT document_type_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_type
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_type_one_active ON document_type (tenant_id, code) WHERE status = 'ACTIVE';

-- retention_policy — a versioned, immutable-after-publish retention definition (period, trigger, disposition
-- action, review requirement).
CREATE TABLE retention_policy (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  code           text        NOT NULL,
  version_number integer     NOT NULL DEFAULT 1,
  name           text        NOT NULL,
  scope          text        NOT NULL DEFAULT 'tenant',
  status         text        NOT NULL DEFAULT 'DRAFT',
  spec           jsonb       NOT NULL,
  content_hash   text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  published_at   timestamptz,
  published_by   uuid,
  CONSTRAINT retention_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT retention_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT retention_policy_code_ver_key UNIQUE (tenant_id, code, version_number),
  CONSTRAINT retention_policy_scope_ck CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT retention_policy_status_ck CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED','ARCHIVED')),
  CONSTRAINT retention_policy_hash_ck CHECK (status IN ('DRAFT','VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT retention_policy_optlock_ck CHECK (version >= 1)
);
ALTER TABLE retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON retention_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX retention_policy_one_active ON retention_policy (tenant_id, code) WHERE status = 'ACTIVE';

-- document — the logical, stable record. Identified by a code/reference (never by filename). Carries typed
-- metadata (validated against the document type; bounded jsonb, NOT arbitrary), classification/sensitivity,
-- lifecycle status, owner/custodian, the current active version pointer, retention + legal-hold + disposition
-- state, effective/expiry dates, and origin. Optimistic-lock guarded; idempotent creation.
CREATE TABLE document (
  tenant_id             uuid        NOT NULL,
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  code                  text        NOT NULL,
  title                 text        NOT NULL,
  description           text,
  document_type         text        NOT NULL,
  classification        text        NOT NULL DEFAULT 'internal',
  sensitivity           text,
  status                text        NOT NULL DEFAULT 'draft',
  owner_id              uuid,
  custodian_id          uuid,
  current_version_id    uuid,
  current_version_number integer    NOT NULL DEFAULT 0,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  retention_policy_code text,
  retention_anchor_at   timestamptz,
  earliest_disposition_at timestamptz,
  disposition_status    text,
  legal_hold            boolean     NOT NULL DEFAULT false,
  effective_at          timestamptz,
  expires_at            timestamptz,
  origin_module         text,
  origin_entity_type    text,
  origin_entity_id      uuid,
  idempotency_key       text,
  correlation_id        uuid        NOT NULL,
  causation_id          uuid,
  version               integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT document_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_code_key UNIQUE (tenant_id, code),
  CONSTRAINT document_classification_ck CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT document_status_ck CHECK (status IN ('draft','active','superseded','archived','withdrawn','disposed')),
  CONSTRAINT document_current_ver_ck CHECK (current_version_number >= 0),
  CONSTRAINT document_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_idem_key ON document (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX document_type_idx ON document (tenant_id, document_type, status);
CREATE INDEX document_origin_idx ON document (tenant_id, origin_module, origin_entity_id);

-- document_version — an immutable version. A pending row is created at upload initiation; on completion the
-- server verifies the object's actual hash + size against the claimed values, then the version commits. A
-- committed version's content columns are frozen (immutability evidence). Exactly one ACTIVE version per
-- document (partial unique index). Bytes live in the object store; only the storage_ref is persisted here.
CREATE TABLE document_version (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  document_id    uuid        NOT NULL,
  version_number integer     NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',
  storage_ref    text        NOT NULL,
  storage_code   text        NOT NULL,
  filename       text        NOT NULL,
  filename_norm  text        NOT NULL,
  media_type     text        NOT NULL,
  byte_size      bigint,
  content_hash   text,
  change_summary text,
  source         text,
  scan_status    text        NOT NULL DEFAULT 'pending',
  idempotency_key text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  committed_at   timestamptz,
  CONSTRAINT document_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_version_num_key UNIQUE (tenant_id, document_id, version_number),
  CONSTRAINT document_version_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_version_status_ck CHECK (status IN ('pending','committed','active','superseded')),
  CONSTRAINT document_version_scan_ck CHECK (scan_status IN ('pending','clean','suspicious','infected','failed','bypassed')),
  -- A committed-or-later version must carry the frozen content hash + a non-negative byte size (evidence).
  CONSTRAINT document_version_committed_ck CHECK (status = 'pending' OR (content_hash IS NOT NULL AND byte_size IS NOT NULL)),
  CONSTRAINT document_version_size_ck CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT document_version_idem_key UNIQUE (tenant_id, document_id, idempotency_key),
  CONSTRAINT document_version_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_version_one_active ON document_version (tenant_id, document_id) WHERE status = 'active';

-- document_access_grant — a document-scoped ACL entry that SUPPLEMENTS RBAC (never replaces it). Revocable by
-- status; append-only in effect (no DELETE). Grantee is a declarative ref (user/role/permission/participant/
-- custodian).
CREATE TABLE document_access_grant (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  document_id   uuid        NOT NULL,
  grantee_kind  text        NOT NULL,
  grantee_ref   text        NOT NULL,
  access_level  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active',
  granted_by    uuid,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_by    uuid,
  revoked_at    timestamptz,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT document_access_grant_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_access_grant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_access_grant_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_access_grant_kind_ck CHECK (grantee_kind IN ('user','role','permission','participant','custodian')),
  CONSTRAINT document_access_grant_level_ck CHECK (access_level IN ('read','download','edit_metadata','manage')),
  CONSTRAINT document_access_grant_status_ck CHECK (status IN ('active','revoked')),
  CONSTRAINT document_access_grant_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_access_grant
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_access_grant_active_key
  ON document_access_grant (tenant_id, document_id, grantee_kind, grantee_ref, access_level) WHERE status = 'active';

-- document_checkout — an edit reservation with lease semantics. At most one OPEN checkout per document (partial
-- unique index) = single-winner; a stale (expired) lease can be reclaimed; forced release is privileged.
CREATE TABLE document_checkout (
  tenant_id        uuid        NOT NULL,
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  document_id      uuid        NOT NULL,
  checked_out_by   uuid        NOT NULL,
  expected_version integer     NOT NULL,
  acquired_at      timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  released_at      timestamptz,
  released_by      uuid,
  forced           boolean     NOT NULL DEFAULT false,
  version          integer     NOT NULL DEFAULT 1,
  CONSTRAINT document_checkout_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_checkout_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_checkout_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_checkout_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_checkout ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_checkout FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_checkout
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_checkout_open_key ON document_checkout (tenant_id, document_id) WHERE released_at IS NULL;

-- document_relationship — a typed, tenant-consistent link between two documents. Acyclic types (supersedes,
-- derived_from) are cycle-checked in the domain. Removal is by status (no DELETE).
CREATE TABLE document_relationship (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  from_document_id  uuid        NOT NULL,
  to_document_id    uuid        NOT NULL,
  relationship_type text        NOT NULL,
  status            text        NOT NULL DEFAULT 'active',
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  removed_by        uuid,
  removed_at        timestamptz,
  version           integer     NOT NULL DEFAULT 1,
  CONSTRAINT document_relationship_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_relationship_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_relationship_from_fkey FOREIGN KEY (tenant_id, from_document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_relationship_to_fkey FOREIGN KEY (tenant_id, to_document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_relationship_type_ck CHECK (relationship_type IN ('supersedes','derived_from','attachment_to','evidence_for','related_to')),
  CONSTRAINT document_relationship_status_ck CHECK (status IN ('active','removed')),
  CONSTRAINT document_relationship_noself_ck CHECK (from_document_id <> to_document_id),
  CONSTRAINT document_relationship_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_relationship FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_relationship
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_relationship_active_key
  ON document_relationship (tenant_id, from_document_id, to_document_id, relationship_type) WHERE status = 'active';

-- document_legal_hold — APPEND-ONLY hold history (INSERT + SELECT only, 0002). An active hold blocks disposal.
-- At most one ACTIVE hold per document; releasing inserts... no — release UPDATES status. Append-only means no
-- rewrite of a placed hold's identity/reason; status transitions active->released are the one permitted change,
-- so this table gets SELECT/INSERT/UPDATE but never DELETE (the placed_by/reason/at columns are never rewritten
-- by the service — immutability by convention + audit).
CREATE TABLE document_legal_hold (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid        NOT NULL,
  status      text        NOT NULL DEFAULT 'active',
  reason      text        NOT NULL,
  placed_by   uuid,
  placed_at   timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  release_reason text,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT document_legal_hold_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_legal_hold_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_legal_hold_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_legal_hold_status_ck CHECK (status IN ('active','released')),
  CONSTRAINT document_legal_hold_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_legal_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_legal_hold FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_legal_hold
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX document_legal_hold_active_key ON document_legal_hold (tenant_id, document_id) WHERE status = 'active';

-- document_disposition — APPEND-ONLY disposition evidence + workflow state. Disposal requires explicit
-- privileged approval; a tombstone remains after disposal (the row is never deleted).
CREATE TABLE document_disposition (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  document_id   uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'eligible',
  action        text        NOT NULL,
  reason        text,
  idempotency_key text,
  requested_by  uuid,
  requested_at  timestamptz,
  approved_by   uuid,
  approved_at   timestamptz,
  disposed_by   uuid,
  disposed_at   timestamptz,
  correlation_id uuid       NOT NULL,
  version       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_disposition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_disposition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_disposition_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id),
  CONSTRAINT document_disposition_status_ck CHECK (status IN ('eligible','pending_review','approved','rejected','disposed','cancelled','blocked_by_hold')),
  CONSTRAINT document_disposition_action_ck CHECK (action IN ('review','archive','destroy')),
  CONSTRAINT document_disposition_idem_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT document_disposition_optlock_ck CHECK (version >= 1)
);
ALTER TABLE document_disposition ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_disposition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_disposition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- document_scan_result — APPEND-ONLY scan evidence (INSERT + SELECT only, 0002). One row per scan attempt on a
-- version; records status + scanner code + a safe signature label only (never a malicious payload, ADR-046).
CREATE TABLE document_scan_result (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  document_id   uuid        NOT NULL,
  version_id    uuid        NOT NULL,
  status        text        NOT NULL,
  scanner_code  text        NOT NULL,
  signature     text,
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid       NOT NULL,
  CONSTRAINT document_scan_result_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_scan_result_id_key UNIQUE (tenant_id, id),
  CONSTRAINT document_scan_result_version_fkey FOREIGN KEY (tenant_id, version_id) REFERENCES document_version (tenant_id, id),
  CONSTRAINT document_scan_result_status_ck CHECK (status IN ('pending','clean','suspicious','infected','failed','bypassed'))
);
ALTER TABLE document_scan_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_scan_result FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_scan_result
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX document_scan_result_version_idx ON document_scan_result (tenant_id, version_id, scanned_at);
