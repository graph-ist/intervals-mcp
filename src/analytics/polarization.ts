import * as icu from "../intervals.js";
import { matchesSport } from "./utils.js";

/**
 * Training Intensity Distribution & Polarization Analysis.
 *
 * Aggregates time-in-zone across activities to assess training polarity.
 * The 80/20 polarized model (Seiler, 2010) suggests elite endurance
 * performance benefits from ~80% low intensity (Z1-Z2) and ~20% high
 * intensity (Z4-Z5), with minimal time in Z3 ("black hole").
 *
 * Polarization Index (PI): ratio of Z1+Z2 to Z3 time, weighted by Z4+Z5.
 * Higher PI = more polarized. Values > 2.0 are well-polarized.
 *
 * References:
 * - Seiler (2010). Int J Sports Physiol Perform, 5(3), 276-291.
 * - Stöggl & Sperlich (2015). Front Physiol, 6, 295.
 */

interface ZoneSummary {
  zone: number;
  label: string;
  seconds: number;
  pct: number;
}

export async function computePolarization(days: number, sport: string) {
  const newest = new Date().toISOString().slice(0, 10);
  const oldest = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const activities = await icu.getActivities(oldest, newest);

  // Filter by sport and only completed activities with zone data
  const matching = activities.filter(
    (a) =>
      matchesSport(a.type, sport) &&
      !a.name?.toLowerCase().includes("manual") &&
      ((a as Record<string, unknown>).moving_time as number) > 0,
  );

  if (matching.length === 0) {
    return null;
  }

  // intervals.icu fields: icu_zone_times = [{id:"Z1",secs}, ..., {id:"SS",secs}], icu_hr_zone_times / pace_zone_times = number[]
  const zoneSeconds: number[] = [0, 0, 0, 0, 0, 0, 0]; // zones 1-7

  let usedMetric: "power" | "hr" | "pace" = "hr";
  let activitiesWithZones = 0;
  const preferPower = matchesSport(sport, "ride");

  for (const act of matching) {
    const raw = act as Record<string, unknown>;
    let zones: number[] | null = null;

    const powerZones = raw.icu_zone_times as { id?: string; secs?: number }[] | null | undefined;
    const pzt = powerZones?.length
      ? [1, 2, 3, 4, 5, 6, 7].map((z) => powerZones.find((p) => p.id === `Z${z}`)?.secs ?? 0)
      : undefined;
    const hzt = raw.icu_hr_zone_times as number[] | null | undefined;
    const pazt = raw.pace_zone_times as number[] | null | undefined;

    if (preferPower && pzt?.some((s) => s > 0)) {
      zones = pzt;
      usedMetric = "power";
    } else if (hzt?.length) {
      zones = hzt;
      usedMetric = "hr";
    } else if (pazt?.length) {
      zones = pazt;
      usedMetric = "pace";
    }

    if (zones && zones.length > 0) {
      activitiesWithZones++;
      for (let z = 0; z < zones.length && z < zoneSeconds.length; z++) {
        zoneSeconds[z] += zones[z] ?? 0;
      }
    }
  }

  if (activitiesWithZones === 0) {
    return null;
  }

  const totalSeconds = zoneSeconds.reduce((a, b) => a + b, 0);
  if (totalSeconds === 0) return null;

  const labels = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7"];
  const breakdown: ZoneSummary[] = zoneSeconds.map((s, i) => ({
    zone: i + 1,
    label: labels[i] ?? `Z${i + 1}`,
    seconds: Math.round(s),
    pct: Math.round((s / totalSeconds) * 1000) / 10,
  }));

  // Seiler 3-zone model: low = below LT1 (Z1-Z2), mid = LT1-LT2 (Z3 tempo + Z4 threshold), high = above LT2 (Z5+).
  // Valid for Coggan 7 power zones and Friel 7 HR zones (Z5a starts at LTHR).
  const lowIntensity = zoneSeconds[0] + zoneSeconds[1];
  const midIntensity = zoneSeconds[2] + zoneSeconds[3];
  const highIntensity = zoneSeconds.slice(4).reduce((a, b) => a + b, 0);

  const lowPct = Math.round((lowIntensity / totalSeconds) * 1000) / 10;
  const midPct = Math.round((midIntensity / totalSeconds) * 1000) / 10;
  const highPct = Math.round((highIntensity / totalSeconds) * 1000) / 10;

  // Polarization Index (Treff et al. 2019): PI = log10((f1 / f2) · f3 · 100), fractions of time;
  // f2 = 0 is replaced by 0.01, PI is undefined without high-intensity time. PI > 2.00 = polarized.
  const f1 = lowIntensity / totalSeconds;
  const f2 = Math.max(midIntensity / totalSeconds, 0.01);
  const f3 = highIntensity / totalSeconds;
  const polarizationIndex = f3 > 0 ? Math.round(Math.log10((f1 / f2) * f3 * 100) * 100) / 100 : null;

  // Distribution type (Treff 2019 / Stöggl & Sperlich 2015)
  let model: string;
  if (f1 > f3 && f3 > f2 && polarizationIndex != null && polarizationIndex > 2) {
    model = "Polarized";
  } else if (f1 > f2 && f2 > f3) {
    model = "Pyramidal";
  } else if (f2 >= f1 && f2 >= f3) {
    model = "Threshold";
  } else if (f3 >= f1 && f3 >= f2) {
    model = "High-intensity (HIIT)";
  } else {
    model = "Base / low-intensity dominant";
  }

  // Weekly average
  const weeks = Math.max(1, days / 7);
  const weeklyHoursAvg = Math.round((totalSeconds / weeks / 3600) * 10) / 10;

  return {
    period: { oldest, newest, days, weeks: Math.round(weeks * 10) / 10 },
    sport,
    activities_analyzed: matching.length,
    activities_with_zones: activitiesWithZones,
    zone_metric: usedMetric,
    total_hours: Math.round((totalSeconds / 3600) * 10) / 10,
    weekly_hours_avg: weeklyHoursAvg,
    zone_breakdown: breakdown.filter((z) => z.seconds > 0),
    intensity_distribution: {
      low_z1_z2: { pct: lowPct, hours: Math.round((lowIntensity / 3600) * 10) / 10, target: "~75-80%" },
      mid_z3_z4: {
        pct: midPct,
        hours: Math.round((midIntensity / 3600) * 10) / 10,
        target: "<10% polarized, more in pyramidal",
      },
      high_z5_plus: { pct: highPct, hours: Math.round((highIntensity / 3600) * 10) / 10, target: "~10-20%" },
    },
    polarization_index: polarizationIndex,
    distribution_model: model,
    recommendations: generateRecommendations(lowPct, midPct, highPct, weeklyHoursAvg),
    reference_ranges: {
      polarization_index: [
        { range: "> 2.00", label: "Polarized", meaning: "Z1 > Z3 > Z2 with enough high-intensity time" },
        { range: "≤ 2.00", label: "Not polarized", meaning: "Pyramidal, threshold or base distribution" },
        { range: "null", label: "Not computable", meaning: "No time above LT2 in the period" },
      ],
      zones_3_model:
        "Seiler: Z1 < LT1/VT1, Z2 between LT1 and LT2, Z3 > LT2. Mapped from 7 zones as Z1-2 | Z3-4 | Z5+.",
      note: "Pyramidal distributions are also effective, especially for amateurs and in base phases (Casado et al. 2022). PI from Treff et al. (2019).",
    },
  };
}

function generateRecommendations(lowPct: number, midPct: number, highPct: number, weeklyHrs: number): string[] {
  const recs: string[] = [];

  if (midPct > 20) {
    recs.push(
      `${midPct}% of time between LT1 and LT2 (tempo/threshold). Fine for a pyramidal block; for a polarized block move part of it to easy Z1-Z2 or to Z5+ intervals.`,
    );
  }
  if (lowPct < 70) {
    recs.push(`Only ${lowPct}% in Z1-Z2. Aim for 75-80%+ easy volume. Keep easy days truly easy.`);
  }
  if (highPct > 25) {
    recs.push(
      `High intensity is ${highPct}% — risk of accumulated fatigue. Consider reducing to ~15-20% unless in a specific build phase.`,
    );
  }
  if (highPct < 10 && weeklyHrs > 5) {
    recs.push(
      `High intensity is only ${highPct}% — may benefit from adding 1-2 structured interval sessions per week.`,
    );
  }
  if (lowPct >= 75 && midPct <= 10 && highPct >= 10 && highPct <= 25) {
    recs.push("Distribution is well-polarized — maintain current approach.");
  }

  return recs;
}
