import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the intervals module before importing tools
vi.mock("../../intervals.js", () => ({
  getWellness: vi.fn(),
  getActivityStreams: vi.fn(),
  getActivity: vi.fn(),
  getPowerCurves: vi.fn(),
  getSportSettings: vi.fn(),
  getAthlete: vi.fn(),
}));

import * as icu from "../../intervals.js";
import { computeDecoupling } from "../decoupling.js";
import { computeDfrc } from "../dfrc.js";
import { computeMetabolicProfile } from "../metabolic.js";
import { computeRecoveryIndex } from "../recovery.js";
import { computeTrainingLoadRisk } from "../training-load.js";

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

// ─── Decoupling ──────────────────────────────────────────────

describe("computeDecoupling", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null when streams are empty", async () => {
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time: [], watts: [], heartrate: [] });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Test", type: "Ride" });
    expect(await computeDecoupling("a1", 10, 5)).toBeNull();
  });

  it("returns null when fewer than 60 valid points", async () => {
    const time = Array.from({ length: 30 }, (_, i) => i * 60); // 30 points
    const watts = time.map(() => 200);
    const hr = time.map(() => 140);
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts, heartrate: hr });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Test", type: "Ride" });
    expect(await computeDecoupling("a1", 0, 0)).toBeNull();
  });

  it("calculates decoupling for steady data", async () => {
    // 120 points at 1-sec resolution, constant power and HR → ~0% decoupling
    const n = 120;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map(() => 200);
    const hr = time.map(() => 140);
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts, heartrate: hr });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Steady", type: "Ride" });

    const result = await computeDecoupling("a1", 0, 0);
    expect(result).not.toBeNull();
    expect(result!.decoupling_pct).toBeCloseTo(0, 1);
    expect(result!.assessment).toContain("Excellent");
  });

  it("detects positive drift when HR rises", async () => {
    const n = 200;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map(() => 200);
    // HR drifts from 130 to 170
    const hr = time.map((_, i) => 130 + (i / n) * 40);
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts, heartrate: hr });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Drift", type: "Ride" });

    const result = await computeDecoupling("a1", 0, 0);
    expect(result).not.toBeNull();
    expect(result!.decoupling_pct).toBeGreaterThan(5);
  });
});

// ─── dFRC (W'bal) ────────────────────────────────────────────

describe("computeDfrc", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null when no power data", async () => {
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time: [], watts: [] });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Test", type: "Ride" });
    vi.mocked(icu.getPowerCurves).mockResolvedValue({ list: [] });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 250, w_prime: 20000 });
    expect(await computeDfrc("a1")).toBeNull();
  });

  it("W'bal stays full when riding below FTP", async () => {
    const n = 600;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map(() => 180); // well below FTP=250
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Easy", type: "Ride" });
    vi.mocked(icu.getPowerCurves).mockResolvedValue({ list: [] });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 250, w_prime: 20000 });

    const result = await computeDfrc("a1", undefined, undefined, 250, 20000);
    expect(result).not.toBeNull();
    expect(result!.summary.min_dfrc_pct).toBeGreaterThanOrEqual(99);
  });

  it("W'bal depletes when riding above FTP", async () => {
    const n = 300;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map(() => 350); // 100w above FTP for 5 min
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Hard", type: "Ride" });
    vi.mocked(icu.getPowerCurves).mockResolvedValue({ list: [] });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 250, w_prime: 20000 });

    const result = await computeDfrc("a1", undefined, undefined, 250, 20000);
    expect(result).not.toBeNull();
    // 100w * 300s = 30000J above FTP, W' = 20000J → should go negative
    expect(result!.summary.min_dfrc_joules).toBeLessThan(0);
    expect(result!.summary.time_below_zero_seconds).toBeGreaterThan(0);
  });
});

// ─── Recovery Index ──────────────────────────────────────────

describe("computeRecoveryIndex", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null with insufficient data", async () => {
    vi.mocked(icu.getWellness).mockResolvedValue([]);
    expect(await computeRecoveryIndex(30, daysAgo, today)).toBeNull();
  });

  it("handles division-by-zero gracefully (no recovery_index entries)", async () => {
    // 10 days with no device metrics → no recovery_index computed → avg should not NaN
    const data = Array.from({ length: 10 }, (_, i) => ({
      id: daysAgo(10 - i),
      ctl: 50,
      atl: 60,
      rampRate: 1,
    }));
    vi.mocked(icu.getWellness).mockResolvedValue(data);

    const result = await computeRecoveryIndex(10, daysAgo, today);
    // With no device metrics, there may not be enough metric entries → could still return but avg should be 0 not NaN
    if (result) {
      expect(Number.isFinite(result.avg_recovery_index)).toBe(true);
    }
  });

  it("computes recovery index for healthy data", async () => {
    // 45 days of wellness data with HRV, resting HR, sleep
    const data = Array.from({ length: 45 }, (_, i) => ({
      id: daysAgo(45 - i),
      hrv: 45 + Math.sin(i) * 5,
      restingHR: 52 + Math.cos(i) * 3,
      sleepSecs: 7 * 3600 + Math.sin(i) * 1800,
      sleepScore: 80 + Math.sin(i) * 10,
      baevskySI: 80 + Math.cos(i) * 20,
      spO2: 97 + Math.sin(i),
      ctl: 50 + i * 0.2,
      atl: 55 + i * 0.3,
      rampRate: 0.5,
    }));
    vi.mocked(icu.getWellness).mockResolvedValue(data);

    const result = await computeRecoveryIndex(30, daysAgo, today);
    expect(result).not.toBeNull();
    expect(result!.today).toBeDefined();
    expect(result!.today.recovery_index).toBeGreaterThanOrEqual(0);
    expect(result!.today.recovery_index).toBeLessThanOrEqual(100);
    expect(result!.period_days).toBeGreaterThan(0);
    expect(Number.isFinite(result!.avg_recovery_index)).toBe(true);
  });
});

