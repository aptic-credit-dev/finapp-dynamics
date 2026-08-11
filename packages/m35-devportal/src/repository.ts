/**
 * M35 repository — ALL SQL for the developer portal across its 9 devportal_* tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Product scope/review/
 * credential_event/history + the idempotency ledger are append-only. There is NO plaintext credential column — a credential
 * holds a one-way `sha256:` hash XOR an opaque `secretref:` pointer only. No float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m35 repository: expected a row from ${what}`);
  return row;
}

export interface AppRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly app_key: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ProductRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly product_key: string;
  readonly title: string;
  readonly category: string;
  readonly visibility: string;
  readonly source_kind: string;
  readonly source_ref: string | null;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ProductScopeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly product_id: string;
  readonly operation_ref: string;
  readonly required_permission: string;
}
export interface CredentialRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly app_id: string;
  readonly key_id: string;
  readonly purpose: string;
  readonly secret_hash: string | null;
  readonly secret_ref: string | null;
  readonly status: string;
  readonly version: number;
}
export interface SubscriptionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly app_id: string;
  readonly product_id: string;
  readonly status: string;
  readonly requested_by: string | null;
  readonly approved_by: string | null;
  readonly version: number;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
  readonly reason_code: string | null;
}

export class DevportalRepository {
  // ---- app ----
  async insertApp(
    tx: Tx,
    a: {
      tenantId: string;
      scope: string;
      appKey: string;
      name: string;
      description: string | null;
      homepageUrl: string | null;
      ownerRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AppRow> {
    const { rows } = await tx.query<AppRow>(
      `INSERT INTO devportal_app (tenant_id, scope, app_key, name, description, homepage_url, owner_ref, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING tenant_id, id, scope, app_key, name, status, version, correlation_id`,
      [
        a.tenantId,
        a.scope,
        a.appKey,
        a.name,
        a.description,
        a.homepageUrl,
        a.ownerRef,
        a.idempotencyKey,
        a.correlationId,
        a.by,
      ],
    );
    return firstRow(rows, 'insertApp');
  }
  async findAppByIdempotencyKey(tx: Tx, key: string): Promise<AppRow | null> {
    const { rows } = await tx.query<AppRow>(
      `SELECT tenant_id, id, scope, app_key, name, status, version, correlation_id FROM devportal_app WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getApp(tx: Tx, id: string): Promise<AppRow | null> {
    const { rows } = await tx.query<AppRow>(
      `SELECT tenant_id, id, scope, app_key, name, status, version, correlation_id FROM devportal_app WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateAppStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<AppRow | null> {
    const { rows } = await tx.query<AppRow>(
      `UPDATE devportal_app SET status=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, app_key, name, status, version, correlation_id`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }
  async listApps(tx: Tx, limit: number, offset: number): Promise<AppRow[]> {
    const { rows } = await tx.query<AppRow>(
      `SELECT tenant_id, id, scope, app_key, name, status, version, correlation_id FROM devportal_app ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- product ----
  async insertProduct(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      productKey: string;
      title: string;
      summary: string | null;
      category: string;
      visibility: string;
      sourceKind: string;
      sourceRef: string | null;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ProductRow> {
    const { rows } = await tx.query<ProductRow>(
      `INSERT INTO devportal_api_product (tenant_id, scope, product_key, title, summary, category, visibility, source_kind, source_ref, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING tenant_id, id, scope, product_key, title, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id`,
      [
        p.tenantId,
        p.scope,
        p.productKey,
        p.title,
        p.summary,
        p.category,
        p.visibility,
        p.sourceKind,
        p.sourceRef,
        p.contentHash,
        p.idempotencyKey,
        p.correlationId,
        p.by,
      ],
    );
    return firstRow(rows, 'insertProduct');
  }
  async findProductByIdempotencyKey(tx: Tx, key: string): Promise<ProductRow | null> {
    const { rows } = await tx.query<ProductRow>(
      `SELECT tenant_id, id, scope, product_key, title, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id FROM devportal_api_product WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getProduct(tx: Tx, id: string): Promise<ProductRow | null> {
    const { rows } = await tx.query<ProductRow>(
      `SELECT tenant_id, id, scope, product_key, title, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id FROM devportal_api_product WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getPublishedProductByKey(tx: Tx, scope: string, productKey: string): Promise<ProductRow | null> {
    const { rows } = await tx.query<ProductRow>(
      `SELECT tenant_id, id, scope, product_key, title, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id FROM devportal_api_product WHERE scope=$1 AND product_key=$2 AND state='published' LIMIT 1`,
      [scope, productKey],
    );
    return rows[0] ?? null;
  }
  async updateProductState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<ProductRow | null> {
    const { rows } = await tx.query<ProductRow>(
      `UPDATE devportal_api_product SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, product_key, title, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listProducts(tx: Tx, limit: number, offset: number): Promise<ProductRow[]> {
    const { rows } = await tx.query<ProductRow>(
      `SELECT tenant_id, id, scope, product_key, title, category, visibility, source_kind, source_ref, state, validation_passed, content_hash, version, correlation_id FROM devportal_api_product ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- product scope (append-only) ----
  async insertProductScope(
    tx: Tx,
    s: {
      tenantId: string;
      productId: string;
      operationRef: string;
      requiredPermission: string;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ProductScopeRow> {
    const { rows } = await tx.query<ProductScopeRow>(
      `INSERT INTO devportal_product_scope (tenant_id, product_id, operation_ref, required_permission, description, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING tenant_id, id, product_id, operation_ref, required_permission`,
      [s.tenantId, s.productId, s.operationRef, s.requiredPermission, s.description, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertProductScope');
  }
  async listProductScopes(tx: Tx, productId: string): Promise<ProductScopeRow[]> {
    const { rows } = await tx.query<ProductScopeRow>(
      `SELECT tenant_id, id, product_id, operation_ref, required_permission FROM devportal_product_scope WHERE product_id=$1`,
      [productId],
    );
    return rows;
  }

  // ---- credential (one-way hash XOR opaque secretref; no plaintext) ----
  async insertCredential(
    tx: Tx,
    c: {
      tenantId: string;
      appId: string;
      keyId: string;
      purpose: string;
      secretHash: string | null;
      secretRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CredentialRow> {
    const { rows } = await tx.query<CredentialRow>(
      `INSERT INTO devportal_credential (tenant_id, app_id, key_id, purpose, secret_hash, secret_ref, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING tenant_id, id, app_id, key_id, purpose, secret_hash, secret_ref, status, version`,
      [
        c.tenantId,
        c.appId,
        c.keyId,
        c.purpose,
        c.secretHash,
        c.secretRef,
        c.idempotencyKey,
        c.correlationId,
        c.by,
      ],
    );
    return firstRow(rows, 'insertCredential');
  }
  async getCredential(tx: Tx, id: string): Promise<CredentialRow | null> {
    const { rows } = await tx.query<CredentialRow>(
      `SELECT tenant_id, id, app_id, key_id, purpose, secret_hash, secret_ref, status, version FROM devportal_credential WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getActiveCredential(tx: Tx, appId: string, purpose: string): Promise<CredentialRow | null> {
    const { rows } = await tx.query<CredentialRow>(
      `SELECT tenant_id, id, app_id, key_id, purpose, secret_hash, secret_ref, status, version FROM devportal_credential WHERE app_id=$1 AND purpose=$2 AND status='active' LIMIT 1`,
      [appId, purpose],
    );
    return rows[0] ?? null;
  }
  async updateCredentialStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<CredentialRow | null> {
    const { rows } = await tx.query<CredentialRow>(
      `UPDATE devportal_credential SET status=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, app_id, key_id, purpose, secret_hash, secret_ref, status, version`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- subscription ----
  async insertSubscription(
    tx: Tx,
    s: {
      tenantId: string;
      appId: string;
      productId: string;
      requestedBy: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SubscriptionRow> {
    const { rows } = await tx.query<SubscriptionRow>(
      `INSERT INTO devportal_subscription (tenant_id, app_id, product_id, requested_by, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, app_id, product_id, status, requested_by, approved_by, version`,
      [s.tenantId, s.appId, s.productId, s.requestedBy, s.idempotencyKey, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertSubscription');
  }
  async findSubscriptionByIdempotencyKey(tx: Tx, key: string): Promise<SubscriptionRow | null> {
    const { rows } = await tx.query<SubscriptionRow>(
      `SELECT tenant_id, id, app_id, product_id, status, requested_by, approved_by, version FROM devportal_subscription WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getSubscription(tx: Tx, id: string): Promise<SubscriptionRow | null> {
    const { rows } = await tx.query<SubscriptionRow>(
      `SELECT tenant_id, id, app_id, product_id, status, requested_by, approved_by, version FROM devportal_subscription WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateSubscriptionStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; approvedBy: string | null; by: string | null },
  ): Promise<SubscriptionRow | null> {
    const { rows } = await tx.query<SubscriptionRow>(
      `UPDATE devportal_subscription SET status=$3, approved_by=COALESCE($4, approved_by), version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, app_id, product_id, status, requested_by, approved_by, version`,
      [id, expectedVersion, patch.status, patch.approvedBy, patch.by],
    );
    return rows[0] ?? null;
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
      `INSERT INTO devportal_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, target_type, target_id, kind, requested_by, decided_by, reason_code`,
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
      `SELECT tenant_id, id, target_type, target_id, kind, requested_by, decided_by, reason_code FROM devportal_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }

  // ---- credential event + history + idempotency (append-only) ----
  async insertCredentialEvent(
    tx: Tx,
    e: {
      tenantId: string;
      credentialId: string;
      event: string;
      by: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO devportal_credential_event (tenant_id, credential_id, event, by_user, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [e.tenantId, e.credentialId, e.event, e.by, e.reasonCode, e.correlationId],
    );
  }
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
      `INSERT INTO devportal_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
      `INSERT INTO devportal_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
