/**
 * Parallel-gateway token accounting (ADR-023) — PURE. A workflow instance is driven by tokens sitting at
 * nodes. A PARALLEL_SPLIT mints one token per outgoing branch; a PARALLEL_JOIN consumes them and emits one
 * token only when EVERY expected branch has arrived. The accounting is deterministic and idempotent — a
 * branch arriving twice (a retry) does not double-count, so a join fires exactly once. The runtime holds a
 * per-instance advisory lock while mutating token rows; this module is the pure logic it applies.
 */

/** How many tokens a split mints — one per outgoing branch. A split needs at least two branches. */
export function splitTokenCount(outgoingBranches: number): number {
  if (!Number.isInteger(outgoingBranches) || outgoingBranches < 2) {
    throw new Error('a PARALLEL_SPLIT must have at least two outgoing branches');
  }
  return outgoingBranches;
}

/** Immutable join accounting state: which distinct branches have arrived, and how many are expected. */
export interface JoinState {
  readonly expected: number;
  readonly arrived: readonly string[];
}

export function newJoinState(expected: number): JoinState {
  if (!Number.isInteger(expected) || expected < 2) {
    throw new Error('a PARALLEL_JOIN must expect at least two incoming branches');
  }
  return { expected, arrived: [] };
}

/** Record a branch arrival. Idempotent: the same branch key twice is a no-op (retry-safe, ADR-023). */
export function recordArrival(state: JoinState, branchKey: string): JoinState {
  if (state.arrived.includes(branchKey)) return state;
  if (state.arrived.length >= state.expected) {
    // More distinct arrivals than expected means the definition graph is unbalanced — the validator must
    // have rejected it. Fail closed rather than silently over-count.
    throw new Error('parallel join received more distinct branches than expected (unbalanced graph)');
  }
  return { expected: state.expected, arrived: [...state.arrived, branchKey] };
}

/** The join fires exactly once, when every expected distinct branch has arrived. */
export function joinReady(state: JoinState): boolean {
  return state.arrived.length === state.expected;
}

/**
 * Structural balance check the validator uses: every PARALLEL_SPLIT branch count must be matched by a
 * PARALLEL_JOIN expecting the same number. This is a conservative MVP rule (structured/balanced parallelism
 * only — no arbitrary token soup). Returns the list of imbalances (empty = balanced).
 */
export interface ParallelRegion {
  readonly splitKey: string;
  readonly splitBranches: number;
  readonly joinKey: string;
  readonly joinExpected: number;
}

export function findParallelImbalances(regions: readonly ParallelRegion[]): readonly string[] {
  const problems: string[] = [];
  for (const r of regions) {
    if (r.splitBranches !== r.joinExpected) {
      problems.push(
        `PARALLEL_SPLIT '${r.splitKey}' fans out ${String(r.splitBranches)} but PARALLEL_JOIN '${r.joinKey}' expects ${String(r.joinExpected)}`,
      );
    }
  }
  return problems;
}
