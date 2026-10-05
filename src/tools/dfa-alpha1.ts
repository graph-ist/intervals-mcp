import * as icu from "../intervals.js";
import { getStream } from "./utils.js";

/**
 * DFA α1 threshold detection.
 *
 * Source of α1, in order of preference:
 * 1. RR intervals (`hrv` stream, beat-to-beat ms) → α1 computed here (Peng 1995, scales 4–16 beats,
 *    2-min windows, artifact filtering as in Rogers et al. 2021).
 * 2. A precomputed `dfa_a1` stream, if intervals.icu provides one.
 *
 * Thresholds: linear regression of HR (and power) on α1, solved at α1 = 0.75 (HRVT1 ≈ VT1)
 * and α1 = 0.50 (HRVT2 ≈ VT2), as in Rogers et al. (2021, 2022). No extrapolation outside the
 * observed α1 range.
 */

const WINDOW_SECS = 120;
const STEP_SECS = 15;
const MIN_BEATS = 100;
const MAX_ARTIFACT_PCT = 5;
const SCALES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** DFA short-term scaling exponent α1 of an RR series (ms). Returns null if too short. */
export function dfaAlpha1(rr: number[]): number | null {
  const n = rr.length;
  if (n < SCALES[SCALES.length - 1] * 4) return null;
  const mean = rr.reduce((s, v) => s + v, 0) / n;
  const y = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += rr[i] - mean;
    y[i] = acc;
  }

  const logN: number[] = [];
  const logF: number[] = [];
  for (const s of SCALES) {
    const boxes = Math.floor(n / s);
    if (boxes < 2) continue;
    // Least-squares line over x = 0..s-1 for each box; x stats are the same for every box
    const xMean = (s - 1) / 2;
    let sxx = 0;
    for (let x = 0; x < s; x++) sxx += (x - xMean) ** 2;
    let sumSq = 0;
    for (let b = 0; b < boxes; b++) {
      const off = b * s;
      let yMean = 0;
      for (let x = 0; x < s; x++) yMean += y[off + x];
      yMean /= s;
      let sxy = 0;
      for (let x = 0; x < s; x++) sxy += (x - xMean) * (y[off + x] - yMean);
      const slope = sxy / sxx;
      for (let x = 0; x < s; x++) {
        const fit = yMean + slope * (x - xMean);
        sumSq += (y[off + x] - fit) ** 2;
      }
    }
    const F = Math.sqrt(sumSq / (boxes * s));
    if (F > 0) {
      logN.push(Math.log10(s));
      logF.push(Math.log10(F));
    }
  }
  if (logN.length < 3) return null;
  return linreg(logN, logF).slope;
}

function linreg(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept: my - slope * mx, r2 };
}

/** Removes physiologically impossible beats and beats deviating >20% from the local median. */
export function cleanRR(beats: { t: number; rr: number }[]): { clean: { t: number; rr: number }[]; artifacts: number } {
  const clean: { t: number; rr: number }[] = [];
  let artifacts = 0;
  for (const b of beats) {
    if (b.rr < 250 || b.rr > 2000) {
      artifacts++;
      continue;
    }
    const recent = clean.slice(-5).map((c) => c.rr);
    if (recent.length >= 3) {
      const sorted = [...recent].sort((a, c) => a - c);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (Math.abs(b.rr - median) / median > 0.2) {
        artifacts++;
        continue;
      }
    }
    clean.push(b);
  }
  return { clean, artifacts };
}

type Window = { t: number; dfa: number; power: number | null; hr: number | null; artifact_pct?: number };

function windowsFromRR(
  rrStream: unknown[],
  timeArr: number[],
  powerArr: number[],
  hrArr: number[],
): { windows: Window[]; artifactPct: number } {
  const beats: { t: number; rr: number }[] = [];
  for (let i = 0; i < rrStream.length; i++) {
    const v = rrStream[i];
    const t = timeArr[i] ?? i;
    // The hrv stream holds, per sample, the RR intervals (ms) of the beats in that second
    if (Array.isArray(v)) {
      for (const rr of v) if (typeof rr === "number") beats.push({ t, rr });
    } else if (typeof v === "number") {
      beats.push({ t, rr: v });
    }
  }
  const { clean, artifacts } = cleanRR(beats);
  const artifactPct = beats.length ? (artifacts / beats.length) * 100 : 100;
  if (clean.length < MIN_BEATS) return { windows: [], artifactPct };

  const windows: Window[] = [];
  const tEnd = clean[clean.length - 1].t;
  let lo = 0;
  let rawLo = 0;
  for (let t0 = clean[0].t; t0 + WINDOW_SECS <= tEnd; t0 += STEP_SECS) {
    while (lo < clean.length && clean[lo].t < t0) lo++;
    let hi = lo;
    while (hi < clean.length && clean[hi].t < t0 + WINDOW_SECS) hi++;
    while (rawLo < beats.length && beats[rawLo].t < t0) rawLo++;
    let rawHi = rawLo;
    while (rawHi < beats.length && beats[rawHi].t < t0 + WINDOW_SECS) rawHi++;
    const raw = rawHi - rawLo;
    const winArtifactPct = raw > 0 ? ((raw - (hi - lo)) / raw) * 100 : 100;
    if (hi - lo < MIN_BEATS || winArtifactPct > MAX_ARTIFACT_PCT) continue;
    const dfa = dfaAlpha1(clean.slice(lo, hi).map((b) => b.rr));
    if (dfa == null || !Number.isFinite(dfa)) continue;
    windows.push({
      t: t0 + WINDOW_SECS / 2,
      dfa,
      power: avgInRange(timeArr, powerArr, t0, t0 + WINDOW_SECS),
      hr: avgInRange(timeArr, hrArr, t0, t0 + WINDOW_SECS),
      artifact_pct: Math.round(winArtifactPct * 10) / 10,
    });
  }
  return { windows, artifactPct };
}

