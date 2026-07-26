-- ---------------------------------------------------------------------------------------------------
-- M08-notify — generic multi-tenant notifications + escalation (Stage 2.4).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No
-- table grants DELETE (records retire/cancel by status; ADR-010). Delivery attempts are append-only
-- evidence (INSERT + SELECT only, granted in 0002) so the delivery record cannot be rewritten (ADR-005/041).
--
-- A notification_template_version stores its whole validated template as an immutable `spec` JSON (subject +
-- body templates, typed variable schema, channel, locale), frozen at publish with a content_hash (ADR-039,
-- mirrors m07 ADR-032). An escalation_policy stores its ladder the same immutable way. Requests carry the
-- variable values they must render later (operational data under RLS + classification), but the audit spine
-- and the notification.lifecycle events carry IDENTIFIERS/STATUS/REASON-CODES ONLY — never destinations,
-- rendered bodies, provider secrets, or variable values (ADR-041). m08 publishes those events through the ONE
-- outbox m06 owns; it never creates a second outbox.
-- ---------------------------------------------------------------------------------------------------

-- Seed m08's permissions into the global permission catalogue (owned by m02, a global reference table).
-- role_permissions.permission_code FKs to permissions.code, so a permission must exist here before any role
-- can be granted it (CLAUDE.md ships permissions with the module). Publish/activate/retire, escalation and
-- suppression management, and the platform authority are privileged; there is deliberately no vague
-- `notifications.admin` (ADR-042).
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('notifications.template.view', 'm08-notify', 'notification_template', false),
  ('notifications.template.author', 'm08-notify', 'notification_template', false),
  ('notifications.template.validate', 'm08-notify', 'notification_template', false),
  ('notifications.template.publish', 'm08-notify', 'notification_template_version', true),
  ('notifications.template.activate', 'm08-notify', 'notification_template_version', true),
  ('notifications.template.retire', 'm08-notify', 'notification_template_version', true),
  ('notifications.request.view', 'm08-notify', 'notification_request', false),
  ('notifications.request.create', 'm08-notify', 'notification_request', false),
  ('notifications.request.cancel', 'm08-notify', 'notification_request', false),
  ('notifications.request.retry', 'm08-notify', 'notification_request', true),
  ('notifications.delivery.view', 'm08-notify', 'notification_delivery', false),
  ('notifications.escalation.view', 'm08-notify', 'escalation', false),
  ('notifications.escalation.manage', 'm08-notify', 'escalation', true),
  ('notifications.escalation.acknowledge', 'm08-notify', 'escalation', false),
  ('notifications.escalation.resolve', 'm08-notify', 'escalation', false),
  ('notifications.preference.view', 'm08-notify', 'notification_preference', false),
  ('notifications.preference.update', 'm08-notify', 'notification_preference', false),
  ('notifications.inbox.view', 'm08-notify', 'inbox_notification', false),
  ('notifications.inbox.manage', 'm08-notify', 'inbox_notification', false),
  ('notifications.suppression.manage', 'm08-notify', 'notification_preference', true),
  ('notifications.platform.administer', 'm08-notify', 'notification_engine', true);

