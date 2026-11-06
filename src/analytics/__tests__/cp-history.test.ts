import { describe, expect, it, vi } from "vitest";

vi.mock("../../intervals.js", () => ({ getPowerCurves: vi.fn() }));

import * as icu from "../../intervals.js";
import { computeCpHistory, monthRanges } from "../cp-history.js";

const curve = (id: string, cp: number, wPrime: number, pMax: number) => ({
  id,
  secs: [5, 60, 300, 1200],
  values: [pMax, 400, 280, 240],
  activity_id: ["a1", "a1", "a2", "a2"],
  powerModels: [
    { type: "MORTON_3P", criticalPower: cp, wPrime, pMax, ftp: cp },
    { type: "MS_2P", criticalPower: cp + 5, wPrime: wPrime - 3000, ftp: cp + 5 },
  ],
});

describe("cp history", () => {
  it("builds calendar months ending at the reference date", () => {
    const r = monthRanges("2026-03-15", 3);
    expect(r.map((m) => m.spec)).toEqual([
      "r.2026-01-01.2026-01-31",
      "r.2026-02-01.2026-02-28",
      "r.2026-03-01.2026-03-15",
    ]);
    expect(r.map((m) => m.partial)).toEqual([false, false, true]);
    expect(monthRanges("2026-01-10", 2)[0].spec).toBe("r.2025-12-01.2025-12-31");
  });

  it("matches curves by id, marks months without rides and reports the change", async () => {
    vi.mocked(icu.getPowerCurves).mockResolvedValue({
      // February is missing, as intervals.icu does for months without rides; order differs from the request
      list: [curve("r.2026-03-01.2026-03-15", 230, 16000, 900), curve("r.2026-01-01.2026-01-31", 220, 14000, 850)],
    } as never);

    const r = await computeCpHistory({ months: 3, newest: "2026-03-15" });

    expect(vi.mocked(icu.getPowerCurves).mock.calls[0]).toEqual([
      "Ride",
      ["r.2026-01-01.2026-01-31", "r.2026-02-01.2026-02-28", "r.2026-03-01.2026-03-15"],
    ]);
    expect(r.months.map((m) => [m.month, m.has_data])).toEqual([
      ["2026-01", true],
      ["2026-02", false],
      ["2026-03", true],
    ]);
    expect(r.months[0]).toMatchObject({ cp: 220, w_prime: 14000, p_max: 850, activities_on_curve: 2 });
    expect(r.months[0]).toMatchObject({ peaks: { "5s": 850, "60s": 400, "300s": 280, "1200s": 240 } });
    expect(r.months_without_rides).toEqual(["2026-02"]);
    expect(r.change).toEqual({
      from_month: "2026-01",
      to_month: "2026-03",
      cp_watts: 10,
      w_prime_joules: 2000,
      p_max_watts: 50,
    });
  });

  it("uses the chosen model for the main columns", async () => {
    vi.mocked(icu.getPowerCurves).mockResolvedValue({
      list: [curve("r.2026-03-01.2026-03-15", 230, 16000, 900)],
    } as never);
    const r = await computeCpHistory({ months: 1, newest: "2026-03-15", model: "MS_2P" });
    expect(r.months[0]).toMatchObject({ cp: 235, w_prime: 13000, p_max: null });
    expect(r.change).toBeNull();
  });
});
