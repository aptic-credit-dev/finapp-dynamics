/**
 * M32 materialization SOURCE adapters, composed at the API layer (where both m32 and the source modules are available).
 *
 * Architecture (ADR-112 seam): m32 never reads a source module's private tables. It reads aggregates through a
 * GOVERNED read seam — here the canonical m12 `FeedbackService.analytics(ctx, dimension)` (permission-gated on
 * `feedback.analytics.read`, tenant-scoped via FORCE RLS, returns counts only, no PII). The materialising actor must
 * therefore itself hold `feedback.analytics.read`; the resulting snapshot is then read by the governed analytics query
 * path under analytics permissions (so a Management Viewer sees the aggregates without holding any feedback permission).
 *
 * `RoutingMaterializationSource` dispatches by `dataset.source_module`: a real adapter when one is bound, else the
 * deterministic `FixtureMaterializationSource` (offline double) — never a guess, never a private-table read.
 */
import type { RequestContext } from '@finapp/kernel';
import {
  FixtureMaterializationSource,
  type MaterializationSourcePort,
  type MaterializationRequest,
  type MaterializationRow,
} from '@finapp/m32-analytics';
import { FeedbackService } from '@finapp/m12-feedback';

/** The seven governed feedback dimensions m12 exposes through `FeedbackService.analytics`. */
type FeedbackDimension =
  | 'product'
  | 'branch'
  | 'department'
  | 'sentiment'
  | 'severity'
  | 'category'
  | 'status';
const FEEDBACK_DIMENSIONS: readonly FeedbackDimension[] = [
  'product',
  'branch',
  'department',
  'sentiment',
  'severity',
  'category',
  'status',
];

/**
 * Derive the feedback dimension from the metric/dataset key by convention `*.by_<dimension>` (e.g.
 * `feedback.records.by_sentiment`). Falls back to `sentiment`. Never accepts an arbitrary/unknown dimension — the
 * governed m12 seam itself also whitelists, so this is defence-in-depth, not the only guard.
 */
export function feedbackDimensionOf(req: MaterializationRequest): FeedbackDimension {
  const key = `${req.metricKey} ${req.datasetKey}`.toLowerCase();
  const found = FEEDBACK_DIMENSIONS.find((d) => key.includes(`by_${d}`) || key.includes(`_${d}`));
  return found ?? 'sentiment';
}

/**
 * REAL feedback materialization source. Binds to the canonical m12 analytics seam — no direct table access. Returns
 * one MaterializationRow per dimension bucket: dimensionKey = the dimension, dimensionValue = the bucket value, count =
 * the integer count (as a string; money-safe contract — feedback aggregates carry no monetary measure).
 */
export class FeedbackMaterializationSource implements MaterializationSourcePort {
  readonly kind = 'm12-feedback';
  private readonly feedback: FeedbackService;
  constructor(feedback: FeedbackService) {
    this.feedback = feedback;
  }
  async computeAggregate(
    ctx: RequestContext,
    req: MaterializationRequest,
  ): Promise<readonly MaterializationRow[]> {
    const dimension = feedbackDimensionOf(req);
    const buckets = await this.feedback.analytics(ctx, dimension);
    return buckets.map((b) => ({
      dimensionKey: dimension,
      dimensionValue: b.dim,
      valueMinor: null,
      valueNumeric: null,
      count: b.count,
    }));
  }
}

/**
 * Dispatches a materialization to the adapter registered for `req.sourceModule`; falls back to the deterministic
 * fixture double for any unbound source (so generic datasets still materialize, and nothing ever reads a private
 * table or guesses). Fail-closed by construction: an unknown source yields the fixture's empty/declared rows.
 */
export class RoutingMaterializationSource implements MaterializationSourcePort {
  readonly kind = 'routing';
  private readonly bySource: Map<string, MaterializationSourcePort>;
  private readonly fallback: MaterializationSourcePort;
  constructor(
    adapters: Record<string, MaterializationSourcePort>,
    fallback: MaterializationSourcePort = new FixtureMaterializationSource(),
  ) {
    this.bySource = new Map(Object.entries(adapters));
    this.fallback = fallback;
  }
  computeAggregate(
    ctx: RequestContext,
    req: MaterializationRequest,
  ): Promise<readonly MaterializationRow[]> {
    const adapter = this.bySource.get(req.sourceModule) ?? this.fallback;
    return adapter.computeAggregate(ctx, req);
  }
}