// ─── Training Load Risk ─────────────────────────────────────

describe("computeTrainingLoadRisk", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null with insufficient data", async () => {
    vi.mocked(icu.getWellness).mockResolvedValue([{ id: "2024-01-01", ctlLoad: 50, ctl: 50, atl: 60 }]);
    expect(await computeTrainingLoadRisk(42, daysAgo, today)).toBeNull();
  });

  it("computes monotony and ACWR", async () => {
    // 21 days of training data
    const data = Array.from({ length: 21 }, (_, i) => ({
      id: daysAgo(21 - i),
      ctlLoad: 60 + (i % 3 === 0 ? 40 : 0), // varied load
      ctl: 50 + i * 0.5,
      atl: 55 + i * 0.8,
    }));
    vi.mocked(icu.getWellness).mockResolvedValue(data);

    const result = await computeTrainingLoadRisk(21, daysAgo, today);
    expect(result).not.toBeNull();
    expect(result!.weekly_history.length).toBeGreaterThan(0);
    const lastWeek = result!.weekly_history[result!.weekly_history.length - 1];
    expect(lastWeek.monotony).toBeGreaterThan(0);
    expect(lastWeek.strain).toBeGreaterThan(0);
    expect(["low", "moderate", "high"]).toContain(lastWeek.monotony_risk);
  });

  it("flags ACWR spike", async () => {
    // CTL low, ATL high → spike
    const data = Array.from({ length: 14 }, (_, i) => ({
      id: daysAgo(14 - i),
      ctlLoad: i > 10 ? 200 : 50,
      ctl: 30,
      atl: i > 10 ? 60 : 30,
    }));
    vi.mocked(icu.getWellness).mockResolvedValue(data);

    const result = await computeTrainingLoadRisk(14, daysAgo, today);
    expect(result).not.toBeNull();
    const acwrEntries = result!.acwr_history.filter((a: any) => a.acwr > 1.5);
    expect(acwrEntries.length).toBeGreaterThan(0);
  });
});

// ─── Metabolic Profile ───────────────────────────────────────

describe("computeMetabolicProfile", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null with no curve data", async () => {
    vi.mocked(icu.getPowerCurves).mockResolvedValue({ list: [] });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 250 });
    vi.mocked(icu.getAthlete).mockResolvedValue({ weight: 75 });
    expect(await computeMetabolicProfile()).toBeNull();
  });

  it("computes VLaMax, Coggan, FRI from a power curve", async () => {
    // Realistic power-duration curve
    const secs = [1, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600];
    const watts = [1100, 950, 750, 650, 580, 500, 400, 340, 310, 290, 270, 258, 252, 245];
    vi.mocked(icu.getPowerCurves).mockResolvedValue({
      list: [{ secs, values: watts, powerModels: [{ type: "FFT_CURVES", ftp: 260, wPrime: 20000, pMax: 1100 }] }],
    });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 260, types: ["Ride"] });
    vi.mocked(icu.getAthlete).mockResolvedValue({ weight: 72 });

    const result = await computeMetabolicProfile("Ride", "1y");
    expect(result).not.toBeNull();

    // Key metrics
    expect(result!.key_metrics.ftp_watts).toBe(260);
    expect(result!.key_metrics.pmax_watts).toBe(1100);
    expect(result!.key_metrics.map_5min_watts).toBe(290);
    expect(result!.key_metrics.w_per_kg_ftp).toBeCloseTo(260 / 72, 1);

    // VLaMax
    expect(result!.vlamax.value_mmol_L_s).toBeGreaterThan(0);
    expect(result!.vlamax.classification).toBeDefined();

    // Coggan
    expect(result!.coggan_power_profile["5s"]).toBeDefined();
    expect(result!.coggan_power_profile.ftp).toBeDefined();
    expect(result!.coggan_power_profile.ftp.w_per_kg).toBeCloseTo(260 / 72, 1);

    // FRI
    expect(result!.fatigue_resistance.fri_pct).toBeCloseTo((260 / 290) * 100, 0);

    // Energy breakdown
    expect(result!.energy_system_breakdown.length).toBeGreaterThan(0);
    const short = result!.energy_system_breakdown.find((e) => e.secs === 5);
    const long = result!.energy_system_breakdown.find((e) => e.secs === 3600);
    if (short && long) {
      expect(short.pcr_pct).toBeGreaterThan(long.pcr_pct); // PCr dominates short
      expect(long.aerobic_pct).toBeGreaterThan(short.aerobic_pct); // aerobic dominates long
    }
  });
});
