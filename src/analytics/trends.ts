import * as icu from "../intervals.js";
import { daysAgo, today } from "../mcp/helpers.js";
import type { Activity, WellnessDay } from "../types.js";
import { matchesSport } from "./utils.js";

/**
 * Longitudinal Trends & Heart Rate Recovery (HRR) analysis.
 *
 * Tracks key performance and recovery markers over time to detect
 * fitness progression, overtraining, or stagnation.
 *
 * Metrics tracked:
 * - Efficiency Factor (EF): power/HR ratio — improves with aerobic fitness
 * - Power at key durations: peak power from individual activities
 * - CTL (Chronic Training Load): fitness proxy
 * - Weight: body composition
 * - HRV (rMSSD): autonomic nervous system status
 * - Resting HR: cardiovascular fitness
 * - HRR (Heart Rate Recovery): drop in HR 60s post-effort (icu_hrr)
 *   Faster recovery = better parasympathetic reactivation
 *
 * Uses linear regression for trend direction.
 *
 * References:
 * - Daanen et al. (2012). Int J Sports Physiol Perform, 7(3), 251-260. (HRR)
 * - Lamberts et al. (2009). Br J Sports Med, 43(11), 813-817. (EF/HRR monitoring)
 */

interface TrendResult {
  metric: string;
  unit: string;
  data_points: number;
  first_value: number | null;
  last_value: number | null;
  min: number;
  max: number;
  mean: number;
  slope_per_week: number;
  r2: number;
  direction: "improving" | "declining" | "stable";
  change_pct: number | null;
  change_abs: number;
}

