-- ---------------------------------------------------------------------------------------------------
-- M36-events — WEBHOOKS & EVENT STREAMING (Stage 6D-4, mvp:false): the governed OUTBOUND fan-out layer over the platform's
-- domain events — external webhook ENDPOINTS, event SUBSCRIPTIONS/filters, webhook DELIVERY evidence, tenant event STREAMS
-- with consumer CURSORS. THE LOAD-BEARING BOUNDARY: m06 owns THE ONE outbox/event-delivery path (ADR-004) — m36 owns NO
-- outbox here; it CONSUMES domain events (through a fail-closed port fed by the m06 dispatcher) and RECORDS delivery. HARD
-- RULES ARE DB-ENFORCED. THE SECRET RULE: an endpoint's signing secret is an opaque secretref: pointer (m30 seam,
-- signing_secret_ref shape CHECK); there is NO password/key/token/secret VALUE column anywhere; real key mgmt = m41. THE
-- APPROVAL RULE: activating an external endpoint is maker-checker (webhook_review decided_by <> requested_by, SoD; a passing
-- validation; AI never approves — in-service). An approved endpoint's url/key is IMMUTABLE (webhook_endpoint_immutable
-- trigger). Delivery is idempotent (one 'delivered' per endpoint per event). It uses the webhook_*/eventstream_*/events_*
-- prefixes (integration_* is m23's, connector_* is m33's, marketplace_* is m34's, devportal_* is m35's) and owns
-- webhook.lifecycle + eventstream.lifecycle ONLY, emitting through the ONE m06 outbox. Every tenant-scoped table: composite
-- (tenant_id, id) PK + UNIQUE, RLS ENABLE+FORCE + tenant_isolation, composite FKs (within m36), version on mutable
-- aggregates. No DELETE grant (ADR-010). Delivery/review/stream-subscription/history + the idempotency ledger are append-only
-- (INSERT+SELECT, 0002). No float (a cursor position is bigint). PostgreSQL 16.
-- ---------------------------------------------------------------------------------------------------

-- GAP-4 resolution: the events.* permission namespace covering /api/v1/webhooks + /api/v1/events. Three-segment
-- events.<area>.<action>; every controlled endpoint/subscription/delivery/stream operation authorizes one (default deny).
-- events.control.administer is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default; endpoint
-- approval + delivery replay are privileged (controlled actions). NO events.admin / wildcard bypass.
INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('events.webhook.read', 'm36-events', 'webhook_endpoint', false),
  ('events.webhook.manage', 'm36-events', 'webhook_endpoint', false),
  ('events.webhook.approve', 'm36-events', 'webhook_endpoint', true),
  ('events.subscription.manage', 'm36-events', 'webhook_subscription', false),
  ('events.stream.read', 'm36-events', 'eventstream_config', false),
  ('events.stream.manage', 'm36-events', 'eventstream_config', false),
  ('events.delivery.replay', 'm36-events', 'webhook_delivery', true),
  ('events.control.administer', 'm36-events', 'events', true);

-- webhook_endpoint — a registered EXTERNAL subscriber. url is an https PUBLIC target (validated in-service; SSRF allow-list).
-- signing_secret_ref is an OPAQUE secretref: pointer (never a value). Lifecycle draft -> review_pending -> active
-- (maker-checker) -> suspended; an approved endpoint's url/key is IMMUTABLE. Egress is framework-only / fail-closed.
CREATE TABLE webhook_endpoint (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', endpoint_key text NOT NULL, url text NOT NULL, description text,
  signing_secret_ref text, state text NOT NULL DEFAULT 'draft', validation_passed boolean NOT NULL DEFAULT false,
  idempotency_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT webhook_endpoint_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT webhook_endpoint_id_key UNIQUE (tenant_id, id),
  CONSTRAINT webhook_endpoint_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT webhook_endpoint_state_ck CHECK (state IN ('draft','review_pending','active','suspended','rejected')),
  CONSTRAINT webhook_endpoint_evidence_ck CHECK (state NOT IN ('review_pending','active') OR validation_passed = true),
  CONSTRAINT webhook_endpoint_secret_ref_ck CHECK (signing_secret_ref IS NULL OR signing_secret_ref ~ '^secretref:[A-Za-z0-9_.:/-]{3,200}$'),
  CONSTRAINT webhook_endpoint_optlock_ck CHECK (version >= 1));
