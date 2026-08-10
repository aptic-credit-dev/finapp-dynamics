/**
 * M34 repository — ALL SQL for the marketplace across its 9 marketplace_* tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Capability/upgrade/review/
 * history + the idempotency ledger are append-only. There is NO secret VALUE column — marketplace_install_secret holds an
 * opaque `secretref:` pointer only. No float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m34 repository: expected a row from ${what}`);
  return row;
}

export interface ListingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly listing_key: string;
  readonly connector_ref: string;
  readonly title: string;
  readonly category: string;
  readonly visibility: string;
  readonly state: string;
  readonly validation_passed: boolean;
  readonly content_hash: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ListingCapabilityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly listing_id: string;
  readonly capability_ref: string;
  readonly required_scope: string;
}
export interface InstallationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly listing_id: string;
  readonly connector_ref: string;
  readonly scope: string;
  readonly install_key: string;
  readonly config: unknown;
  readonly status: string;
  readonly installed_version: number;
  readonly requested_by: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConsentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly installation_id: string;
  readonly scopes: readonly string[];
  readonly status: string;
  readonly granted_by: string | null;
  readonly version: number;
}
export interface InstallSecretRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly installation_id: string;
  readonly purpose: string;
  readonly secret_ref: string;
  readonly status: string;
  readonly version: number;
}
export interface UpgradeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly installation_id: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly status: string;
  readonly requested_by: string | null;
  readonly approved_by: string | null;
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

export class MarketplaceRepository {
  // ---- listing ----
  async insertListing(
    tx: Tx,
    l: {
      tenantId: string;
      scope: string;
      listingKey: string;
      connectorRef: string;
      title: string;
      summary: string | null;
      category: string;
      publisher: string | null;
      visibility: string;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ListingRow> {
    const { rows } = await tx.query<ListingRow>(
      `INSERT INTO marketplace_listing (tenant_id, scope, listing_key, connector_ref, title, summary, category, publisher, visibility, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING tenant_id, id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, version, correlation_id`,
      [
        l.tenantId,
        l.scope,
        l.listingKey,
        l.connectorRef,
        l.title,
        l.summary,
        l.category,
        l.publisher,
        l.visibility,
        l.contentHash,
        l.idempotencyKey,
        l.correlationId,
        l.by,
      ],
    );
    return firstRow(rows, 'insertListing');
  }
  async findListingByIdempotencyKey(tx: Tx, key: string): Promise<ListingRow | null> {
    const { rows } = await tx.query<ListingRow>(
      `SELECT tenant_id, id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, version, correlation_id FROM marketplace_listing WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getListing(tx: Tx, id: string): Promise<ListingRow | null> {
    const { rows } = await tx.query<ListingRow>(
      `SELECT tenant_id, id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, version, correlation_id FROM marketplace_listing WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getPublishedListingByKey(tx: Tx, scope: string, listingKey: string): Promise<ListingRow | null> {
    const { rows } = await tx.query<ListingRow>(
      `SELECT tenant_id, id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, version, correlation_id FROM marketplace_listing WHERE scope=$1 AND listing_key=$2 AND state='published' LIMIT 1`,
      [scope, listingKey],
    );
    return rows[0] ?? null;
  }
  async updateListingState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<ListingRow | null> {
    const { rows } = await tx.query<ListingRow>(
      `UPDATE marketplace_listing SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, version, correlation_id`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listListings(tx: Tx, limit: number, offset: number): Promise<ListingRow[]> {
    const { rows } = await tx.query<ListingRow>(
      `SELECT tenant_id, id, scope, listing_key, connector_ref, title, category, visibility, state, validation_passed, content_hash, version, correlation_id FROM marketplace_listing ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- listing capability (append-only) ----
  async insertListingCapability(
    tx: Tx,
    c: {
      tenantId: string;
      listingId: string;
      capabilityRef: string;
      requiredScope: string;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ListingCapabilityRow> {
    const { rows } = await tx.query<ListingCapabilityRow>(
      `INSERT INTO marketplace_listing_capability (tenant_id, listing_id, capability_ref, required_scope, description, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING tenant_id, id, listing_id, capability_ref, required_scope`,
      [c.tenantId, c.listingId, c.capabilityRef, c.requiredScope, c.description, c.correlationId, c.by],
    );
    return firstRow(rows, 'insertListingCapability');
  }
  async listListingCapabilities(tx: Tx, listingId: string): Promise<ListingCapabilityRow[]> {
    const { rows } = await tx.query<ListingCapabilityRow>(
      `SELECT tenant_id, id, listing_id, capability_ref, required_scope FROM marketplace_listing_capability WHERE listing_id=$1`,
      [listingId],
    );
    return rows;
  }

  // ---- installation ----
  async insertInstallation(
    tx: Tx,
    i: {
      tenantId: string;
      listingId: string;
      connectorRef: string;
      scope: string;
      installKey: string;
      config: unknown;
      requestedBy: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<InstallationRow> {
    const { rows } = await tx.query<InstallationRow>(
      `INSERT INTO marketplace_installation (tenant_id, listing_id, connector_ref, scope, install_key, config, requested_by, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10) RETURNING tenant_id, id, listing_id, connector_ref, scope, install_key, config, status, installed_version, requested_by, version, correlation_id`,
      [
        i.tenantId,
        i.listingId,
        i.connectorRef,
        i.scope,
        i.installKey,
        JSON.stringify(i.config ?? {}),
        i.requestedBy,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(rows, 'insertInstallation');
  }
  async findInstallationByIdempotencyKey(tx: Tx, key: string): Promise<InstallationRow | null> {
    const { rows } = await tx.query<InstallationRow>(
      `SELECT tenant_id, id, listing_id, connector_ref, scope, install_key, config, status, installed_version, requested_by, version, correlation_id FROM marketplace_installation WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getInstallation(tx: Tx, id: string): Promise<InstallationRow | null> {
    const { rows } = await tx.query<InstallationRow>(
      `SELECT tenant_id, id, listing_id, connector_ref, scope, install_key, config, status, installed_version, requested_by, version, correlation_id FROM marketplace_installation WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateInstallation(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; installedVersion: number; by: string | null },
  ): Promise<InstallationRow | null> {
    const { rows } = await tx.query<InstallationRow>(
      `UPDATE marketplace_installation SET status=$3, installed_version=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, listing_id, connector_ref, scope, install_key, config, status, installed_version, requested_by, version, correlation_id`,
      [id, expectedVersion, patch.status, patch.installedVersion, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- consent ----
  async insertConsent(
    tx: Tx,
    c: {
      tenantId: string;
      installationId: string;
      scopes: readonly string[];
      grantedBy: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConsentRow> {
    const { rows } = await tx.query<ConsentRow>(
      `INSERT INTO marketplace_consent (tenant_id, installation_id, scopes, status, granted_by, reason_code, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,'granted',$4,'consent_granted',$5,$6,$7,$7) RETURNING tenant_id, id, installation_id, scopes, status, granted_by, version`,
      [c.tenantId, c.installationId, [...c.scopes], c.grantedBy, c.idempotencyKey, c.correlationId, c.by],
    );
    return firstRow(rows, 'insertConsent');
  }
  async getActiveConsent(tx: Tx, installationId: string): Promise<ConsentRow | null> {
    const { rows } = await tx.query<ConsentRow>(
      `SELECT tenant_id, id, installation_id, scopes, status, granted_by, version FROM marketplace_consent WHERE installation_id=$1 AND status='granted' LIMIT 1`,
      [installationId],
    );
    return rows[0] ?? null;
  }
  async revokeConsent(
    tx: Tx,
    id: string,
    expectedVersion: number,
    by: string | null,
  ): Promise<ConsentRow | null> {
    const { rows } = await tx.query<ConsentRow>(
      `UPDATE marketplace_consent SET status='revoked', version=version+1, updated_at=now(), updated_by=$3 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, installation_id, scopes, status, granted_by, version`,
      [id, expectedVersion, by],
    );
    return rows[0] ?? null;
  }

  // ---- install secret (opaque secretref only) ----
  async insertInstallSecret(
    tx: Tx,
    s: {
      tenantId: string;
      installationId: string;
      purpose: string;
      secretRef: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<InstallSecretRow> {
    const { rows } = await tx.query<InstallSecretRow>(
      `INSERT INTO marketplace_install_secret (tenant_id, installation_id, purpose, secret_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, installation_id, purpose, secret_ref, status, version`,
      [s.tenantId, s.installationId, s.purpose, s.secretRef, s.idempotencyKey, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertInstallSecret');
  }

  // ---- upgrade (append-only) ----
  async insertUpgrade(
    tx: Tx,
    u: {
      tenantId: string;
      installationId: string;
      fromVersion: number;
      toVersion: number;
      status: string;
      requestedBy: string | null;
      approvedBy: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<UpgradeRow> {
    const { rows } = await tx.query<UpgradeRow>(
      `INSERT INTO marketplace_upgrade (tenant_id, installation_id, from_version, to_version, status, requested_by, approved_by, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, installation_id, from_version, to_version, status, requested_by, approved_by`,
      [
        u.tenantId,
        u.installationId,
        u.fromVersion,
        u.toVersion,
        u.status,
        u.requestedBy,
        u.approvedBy,
        u.reasonCode,
        u.correlationId,
      ],
    );
    return firstRow(rows, 'insertUpgrade');
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
      `INSERT INTO marketplace_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, target_type, target_id, kind, requested_by, decided_by, reason_code`,
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
      `SELECT tenant_id, id, target_type, target_id, kind, requested_by, decided_by, reason_code FROM marketplace_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
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
      `INSERT INTO marketplace_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
      `INSERT INTO marketplace_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