-- notification_template — a logical, named notification template. The live revision is tracked by status on
-- the version rows; this row carries identity + the immutable business key. `scope` reserves the
-- platform-vs-tenant distinction (ADR-042); MVP templates are tenant-scoped and RLS applies uniformly.
CREATE TABLE notification_template (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  key         text        NOT NULL,
  name        text        NOT NULL,
  description text,
  channel     text        NOT NULL,
  scope       text        NOT NULL DEFAULT 'tenant',
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT notification_template_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT notification_template_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notification_template_key_key UNIQUE (tenant_id, key),
  CONSTRAINT notification_template_channel_ck CHECK (channel IN ('email', 'sms', 'in_app', 'webhook')),
  CONSTRAINT notification_template_scope_ck CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT notification_template_status_ck CHECK (status IN ('active', 'retired')),
  CONSTRAINT notification_template_version_ck CHECK (version >= 1)
);
ALTER TABLE notification_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_template FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_template
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- notification_template_version — an immutable-once-published revision. `spec` is the validated template
-- document (channel, subject/body templates, typed variable schema, locale). `content_hash` is frozen at
-- publish. Exactly one version per template may be ACTIVE (partial unique index) so a request binds to a
-- deterministic revision (ADR-039).
CREATE TABLE notification_template_version (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  template_id    uuid        NOT NULL,
  version_number integer     NOT NULL,
  status         text        NOT NULL DEFAULT 'DRAFT',
  spec           jsonb       NOT NULL,
  content_hash   text,
  notes          text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  published_at   timestamptz,
  published_by   uuid,
  CONSTRAINT notification_template_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT notification_template_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notification_template_version_num_key UNIQUE (tenant_id, template_id, version_number),
  CONSTRAINT notification_template_version_template_fkey
    FOREIGN KEY (tenant_id, template_id) REFERENCES notification_template (tenant_id, id),
  CONSTRAINT notification_template_version_status_ck
    CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
  CONSTRAINT notification_template_version_hash_ck
    CHECK (status IN ('DRAFT', 'VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT notification_template_version_optlock_ck CHECK (version >= 1)
);
ALTER TABLE notification_template_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_template_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_template_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX notification_template_version_one_active
  ON notification_template_version (tenant_id, template_id) WHERE status = 'ACTIVE';

-- notification_request — the core mutable aggregate. Bound to an ACTIVE template version, it carries the
-- normalized destination, the (tenant, classified) variable VALUES it will render at dispatch, a variables
-- hash for idempotency-conflict detection, the retry policy used (for replay/evidence), lifecycle status, an
-- attempt counter, a next-attempt time, and a worker LEASE (locked_by/locked_until) for safe concurrent
-- claiming. `idempotency_key` makes request creation safe to retry (partial unique index).
CREATE TABLE notification_request (
  tenant_id           uuid        NOT NULL,
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  template_version_id uuid        NOT NULL,
  channel             text        NOT NULL,
  destination         text        NOT NULL,
  recipient_ref       text,
  category            text        NOT NULL DEFAULT 'operational',
  priority            text        NOT NULL DEFAULT 'normal',
  variables           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  variables_hash      text        NOT NULL,
  retry_policy        jsonb       NOT NULL,
  status              text        NOT NULL DEFAULT 'requested',
  attempt_count       integer     NOT NULL DEFAULT 0,
  max_attempts        integer     NOT NULL,
  next_attempt_at     timestamptz,
  scheduled_at        timestamptz,
  expires_at          timestamptz,
  last_error_category text,
  suppressed_reason   text,
  locked_by           uuid,
  locked_until        timestamptz,
  idempotency_key     text,
  correlation_id      uuid        NOT NULL,
  causation_id        uuid,
  origin_module       text,
  origin_entity_type  text,
  origin_entity_id    uuid,
  version             integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  CONSTRAINT notification_request_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT notification_request_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notification_request_version_fkey
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES notification_template_version (tenant_id, id),
  CONSTRAINT notification_request_channel_ck CHECK (channel IN ('email', 'sms', 'in_app', 'webhook')),
  CONSTRAINT notification_request_category_ck
    CHECK (category IN ('optional', 'operational', 'security', 'legal')),
  CONSTRAINT notification_request_priority_ck CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT notification_request_status_ck
    CHECK (status IN ('requested', 'queued', 'processing', 'delivered', 'failed', 'retry_scheduled',
                      'exhausted', 'cancelled', 'expired', 'suppressed')),
  CONSTRAINT notification_request_attempts_ck CHECK (attempt_count >= 0 AND max_attempts >= 1),
  CONSTRAINT notification_request_optlock_ck CHECK (version >= 1)
);
ALTER TABLE notification_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_request
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Idempotent request creation: one committed request per (tenant, key).
CREATE UNIQUE INDEX notification_request_idem_key
  ON notification_request (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- The dispatch queue: rows eligible to process, ordered by when they are due.
CREATE INDEX notification_request_queue_idx
  ON notification_request (tenant_id, status, next_attempt_at);

-- notification_delivery — append-only per-attempt evidence (ADR-041). One row per dispatch attempt: the
-- provider/adapter code, outcome, a normalized (safe) response code + error category, retryability, timing,
-- and an opaque provider message reference. NEVER stores provider secrets, the destination, or the rendered
-- body. Append-only: the app role gets INSERT + SELECT only (0002).
CREATE TABLE notification_delivery (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  request_id      uuid        NOT NULL,
  attempt_number  integer     NOT NULL,
  provider_code   text        NOT NULL,
  outcome         text        NOT NULL,
  response_code   text,
  error_category  text,
  retryable       boolean     NOT NULL DEFAULT false,
  provider_ref    text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  next_retry_at   timestamptz,
  correlation_id  uuid        NOT NULL,
  CONSTRAINT notification_delivery_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT notification_delivery_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notification_delivery_attempt_key UNIQUE (tenant_id, request_id, attempt_number),
  CONSTRAINT notification_delivery_request_fkey
    FOREIGN KEY (tenant_id, request_id) REFERENCES notification_request (tenant_id, id),
  CONSTRAINT notification_delivery_outcome_ck CHECK (outcome IN ('succeeded', 'failed')),
  CONSTRAINT notification_delivery_attempt_ck CHECK (attempt_number >= 1),
  CONSTRAINT notification_delivery_category_ck
    CHECK (error_category IS NULL OR error_category IN
      ('transient', 'throttled', 'provider_error', 'invalid_recipient', 'rejected', 'permanent'))
);
ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_delivery
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX notification_delivery_request_idx
  ON notification_delivery (tenant_id, request_id, attempt_number);

-- escalation_policy — a versioned, immutable-once-published escalation ladder. `spec` holds the levels
-- (delay, channel, recipients, optional template) as one document; frozen at publish (content_hash). Exactly
-- one version per key may be ACTIVE (partial unique index). Collapses definition + version into one table
-- (ADR-043).
CREATE TABLE escalation_policy (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  key            text        NOT NULL,
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
  CONSTRAINT escalation_policy_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT escalation_policy_id_key UNIQUE (tenant_id, id),
  CONSTRAINT escalation_policy_key_ver_key UNIQUE (tenant_id, key, version_number),
  CONSTRAINT escalation_policy_scope_ck CHECK (scope IN ('tenant', 'platform')),
  CONSTRAINT escalation_policy_status_ck
    CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
  CONSTRAINT escalation_policy_hash_ck
    CHECK (status IN ('DRAFT', 'VALIDATED') OR content_hash IS NOT NULL),
  CONSTRAINT escalation_policy_optlock_ck CHECK (version >= 1)
);
ALTER TABLE escalation_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation_policy
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX escalation_policy_one_active
  ON escalation_policy (tenant_id, key) WHERE status = 'ACTIVE';

-- escalation_instance — a running escalation against an ACTIVE policy. Carries the origin, the current level,
-- the next-escalation time, acknowledgement + resolution state, a worker LEASE for safe concurrent
-- advancement, and an idempotency key so the same originating event does not open two escalations.
CREATE TABLE escalation_instance (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  policy_id          uuid        NOT NULL,
  origin_module      text,
  origin_entity_type text,
  origin_entity_id   uuid,
  current_level      integer     NOT NULL DEFAULT 0,
  status             text        NOT NULL DEFAULT 'pending',
  next_escalation_at timestamptz,
  acknowledged_by    uuid,
  acknowledged_at    timestamptz,
  resolved_by        uuid,
  resolved_at        timestamptz,
  resolution         text,
  locked_by          uuid,
  locked_until       timestamptz,
  idempotency_key    text,
  correlation_id     uuid        NOT NULL,
  causation_id       uuid,
  version            integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  CONSTRAINT escalation_instance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT escalation_instance_id_key UNIQUE (tenant_id, id),
  CONSTRAINT escalation_instance_policy_fkey
    FOREIGN KEY (tenant_id, policy_id) REFERENCES escalation_policy (tenant_id, id),
  CONSTRAINT escalation_instance_status_ck
    CHECK (status IN ('pending', 'active', 'acknowledged', 'resolved', 'cancelled', 'exhausted', 'expired')),
  CONSTRAINT escalation_instance_level_ck CHECK (current_level >= 0),
  CONSTRAINT escalation_instance_optlock_ck CHECK (version >= 1)
);
ALTER TABLE escalation_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation_instance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX escalation_instance_idem_key
  ON escalation_instance (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX escalation_instance_queue_idx
  ON escalation_instance (tenant_id, status, next_escalation_at);

-- notification_preference — user channel preferences AND destination-level suppression in one table. A user
-- row (subject_id set) carries opt-in/quiet-hours/suppressed; a suppression row (destination set) hard-stops a
-- bounced/complained destination. Mandatory categories (security/legal) bypass both in the domain layer.
CREATE TABLE notification_preference (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  subject_id  uuid,
  destination text,
  channel     text        NOT NULL,
  opt_in      boolean     NOT NULL DEFAULT true,
  suppressed  boolean     NOT NULL DEFAULT false,
  quiet_hours jsonb,
  reason      text,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT notification_preference_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT notification_preference_id_key UNIQUE (tenant_id, id),
  CONSTRAINT notification_preference_channel_ck CHECK (channel IN ('email', 'sms', 'in_app', 'webhook')),
  CONSTRAINT notification_preference_target_ck CHECK (subject_id IS NOT NULL OR destination IS NOT NULL),
  CONSTRAINT notification_preference_optlock_ck CHECK (version >= 1)
);
ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preference
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX notification_preference_subject_key
  ON notification_preference (tenant_id, subject_id, channel) WHERE subject_id IS NOT NULL;
CREATE UNIQUE INDEX notification_preference_destination_key
  ON notification_preference (tenant_id, destination, channel) WHERE destination IS NOT NULL;

-- inbox_notification — the in-app inbox. Tenant + recipient isolated; unread/read/archived lifecycle; carries
-- only SAFE rendered title/body and deep-link metadata. Never exposed outside its tenant or its recipient.
CREATE TABLE inbox_notification (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  recipient_id       uuid        NOT NULL,
  request_id         uuid,
  severity           text        NOT NULL DEFAULT 'info',
  title              text        NOT NULL,
  body               text        NOT NULL,
  status             text        NOT NULL DEFAULT 'unread',
  deep_link          jsonb,
  origin_module      text,
  origin_entity_type text,
  origin_entity_id   uuid,
  delivered_at       timestamptz NOT NULL DEFAULT now(),
  read_at            timestamptz,
  expires_at         timestamptz,
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT inbox_notification_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT inbox_notification_id_key UNIQUE (tenant_id, id),
  CONSTRAINT inbox_notification_severity_ck CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT inbox_notification_status_ck CHECK (status IN ('unread', 'read', 'archived')),
  CONSTRAINT inbox_notification_optlock_ck CHECK (version >= 1)
);
ALTER TABLE inbox_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_notification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inbox_notification
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX inbox_notification_recipient_idx
  ON inbox_notification (tenant_id, recipient_id, status, delivered_at);