export async function computeTrends(days: number, sport: string) {
  const newest = today();
  const oldest = daysAgo(days);

  const [activities, wellness] = await Promise.all([
    icu.getActivities(oldest, newest),
    icu.getWellness(oldest, newest),
  ]);

  const matching = activities.filter(
    (a) => matchesSport(a.type, sport) && ((a as Record<string, unknown>).moving_time as number) > 0,
  );

  if (matching.length < 3 && wellness.length < 3) {
    return null;
  }

  const trends: TrendResult[] = [];
  const baseDateMs = new Date(oldest).getTime();

  // --- Activity-based trends ---
  if (matching.length >= 3) {
    // EF (Efficiency Factor)
    const efPoints = extractActivityMetric(matching, baseDateMs, (a) => {
      const raw = a as Record<string, unknown>;
      const ef = raw.icu_efficiency_factor as number | undefined;
      if (ef && ef > 0) return ef;
      const avgP = raw.icu_weighted_avg_watts as number | undefined;
      const avgHR = raw.average_heartrate as number | undefined;
      if (avgP && avgHR && avgHR > 0) return avgP / avgHR;
      return null;
    });
    if (efPoints.length >= 3) {
      trends.push(buildTrend("Efficiency Factor", "W/bpm", efPoints, "higher"));
    }

    // HRR (Heart Rate Recovery): icu_hrr is an object, the drop in bpm is its hrr field
    const hrrPoints = extractActivityMetric(matching, baseDateMs, (a) => {
      const raw = a as Record<string, unknown>;
      const hrr = (raw.icu_hrr as { hrr?: number } | null | undefined)?.hrr;
      return hrr && hrr > 0 ? hrr : null;
    });
    if (hrrPoints.length >= 3) {
      trends.push(buildTrend("Heart Rate Recovery", "bpm", hrrPoints, "higher"));
    }

    // Average power
    const powerPoints = extractActivityMetric(matching, baseDateMs, (a) => {
      const raw = a as Record<string, unknown>;
      return (raw.icu_average_watts as number | undefined) ?? null;
    });
    if (powerPoints.length >= 3) {
      trends.push(buildTrend("Average Power", "W", powerPoints, "higher"));
    }

    // Normalized power
    const npPoints = extractActivityMetric(matching, baseDateMs, (a) => {
      const raw = a as Record<string, unknown>;
      return (raw.icu_weighted_avg_watts as number | undefined) ?? null;
    });
    if (npPoints.length >= 3) {
      trends.push(buildTrend("Normalized Power", "W", npPoints, "higher"));
    }

    // Decoupling (lower is better)
    const dcPoints = extractActivityMetric(matching, baseDateMs, (a) => {
      const raw = a as Record<string, unknown>;
      return (raw.decoupling as number | undefined) ?? null;
    });
    if (dcPoints.length >= 3) {
      trends.push(buildTrend("Decoupling", "%", dcPoints, "lower"));
    }

    // Training load per activity
    const loadPoints = extractActivityMetric(matching, baseDateMs, (a) => {
      return a.icu_training_load ?? null;
    });
    if (loadPoints.length >= 3) {
      trends.push(buildTrend("Training Load", "TSS", loadPoints, "neutral"));
    }
  }

  // --- Wellness-based trends ---
  if (wellness.length >= 3) {
    // CTL
    const ctlPoints = extractWellnessMetric(wellness, baseDateMs, (w) => w.ctl ?? null);
    if (ctlPoints.length >= 3) {
      trends.push(buildTrend("CTL (Fitness)", "TSS", ctlPoints, "higher"));
    }

    // HRV
    const hrvPoints = extractWellnessMetric(wellness, baseDateMs, (w) => w.hrv ?? null);
    if (hrvPoints.length >= 3) {
      trends.push(buildTrend("HRV (rMSSD)", "ms", hrvPoints, "higher"));
    }

    // Resting HR
    const rhrPoints = extractWellnessMetric(wellness, baseDateMs, (w) => w.restingHR ?? null);
    if (rhrPoints.length >= 3) {
      trends.push(buildTrend("Resting HR", "bpm", rhrPoints, "lower"));
    }

    // Weight
    const weightPoints = extractWellnessMetric(wellness, baseDateMs, (w) => w.weight ?? null);
    if (weightPoints.length >= 3) {
      trends.push(buildTrend("Weight", "kg", weightPoints, "neutral"));
    }

    // Sleep
    const sleepPoints = extractWellnessMetric(wellness, baseDateMs, (w) => (w.sleepSecs ? w.sleepSecs / 3600 : null));
    if (sleepPoints.length >= 3) {
      trends.push(buildTrend("Sleep", "hours", sleepPoints, "higher"));
    }

    // ATL
    const atlPoints = extractWellnessMetric(wellness, baseDateMs, (w) => w.atl ?? null);
    if (atlPoints.length >= 3) {
      trends.push(buildTrend("ATL (Fatigue)", "TSS", atlPoints, "neutral"));
    }

    // TSB = CTL - ATL
    const tsbPoints = extractWellnessMetric(wellness, baseDateMs, (w) =>
      w.ctl != null && w.atl != null ? w.ctl - w.atl : null,
    );
    if (tsbPoints.length >= 3) {
      trends.push(buildTrend("TSB (Form)", "TSS", tsbPoints, "neutral"));
    }
  }

  if (trends.length === 0) return null;

  // Summary flags
  const flags: string[] = [];
  for (const t of trends) {
    const pct = t.change_pct ?? 0;
    if (t.metric === "CTL (Fitness)" && t.direction === "improving" && pct > 10) {
      flags.push("Fitness (CTL) trending up — good progression");
    }
    if (t.metric === "HRV (rMSSD)" && t.direction === "declining" && pct < -15) {
      flags.push("HRV declining significantly — monitor recovery, possible overreaching");
    }
    if (t.metric === "Resting HR" && t.direction === "improving" && pct < -5) {
      flags.push("Resting HR dropping — cardiovascular fitness improving");
    }
    if (t.metric === "Resting HR" && t.direction === "declining" && pct > 5) {
      flags.push("Resting HR rising — check fatigue, illness, heat or dehydration");
    }
    if (t.metric === "Heart Rate Recovery" && t.direction === "improving") {
      flags.push("HRR improving — better parasympathetic reactivation");
    }
    if (t.metric === "Heart Rate Recovery" && t.direction === "declining") {
      flags.push("HRR declining — possible fatigue accumulation or detraining");
    }
    if (t.metric === "Efficiency Factor" && t.direction === "improving" && pct > 5) {
      flags.push("Efficiency Factor improving — aerobic base developing well");
    }
    if (t.metric === "Decoupling" && t.direction === "improving" && t.change_abs < -1) {
      flags.push("Decoupling improving — better aerobic endurance");
    }
  }

  return {
    period: { oldest, newest, days },
    sport,
    activities_analyzed: matching.length,
    wellness_days: wellness.length,
    trends,
    flags: flags.length > 0 ? flags : ["No significant trends detected — continue monitoring"],
    interpretation: {
      ef: "Power/HR ratio. Rising = better aerobic efficiency. Target steady improvement over 4-8 weeks.",
      hrr: "HR drop 60s after effort. Higher = better recovery capacity. Responds quickly to fitness/fatigue changes (Daanen et al., 2012).",
      ctl: "Chronic Training Load. Rise rate >5 TSS/week = aggressive ramp. Flat = maintenance.",
      hrv: "Heart rate variability. Declining trend over >7 days = possible overreaching. Look at 7-day rolling average, not daily values.",
    },
  };
}

