/**
 * Business-time calendar math for SLAs (ADR-025) — PURE. Elapsed SLA time is BUSINESS time: it counts only
 * open hours on working days (weekends and configured holidays are skipped). This keeps an SLA from
 * "breaching" overnight or over a weekend. Everything here is deterministic given its inputs — the caller
 * passes the timestamps (services stamp real dates; this module never reads the clock), so it is fully unit
 * testable and replay-safe.
 */

export interface BusinessCalendar {
  /** Days of week that are non-working, 0 = Sunday … 6 = Saturday. Default: [0, 6]. */
  readonly weekend?: readonly number[];
  /** Holiday dates as `YYYY-MM-DD` (UTC). */
  readonly holidays?: readonly string[];
  /** Open hour (UTC, 0–24). Default 0. */
  readonly openHour?: number;
  /** Close hour (UTC, 0–24). Default 24 (i.e. 24h working day when unspecified). */
  readonly closeHour?: number;
}

const MS_PER_HOUR = 3_600_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWorkingDay(d: Date, cal: Required<Pick<BusinessCalendar, 'weekend' | 'holidays'>>): boolean {
  if (cal.weekend.includes(d.getUTCDay())) return false;
  if (cal.holidays.includes(isoDate(d))) return false;
  return true;
}

function normalise(cal: BusinessCalendar): {
  weekend: readonly number[];
  holidays: readonly string[];
  openHour: number;
  closeHour: number;
} {
  return {
    weekend: cal.weekend ?? [0, 6],
    holidays: cal.holidays ?? [],
    openHour: cal.openHour ?? 0,
    closeHour: cal.closeHour ?? 24,
  };
}

/**
 * Business seconds elapsed between `start` and `end` under `cal`. Walks hour by hour (bounded and
 * deterministic); for the MVP's horizon (≤ 400 days) this is inexpensive and exact to the hour.
 */
export function businessSecondsBetween(start: Date, end: Date, cal: BusinessCalendar = {}): number {
  if (end.getTime() <= start.getTime()) return 0;
  const c = normalise(cal);
  let seconds = 0;
  // Iterate whole UTC hours. A partial hour at each end is prorated to the fraction inside the window.
  let cursor = Math.floor(start.getTime() / MS_PER_HOUR) * MS_PER_HOUR;
  const endMs = end.getTime();
  while (cursor < endMs) {
    const hourStart = cursor;
    const hourEnd = cursor + MS_PER_HOUR;
    const d = new Date(hourStart);
    const hour = d.getUTCHours();
    const working = isWorkingDay(d, c) && hour >= c.openHour && hour < c.closeHour;
    if (working) {
      const from = Math.max(hourStart, start.getTime());
      const to = Math.min(hourEnd, endMs);
      seconds += Math.max(0, (to - from) / 1000);
    }
    cursor = hourEnd;
  }
  return Math.round(seconds);
}

/**
 * The wall-clock instant at which `targetBusinessSeconds` of business time will have elapsed from `start`.
 * Used to schedule warn/breach timers. Returns `start + horizon` as a safety cap if the target is never
 * reached within the max horizon (days), so a timer is always schedulable.
 */
export function businessDeadline(
  start: Date,
  targetBusinessSeconds: number,
  cal: BusinessCalendar = {},
  maxHorizonDays = 400,
): Date {
  if (targetBusinessSeconds <= 0) return new Date(start.getTime());
  const c = normalise(cal);
  let remaining = targetBusinessSeconds;
  let cursor = Math.floor(start.getTime() / MS_PER_HOUR) * MS_PER_HOUR;
  const cap = start.getTime() + maxHorizonDays * 24 * MS_PER_HOUR;
  while (cursor < cap) {
    const hourStart = Math.max(cursor, start.getTime());
    const hourEnd = cursor + MS_PER_HOUR;
    const d = new Date(cursor);
    const hour = d.getUTCHours();
    const working = isWorkingDay(d, c) && hour >= c.openHour && hour < c.closeHour;
    if (working) {
      const available = (hourEnd - hourStart) / 1000;
      if (available >= remaining) {
        return new Date(hourStart + remaining * 1000);
      }
      remaining -= available;
    }
    cursor = hourEnd;
  }
  return new Date(cap);
}
