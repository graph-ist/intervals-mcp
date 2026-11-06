import * as icu from "../intervals.js";
import { addDays } from "../mcp/helpers.js";
import { computeRecoveryIndex } from "./recovery.js";

/*
 * Readiness rule on intervals.icu values, identical to the training dashboard's `wellness_trend` and
 * `today_state` calcs (rounding included, so both give the same case) and to
 * skills/intervals-coach/references/readiness-rule.md.
 */

export type WellnessRow = {
  id: string;
  readiness?: number | null;
  hrv?: number | null;
  restingHR?: number | null;
  ctl?: number | null;
  atl?: number | null;
};

type Position = "below" | "inside" | "above" | null;
type MetricState = {
  value: number | null;
  mean_7d: number | null;
  band: { low: number; high: number } | null;
  position: Position;
};

export const READINESS_CASES = {
  low: { case: 1, sentence: "Keep intensity low today" },
  tired: { case: 2, sentence: "Accumulated fatigue is high: consider a recovery day" },
  watch: { case: 3, sentence: "Follow the plan without adding intensity" },
  ok: { case: 4, sentence: "No signal against today's plan" },
} as const;
export type ReadinessCode = keyof typeof READINESS_CASES;

const TSB_LIMIT = -30;
const MIN_WEEK_VALUES = 4;
const MIN_BASE_VALUES = 30;
const DAY_MS = 864e5;

const r1 = (v: number) => Math.round(v * 10) / 10;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const mean = (a: number[]) => a.reduce((t, v) => t + v, 0) / a.length;
const sampleSd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((t, v) => t + (v - m) * (v - m), 0) / (a.length - 1));
};

function metricState(rows: WellnessRow[], d: number, field: "readiness" | "hrv" | "restingHR"): MetricState {
  const vals = (from: number, to: number) =>
    rows
      .filter((w) => {
        const x = dayNum(w.id);
        return x >= from && x <= to && w[field] != null;
      })
      .map((w) => Number(w[field]));
  const week = vals(d - 6, d);
  const base = vals(d - 60, d - 1);
  const mean7 = week.length >= MIN_WEEK_VALUES ? r1(mean(week)) : null;
  let band: MetricState["band"] = null;
  if (base.length >= MIN_BASE_VALUES) {
    const m = mean(base);
    const half = sampleSd(base) / 2;
    band = { low: r1(m - half), high: r1(m + half) };
  }
  const position: Position =
    mean7 == null || band == null ? null : mean7 < band.low ? "below" : mean7 > band.high ? "above" : "inside";
  const today = rows.find((w) => dayNum(w.id) === d)?.[field];
  return { value: today == null ? null : Number(today), mean_7d: mean7, band, position };
}

/** Pure part of the rule: evaluates the last row on or before `asOf` (default: the last row). */
export function evaluateReadiness(input: WellnessRow[], asOf?: string) {
  const rows = input
    .filter((w) => w.id && (!asOf || w.id.slice(0, 10) <= asOf))
    .map((w) => ({ ...w, id: w.id.slice(0, 10) }))
    .sort((p, q) => (p.id < q.id ? -1 : 1));
  const last = rows[rows.length - 1];
  if (!last) return null;
  const d = dayNum(last.id);
  const readiness = metricState(rows, d, "readiness");
  const hrv = metricState(rows, d, "hrv");
  const restingHr = metricState(rows, d, "restingHR");
  const tsb = last.ctl == null || last.atl == null ? null : r1(last.ctl - last.atl);

  const hrvBad = hrv.position === "below";
  const rhrBad = restingHr.position === "above";
  const rdyBad = readiness.position === "below";
  const code: ReadinessCode =
    hrvBad && rhrBad ? "low" : tsb != null && tsb < TSB_LIMIT ? "tired" : hrvBad || rhrBad || rdyBad ? "watch" : "ok";

  return {
    date: last.id,
    readiness,
    hrv,
    resting_hr: restingHr,
    form: { ctl: last.ctl ?? null, atl: last.atl ?? null, tsb },
    rule: { code, ...READINESS_CASES[code] },
  };
}

/**
 * Fetches intervals.icu wellness, applies the rule, and adds the severe flags from the recovery index
 * (HRV or resting HR z below -2, SpO2 below 93%), which are the only exceptions outside the rule.
 */
export async function computeReadinessCheck(asOf: string) {
  const fields = ["id", "readiness", "hrv", "restingHR", "ctl", "atl"];
  const [rows, recovery] = await Promise.all([
    icu.getWellness(addDays(asOf, -70), asOf, fields) as Promise<WellnessRow[]>,
    computeRecoveryIndex(
      30,
      (n) => addDays(asOf, -n),
      () => asOf,
    ).catch(() => null),
  ]);
  const result = evaluateReadiness(rows, asOf);
  if (!result) return null;

  const severe: string[] = [];
  const m = recovery?.today?.metrics as Record<string, { value: number; z_score: number }> | undefined;
  if (m?.hrv && m.hrv.z_score < -2) severe.push(`HRV z-score ${m.hrv.z_score} (below -2)`);
  if (m?.restingHR && m.restingHR.z_score < -2) severe.push(`Resting HR z-score ${m.restingHR.z_score} (elevated)`);
  if (m?.spO2 && m.spO2.value < 93) severe.push(`SpO2 ${m.spO2.value}% (below 93%: suggest seeing a doctor)`);

  return {
    ...result,
    severe_flags: severe,
    severe_flags_checked: m != null,
    rule_definition:
      "7-day mean (>= 4 values) of readiness, HRV and resting HR against a normal band: mean of the 60 previous days +/- half the sample SD (>= 30 values); means and bands rounded to 0.1 before comparing. First case that holds: 1 HRV below and resting HR above the band; 2 TSB below -30; 3 at least one of HRV below, resting HR above, readiness below; 4 otherwise. A severe flag justifies changing the session whatever the case. Same rule as the training dashboard.",
  };
}
