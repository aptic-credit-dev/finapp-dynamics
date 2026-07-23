-- ---------------------------------------------------------------------------------------------------
-- M06-workflow — the enterprise workflow engine (Stage 2.2).
--
-- Tenant-scoped tables follow the proven convention: composite (tenant_id, id) primary keys, UNIQUE
-- (tenant_id, id) so composite foreign keys can reference them, RLS ENABLE + FORCE with the standard
-- `tenant_isolation` policy, and a `version` column for optimistic concurrency on mutable aggregates. No
-- table grants DELETE (records retire by status; ADR-010). History tables are append-only (INSERT + SELECT
-- only, granted in 0002). The outbox is mixed-scope (tenant rows + a system escape for the dispatcher),
-- mirroring m03 audit_events.
--
-- A workflow DEFINITION VERSION stores its whole validated graph as an immutable `spec` JSON (ADR-022):
-- nodes, transitions, variables, sla, assignment and escalation live inside `spec`, not shredded into
-- separate tables. Determinism and immutability come from freezing that document at publish.
-- ---------------------------------------------------------------------------------------------------

-- workflow_definition — a logical, named process. The current live version is tracked by status on the
-- version rows; this row carries identity + the immutable business code.
CREATE TABLE workflow_definition (
  tenant_id    uuid        NOT NULL,
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  code         text        NOT NULL,
  name         text        NOT NULL,
  description  text,
  status       text        NOT NULL DEFAULT 'active',
  version      integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  CONSTRAINT workflow_definition_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_definition_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_definition_code_key UNIQUE (tenant_id, code),
  CONSTRAINT workflow_definition_status_ck CHECK (status IN ('active', 'retired')),
  CONSTRAINT workflow_definition_version_ck CHECK (version >= 1)
);
ALTER TABLE workflow_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_definition
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- workflow_definition_version — an immutable-once-published revision. `spec` is the validated definition
-- document. Exactly one version per definition may be ACTIVE (enforced by a partial unique index).
CREATE TABLE workflow_definition_version (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  definition_id  uuid        NOT NULL,
  version_number integer     NOT NULL,
  status         text        NOT NULL DEFAULT 'DRAFT',
  spec           jsonb       NOT NULL,
  content_hash   text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  published_at   timestamptz,
  published_by   uuid,
  CONSTRAINT workflow_def_version_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_def_version_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_def_version_num_key UNIQUE (tenant_id, definition_id, version_number),
  CONSTRAINT workflow_def_version_definition_fkey
    FOREIGN KEY (tenant_id, definition_id) REFERENCES workflow_definition (tenant_id, id),
  CONSTRAINT workflow_def_version_status_ck
    CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
  CONSTRAINT workflow_def_version_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_definition_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definition_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_definition_version
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- At most one ACTIVE version per definition governs new starts (ADR-022).
CREATE UNIQUE INDEX workflow_def_version_one_active
  ON workflow_definition_version (tenant_id, definition_id) WHERE status = 'ACTIVE';

-- workflow_instance — a running process, pinned to the version it started under (ADR-022). `variables`
-- holds the live variable environment. `business_key` makes start idempotent per definition.
CREATE TABLE workflow_instance (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  definition_id uuid        NOT NULL,
  version_id    uuid        NOT NULL,
  business_key  text,
  subject_type  text,
  subject_id    text,
  status        text        NOT NULL DEFAULT 'CREATED',
  variables     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  started_by    uuid,
  version       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_instance_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_instance_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_instance_definition_fkey
    FOREIGN KEY (tenant_id, definition_id) REFERENCES workflow_definition (tenant_id, id),
  CONSTRAINT workflow_instance_version_fkey
    FOREIGN KEY (tenant_id, version_id) REFERENCES workflow_definition_version (tenant_id, id),
  CONSTRAINT workflow_instance_status_ck
    CHECK (status IN ('CREATED', 'RUNNING', 'WAITING', 'SUSPENDED', 'COMPLETED', 'CANCELLED', 'FAILED', 'COMPENSATING')),
  CONSTRAINT workflow_instance_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_instance
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX workflow_instance_business_key
  ON workflow_instance (tenant_id, definition_id, business_key) WHERE business_key IS NOT NULL;
CREATE INDEX workflow_instance_status_idx ON workflow_instance (tenant_id, status);

-- workflow_token — execution markers. Parallel splits mint one per branch; joins consume them.
CREATE TABLE workflow_token (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  instance_id uuid        NOT NULL,
  node_key    text        NOT NULL,
  status      text        NOT NULL DEFAULT 'active',
  branch_key  text,
  join_key    text,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_token_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_token_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_token_instance_fkey
    FOREIGN KEY (tenant_id, instance_id) REFERENCES workflow_instance (tenant_id, id),
  CONSTRAINT workflow_token_status_ck CHECK (status IN ('active', 'consumed')),
  CONSTRAINT workflow_token_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_token FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_token
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX workflow_token_active_idx ON workflow_token (tenant_id, instance_id) WHERE status = 'active';

-- workflow_task — a unit of human/system work. `maker_id` is the instance starter, so maker != checker can
-- be enforced at completion (ADR-026). Assignment lives on the row (assignee_kind/ref + lease) for the MVP.
CREATE TABLE workflow_task (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  instance_id     uuid        NOT NULL,
  node_key        text        NOT NULL,
  task_type       text        NOT NULL,
  status          text        NOT NULL DEFAULT 'CREATED',
  assignee_kind   text,
  assignee_ref    text,
  claimed_by      uuid,
  lease_expires_at timestamptz,
  maker_id        uuid,
  due_at          timestamptz,
  decision        jsonb,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_task_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_task_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_task_instance_fkey
    FOREIGN KEY (tenant_id, instance_id) REFERENCES workflow_instance (tenant_id, id),
  CONSTRAINT workflow_task_type_ck CHECK (task_type IN ('HUMAN_TASK', 'APPROVAL_TASK', 'SYSTEM_TASK')),
  CONSTRAINT workflow_task_status_ck
    CHECK (status IN ('CREATED', 'AVAILABLE', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED',
                      'DELEGATED', 'ESCALATED', 'CANCELLED', 'EXPIRED', 'FAILED')),
  CONSTRAINT workflow_task_assignee_kind_ck
    CHECK (assignee_kind IS NULL OR assignee_kind IN ('user', 'role', 'department', 'branch', 'entity', 'queue')),
  CONSTRAINT workflow_task_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_task
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX workflow_task_queue_idx ON workflow_task (tenant_id, status, due_at);
CREATE INDEX workflow_task_instance_idx ON workflow_task (tenant_id, instance_id);

-- workflow_timer — scheduled wake-ups. `dedupe_key` UNIQUE guarantees a timer fires at most once (ADR-025).
CREATE TABLE workflow_timer (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  instance_id uuid        NOT NULL,
  node_key    text,
  kind        text        NOT NULL,
  fire_at     timestamptz NOT NULL,
  status      text        NOT NULL DEFAULT 'scheduled',
  dedupe_key  text        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  fired_at    timestamptz,
  CONSTRAINT workflow_timer_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_timer_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_timer_dedupe_key UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT workflow_timer_instance_fkey
    FOREIGN KEY (tenant_id, instance_id) REFERENCES workflow_instance (tenant_id, id),
  CONSTRAINT workflow_timer_kind_ck CHECK (kind IN ('node', 'sla_warn', 'sla_breach', 'escalation')),
  CONSTRAINT workflow_timer_status_ck CHECK (status IN ('scheduled', 'fired', 'cancelled')),
  CONSTRAINT workflow_timer_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_timer ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_timer FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_timer
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX workflow_timer_due_idx ON workflow_timer (fire_at) WHERE status = 'scheduled';

-- workflow_sla_clock — persisted business-time accounting per SLA target (ADR-025).
CREATE TABLE workflow_sla_clock (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  instance_id        uuid        NOT NULL,
  task_id            uuid,
  sla_type           text        NOT NULL,
  status             text        NOT NULL DEFAULT 'running',
  started_at         timestamptz NOT NULL DEFAULT now(),
  accumulated_seconds bigint     NOT NULL DEFAULT 0,
  paused_at          timestamptz,
  warn_at            timestamptz,
  breach_at          timestamptz,
  warned             boolean     NOT NULL DEFAULT false,
  breached           boolean     NOT NULL DEFAULT false,
  calendar_ref       text,
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT workflow_sla_clock_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_sla_clock_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_sla_clock_instance_fkey
    FOREIGN KEY (tenant_id, instance_id) REFERENCES workflow_instance (tenant_id, id),
  CONSTRAINT workflow_sla_clock_type_ck CHECK (sla_type IN ('response', 'completion', 'resolution')),
  CONSTRAINT workflow_sla_clock_status_ck CHECK (status IN ('running', 'paused', 'stopped')),
  CONSTRAINT workflow_sla_clock_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_sla_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_sla_clock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_sla_clock
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- workflow_incident — a recoverable execution failure (system-task error, poison event).
CREATE TABLE workflow_incident (
  tenant_id    uuid        NOT NULL,
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  instance_id  uuid,
  task_id      uuid,
  error_code   text        NOT NULL,
  error_detail jsonb,
  status       text        NOT NULL DEFAULT 'open',
  retry_count  integer     NOT NULL DEFAULT 0,
  version      integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid,
  CONSTRAINT workflow_incident_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_incident_id_key UNIQUE (tenant_id, id),
  CONSTRAINT workflow_incident_instance_fkey
    FOREIGN KEY (tenant_id, instance_id) REFERENCES workflow_instance (tenant_id, id),
  CONSTRAINT workflow_incident_status_ck CHECK (status IN ('open', 'investigating', 'resolved', 'wont_fix')),
  CONSTRAINT workflow_incident_optlock_ck CHECK (version >= 1)
);
ALTER TABLE workflow_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_incident FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_incident
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX workflow_incident_open_idx ON workflow_incident (tenant_id, status) WHERE status IN ('open', 'investigating');

-- workflow_event_outbox — THE single transactional outbox (ADR-004/023). Mixed scope: tenant events carry
-- tenant_id; the platform dispatcher reads across tenants under the system escape (mirrors m03 audit_events).
-- The business path only INSERTs (in the same tx as the state change); the dispatcher UPDATEs status.
CREATE TABLE workflow_event_outbox (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  scope_key     text        NOT NULL,
  family        text        NOT NULL,
  type          text        NOT NULL,
  aggregate_id  text        NOT NULL,
  envelope      jsonb       NOT NULL,
  dedupe_key    text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  attempts      integer     NOT NULL DEFAULT 0,
  available_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  last_error    text,
  CONSTRAINT workflow_event_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT workflow_event_outbox_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT workflow_event_outbox_status_ck CHECK (status IN ('pending', 'dispatched', 'dead_letter')),
  CONSTRAINT workflow_event_outbox_scope_ck CHECK (scope_key <> ''),
  CONSTRAINT workflow_event_outbox_scope_coherence_ck CHECK (
    (tenant_id IS NULL AND scope_key = 'PLATFORM') OR
    (tenant_id IS NOT NULL AND scope_key = tenant_id::text)
  )
);
ALTER TABLE workflow_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_event_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_event_outbox
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR COALESCE(NULLIF(current_setting('app.system_context', true), ''), 'off') = 'on'
  );
CREATE INDEX workflow_event_outbox_pending_idx
  ON workflow_event_outbox (available_at) WHERE status = 'pending';

-- workflow_instance_history — append-only record of every instance state change (evidence).
CREATE TABLE workflow_instance_history (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  instance_id    uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id uuid        NOT NULL,
  changed_by     uuid,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_instance_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_instance_history_instance_fkey
    FOREIGN KEY (tenant_id, instance_id) REFERENCES workflow_instance (tenant_id, id),
  CONSTRAINT workflow_instance_history_from_ck CHECK (from_status IS NOT NULL OR action = 'start')
);
ALTER TABLE workflow_instance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instance_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_instance_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX workflow_instance_history_idx ON workflow_instance_history (tenant_id, instance_id, at);

-- workflow_task_history — append-only record of every task state change (evidence).
CREATE TABLE workflow_task_history (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  task_id        uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  action         text        NOT NULL,
  reason         text,
  correlation_id uuid        NOT NULL,
  changed_by     uuid,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_task_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_task_history_task_fkey
    FOREIGN KEY (tenant_id, task_id) REFERENCES workflow_task (tenant_id, id),
  CONSTRAINT workflow_task_history_from_ck CHECK (from_status IS NOT NULL OR action = 'create')
);
ALTER TABLE workflow_task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_task_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_task_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX workflow_task_history_idx ON workflow_task_history (tenant_id, task_id, at);