ALTER TABLE webhook_endpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoint FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_endpoint
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX webhook_endpoint_one_key ON webhook_endpoint (tenant_id, scope, endpoint_key) WHERE state <> 'rejected';
CREATE UNIQUE INDEX webhook_endpoint_idem ON webhook_endpoint (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE webhook_endpoint IS 'class=tenant_aggregate; m36 registered external webhook subscriber (approved url/key immutable)';

-- IMMUTABILITY: a rejected endpoint is terminal; endpoint_key never changes; once past draft the approved url is frozen (an
-- approved egress target can never be silently repointed — register a new endpoint instead).
CREATE OR REPLACE FUNCTION webhook_endpoint_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('rejected') THEN
    RAISE EXCEPTION 'webhook_endpoint % is immutable in state %', OLD.id, OLD.state USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.endpoint_key <> OLD.endpoint_key THEN
    RAISE EXCEPTION 'a webhook endpoint key is immutable' USING ERRCODE = 'raise_exception';
  END IF;
  IF OLD.state <> 'draft' AND NEW.url <> OLD.url THEN
    RAISE EXCEPTION 'an approved endpoint url is immutable (register a new endpoint)' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER webhook_endpoint_immutable_trg BEFORE UPDATE ON webhook_endpoint
  FOR EACH ROW EXECUTE FUNCTION webhook_endpoint_immutable();

-- webhook_subscription — which REGISTERED event family/type an endpoint subscribes to (event_type '*' = all types in family).
CREATE TABLE webhook_subscription (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), endpoint_id uuid NOT NULL,
  event_family text NOT NULL, event_type text NOT NULL DEFAULT '*', status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT webhook_subscription_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT webhook_subscription_id_key UNIQUE (tenant_id, id),
  CONSTRAINT webhook_subscription_status_ck CHECK (status IN ('active','paused')),
  CONSTRAINT webhook_subscription_optlock_ck CHECK (version >= 1),
  CONSTRAINT webhook_subscription_endpoint_fkey FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoint (tenant_id, id));
ALTER TABLE webhook_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_subscription
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX webhook_subscription_uniq ON webhook_subscription (tenant_id, endpoint_id, event_family, event_type);
COMMENT ON TABLE webhook_subscription IS 'class=tenant_aggregate; m36 endpoint subscription to a registered event family/type';

-- webhook_delivery — APPEND-ONLY evidence of a delivery ATTEMPT to an endpoint. status delivered/failed/blocked/dead_letter.
-- Idempotent: at most one 'delivered' per endpoint per event (dedupe_key). Carries NO event body or secret.
CREATE TABLE webhook_delivery (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), endpoint_id uuid NOT NULL,
  event_id uuid NOT NULL, event_family text NOT NULL, event_type text NOT NULL, dedupe_key text NOT NULL,
  status text NOT NULL, attempt_no integer NOT NULL DEFAULT 1, reason_code text, status_hint integer,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT webhook_delivery_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT webhook_delivery_id_key UNIQUE (tenant_id, id),
  CONSTRAINT webhook_delivery_status_ck CHECK (status IN ('delivered','failed','blocked','dead_letter')),
  CONSTRAINT webhook_delivery_attempt_ck CHECK (attempt_no >= 1),
  CONSTRAINT webhook_delivery_endpoint_fkey FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoint (tenant_id, id));
ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_delivery
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX webhook_delivery_one_delivered ON webhook_delivery (tenant_id, endpoint_id, dedupe_key) WHERE status = 'delivered';
CREATE INDEX webhook_delivery_by_endpoint ON webhook_delivery (tenant_id, endpoint_id);
COMMENT ON TABLE webhook_delivery IS 'class=tenant_ledger_append_only; m36 webhook delivery attempt evidence (idempotent; no body/secret)';

-- webhook_review — APPEND-ONLY maker-checker ledger for endpoint activation. A decision needs a decider and the decider can
-- never be the requester (SoD). AI never approves (isHumanActor in-service).
CREATE TABLE webhook_review (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, kind text NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text, reason_code text,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_review_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT webhook_review_id_key UNIQUE (tenant_id, id),
  CONSTRAINT webhook_review_target_ck CHECK (target_type IN ('endpoint')),
  CONSTRAINT webhook_review_kind_ck CHECK (kind IN ('requested','approved','rejected')),
  CONSTRAINT webhook_review_decider_ck CHECK (kind = 'requested' OR decided_by IS NOT NULL),
  CONSTRAINT webhook_review_sod_ck CHECK (decided_by IS NULL OR decided_by <> requested_by));
