/**
 * Preference + suppression evaluation (prompt §E10). Distinguishes four communication categories and refuses to
 * let a general opt-out silence what must always be delivered:
 *
 *  - `optional`   — marketing/informational: fully subject to opt-out, suppression, and quiet hours.
 *  - `operational`— system/workflow notices: delivered; quiet hours may DEFER but not drop.
 *  - `security`   — security-critical: always delivered, never suppressed, never deferred.
 *  - `legal`      — legally/regulatorily required: always delivered, never suppressed, never deferred.
 *
 * PURE and deterministic: the "current time" is passed in as a minute-of-day so there is no clock. This is a
 * generic preference core, NOT a consent-management platform.
 */
import { NotifyError } from './limits.ts';

export const NOTIFICATION_CATEGORIES = ['optional', 'operational', 'security', 'legal'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories that a preference/suppression/quiet-hours setting may NEVER silence or defer. */
export function isMandatoryCategory(category: NotificationCategory): boolean {
  return category === 'security' || category === 'legal';
}

export interface QuietHours {
  /** Minute-of-day [0,1440). If start <= end it is a normal window; if start > end it wraps midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface ChannelPreference {
  readonly channel: string;
  readonly optIn: boolean;
  readonly suppressed: boolean;
  readonly quietHours?: QuietHours;
}

export interface DeliveryDecision {
  readonly deliver: boolean;
  readonly defer: boolean;
  readonly reason:
    'deliver' | 'mandatory' | 'opted_out' | 'suppressed' | 'quiet_hours' | 'destination_suppressed';
}

function withinQuietHours(q: QuietHours, minuteOfDay: number): boolean {
  if (q.startMinute === q.endMinute) return false;
  if (q.startMinute < q.endMinute) {
    return minuteOfDay >= q.startMinute && minuteOfDay < q.endMinute;
  }
  // Wraps midnight (e.g. 22:00 → 07:00).
  return minuteOfDay >= q.startMinute || minuteOfDay < q.endMinute;
}

/**
 * Decide whether a message in `category` may be delivered on `channel` given the recipient preference, the set
 * of hard-suppressed destinations, and the current minute-of-day. Mandatory categories always deliver.
 */
export function evaluateDelivery(input: {
  category: NotificationCategory;
  channel: string;
  minuteOfDay: number;
  preference?: ChannelPreference;
  destinationSuppressed?: boolean;
}): DeliveryDecision {
  if (input.minuteOfDay < 0 || input.minuteOfDay >= 1440) {
    throw new NotifyError('INVALID_TIME', 'minuteOfDay must be in [0,1440)');
  }

  // A hard destination suppression (bounce/complaint) stops everything EXCEPT the mandatory categories.
  if (input.destinationSuppressed === true && !isMandatoryCategory(input.category)) {
    return { deliver: false, defer: false, reason: 'destination_suppressed' };
  }

  if (isMandatoryCategory(input.category)) {
    return { deliver: true, defer: false, reason: 'mandatory' };
  }

  const pref = input.preference;
  if (input.category === 'optional') {
    if (pref?.suppressed === true) {
      return { deliver: false, defer: false, reason: 'suppressed' };
    }
    if (pref !== undefined && !pref.optIn) {
      return { deliver: false, defer: false, reason: 'opted_out' };
    }
    if (pref?.quietHours !== undefined && withinQuietHours(pref.quietHours, input.minuteOfDay)) {
      return { deliver: false, defer: true, reason: 'quiet_hours' };
    }
    return { deliver: true, defer: false, reason: 'deliver' };
  }

  // operational: delivered, but quiet hours may DEFER (never drop).
  if (pref?.quietHours !== undefined && withinQuietHours(pref.quietHours, input.minuteOfDay)) {
    return { deliver: false, defer: true, reason: 'quiet_hours' };
  }
  return { deliver: true, defer: false, reason: 'deliver' };
}
