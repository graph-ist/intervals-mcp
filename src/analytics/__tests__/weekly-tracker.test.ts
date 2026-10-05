import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../intervals.js", () => ({
  getEvents: vi.fn(),
  getActivities: vi.fn(),
}));

import * as icu from "../../intervals.js";
import { computeWeeklyTracker, sportGroup } from "../weekly-tracker.js";

describe("sportGroup", () => {
  it("maps intervals.icu types to the tracked sports", () => {
    expect(sportGroup("VirtualRide")).toBe("bike");
    expect(sportGroup("GravelRide")).toBe("bike");
    expect(sportGroup("TrailRun")).toBe("run");
    expect(sportGroup("OpenWaterSwim")).toBe("swim");
    expect(sportGroup("WeightTraining")).toBe("strength");
    expect(sportGroup("Yoga")).toBe("other");
    expect(sportGroup(undefined)).toBe("other");
  });
});

describe("computeWeeklyTracker", () => {
  beforeEach(() => vi.resetAllMocks());

  // 2026-10-07 is a Wednesday; its week runs Mon 2026-10-05 to Sun 2026-10-11
  it("fills weeks per sport and day against planned targets", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([
      { id: 1, start_date_local: "2026-10-08T00:00:00", type: "Ride", icu_training_load: 80 },
      { id: 2, start_date_local: "2026-10-10T00:00:00", type: "Run", icu_training_load: 60 },
      { id: 3, start_date_local: "2026-10-14T00:00:00", type: "Swim", load_target: 50 },
    ]);
    vi.mocked(icu.getActivities).mockResolvedValue([
      { start_date_local: "2026-10-05T07:00:00", type: "Swim", icu_training_load: 40 },
      { start_date_local: "2026-10-06T07:00:00", type: "VirtualRide", icu_training_load: 70 },
      { start_date_local: "2026-10-06T18:00:00", type: "WeightTraining", icu_training_load: 25 },
      { start_date_local: "2026-10-07T07:00:00", type: "Yoga", icu_training_load: 10 },
      { start_date_local: "2026-10-07T08:00:00", type: "Run", icu_training_load: null },
    ] as never);

    const r = await computeWeeklyTracker({ weeks: 2, start: "2026-10-07" }, "2026-10-07");

    expect(r.range).toMatchObject({ from: "2026-10-05", to: "2026-10-18" });
    const [w1, w2] = r.weeks;
    expect(w1).toMatchObject({ status: "current", target_tss: 140, target_source: "planned_events", actual_tss: 135 });
    expect(w1.actual_tss_by_sport).toEqual({ swim: 40, bike: 70, run: 0, strength: 25 });
    expect(w1.other_tss_not_counted).toBe(10);
    expect(w1.completion_pct).toBe(96.4);
    expect(w1.remaining_tss).toBe(5);
    expect(w1.days_left_including_today).toBe(5);
    expect(w1.days.map((d) => d.cumulative_tss)).toEqual([40, 135, 135, 135, 135, 135, 135]);
    expect(w2).toMatchObject({ status: "future", target_tss: 50, actual_tss: 0 });
    expect(r.hint).toBeUndefined();
  });

  it("uses manual targets and flags weeks without any target", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([]);
    vi.mocked(icu.getActivities).mockResolvedValue([]);

    const r = await computeWeeklyTracker({ weeks: 3, start: "2026-10-05", targets: [300, 350] }, "2026-10-05");

    expect(r.weeks.map((w) => w.target_tss)).toEqual([300, 350, null]);
    expect(r.weeks.map((w) => w.target_source)).toEqual(["manual", "manual", "none"]);
    expect(r.weeks[2].completion_pct).toBeNull();
    expect(r.totals.weeks_without_target).toBe(1);
    expect(r.hint).toContain("1 of 3 weeks");
  });

  it("caps the number of weeks and treats Sunday as the end of the week", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([]);
    vi.mocked(icu.getActivities).mockResolvedValue([]);

    const r = await computeWeeklyTracker({ weeks: 99, start: "2026-10-11" }, "2026-10-11");

    expect(r.weeks).toHaveLength(26);
    expect(r.weeks[0].week_start).toBe("2026-10-05");
    expect(r.weeks[0].days_left_including_today).toBeUndefined();
  });
});
