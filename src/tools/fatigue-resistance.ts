import * as icu from "../intervals.js";
import type { PowerCurve } from "../types.js";

const KEY_DURATIONS = [
  { secs: 5, label: "5s (neuromuscular)" },
  { secs: 15, label: "15s (anaerobic)" },
  { secs: 60, label: "1min (anaerobic capacity)" },
  { secs: 300, label: "5min (VO₂max)" },
  { secs: 600, label: "10min (threshold)" },
  { secs: 1200, label: "20min (FTP)" },
  { secs: 3600, label: "60min (endurance)" },
];

function extractCurve(curveSet: { list?: PowerCurve[] }): PowerCurve | null {
  const list = curveSet?.list ?? (Array.isArray(curveSet) ? curveSet : [curveSet]);
  for (const c of list as PowerCurve[]) {
    if (c?.secs?.length && (c.values?.length || c.watts?.length)) return c;
  }
  return null;
}

function interpolate(secs: number[], values: number[], target: number): number | null {
  // Find exact or closest
  for (let i = 0; i < secs.length; i++) {
    if (secs[i] === target) return values[i];
  }
  // Find bracketing values for interpolation
  for (let i = 0; i < secs.length - 1; i++) {
    if (secs[i] < target && secs[i + 1] > target) {
      const ratio = (target - secs[i]) / (secs[i + 1] - secs[i]);
      return Math.round(values[i] + ratio * (values[i + 1] - values[i]));
    }
  }
  return null;
}

export async function computeFatigueResistance(sport?: string, curve_type?: string) {
  const sportType = sport ?? "Ride";
  const curveType = curve_type ?? "1y";

  // Fetch fresh and fatigued curves in parallel
  const [freshData, fatiguedData, settings, athlete] = await Promise.all([
    icu.getPowerCurves(sportType, [curveType]),
    icu.getPowerCurves(sportType, [curveType], "kj0"),
    icu.getSportSettings(),
    icu.getAthlete(),
  ]);

  const fresh = extractCurve(freshData);
  const fatigued = extractCurve(fatiguedData);

  if (!fresh?.secs || (!fresh.values && !fresh.watts)) return null;

  const freshSecs = fresh.secs;
  const freshWatts = fresh.values ?? fresh.watts ?? [];

  const ssArr = Array.isArray(settings) ? settings : [settings];
  const ss = ssArr.find((s) => s.types?.includes(sportType)) ?? ssArr[0];
  const mass = athlete?.weight ?? 75;
  const ftp = ss?.ftp ?? 250;

  // Build comparison at key durations
  const comparison: {
    duration: string;
    secs: number;
    fresh_watts: number | null;
    fatigued_watts: number | null;
    delta_watts: number | null;
    delta_percent: number | null;
    fresh_wkg: number | null;
  }[] = [];

  const fatiguedSecs = fatigued?.secs ?? [];
  const fatiguedWatts = fatigued?.values ?? fatigued?.watts ?? [];

  for (const { secs, label } of KEY_DURATIONS) {
    const fw = interpolate(freshSecs, freshWatts, secs);
    const fatW = fatiguedSecs.length > 0 ? interpolate(fatiguedSecs, fatiguedWatts, secs) : null;

    comparison.push({
      duration: label,
      secs,
      fresh_watts: fw,
      fatigued_watts: fatW,
      delta_watts: fw != null && fatW != null ? fatW - fw : null,
      delta_percent: fw != null && fatW != null && fw > 0 ? Math.round(((fatW - fw) / fw) * 10000) / 100 : null,
      fresh_wkg: fw != null ? Math.round((fw / mass) * 100) / 100 : null,
    });
  }

  // Calculate Fatigue Resistance Score: average % retention across key durations
  const validDeltas = comparison.filter((c) => c.delta_percent != null).map((c) => c.delta_percent!);
  const avgDrop = validDeltas.length > 0 ? validDeltas.reduce((s, v) => s + v, 0) / validDeltas.length : null;
  const frs = avgDrop != null ? Math.round((100 + avgDrop) * 100) / 100 : null;

  // FTP-specific fatigue resistance
  const ftp5min = interpolate(freshSecs, freshWatts, 300);
  const ftpFatigued5min = fatiguedSecs.length > 0 ? interpolate(fatiguedSecs, fatiguedWatts, 300) : null;
  const vo2maxRetention = ftp5min && ftpFatigued5min ? Math.round((ftpFatigued5min / ftp5min) * 10000) / 100 : null;

  return {
    sport: sportType,
    curve: curveType,
    weight_kg: mass,
    ftp,
    fatigued_curve_available: fatiguedSecs.length > 0,
    comparison,
    fatigue_resistance_score: frs,
    vo2max_retention_percent: vo2maxRetention,
    avg_power_drop_percent: avgDrop != null ? Math.round(avgDrop * 100) / 100 : null,
    reference_ranges: {
      fatigue_resistance_score: [
        { range: "≥ 95%", label: "Excellent", meaning: "Minimal power loss under fatigue — strong endurance" },
        { range: "90–95%", label: "Good", meaning: "Acceptable fade, well-adapted musculature" },
        { range: "85–90%", label: "Moderate", meaning: "Room to improve fatigue resistance" },
        { range: "< 85%", label: "Low", meaning: "Significant power loss under fatigue — address endurance base" },
      ],
      note: "Fatigued curves use intervals.icu predefined kJ thresholds. A delta close to 0% = power is well-maintained after initial work. Based on Maunder et al. (2021) durability framework.",
    },
  };
}
