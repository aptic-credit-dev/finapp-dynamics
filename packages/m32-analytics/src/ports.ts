/**
 * M32 ports. Two seams:
 *  (1) `M32ExecutiveAnalyticsAdapter` IMPLEMENTS M28's `ExecutiveAnalyticsPort` (ADR-112) — the real, read-only, bounded,
 *      tenant-scoped, entitlement-filtered, citation-bearing analytics port the Executive Copilot consumes. M28 is the
 *      downstream consumer; m32 provides the implementation. It delegates to an `AnalyticsEvidenceProvider` (the query
 *      service) so the entitlement + lineage/citation logic lives in one governed place.
 *  (2) `MaterializationSourcePort` — the seam m32 reads source-module aggregates through to COMPUTE a materialization.
 *      Only DETERMINISTIC offline doubles ship (no network, no arbitrary SQL); a FAIL-CLOSED `UnavailableMaterializationSource`
 *      throws when a real source adapter (or the unbuilt m33 integration foundation) is not present. m32 never reads a
 *      source module's private tables — it binds to a governed read seam.
 */
import type { RequestContext } from '@finapp/kernel';
import type { ExecutiveAnalyticsPort, EvidenceItem, ReadPortQuery } from '@finapp/m28-executive-ai';
import type { QueryPlan } from './domain.ts';

/** The governed provider of copilot-safe analytics evidence (published metrics' latest materializations, masked). */
export interface AnalyticsEvidenceProvider {
  aggregatesForCopilot(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]>;
}

/** The REAL implementation of M28's deferred analytics port (ADR-112). Read-only; delegates to the governed provider. */
export class M32ExecutiveAnalyticsAdapter implements ExecutiveAnalyticsPort {
  readonly sourceModule = 'm32-analytics';
  private readonly provider: AnalyticsEvidenceProvider;
  constructor(provider: AnalyticsEvidenceProvider) {
    this.provider = provider;
  }
  queryAggregates(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]> {
    return this.provider.aggregatesForCopilot(ctx, query);
  }
}

/** One computed aggregate row from a governed source seam. Money-safe: minor units (bigint as string) / exact decimal
 * (string) / integer count — never a float. */
export interface MaterializationRow {
  readonly dimensionKey: string | null;
  readonly dimensionValue: string | null;
  readonly valueMinor: string | null;
  readonly valueNumeric: string | null;
  readonly count: string | null;
}

export interface MaterializationRequest {
  readonly sourceModule: string;
  readonly datasetKey: string;
  readonly metricKey: string;
  readonly plan: QueryPlan;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}

/** The seam m32 reads source aggregates through to compute a materialization. Deterministic doubles only (no network). */
export interface MaterializationSourcePort {
  readonly kind: string;
  computeAggregate(ctx: RequestContext, req: MaterializationRequest): Promise<readonly MaterializationRow[]>;
}

/** A DETERMINISTIC offline double: yields fixed, tenant-independent aggregate rows for a request (no network, no SQL). */
export class FixtureMaterializationSource implements MaterializationSourcePort {
  readonly kind = 'fixture';
  private readonly rows: (req: MaterializationRequest) => readonly MaterializationRow[];
  constructor(rows: (req: MaterializationRequest) => readonly MaterializationRow[] = () => []) {
    this.rows = rows;
  }
  computeAggregate(
    _ctx: RequestContext,
    req: MaterializationRequest,
  ): Promise<readonly MaterializationRow[]> {
    return Promise.resolve(this.rows(req));
  }
}

/** FAIL-CLOSED: used when no real source adapter (or the unbuilt m33 integration foundation) is bound. Never guesses. */
export class UnavailableMaterializationSource implements MaterializationSourcePort {
  readonly kind = 'unavailable';
  computeAggregate(): Promise<readonly MaterializationRow[]> {
    return Promise.reject(
      new Error('analytics materialization source is unavailable (m33 integration unbuilt)'),
    );
  }
}
