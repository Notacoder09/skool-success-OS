import { formatInTimeZone, toZonedTime } from "date-fns-tz";

// Days 11-13 — pure timezone-aware scheduler for the Monday 7am-local
// weekly report.
//
// The cron route runs hourly UTC. Each creator has their own IANA
// timezone string in the creators table (defaulting to "UTC"). For
// each creator we ask: in *their* timezone, is `now` Monday between
// 07:00:00 and 07:59:59? If yes, queue a send.
//
// We compute Monday-of-the-week (in the creator's TZ) so the
// weekly_reports.weekStartDate column is consistent regardless of who
// runs the report or when. The unique idx on (creator_id, week_start)
// makes the whole pipeline idempotent — re-running the cron in the
// same hour can't double-send.

/** Monday in JS Date.getDay(): 1. */
const MONDAY = 1;
/** Local-clock hour the report should fire. */
export const REPORT_LOCAL_HOUR = 7;

export interface ScheduleDecision {
  /** True when (now, timezone) lands inside the firing window. */
  shouldFire: boolean;
  /**
   * Monday 00:00 of the current week, in UTC. Used as
   * weekly_reports.weekStartDate (date column, no time component).
   */
  weekStartDate: Date;
  /** Day-of-week and hour we evaluated, surfaced for tests + logs. */
  localDayOfWeek: number;
  localHour: number;
  timezone: string;
}

/**
 * True iff the IANA name resolves cleanly. Internally we round-trip
 * through `toZonedTime` and verify the result is a real Date — bad
 * names sometimes return an Invalid Date silently rather than
 * throwing.
 */
function isValidTz(tz: string): boolean {
  try {
    const probe = toZonedTime(new Date(), tz);
    return probe instanceof Date && !Number.isNaN(probe.getTime());
  } catch {
    return false;
  }
}

/**
 * Decide whether `now` falls inside the Monday-7am-local window for
 * `timezone`. Pure: `now` and `timezone` go in, decision comes out.
 */
export function evaluateMondaySchedule(
  now: Date,
  timezone: string,
): ScheduleDecision {
  const requestedTz = timezone || "UTC";
  const safeTz = isValidTz(requestedTz) ? requestedTz : "UTC";
  const zonedNow = toZonedTime(now, safeTz);
  const localDayOfWeek = zonedNow.getDay();
  const localHour = zonedNow.getHours();
  const shouldFire =
    localDayOfWeek === MONDAY && localHour === REPORT_LOCAL_HOUR;

  return {
    shouldFire,
    weekStartDate: weekStartDateForTz(now, safeTz),
    localDayOfWeek,
    localHour,
    // Echo the *requested* timezone string so callers can log/log
    // exactly what was passed in; the safe value drove the decision.
    timezone: requestedTz,
  };
}

/**
 * Returns the Monday 00:00 of the current local week, expressed as a
 * UTC `Date`. Date columns in Postgres ignore the time component, so
 * we round-trip via the formatted ISO date string for safety. The
 * value is stable for the entire week regardless of which hour we run.
 *
 * Exported for the orchestrator (which may queue reports from a
 * "regenerate now" button outside the cron window).
 */
export function weekStartDateForTz(now: Date, timezone: string): Date {
  const requestedTz = timezone || "UTC";
  const tz = isValidTz(requestedTz) ? requestedTz : "UTC";
  const zonedNow = toZonedTime(now, tz);
  const dow = zonedNow.getDay();
  // Monday = 1; offset to back up to Monday of this week.
  // Sunday (0) walks back 6 days, not -1 — keep the local week
  // running Mon→Sun rather than Sun→Sat.
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const mondayLocal = new Date(zonedNow);
  mondayLocal.setDate(mondayLocal.getDate() - daysSinceMonday);
  mondayLocal.setHours(0, 0, 0, 0);

  // Re-emit as a UTC `YYYY-MM-DD` date — Postgres `date` type stores
  // the calendar date, no timezone, so we hand it the literal day
  // we computed in the creator's local time.
  const isoDate = formatInTimeZone(mondayLocal, tz, "yyyy-MM-dd");
  return new Date(`${isoDate}T00:00:00Z`);
}
