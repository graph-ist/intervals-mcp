import * as icu from "../intervals.js";

export const TRACKED_SPORTS = ["swim", "bike", "run", "strength"] as const;
export type TrackedSport = (typeof TRACKED_SPORTS)[number];
type Bucket = TrackedSport | "other";
type SportTotals = Record<TrackedSport, number>;

const STRENGTH_TYPES = new Set(["weighttraining", "workout", "crossfit"]);
const DAY_MS = 86_400_000;

/** Groups intervals.icu activity types into the four tracked sports; everything else is "other". */
export function sportGroup(type?: string): Bucket {
  const t = (type ?? "").toLowerCase();
  if (t.endsWith("swim")) return "swim";
  if (t.endsWith("ride")) return "bike";
  if (t.endsWith("run")) return "run";
  if (STRENGTH_TYPES.has(t)) return "strength";
  return "other";
}

const emptyTotals = (): SportTotals => ({ swim: 0, bike: 0, run: 0, strength: 0 });
const sum = (t: SportTotals) => t.swim + t.bike + t.run + t.strength;
const round = (n: number) => Math.round(n);

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((weekday + 6) % 7));
}

function roundTotals(t: SportTotals): SportTotals {
  return { swim: round(t.swim), bike: round(t.bike), run: round(t.run), strength: round(t.strength) };
}

export type WeeklyTrackerOptions = {
  /** Number of weeks, starting from the week of `start` (default 6, max 26). */
  weeks?: number;
  /** Any date inside the first week, YYYY-MM-DD (default: today). */
  start?: string;
  /** Manual weekly TSS targets, index 0 = first week. Overrides the planned load for that week. */
  targets?: number[];
};

export async function computeWeeklyTracker(opts: WeeklyTrackerOptions, today: string) {
  const weekCount = Math.min(Math.max(Math.floor(opts.weeks ?? 6), 1), 26);
  const firstMonday = mondayOf(opts.start ?? today);
  const lastDay = addDays(firstMonday, weekCount * 7 - 1);

  const [events, activities] = await Promise.all([
    icu.getEvents(firstMonday, lastDay, "WORKOUT", { limit: 1000 }),
    icu.getActivities(firstMonday, lastDay, {
      limit: 2000,
      fields: ["start_date_local", "type", "icu_training_load"],
    }),
  ]);

  const planned = new Map<string, SportTotals>();
  const actual = new Map<string, SportTotals>();
  const other = new Map<string, number>();
  const bucketFor = <T>(map: Map<string, T>, date: string, make: () => T): T => {
    let v = map.get(date);
    if (!v) {
      v = make();
      map.set(date, v);
    }
    return v;
  };

  for (const e of events ?? []) {
    const date = e.start_date_local?.slice(0, 10);
    const sport = sportGroup(e.type);
    if (!date || sport === "other") continue;
    const load = Number(e.icu_training_load ?? e.load_target ?? 0);
    if (load > 0) bucketFor(planned, date, emptyTotals)[sport] += load;
  }

  for (const a of activities ?? []) {
    const date = String(a.start_date_local ?? "").slice(0, 10);
    const load = Number(a.icu_training_load ?? 0);
    if (!date || !(load > 0)) continue;
    const sport = sportGroup(a.type);
    if (sport === "other") other.set(date, (other.get(date) ?? 0) + load);
    else bucketFor(actual, date, emptyTotals)[sport] += load;
  }

  let weeksWithoutTarget = 0;
  let targetSum = 0;
  let actualSum = 0;

  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const start = addDays(firstMonday, i * 7);
    const end = addDays(start, 6);
    const plannedWeek = emptyTotals();
    const actualWeek = emptyTotals();
    let otherWeek = 0;
    let cumulative = 0;

    const days = Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, d);
      const act = actual.get(date) ?? emptyTotals();
      const plan = planned.get(date) ?? emptyTotals();
      for (const s of TRACKED_SPORTS) {
        plannedWeek[s] += plan[s];
        actualWeek[s] += act[s];
      }
      otherWeek += other.get(date) ?? 0;
      cumulative += sum(act);
      return { date, tss: roundTotals(act), total_tss: round(sum(act)), cumulative_tss: round(cumulative) };
    });

    const manual = opts.targets?.[i];
    const plannedTotal = sum(plannedWeek);
    const target = manual != null ? manual : plannedTotal > 0 ? plannedTotal : null;
    const targetSource = manual != null ? "manual" : plannedTotal > 0 ? "planned_events" : "none";
    const actualTotal = sum(actualWeek);
    if (target == null) weeksWithoutTarget++;
    else targetSum += target;
    actualSum += actualTotal;

    const status = end < today ? "past" : start > today ? "future" : "current";
    const remaining = target != null ? Math.max(0, target - actualTotal) : null;
    const daysLeft = status === "current" ? Math.round((Date.parse(end) - Date.parse(today)) / DAY_MS) + 1 : null;

    return {
      week_start: start,
      week_end: end,
      status,
      target_tss: target != null ? round(target) : null,
      target_source: targetSource,
      planned_tss_by_sport: roundTotals(plannedWeek),
      actual_tss: round(actualTotal),
      actual_tss_by_sport: roundTotals(actualWeek),
      other_tss_not_counted: round(otherWeek),
      completion_pct: target ? Math.round((actualTotal / target) * 1000) / 10 : null,
      remaining_tss: remaining != null ? round(remaining) : null,
      ...(status === "current" && remaining != null && daysLeft
        ? { days_left_including_today: daysLeft, tss_per_day_needed: round(remaining / daysLeft) }
        : {}),
      days,
    };
  });

  return {
    range: { from: firstMonday, to: lastDay, today },
    sports_tracked: TRACKED_SPORTS,
    note: "TSS is intervals.icu icu_training_load. Swim, bike (all ride types), run (all run types) and strength (WeightTraining, Workout, CrossFit) count toward the bars; other activities such as Yoga or Pilates are reported separately and not counted.",
    ...(weeksWithoutTarget > 0 && {
      hint: `${weeksWithoutTarget} of ${weekCount} weeks have no target: the calendar has no planned workouts with load there. Pass 'targets' (weekly TSS per week) or add the plan to the calendar (create_training_plan), then call again.`,
    }),
    totals: {
      target_tss_weeks_with_target: round(targetSum),
      actual_tss_all_weeks: round(actualSum),
      weeks_without_target: weeksWithoutTarget,
    },
    weeks,
    chart_hint:
      "One horizontal bar per week, length proportional to target_tss. Fill it with actual_tss_by_sport as colour segments (swim, bike, run, strength), mark the target at 100%, label completion_pct. Highlight the current week, show tss_per_day_needed for it, and optionally draw the per-day cumulative_tss as a step profile.",
  };
}
