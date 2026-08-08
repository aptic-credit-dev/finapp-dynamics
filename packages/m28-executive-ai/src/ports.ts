/**
 * The READ-ONLY cross-domain PORTS through which the Executive Copilot gathers evidence. Every port is READ-ONLY (no
 * write method exists on any of them), returns BOUNDED, tenant-scoped DTOs, and every evidence item carries the
 * entitlement metadata the copilot needs to MASK it to the caller's authority + the citation reference it needs to cite
 * it. A port NEVER reads another module's PRIVATE tables directly — it is the seam a module's public read contract binds
 * to; until a module's real adapter is wired, a DETERMINISTIC fixture double stands in (no network, no secret). The
 * copilot must remain useful with fixture-backed evidence.
 *
 * M32 ANALYTICS IS UNBUILT (Stage 6, mvp:false). It is DEFERRED behind `ExecutiveAnalyticsPort`: a read-only,
 * tenant-scoped, entitlement-filtered, citation-bearing aggregate port with a deterministic fixture double and a
 * FAIL-CLOSED `UnavailableAnalyticsPort` (throws `AnalyticsUnavailableError`) for when the real m32 is not present — the
 * copilot then returns a review-required answer rather than an uncited guess. M28 does NOT implement m32.
 */
import type { RequestContext } from '@finapp/kernel';
import type { EvidenceEntitlement } from './domain.ts';

/**
 * One bounded piece of evidence the copilot may cite. It carries a REFERENCE (opaque record/document id) + safe bounded
 * summary metadata, NEVER copied restricted content. `entitlement` is what the masking model intersects against the
 * caller's authority; `citation` is the safe reference the copilot persists when (and only when) the caller is entitled.
 */
export interface EvidenceItem {
  readonly entitlement: EvidenceEntitlement;
  readonly citation: {
    readonly sourceType: string;
    readonly sourceModule: string;
    readonly recordRef: string | null;
    readonly documentRef: string | null;
    readonly documentVersion: string | null;
    readonly location: string | null;
    readonly confidenceBps: number;
  };
  /** a SHORT, non-restricted headline used only to compose the answer prompt — never persisted verbatim as content. */
  readonly headline: string;
}

export interface ReadPortQuery {
  readonly scopeLevel: string;
  readonly maxSources: number;
  readonly topic?: string;
}

/** A cross-domain read port: read-only, bounded, entitlement- and citation-bearing. */
export interface CrossDomainReadPort {
  readonly sourceModule: string;
  read(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]>;
}

/** The M32-deferred analytics/reporting read port (bounded aggregates + KPI/trend metrics). Read-only. */
export interface ExecutiveAnalyticsPort {
  readonly sourceModule: string;
  queryAggregates(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]>;
}

