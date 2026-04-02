import * as icu from "../intervals.js";
import { extractStream } from "./utils.js";

/**
 * DFA α1 (Detrended Fluctuation Analysis alpha1) threshold detection.
 *
 * DFA α1 measures the fractal correlation properties of beat-to-beat HR intervals.
 * - α1 ≈ 1.0 at rest = correlated, healthy HRV
 * - α1 = 0.75 = first ventilatory/aerobic threshold (VT1/AeT)
 * - α1 = 0.50 = second ventilatory/anaerobic threshold (VT2/AnT)
 *
 * Requires a device that records DFA α1 as a stream (e.g. Garmin with FirstBeat,
 * Movesense + HRV Logger). Apple Watch does NOT provide DFA α1 during exercise.
 *
 * References:
 * - Rogers et al. (2021). J Sports Sci Med, 20(2), 303-311.
 * - Gronwald et al. (2019). Front Physiol, 10, 1202.
 */

interface DfaThreshold {
  name: string;
  dfa_target: number;
  watts: number | null;
  hr: number | null;
  time_secs: number | null;
  confidence: string;
}

export async function computeDfaAnalysis(activityId: string) {
  const [streams, activity] = await Promise.all([
    icu.getActivityStreams(activityId, ["time", "watts", "heartrate", "dfa_a1"]),
    icu.getActivity(activityId),
  ]);

  const timeArr = extractStream(streams?.time);
  const powerArr = extractStream(streams?.watts);
  const hrArr = extractStream(streams?.heartrate);
  const dfaArr = extractStream(streams?.dfa_a1);

  if (dfaArr.length === 0) {
    return {
      available: false,
      activity_id: activityId,
      activity_type: activity?.type,
      message:
        "No DFA α1 stream found for this activity. DFA α1 requires a device that records beat-to-beat RR intervals during exercise (e.g. Garmin with FirstBeat, Polar H10 + HRV Logger). Apple Watch does NOT provide this data.",
      device_requirements: {
        compatible: [
          "Garmin watches with FirstBeat (Fenix 7+, Forerunner 265+, Edge 1040+)",
          "Polar H10 chest strap + HRV Logger app",
          "Movesense sensor + compatible app",
          "Garmin HRM-Pro Plus chest strap + compatible Garmin watch",
        ],
        not_compatible: [
          "Apple Watch (any model) — measures rMSSD at rest only, no beat-to-beat DFA during exercise",
          "Optical-only wrist HR sensors",
          "Most consumer fitness trackers",
        ],
      },
    };
  }

  // Build valid data points (with rolling 2-min window for smoothing)
  const windowSecs = 120;
  const points: { t: number; power: number; hr: number; dfa: number }[] = [];

  for (let i = 0; i < dfaArr.length; i++) {
    const t = timeArr[i] ?? i;
    const p = powerArr[i] ?? 0;
    const hr = hrArr[i] ?? 0;
    const dfa = dfaArr[i];
    if (dfa > 0 && dfa < 2.0 && hr > 0) {
      points.push({ t, power: p, hr, dfa });
    }
  }

  if (points.length < 30) {
    return {
      available: false,
      activity_id: activityId,
      message: "Insufficient valid DFA α1 data points (need ≥ 30).",
    };
  }

  // Smooth DFA with rolling window
  const smoothed: { t: number; power: number; hr: number; dfa: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const windowStart = points[i].t - windowSecs;
    const windowPoints = points.filter((p) => p.t >= windowStart && p.t <= points[i].t);
    if (windowPoints.length >= 3) {
      const avgDfa = windowPoints.reduce((s, p) => s + p.dfa, 0) / windowPoints.length;
      const avgPower = windowPoints.reduce((s, p) => s + p.power, 0) / windowPoints.length;
      const avgHr = windowPoints.reduce((s, p) => s + p.hr, 0) / windowPoints.length;
      smoothed.push({
        t: points[i].t,
        power: Math.round(avgPower),
        hr: Math.round(avgHr),
        dfa: Math.round(avgDfa * 1000) / 1000,
      });
    }
  }

  // Find threshold crossings (DFA decreasing as intensity increases)
  function findThreshold(target: number): DfaThreshold | null {
    // Look for the point where smoothed DFA crosses the target from above
    for (let i = 1; i < smoothed.length; i++) {
      if (smoothed[i - 1].dfa >= target && smoothed[i].dfa < target) {
        // Interpolate
        const ratio = (smoothed[i - 1].dfa - target) / (smoothed[i - 1].dfa - smoothed[i].dfa);
        const watts = Math.round(smoothed[i - 1].power + ratio * (smoothed[i].power - smoothed[i - 1].power));
        const hr = Math.round(smoothed[i - 1].hr + ratio * (smoothed[i].hr - smoothed[i - 1].hr));
        const time = Math.round(smoothed[i - 1].t + ratio * (smoothed[i].t - smoothed[i - 1].t));

        // Confidence based on data density around crossing
        const nearby = smoothed.filter((p) => Math.abs(p.dfa - target) < 0.15).length;
        const confidence = nearby >= 10 ? "high" : nearby >= 5 ? "medium" : "low";

        return {
          name: target === 0.75 ? "Aerobic Threshold (VT1/AeT)" : "Anaerobic Threshold (VT2/AnT)",
          dfa_target: target,
          watts,
          hr,
          time_secs: time,
          confidence,
        };
      }
    }
    return null;
  }

  const aet = findThreshold(0.75);
  const ant = findThreshold(0.5);

  // DFA α1 time series (downsampled for chart)
  const step = Math.max(1, Math.floor(smoothed.length / 100));
  const chart = smoothed
    .filter((_, i) => i % step === 0)
    .map((p) => ({
      time_secs: p.t,
      watts: p.power,
      hr: p.hr,
      dfa_a1: p.dfa,
    }));

  // Zone recommendation based on thresholds
  const zones =
    aet && ant
      ? {
          zone1_recovery: { max_watts: Math.round(aet.watts! * 0.75), max_hr: Math.round(aet.hr! * 0.9) },
          zone2_aerobic: {
            watts: `${Math.round(aet.watts! * 0.75)}-${aet.watts}`,
            hr: `${Math.round(aet.hr! * 0.9)}-${aet.hr}`,
          },
          zone3_tempo: { watts: `${aet.watts}-${ant.watts}`, hr: `${aet.hr}-${ant.hr}` },
          zone4_threshold: {
            watts: `${ant.watts}-${Math.round(ant.watts! * 1.05)}`,
            hr: `${ant.hr}-${Math.round(ant.hr! * 1.03)}`,
          },
          note: "DFA-based zones are individualized from THIS activity's physiological responses, not population averages.",
        }
      : null;

  return {
    available: true,
    activity_id: activityId,
    activity_type: activity?.type,
    activity_name: activity?.name,
    data_points: smoothed.length,
    thresholds: {
      aerobic_threshold: aet ?? { message: "DFA α1 = 0.75 crossing not found — ramp test protocol recommended" },
      anaerobic_threshold: ant ?? { message: "DFA α1 = 0.50 crossing not found — ramp test protocol recommended" },
    },
    dfa_zones: zones,
    chart_data: chart,
    reference_ranges: {
      dfa_a1_values: [
        { range: "> 1.0", label: "Rest/Very Low Intensity", meaning: "Well below AeT, correlated cardiac dynamics" },
        { range: "0.75–1.0", label: "Low-Moderate Intensity", meaning: "Below aerobic threshold (Zone 1-2)" },
        { range: "0.50–0.75", label: "Moderate-High Intensity", meaning: "Between AeT and AnT (Zone 3)" },
        { range: "< 0.50", label: "High-Severe Intensity", meaning: "Above anaerobic threshold (Zone 4-5)" },
      ],
      note: "DFA α1 thresholds are most reliable from graded ramp tests (Rogers et al., 2021). Steady-state or interval activities may not show clean crossings.",
    },
  };
}