ALTER TABLE webhook_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_review
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX webhook_review_by_target ON webhook_review (tenant_id, target_type, target_id);
COMMENT ON TABLE webhook_review IS 'class=tenant_ledger_append_only; m36 maker-checker endpoint activation decisions';

-- eventstream_config — a tenant EVENT STREAM (a named, filtered projection of the platform's domain events for a consumer).
CREATE TABLE eventstream_config (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant', stream_key text NOT NULL, description text, status text NOT NULL DEFAULT 'active',
  idempotency_key text, version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT eventstream_config_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT eventstream_config_id_key UNIQUE (tenant_id, id),
  CONSTRAINT eventstream_config_scope_ck CHECK (scope IN ('platform','tenant')),
  CONSTRAINT eventstream_config_status_ck CHECK (status IN ('active','paused')),
  CONSTRAINT eventstream_config_optlock_ck CHECK (version >= 1));
ALTER TABLE eventstream_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventstream_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eventstream_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX eventstream_config_one_key ON eventstream_config (tenant_id, scope, stream_key);
CREATE UNIQUE INDEX eventstream_config_idem ON eventstream_config (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE eventstream_config IS 'class=tenant_aggregate; m36 tenant event stream config';

-- eventstream_cursor — a consumer's POSITION in a stream (bigint; monotonic in-service). No float.
CREATE TABLE eventstream_cursor (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), stream_id uuid NOT NULL,
  consumer_key text NOT NULL, position bigint NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT eventstream_cursor_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT eventstream_cursor_id_key UNIQUE (tenant_id, id),
  CONSTRAINT eventstream_cursor_status_ck CHECK (status IN ('active','paused')),
  CONSTRAINT eventstream_cursor_pos_ck CHECK (position >= 0),
  CONSTRAINT eventstream_cursor_optlock_ck CHECK (version >= 1),
  CONSTRAINT eventstream_cursor_stream_fkey FOREIGN KEY (tenant_id, stream_id) REFERENCES eventstream_config (tenant_id, id));
ALTER TABLE eventstream_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventstream_cursor FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eventstream_cursor
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX eventstream_cursor_uniq ON eventstream_cursor (tenant_id, stream_id, consumer_key);
COMMENT ON TABLE eventstream_cursor IS 'class=tenant_aggregate; m36 event stream consumer cursor (bigint position)';

-- eventstream_subscription — APPEND-ONLY: which REGISTERED event family a stream carries.
CREATE TABLE eventstream_subscription (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), stream_id uuid NOT NULL,
  event_family text NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT eventstream_subscription_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT eventstream_subscription_id_key UNIQUE (tenant_id, id),
  CONSTRAINT eventstream_subscription_stream_fkey FOREIGN KEY (tenant_id, stream_id) REFERENCES eventstream_config (tenant_id, id));
ALTER TABLE eventstream_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventstream_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eventstream_subscription
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE UNIQUE INDEX eventstream_subscription_uniq ON eventstream_subscription (tenant_id, stream_id, event_family);
COMMENT ON TABLE eventstream_subscription IS 'class=tenant_ledger_append_only; m36 event family a stream carries';

-- events_history — APPEND-ONLY status/transition evidence (endpoint|subscription|stream|cursor|delivery).
CREATE TABLE events_history (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL, target_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  reason text, reason_code text, by_user uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_history_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT events_history_id_key UNIQUE (tenant_id, id),
  CONSTRAINT events_history_target_ck CHECK (target_type IN ('endpoint','subscription','stream','cursor','delivery')));
ALTER TABLE events_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE events_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events_history
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX events_history_by_target ON events_history (tenant_id, target_type, target_id);
COMMENT ON TABLE events_history IS 'class=tenant_ledger_append_only; m36 endpoint/subscription/stream/cursor/delivery history';

-- events_idempotency — APPEND-ONLY idempotency ledger (no duplicate register/approve/subscribe/deliver).
CREATE TABLE events_idempotency (
  tenant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL, target_type text, target_id uuid,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CONSTRAINT events_idempotency_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT events_idempotency_id_key UNIQUE (tenant_id, id),
  CONSTRAINT events_idempotency_key_uk UNIQUE (tenant_id, idempotency_key));
ALTER TABLE events_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE events_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
COMMENT ON TABLE events_idempotency IS 'class=tenant_ledger_append_only; m36 idempotency ledger (no duplicate events mutation)';
