import { describe, expect, it } from "vitest";
import { addDays } from "../../mcp/helpers.js";
import { evaluateReadiness, type WellnessRow } from "../readiness.js";

const END = "2026-11-05";

// 67 days of stable values with small alternating noise, then the last 7 days overridden per case
function series(last7: Partial<WellnessRow> = {}, base: Partial<WellnessRow> = {}): WellnessRow[] {
  return Array.from({ length: 67 }, (_, i) => {
    const id = addDays(END, i - 66);
    const wobble = i % 2 ? 1 : -1;
    const row: WellnessRow = {
      id,
      readiness: 70 + wobble * 4,
      hrv: 50 + wobble * 4,
      restingHR: 50 + wobble * 2,
      ctl: 60,
      atl: 65,
      ...base,
    };
    return i >= 60 ? { ...row, ...last7 } : row;
  });
}

describe("readiness rule", () => {
  it("returns case 4 when everything is inside the band", () => {
    const r = evaluateReadiness(series())!;
    expect(r.date).toBe(END);
    expect(r.hrv.band).not.toBeNull();
    expect(r.rule.code).toBe("ok");
    expect(r.rule.case).toBe(4);
  });

  it("returns case 1 when HRV is below and resting HR above the band, before checking TSB", () => {
    const r = evaluateReadiness(series({ hrv: 40, restingHR: 56, ctl: 40, atl: 80 }))!;
    expect(r.hrv.position).toBe("below");
    expect(r.resting_hr.position).toBe("above");
    expect(r.rule.code).toBe("low");
  });

  it("returns case 2 when TSB is below -30 and case 1 does not hold", () => {
    const r = evaluateReadiness(series({ ctl: 50, atl: 85 }))!;
    expect(r.form.tsb).toBe(-35);
    expect(r.rule.code).toBe("tired");
  });

  it("returns case 3 with one or two signals out of band", () => {
    expect(evaluateReadiness(series({ readiness: 50 }))!.rule.code).toBe("watch");
    expect(evaluateReadiness(series({ readiness: 50, hrv: 40 }))!.rule.code).toBe("watch");
  });

  it("does not treat better-than-usual values as signals", () => {
    const r = evaluateReadiness(series({ hrv: 70, restingHR: 40, readiness: 95 }))!;
    expect(r.rule.code).toBe("ok");
  });

  it("needs 4 values in the week and 30 in the base, else no position", () => {
    const sparse = series().map((w, i) => (i >= 60 && i < 64 ? { ...w, hrv: null } : w));
    expect(evaluateReadiness(sparse)!.hrv.mean_7d).toBeNull();
    const short = series().slice(-25);
    expect(evaluateReadiness(short)!.hrv.band).toBeNull();
    expect(evaluateReadiness(short)!.rule.code).toBe("ok");
  });

  it("evaluates on the last day on or before asOf", () => {
    const r = evaluateReadiness(series(), "2026-11-01")!;
    expect(r.date).toBe("2026-11-01");
  });
});
