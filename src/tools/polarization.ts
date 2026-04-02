import * as icu from "../intervals.js";

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
      a.type?.toLowerCase() === sport.toLowerCase() &&
      !a.name?.toLowerCase().includes("manual") &&
      ((a as Record<string, unknown>).moving_time as number) > 0,
  );

  if (matching.length === 0) {
    return null;
  }

  // Aggregate zone seconds from activities
  // intervals.icu stores zone seconds in fields like pace_zone_times, hr_zone_times, power_zone_times
  const zoneSeconds: number[] = [0, 0, 0, 0, 0, 0, 0]; // zones 1-7

  let usedMetric: "power" | "hr" | "pace" = "hr";
  let activitiesWithZones = 0;

  for (const act of matching) {
    const raw = act as Record<string, unknown>;
    // Prefer power zones for cycling, HR/pace for running
    let zones: number[] | null = null;

    const pzt = raw.power_zone_times as number[] | undefined;
    const hzt = raw.hr_zone_times as number[] | undefined;
    const pazt = raw.pace_zone_times as number[] | undefined;

    if (sport.toLowerCase() === "ride" && pzt?.length) {
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

  // Group into intensity buckets
  const lowIntensity = zoneSeconds[0] + zoneSeconds[1]; // Z1+Z2
  const midIntensity = zoneSeconds[2]; // Z3
  const highIntensity = zoneSeconds.slice(3).reduce((a, b) => a + b, 0); // Z4+

  const lowPct = Math.round((lowIntensity / totalSeconds) * 1000) / 10;
  const midPct = Math.round((midIntensity / totalSeconds) * 1000) / 10;
  const highPct = Math.round((highIntensity / totalSeconds) * 1000) / 10;

  // Polarization Index: (Z1+Z2) / max(Z3, 1) * log2(Z4+Z5+... + 1)
  // Higher = more polarized
  const pi =
    midIntensity > 0
      ? ((lowIntensity / midIntensity) * Math.log2(1 + (highIntensity / totalSeconds) * 100)) / 5
      : lowPct > 80
        ? 3.0
        : 0;

  const polarizationIndex = Math.round(pi * 100) / 100;

  // Determine distribution model
  let model: string;
  if (lowPct >= 75 && midPct <= 10 && highPct >= 10) {
    model = "Polarized (optimal for endurance)";
  } else if (lowPct >= 75 && midPct <= 15) {
    model = "Mostly Polarized";
  } else if (midPct >= 30) {
    model = "Threshold-dominant (risk of 'black hole' training)";
  } else if (lowPct < 60) {
    model = "Pyramidal / High-Volume-High-Intensity";
  } else {
    model = "Mixed";
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
      low_z1_z2: { pct: lowPct, hours: Math.round((lowIntensity / 3600) * 10) / 10, target: "~80%" },
      mid_z3: { pct: midPct, hours: Math.round((midIntensity / 3600) * 10) / 10, target: "<5-10%" },
      high_z4_plus: { pct: highPct, hours: Math.round((highIntensity / 3600) * 10) / 10, target: "~15-20%" },
    },
    polarization_index: polarizationIndex,
    distribution_model: model,
    recommendations: generateRecommendations(lowPct, midPct, highPct, weeklyHoursAvg),
    reference_ranges: {
      polarization_index: [
        { range: "> 2.0", label: "Well Polarized" },
        { range: "1.0–2.0", label: "Moderately Polarized" },
        { range: "< 1.0", label: "Not Polarized / Threshold-heavy" },
      ],
      optimal_80_20: "Seiler (2010): ~80% Z1-Z2, ~20% Z4-Z5, minimal Z3",
      note: "Pyramidal distribution (more Z3 than Z4+) also effective for well-trained athletes (Stöggl & Sperlich, 2015).",
    },
  };
}

function generateRecommendations(lowPct: number, midPct: number, highPct: number, weeklyHrs: number): string[] {
  const recs: string[] = [];

  if (midPct > 20) {
    recs.push(
      `Z3 is ${midPct}% of training — reduce tempo/sweetspot volume to avoid 'black hole' intensity. Replace with easy Z2 or hard Z4+ intervals.`,
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