function avgInRange(timeArr: number[], values: number[], t0: number, t1: number): number | null {
  if (!values.length) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const t = timeArr[i] ?? i;
    if (t >= t0 && t < t1 && values[i] != null) {
      sum += values[i];
      n++;
    }
  }
  return n ? sum / n : null;
}

function windowsFromDfaStream(dfaArr: number[], timeArr: number[], powerArr: number[], hrArr: number[]): Window[] {
  const windows: Window[] = [];
  const valid = dfaArr.map((dfa, i) => ({ t: timeArr[i] ?? i, dfa })).filter((p) => p.dfa > 0 && p.dfa < 2.0);
  if (!valid.length) return windows;
  for (let t0 = valid[0].t; t0 + WINDOW_SECS <= valid[valid.length - 1].t; t0 += STEP_SECS) {
    const inWin = valid.filter((p) => p.t >= t0 && p.t < t0 + WINDOW_SECS);
    if (inWin.length < 10) continue;
    windows.push({
      t: t0 + WINDOW_SECS / 2,
      dfa: inWin.reduce((s, p) => s + p.dfa, 0) / inWin.length,
      power: avgInRange(timeArr, powerArr, t0, t0 + WINDOW_SECS),
      hr: avgInRange(timeArr, hrArr, t0, t0 + WINDOW_SECS),
    });
  }
  return windows;
}

interface Threshold {
  name: string;
  dfa_target: number;
  hr: number | null;
  watts: number | null;
  r2_hr: number | null;
  confidence: "high" | "medium" | "low";
}

function solveAt(windows: Window[], key: "hr" | "power", target: number) {
  const pts = windows.filter((w) => w[key] != null && w[key]! > 0 && w.dfa >= 0.3 && w.dfa <= 1.25);
  if (pts.length < 8) return null;
  // Regress the metric on α1 (Rogers 2021: HR vs α1), then read it at the target α1
  const fit = linreg(
    pts.map((p) => p.dfa),
    pts.map((p) => p[key]!),
  );
  if (fit.slope >= 0) return null; // intensity must rise as α1 falls
  return { value: fit.intercept + fit.slope * target, r2: fit.r2 };
}

function findThreshold(windows: Window[], target: number): Threshold | { message: string } {
  const minDfa = Math.min(...windows.map((w) => w.dfa));
  const maxDfa = Math.max(...windows.map((w) => w.dfa));
  if (minDfa > target || maxDfa < target) {
    return {
      message: `α1 = ${target} not reached in this activity (observed ${minDfa.toFixed(2)}–${maxDfa.toFixed(2)}). Use a ramp test that goes above threshold.`,
    };
  }
  const hr = solveAt(windows, "hr", target);
  const pw = solveAt(windows, "power", target);
  if (!hr && !pw) return { message: "No consistent relationship between α1 and HR/power in this activity." };
  const r2 = hr?.r2 ?? pw?.r2 ?? 0;
  return {
    name: target === 0.75 ? "HRVT1 ≈ aerobic threshold (VT1)" : "HRVT2 ≈ anaerobic threshold (VT2)",
    dfa_target: target,
    hr: hr ? Math.round(hr.value) : null,
    watts: pw ? Math.round(pw.value) : null,
    r2_hr: hr ? Math.round(hr.r2 * 100) / 100 : null,
    confidence: r2 >= 0.7 ? "high" : r2 >= 0.4 ? "medium" : "low",
  };
}

