/**
 * ExecutiveSummaryService — resolves the READ-ONLY cross-domain evidence a query needs and MASKS it to the caller's
 * authority. It selects the relevant read ports by intent (finance / operations / legal / case / documents / analytics),
 * gathers BOUNDED evidence, then intersects it against the caller's entitlements (`maskEvidence`) so the copilot only
 * ever surfaces what the caller may already see — no cross-tenant inference, no masked-row/count leakage. The UNBUILT
 * m32 analytics is consulted through `ExecutiveAnalyticsPort`; if it is genuinely unavailable it FAILS CLOSED (the
 * answer becomes review-required) rather than guessing. This service performs NO mutation and NO controlled action.
 */
import type { RequestContext } from '@finapp/kernel';
import type { Caller } from './domain.ts';
import { maskEvidence, clampMaxSources } from './domain.ts';
import {
  type CrossDomainReadPort,
  type ExecutiveAnalyticsPort,
  type EvidenceItem,
  type ReadPortQuery,
  AnalyticsUnavailableError,
  FixtureFinanceSummaryPort,
  FixtureOperationsSummaryPort,
  FixtureLegalSummaryPort,
  FixtureCaseSummaryPort,
  FixtureDocumentEvidencePort,
  FixtureAnalyticsPort,
} from './ports.ts';

export interface ResolvedEvidence {
  /** the evidence the caller is entitled to see (already masked to the intersection). */
  readonly visible: readonly EvidenceItem[];
  /** how many items were masked away — kept only as a private signal; never surfaced to the caller. */
  readonly maskedCount: number;
  /** true when the deferred m32 analytics port was needed but unavailable (=> review-required). */
  readonly analyticsUnavailable: boolean;
}

/** Which read ports each intent draws on. Every port is READ-ONLY. */
const ANALYTICS_INTENTS = new Set([
  'kpi_explanation',
  'trend_explanation',
  'portfolio_summary',
  'dashboard_narrative',
  'risk_summary',
  'exception_summary',
]);

export class ExecutiveSummaryService {
  private readonly finance: CrossDomainReadPort;
  private readonly operations: CrossDomainReadPort;
  private readonly legal: CrossDomainReadPort;
  private readonly cases: CrossDomainReadPort;
  private readonly documents: CrossDomainReadPort;
  private readonly analytics: ExecutiveAnalyticsPort;
  constructor(ports?: {
    finance?: CrossDomainReadPort;
    operations?: CrossDomainReadPort;
    legal?: CrossDomainReadPort;
    cases?: CrossDomainReadPort;
    documents?: CrossDomainReadPort;
    analytics?: ExecutiveAnalyticsPort;
  }) {
    this.finance = ports?.finance ?? new FixtureFinanceSummaryPort();
    this.operations = ports?.operations ?? new FixtureOperationsSummaryPort();
    this.legal = ports?.legal ?? new FixtureLegalSummaryPort();
    this.cases = ports?.cases ?? new FixtureCaseSummaryPort();
    this.documents = ports?.documents ?? new FixtureDocumentEvidencePort();
    this.analytics = ports?.analytics ?? new FixtureAnalyticsPort();
  }

  async resolveEvidence(
    ctx: RequestContext,
    caller: Caller,
    intentClass: string,
    scopeLevel: string,
    maxSources: number | undefined,
  ): Promise<ResolvedEvidence> {
    const bound = clampMaxSources(maxSources);
    const q: ReadPortQuery = { scopeLevel, maxSources: bound };
    const gathered: EvidenceItem[] = [];
    let analyticsUnavailable = false;

    const wants = (m: string): boolean =>
      intentClass === 'cross_domain_synthesis' ||
      intentClass === 'executive_question' ||
      intentClass === 'follow_up' ||
      intentClass === m;

    if (wants('finance_summary')) gathered.push(...(await this.finance.read(ctx, q)));
    if (wants('operational_summary') || wants('feedback_summary'))
      gathered.push(...(await this.operations.read(ctx, q)));
    if (wants('legal_summary')) gathered.push(...(await this.legal.read(ctx, q)));
    if (wants('case_summary')) gathered.push(...(await this.cases.read(ctx, q)));
    // Document evidence is always eligible (subject to entitlement masking).
    gathered.push(...(await this.documents.read(ctx, q)));

    if (
      intentClass === 'cross_domain_synthesis' ||
      intentClass === 'executive_question' ||
      intentClass === 'follow_up' ||
      ANALYTICS_INTENTS.has(intentClass)
    ) {
      try {
        gathered.push(...(await this.analytics.queryAggregates(ctx, q)));
      } catch (err) {
        if (err instanceof AnalyticsUnavailableError) analyticsUnavailable = true;
        else throw err;
      }
    }

    // ENTITLEMENT INTERSECTION: keep only what the caller may already see; masked items are dropped (never counted).
    const { visible, maskedCount } = maskEvidence(caller, gathered);
    return { visible: visible.slice(0, bound), maskedCount, analyticsUnavailable };
  }
}