// --- Helpers ---

type Point = { dayOffset: number; value: number };

function extractActivityMetric(
  activities: Activity[],
  baseDateMs: number,
  extract: (a: Activity) => number | null,
): Point[] {
  const points: Point[] = [];
  for (const a of activities) {
    const raw = a as Record<string, unknown>;
    const dateStr = (raw.start_date_local as string | undefined) ?? (raw.start_date as string | undefined);
    if (!dateStr) continue;
    const value = extract(a);
    if (value == null || !Number.isFinite(value)) continue;
    const dayOffset = (new Date(dateStr).getTime() - baseDateMs) / 86400000;
    points.push({ dayOffset, value: Math.round(value * 100) / 100 });
  }
  return points.sort((a, b) => a.dayOffset - b.dayOffset);
}

function extractWellnessMetric(
  wellness: WellnessDay[],
  baseDateMs: number,
  extract: (w: WellnessDay) => number | null,
): Point[] {
  const points: Point[] = [];
  for (const w of wellness) {
    const value = extract(w);
    if (value == null || !Number.isFinite(value)) continue;
    const dayOffset = (new Date(w.id).getTime() - baseDateMs) / 86400000;
    points.push({ dayOffset, value: Math.round(value * 100) / 100 });
  }
  return points.sort((a, b) => a.dayOffset - b.dayOffset);
}

function linearRegression(points: Point[]): { slope: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, r2: 0 };

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;
  for (const p of points) {
    sumX += p.dayOffset;
    sumY += p.value;
    sumXY += p.dayOffset * p.value;
    sumX2 += p.dayOffset * p.dayOffset;
    sumY2 += p.value * p.value;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const ssRes = points.reduce((s, p) => {
    const predicted = sumY / n + slope * (p.dayOffset - sumX / n);
    return s + (p.value - predicted) ** 2;
  }, 0);
  const ssTot = sumY2 - (sumY * sumY) / n;
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, r2 };
}

function buildTrend(
  metric: string,
  unit: string,
  points: Point[],
  betterDirection: "higher" | "lower" | "neutral",
): TrendResult {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

  const { slope, r2 } = linearRegression(points);
  const slopePerWeek = Math.round(slope * 7 * 100) / 100;

  const firstValue = values[0];
  const lastValue = values[values.length - 1];
  // Change measured on the fitted line, not on two noisy single points
  const xMean = points.reduce((s, p) => s + p.dayOffset, 0) / points.length;
  const fitted = (x: number) => mean + slope * (x - xMean);
  const fittedStart = fitted(points[0].dayOffset);
  const fittedEnd = fitted(points[points.length - 1].dayOffset);
  const changeAbs = Math.round((fittedEnd - fittedStart) * 100) / 100;
  // % change is meaningless for metrics that can be zero or negative (decoupling, TSB)
  const changePct =
    min > 0 && fittedStart > 0 ? Math.round(((fittedEnd - fittedStart) / fittedStart) * 1000) / 10 : null;

  // Determine direction relative to "better"; a fit explaining <10% of variance is treated as noise
  let direction: "improving" | "declining" | "stable";
  const threshold = Math.abs(mean) * 0.01; // 1% of mean per week as stability threshold
  if (Math.abs(slopePerWeek) < threshold || r2 < 0.1) {
    direction = "stable";
  } else if (betterDirection === "neutral") {
    direction = slopePerWeek > 0 ? "improving" : "declining";
  } else if (betterDirection === "higher") {
    direction = slopePerWeek > 0 ? "improving" : "declining";
  } else {
    // lower is better
    direction = slopePerWeek < 0 ? "improving" : "declining";
  }

  return {
    metric,
    unit,
    data_points: points.length,
    first_value: firstValue,
    last_value: lastValue,
    min,
    max,
    mean,
    slope_per_week: slopePerWeek,
    r2: Math.round(r2 * 100) / 100,
    direction,
    change_pct: changePct,
    change_abs: changeAbs,
  };
}