/** Thrown by the fail-closed analytics port when m32 is not available. The copilot answers review_required, never guesses. */
export class AnalyticsUnavailableError extends Error {
  readonly code = 'analytics_unavailable';
  constructor(message = 'executive analytics (m32) is not available') {
    super(message);
    this.name = 'AnalyticsUnavailableError';
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Deterministic doubles — the ONLY adapters that ship (no production integration, no network, no secret). Each yields
// fixed, tenant-scoped evidence with realistic entitlement metadata so masking + citation are exercised end to end.
// ------------------------------------------------------------------------------------------------------------------

/**
 * The deterministic doubles key their evidence to a REAL, seeded, grantable read entitlement (`ai.copilot.read`) so the
 * masking pipeline runs against genuine RBAC in the integration tests; the entitlement-INTERSECTION logic across
 * arbitrary domain permissions is exercised directly against `evaluateEntitlement`/`maskEvidence` in the pure suite.
 * Opaque record/document refs are fixed UUIDs (the columns are `uuid`).
 */
const READ_ENTITLEMENT = 'ai.copilot.read';

function fixtureItem(
  ctx: RequestContext,
  sourceModule: string,
  sourceType: string,
  headline: string,
  classification: string,
  scopeLevel: string,
  recordRef: string,
): EvidenceItem {
  return {
    entitlement: {
      tenantId: ctx.tenantId,
      scopeLevel,
      requiredEntitlements: [READ_ENTITLEMENT],
      classification,
    },
    citation: {
      sourceType,
      sourceModule,
      recordRef,
      documentRef: null,
      documentVersion: null,
      location: null,
      confidenceBps: 8000,
    },
    headline,
  };
}

/** A configurable deterministic cross-domain read double. Fixtures are pure functions of the ctx (no randomness). */
export class FixtureReadPort implements CrossDomainReadPort {
  readonly sourceModule: string;
  private readonly items: (ctx: RequestContext, q: ReadPortQuery) => readonly EvidenceItem[];
  constructor(
    sourceModule: string,
    items: (ctx: RequestContext, q: ReadPortQuery) => readonly EvidenceItem[],
  ) {
    this.sourceModule = sourceModule;
    this.items = items;
  }
  read(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]> {
    return Promise.resolve(this.items(ctx, query).slice(0, query.maxSources));
  }
}

/** Deterministic finance-summary double (m19). Confidential (needs ai.copilot.sensitive to surface). */
export class FixtureFinanceSummaryPort extends FixtureReadPort {
  constructor() {
    super('m19-finance', (ctx, q) => [
      fixtureItem(
        ctx,
        'm19-finance',
        'aggregate',
        'Period close on track; 2 open reconciliations',
        'confidential',
        q.scopeLevel,
        '00000000-0000-4000-8000-0000000f0001',
      ),
      fixtureItem(
        ctx,
        'm19-finance',
        'metric',
        'Cash position stable vs prior period',
        'confidential',
        q.scopeLevel,
        '00000000-0000-4000-8000-0000000f0002',
      ),
    ]);
  }
}

/** Deterministic operations-summary double (m12 feedback). Internal. */
export class FixtureOperationsSummaryPort extends FixtureReadPort {
  constructor() {
    super('m12-feedback', (ctx, q) => [
      fixtureItem(
        ctx,
        'm12-feedback',
        'aggregate',
        'Feedback volume within SLA; 1 escalation open',
        'internal',
        q.scopeLevel,
        '00000000-0000-4000-8000-0000000f0011',
      ),
    ]);
  }
}

/** Deterministic legal-summary double (m14). Restricted (ethical wall; needs ai.copilot.sensitive). */
export class FixtureLegalSummaryPort extends FixtureReadPort {
  constructor() {
    super('m14-legal', (ctx, q) => [
      fixtureItem(
        ctx,
        'm14-legal',
        'record',
        'One matter approaching a filing deadline',
        'restricted',
        q.scopeLevel,
        '00000000-0000-4000-8000-0000000f0021',
      ),
    ]);
  }
}

/** Deterministic case-summary double (m13). Internal. */
export class FixtureCaseSummaryPort extends FixtureReadPort {
  constructor() {
    super('m13-case', (ctx, q) => [
      fixtureItem(
        ctx,
        'm13-case',
        'aggregate',
        'Open cases trending down week over week',
        'internal',
        q.scopeLevel,
        '00000000-0000-4000-8000-0000000f0031',
      ),
    ]);
  }
}

/** Deterministic document-evidence double (m09). Internal; cited by opaque document ref. */
export class FixtureDocumentEvidencePort extends FixtureReadPort {
  constructor() {
    super('m09-docs', (ctx, q) => [
      {
        entitlement: {
          tenantId: ctx.tenantId,
          scopeLevel: q.scopeLevel,
          requiredEntitlements: [READ_ENTITLEMENT],
          classification: 'internal',
        },
        citation: {
          sourceType: 'document',
          sourceModule: 'm09-docs',
          recordRef: null,
          documentRef: '00000000-0000-4000-8000-0000000f0041',
          documentVersion: 'v1',
          location: 'p.1',
          confidenceBps: 7500,
        },
        headline: 'Board pack summary document',
      },
    ]);
  }
}

/** Deterministic analytics double standing in for the UNBUILT m32 (KPI/trend aggregates). Read-only. */
export class FixtureAnalyticsPort implements ExecutiveAnalyticsPort {
  readonly sourceModule = 'm32-analytics';
  queryAggregates(ctx: RequestContext, query: ReadPortQuery): Promise<readonly EvidenceItem[]> {
    return Promise.resolve(
      [
        fixtureItem(
          ctx,
          'm32-analytics',
          'metric',
          'KPI: on-time close rate 96% (trend +2pp)',
          'internal',
          query.scopeLevel,
          '00000000-0000-4000-8000-0000000f0051',
        ),
        fixtureItem(
          ctx,
          'm32-analytics',
          'aggregate',
          'Portfolio risk band: stable',
          'confidential',
          query.scopeLevel,
          '00000000-0000-4000-8000-0000000f0052',
        ),
      ].slice(0, query.maxSources),
    );
  }
}

/** The FAIL-CLOSED analytics port: used when m32 is genuinely unavailable. It never guesses — it throws. */
export class UnavailableAnalyticsPort implements ExecutiveAnalyticsPort {
  readonly sourceModule = 'm32-analytics';
  queryAggregates(): Promise<readonly EvidenceItem[]> {
    return Promise.reject(new AnalyticsUnavailableError());
  }
}
