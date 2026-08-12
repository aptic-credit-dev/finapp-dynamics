/**
 * M36 repository — ALL SQL for webhooks & event streaming across its 9 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO tenant_id
 * predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Delivery/review/stream-subscription/
 * history + the idempotency ledger are append-only. There is NO secret VALUE column — webhook_endpoint holds an opaque
 * `secretref:` pointer only. A cursor position is bigint (no float).
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m36 repository: expected a row from ${what}`);
  return row;
}

export interface EndpointRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly endpoint_key: string;
  readonly url: string;
  readonly signing_secret_ref: string | null;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly version: number;
  readonly correlation_id: string;
}
export interface SubscriptionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly endpoint_id: string;
  readonly event_family: string;
  readonly event_type: string;
  readonly status: string;
  readonly version: number;
}
export interface DeliveryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly endpoint_id: string;
  readonly event_id: string;
  readonly event_family: string;
  readonly event_type: string;
  readonly dedupe_key: string;
  readonly status: string;
  readonly attempt_no: number;
  readonly reason_code: string | null;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
}
export interface StreamRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly stream_key: string;
  readonly status: string;
  readonly version: number;
}
export interface CursorRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly stream_id: string;
  readonly consumer_key: string;
  readonly position: string;
  readonly status: string;
  readonly version: number;
}

export class EventsRepository {
  // ---- endpoint ----
  async insertEndpoint(
    tx: Tx,
    e: {
      tenantId: string;
      scope: string;
      endpointKey: string;
      url: string;
      description: string | null;
      signingSecretRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EndpointRow> {
    const { rows } = await tx.query<EndpointRow>(
      `INSERT INTO webhook_endpoint (tenant_id, scope, endpoint_key, url, description, signing_secret_ref, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING tenant_id, id, scope, endpoint_key, url, signing_secret_ref, state, validation_passed, version, correlation_id`,
      [
        e.tenantId,
        e.scope,
        e.endpointKey,
        e.url,
        e.description,
        e.signingSecretRef,
        e.idempotencyKey,
        e.correlationId,
        e.by,
      ],
    );
    return firstRow(rows, 'insertEndpoint');
  }
  async findEndpointByIdempotencyKey(tx: Tx, key: string): Promise<EndpointRow | null> {
    const { rows } = await tx.query<EndpointRow>(
      `SELECT tenant_id, id, scope, endpoint_key, url, signing_secret_ref, state, validation_passed, version, correlation_id FROM webhook_endpoint WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getEndpoint(tx: Tx, id: string): Promise<EndpointRow | null> {
    const { rows } = await tx.query<EndpointRow>(
      `SELECT tenant_id, id, scope, endpoint_key, url, signing_secret_ref, state, validation_passed, version, correlation_id FROM webhook_endpoint WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateEndpointState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<EndpointRow | null> {
    const { rows } = await tx.query<EndpointRow>(
      `UPDATE webhook_endpoint SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, endpoint_key, url, signing_secret_ref, state, validation_passed, version, correlation_id`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listEndpoints(tx: Tx, limit: number, offset: number): Promise<EndpointRow[]> {
    const { rows } = await tx.query<EndpointRow>(
      `SELECT tenant_id, id, scope, endpoint_key, url, signing_secret_ref, state, validation_passed, version, correlation_id FROM webhook_endpoint ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- subscription ----
  async insertSubscription(
    tx: Tx,
    s: {
      tenantId: string;
      endpointId: string;
      eventFamily: string;
      eventType: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SubscriptionRow> {
    const { rows } = await tx.query<SubscriptionRow>(
      `INSERT INTO webhook_subscription (tenant_id, endpoint_id, event_family, event_type, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING tenant_id, id, endpoint_id, event_family, event_type, status, version`,
      [s.tenantId, s.endpointId, s.eventFamily, s.eventType, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertSubscription');
  }
  async listActiveSubscriptionsForEvent(tx: Tx, family: string, type: string): Promise<SubscriptionRow[]> {
    const { rows } = await tx.query<SubscriptionRow>(
      `SELECT s.tenant_id, s.id, s.endpoint_id, s.event_family, s.event_type, s.status, s.version
         FROM webhook_subscription s JOIN webhook_endpoint e ON e.tenant_id=s.tenant_id AND e.id=s.endpoint_id
        WHERE s.status='active' AND e.state='active' AND s.event_family=$1 AND (s.event_type='*' OR s.event_type=$2)`,
      [family, type],
    );
    return rows;
  }

  // ---- delivery (append-only) ----
  async insertDelivery(
    tx: Tx,
    d: {
      tenantId: string;
      endpointId: string;
      eventId: string;
      eventFamily: string;
      eventType: string;
      dedupeKey: string;
      status: string;
      attemptNo: number;
      reasonCode: string | null;
      statusHint: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DeliveryRow> {
    const { rows } = await tx.query<DeliveryRow>(
      `INSERT INTO webhook_delivery (tenant_id, endpoint_id, event_id, event_family, event_type, dedupe_key, status, attempt_no, reason_code, status_hint, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING tenant_id, id, endpoint_id, event_id, event_family, event_type, dedupe_key, status, attempt_no, reason_code`,
      [
        d.tenantId,
        d.endpointId,
        d.eventId,
        d.eventFamily,
        d.eventType,
        d.dedupeKey,
        d.status,
        d.attemptNo,
        d.reasonCode,
        d.statusHint,
        d.correlationId,
        d.by,
      ],
    );
    return firstRow(rows, 'insertDelivery');
  }
  async getDelivery(tx: Tx, id: string): Promise<DeliveryRow | null> {
    const { rows } = await tx.query<DeliveryRow>(
      `SELECT tenant_id, id, endpoint_id, event_id, event_family, event_type, dedupe_key, status, attempt_no, reason_code FROM webhook_delivery WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async countDeliveryAttempts(tx: Tx, endpointId: string, dedupeKey: string): Promise<number> {
    const { rows } = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM webhook_delivery WHERE endpoint_id=$1 AND dedupe_key=$2`,
      [endpointId, dedupeKey],
    );
    return Number(rows[0]?.c ?? '0');
  }
  async hasDelivered(tx: Tx, endpointId: string, dedupeKey: string): Promise<boolean> {
    const { rows } = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM webhook_delivery WHERE endpoint_id=$1 AND dedupe_key=$2 AND status='delivered'`,
      [endpointId, dedupeKey],
    );
    return Number(rows[0]?.c ?? '0') > 0;
  }

  // ---- review (append-only maker-checker) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetType: string;
      targetId: string;
      kind: string;
      requestedBy: string;
      decidedBy: string | null;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const { rows } = await tx.query<ReviewRow>(
      `INSERT INTO webhook_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, target_type, target_id, kind, requested_by, decided_by`,
      [
        r.tenantId,
        r.targetType,
        r.targetId,
        r.kind,
        r.requestedBy,
        r.decidedBy,
        r.reason,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async findOpenReviewRequest(tx: Tx, targetType: string, targetId: string): Promise<ReviewRow | null> {
    const { rows } = await tx.query<ReviewRow>(
      `SELECT tenant_id, id, target_type, target_id, kind, requested_by, decided_by FROM webhook_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }

  // ---- stream + cursor + stream subscription ----
  async insertStream(
    tx: Tx,
    s: {
      tenantId: string;
      scope: string;
      streamKey: string;
      description: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<StreamRow> {
    const { rows } = await tx.query<StreamRow>(
      `INSERT INTO eventstream_config (tenant_id, scope, stream_key, description, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, scope, stream_key, status, version`,
      [s.tenantId, s.scope, s.streamKey, s.description, s.idempotencyKey, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertStream');
  }
  async findStreamByIdempotencyKey(tx: Tx, key: string): Promise<StreamRow | null> {
    const { rows } = await tx.query<StreamRow>(
      `SELECT tenant_id, id, scope, stream_key, status, version FROM eventstream_config WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getStream(tx: Tx, id: string): Promise<StreamRow | null> {
    const { rows } = await tx.query<StreamRow>(
      `SELECT tenant_id, id, scope, stream_key, status, version FROM eventstream_config WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateStreamStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<StreamRow | null> {
    const { rows } = await tx.query<StreamRow>(
      `UPDATE eventstream_config SET status=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, stream_key, status, version`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }
  async listStreams(tx: Tx, limit: number, offset: number): Promise<StreamRow[]> {
    const { rows } = await tx.query<StreamRow>(
      `SELECT tenant_id, id, scope, stream_key, status, version FROM eventstream_config ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
  async insertStreamSubscription(
    tx: Tx,
    s: { tenantId: string; streamId: string; eventFamily: string; correlationId: string; by: string | null },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO eventstream_subscription (tenant_id, stream_id, event_family, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [s.tenantId, s.streamId, s.eventFamily, s.correlationId, s.by],
    );
  }
  async insertCursor(
    tx: Tx,
    c: { tenantId: string; streamId: string; consumerKey: string; correlationId: string; by: string | null },
  ): Promise<CursorRow> {
    const { rows } = await tx.query<CursorRow>(
      `INSERT INTO eventstream_cursor (tenant_id, stream_id, consumer_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5) RETURNING tenant_id, id, stream_id, consumer_key, position::text AS position, status, version`,
      [c.tenantId, c.streamId, c.consumerKey, c.correlationId, c.by],
    );
    return firstRow(rows, 'insertCursor');
  }
  async getCursor(tx: Tx, id: string): Promise<CursorRow | null> {
    const { rows } = await tx.query<CursorRow>(
      `SELECT tenant_id, id, stream_id, consumer_key, position::text AS position, status, version FROM eventstream_cursor WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async advanceCursor(
    tx: Tx,
    id: string,
    expectedVersion: number,
    position: string,
    by: string | null,
  ): Promise<CursorRow | null> {
    const { rows } = await tx.query<CursorRow>(
      `UPDATE eventstream_cursor SET position=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 AND $3::bigint >= position RETURNING tenant_id, id, stream_id, consumer_key, position::text AS position, status, version`,
      [id, expectedVersion, position, by],
    );
    return rows[0] ?? null;
  }

  // ---- history + idempotency (append-only) ----
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      targetType: string;
      targetId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO events_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        h.tenantId,
        h.targetType,
        h.targetId,
        h.fromStatus,
        h.toStatus,
        h.reason,
        h.reasonCode,
        h.by,
        h.correlationId,
      ],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      targetType: string | null;
      targetId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO events_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