export async function computeDfaAnalysis(activityId: string) {
  const [streams, activity] = await Promise.all([
    icu.getActivityStreams(activityId, ["time", "watts", "heartrate", "hrv", "dfa_a1"]),
    icu.getActivity(activityId),
  ]);

  const timeArr = getStream(streams, "time");
  const powerArr = getStream(streams, "watts");
  const hrArr = getStream(streams, "heartrate");
  const rrStream = getStream(streams, "hrv") as unknown[];
  const dfaArr = getStream(streams, "dfa_a1").filter((v) => v != null);

  let windows: Window[] = [];
  let source: "rr_intervals" | "dfa_a1_stream" | null = null;
  let artifactPct: number | null = null;

  if (rrStream.some((v) => v != null)) {
    const r = windowsFromRR(rrStream, timeArr, powerArr, hrArr);
    windows = r.windows;
    artifactPct = Math.round(r.artifactPct * 10) / 10;
    source = "rr_intervals";
  }
  if (windows.length === 0 && dfaArr.length > 0) {
    windows = windowsFromDfaStream(getStream(streams, "dfa_a1"), timeArr, powerArr, hrArr);
    source = "dfa_a1_stream";
  }

  if (windows.length === 0) {
    return {
      available: false,
      activity_id: activityId,
      activity_type: activity?.type,
      ...(artifactPct != null && { rr_artifact_pct: artifactPct }),
      message:
        artifactPct != null && artifactPct > MAX_ARTIFACT_PCT
          ? `RR data present but too noisy (${artifactPct}% artifacts, max ${MAX_ARTIFACT_PCT}% per window). Check strap contact/moisture.`
          : "No beat-to-beat RR data for this activity. DFA α1 needs RR intervals recorded by a chest strap and saved in the FIT file.",
      device_requirements: {
        compatible: [
          "Chest strap with RR output (Polar H10, Garmin HRM-Pro/HRM-Dual, Wahoo TICKR) paired to a head unit that records RR",
          "Garmin watches/Edge: enable 'Log HRV' (Record HRV) in settings — intervals.icu then shows the 'hrv' stream",
          "Polar H10 + apps that export RR in the FIT file",
        ],
        not_compatible: ["Optical wrist/arm HR (RR timing too imprecise during exercise)", "Apple Watch workouts"],
      },
    };
  }

  const aet = findThreshold(windows, 0.75);
  const ant = findThreshold(windows, 0.5);

  const step = Math.max(1, Math.floor(windows.length / 120));
  const chart = windows
    .filter((_, i) => i % step === 0)
    .map((w) => ({
      time_secs: Math.round(w.t),
      dfa_a1: Math.round(w.dfa * 1000) / 1000,
      hr: w.hr != null ? Math.round(w.hr) : null,
      watts: w.power != null ? Math.round(w.power) : null,
    }));

  const bothHr = "hr" in aet && "hr" in ant && aet.hr != null && ant.hr != null;
  const bothW = "watts" in aet && "watts" in ant && aet.watts != null && ant.watts != null;
  const zones =
    bothHr || bothW
      ? {
          zone1_below_hrvt1: {
            max_hr: bothHr ? (aet as Threshold).hr : null,
            max_watts: bothW ? (aet as Threshold).watts : null,
          },
          zone2_between: {
            hr: bothHr ? `${(aet as Threshold).hr}-${(ant as Threshold).hr}` : null,
            watts: bothW ? `${(aet as Threshold).watts}-${(ant as Threshold).watts}` : null,
          },
          zone3_above_hrvt2: {
            min_hr: bothHr ? (ant as Threshold).hr : null,
            min_watts: bothW ? (ant as Threshold).watts : null,
          },
          note: "3-zone model (Seiler): Z1 < HRVT1, Z2 between thresholds, Z3 > HRVT2. Individual to this activity.",
        }
      : null;

  return {
    available: true,
    source,
    activity_id: activityId,
    activity_type: activity?.type,
    activity_name: activity?.name,
    quality: {
      windows: windows.length,
      window_secs: WINDOW_SECS,
      step_secs: STEP_SECS,
      ...(artifactPct != null && { rr_artifact_pct: artifactPct }),
      dfa_range: [
        Math.round(Math.min(...windows.map((w) => w.dfa)) * 100) / 100,
        Math.round(Math.max(...windows.map((w) => w.dfa)) * 100) / 100,
      ],
    },
    thresholds: { aerobic_threshold: aet, anaerobic_threshold: ant },
    dfa_zones: zones,
    chart_data: chart,
    reference_ranges: {
      dfa_a1_values: [
        { range: "> 1.0", label: "Low intensity", meaning: "Well below aerobic threshold, correlated dynamics" },
        { range: "0.75–1.0", label: "Below VT1", meaning: "Moderate, below aerobic threshold" },
        { range: "0.50–0.75", label: "Between VT1 and VT2", meaning: "Heavy domain (Zone 2 of 3-zone model)" },
        { range: "< 0.50", label: "Above VT2", meaning: "Severe domain" },
      ],
      confidence: "Based on r² of the HR–α1 regression: ≥ 0.7 high, 0.4–0.7 medium, < 0.4 low.",
      note: "Most reliable on a graded ramp test (Rogers et al. 2021). Steady or interval sessions often do not span both thresholds; artifacts > 5% per window are excluded.",
    },
  };
}
