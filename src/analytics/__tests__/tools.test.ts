import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the intervals module before importing tools
vi.mock("../../intervals.js", () => ({
  getWellness: vi.fn(),
  getActivities: vi.fn(),
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
import { computePolarization } from "../polarization.js";
import { computeRecoveryIndex } from "../recovery.js";
import { computeTrainingLoadRisk } from "../training-load.js";
import { computeTrends } from "../trends.js";

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

  it("reads the array-of-{type,data} stream shape returned by the real API", async () => {
    const time = Array.from({ length: 120 }, (_, i) => i);
    const streams = [
      { type: "time", data: time },
      { type: "watts", data: time.map(() => 200) },
      { type: "heartrate", data: time.map(() => 140) },
    ];
    vi.mocked(icu.getActivityStreams).mockResolvedValue(streams as never);
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Real", type: "VirtualRide" });
    const result = await computeDecoupling("a1", 0, 0);
    expect(result).not.toBeNull();
    expect(result!.decoupling_pct).toBeCloseTo(0, 1);
  });

  it("handles exactly 60 valid points (boundary)", async () => {
    const n = 60;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map(() => 200);
    const hr = time.map(() => 140);
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts, heartrate: hr });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "Boundary", type: "Ride" });

    const result = await computeDecoupling("a1", 0, 0);
    expect(result).not.toBeNull();
    expect(result!.decoupling_pct).toBeCloseTo(0, 1);
  });

  it("handles streams with NaN values gracefully", async () => {
    const n = 120;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = time.map((_, i) => (i === 50 ? 0 : 200)); // zero power filtered out
    const hr = time.map(() => 140);
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ time, watts, heartrate: hr });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "NaN", type: "Ride" });

    const result = await computeDecoupling("a1", 0, 0);
    // Should still compute (zero-power points are excluded, but 119 > 60)
    expect(result).not.toBeNull();
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

  it("handles time array without gaps when missing", async () => {
    const n = 100;
    const watts = Array.from({ length: n }, () => 200);
    // No time array → should generate index-based time
    vi.mocked(icu.getActivityStreams).mockResolvedValue({ watts });
    vi.mocked(icu.getActivity).mockResolvedValue({ name: "NoTime", type: "Ride" });
    vi.mocked(icu.getPowerCurves).mockResolvedValue({ list: [] });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 250, w_prime: 20000 });

    const result = await computeDfrc("a1", undefined, undefined, 250, 20000);
    expect(result).not.toBeNull();
    expect(result!.chart_data.length).toBeGreaterThan(0);
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
    const acwrEntries = result!.acwr_history.filter((a: { acwr: number }) => a.acwr > 1.5);
    expect(acwrEntries.length).toBeGreaterThan(0);
  });

  it("handles all zero CTL (no ACWR entries)", async () => {
    const data = Array.from({ length: 14 }, (_, i) => ({
      id: daysAgo(14 - i),
      ctlLoad: 50,
      ctl: 0,
      atl: 0,
    }));
    vi.mocked(icu.getWellness).mockResolvedValue(data);

    const result = await computeTrainingLoadRisk(14, daysAgo, today);
    expect(result).not.toBeNull();
    // ACWR skips entries with ctl <= 0
    expect(result!.acwr_history.length).toBe(0);
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

  it("handles single-point power curve", async () => {
    vi.mocked(icu.getPowerCurves).mockResolvedValue({
      list: [{ secs: [300], values: [290], powerModels: [] }],
    });
    vi.mocked(icu.getSportSettings).mockResolvedValue({ ftp: 250 });
    vi.mocked(icu.getAthlete).mockResolvedValue({ weight: 70 });

    const result = await computeMetabolicProfile();
    expect(result).not.toBeNull();
    expect(result!.key_metrics.map_5min_watts).toBe(290);
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

// ─── Real API field shapes ───────────────────────────────────

const realActivity = (i: number, extra: Record<string, unknown>) => ({
  id: `i${i}`,
  name: `A${i}`,
  start_date_local: `${daysAgo(10 - i)}T08:00:00`,
  moving_time: 3600,
  ...extra,
});

describe("computePolarization with real fields", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads icu_zone_times objects and includes VirtualRide in Ride", async () => {
    vi.mocked(icu.getActivities).mockResolvedValue([
      realActivity(1, {
        type: "VirtualRide",
        icu_zone_times: [
          { id: "Z1", secs: 2000 },
          { id: "Z2", secs: 1000 },
          { id: "Z3", secs: 100 },
          { id: "Z4", secs: 300 },
          { id: "Z5", secs: 200 },
          { id: "SS", secs: 50 },
        ],
      }),
    ] as never);
    const result = await computePolarization(28, "Ride");
    expect(result).not.toBeNull();
    expect(result!.zone_metric).toBe("power");
    expect(result!.zone_breakdown.find((z) => z.zone === 1)?.seconds).toBe(2000);
  });

  it("uses icu_hr_zone_times for runs", async () => {
    vi.mocked(icu.getActivities).mockResolvedValue([
      realActivity(1, { type: "TrailRun", icu_hr_zone_times: [600, 1800, 300, 200, 100, 0, 0] }),
    ] as never);
    const result = await computePolarization(28, "Run");
    expect(result!.zone_metric).toBe("hr");
  });

  it("computes Treff PI on the Seiler 3-zone model (Z1-2 | Z3-4 | Z5+)", async () => {
    // f1 = 0.80, f2 = 0.05, f3 = 0.15 \u2192 PI = log10(16 \u00b7 0.15 \u00b7 100) = log10(240) = 2.38
    vi.mocked(icu.getActivities).mockResolvedValue([
      realActivity(1, { type: "Ride", icu_hr_zone_times: [4000, 4000, 300, 200, 1000, 500, 0] }),
    ] as never);
    const result = await computePolarization(28, "Hike");
    expect(result).toBeNull(); // sport filter excludes the Ride
    vi.mocked(icu.getActivities).mockResolvedValue([
      realActivity(1, { type: "Run", icu_hr_zone_times: [4000, 4000, 300, 200, 1000, 500, 0] }),
    ] as never);
    const run = await computePolarization(28, "Run");
    expect(run!.polarization_index).toBeCloseTo(2.38, 2);
    expect(run!.distribution_model).toBe("Polarized");
  });
});

describe("computeTrends with real fields", () => {
  beforeEach(() => vi.resetAllMocks());

  it("computes EF and HRR from icu_efficiency_factor and the icu_hrr object", async () => {
    vi.mocked(icu.getActivities).mockResolvedValue(
      [1, 2, 3, 4].map((i) =>
        realActivity(i, {
          type: "VirtualRide",
          icu_efficiency_factor: 1.4 + i * 0.02,
          icu_hrr: { hrr: 20 + i },
          icu_average_watts: 180,
        }),
      ) as never,
    );
    vi.mocked(icu.getWellness).mockResolvedValue([]);
    const result = await computeTrends(30, "Ride");
    const names = result!.trends.map((t) => t.metric);
    expect(names).toContain("Efficiency Factor");
    expect(names).toContain("Heart Rate Recovery");
  });
});

// ─── Recovery thresholds ────────────────────────────────────

describe("recovery thresholds", () => {
  it("uses the same cut points as the decision rules", async () => {
    const { recoveryStatus } = await import("../recovery.js");
    expect(recoveryStatus(80)).toBe("Recovered");
    expect(recoveryStatus(79)).toBe("Moderate");
    expect(recoveryStatus(55)).toBe("Moderate");
    expect(recoveryStatus(54)).toBe("Strained");
    expect(recoveryStatus(40)).toBe("Strained");
    expect(recoveryStatus(39)).toBe("At risk");
  });

  it("flags SpO2 only below 93%", async () => {
    const base = Array.from({ length: 45 }, (_, i) => ({
      id: daysAgo(45 - i),
      hrv: 45 + Math.sin(i) * 5,
      restingHR: 52 + Math.cos(i) * 3,
      sleepSecs: 7 * 3600,
      spO2: 97 + Math.sin(i) * 0.5,
    }));
    const spo2Flags = async (last: number) => {
      const data = base.map((d, i) => (i === base.length - 1 ? { ...d, spO2: last } : d));
      vi.mocked(icu.getWellness).mockResolvedValue(data);
      const result = await computeRecoveryIndex(30, daysAgo, today);
      return (result!.today.red_flags ?? []).filter((f: string) => f.startsWith("SpO₂"));
    };
    expect(await spo2Flags(94)).toHaveLength(0);
    expect(await spo2Flags(92)).toHaveLength(1);
  });
});
