import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../intervals.js", () => ({
  getEvents: vi.fn(),
  getActivities: vi.fn(),
  getAthlete: vi.fn(),
}));

import * as icu from "../../intervals.js";
import { computeWeeklyTracker, sportGroup } from "../weekly-tracker.js";

describe("sportGroup", () => {
  it("maps intervals.icu types to the tracked sports", () => {
    expect(sportGroup("VirtualRide")).toBe("bike");
    expect(sportGroup("GravelRide")).toBe("bike");
    expect(sportGroup("TrailRun")).toBe("run");
    expect(sportGroup("OpenWaterSwim")).toBe("swim");
    expect(sportGroup("WeightTraining")).toBe("other");
    expect(sportGroup("Hike")).toBe("other");
    expect(sportGroup("Yoga")).toBe("other");
    expect(sportGroup(undefined)).toBe("other");
  });
});

describe("computeWeeklyTracker", () => {
  beforeEach(() => vi.resetAllMocks());

  // 2026-10-07 is a Wednesday; its week runs Mon 2026-10-05 to Sun 2026-10-11
  it("fills the current week per sport and day against planned targets", async () => {
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

    vi.mocked(icu.getAthlete).mockResolvedValue({
      id: "i1",
      icu_type_settings: [{ type: "WeightTraining", ctlFactor: 0.4, atlFactor: 0.75 }],
    } as never);

    const r = await computeWeeklyTracker({ weeksBefore: 0, weeksAfter: 1, start: "2026-10-07" }, "2026-10-07");

    expect(r.range).toMatchObject({ from: "2026-10-05", to: "2026-10-18" });
    const [w1, w2] = r.weeks;
    expect(w1).toMatchObject({
      position: 0,
      status: "current",
      target_tss: 140,
      target_source: "planned_events",
      actual_tss: 110,
    });
    expect(w1.actual_tss_by_sport).toEqual({ swim: 40, bike: 70, run: 0 });
    expect(w1.other_tss_not_counted).toBe(10); // WeightTraining 25 x 40% (athlete setting), Yoga 10 x 0% (default)
    expect(w1.completion_pct).toBe(78.6);
    expect(w1.remaining_tss).toBe(30);
    expect(w1.days_left_including_today).toBe(5);
    expect(w1.days?.map((d) => d.cumulative_tss)).toEqual([40, 110, 110, 110, 110, 110, 110]);
    expect(w2).toMatchObject({ position: 1, status: "future", target_tss: 50, actual_tss: 0 });
    expect(w2.days).toBeUndefined();
    expect(r.hint).toBeUndefined();
  });

  it("opens on the current week and covers 12 weeks by default", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([]);
    vi.mocked(icu.getActivities).mockResolvedValue([]);

    const r = await computeWeeklyTracker({}, "2026-10-07");

    expect(r.weeks).toHaveLength(12);
    expect(r.weeks[0]).toMatchObject({ week_start: "2026-10-05", position: 0, status: "current" });
    expect(r.weeks[11]).toMatchObject({ week_start: "2026-12-21", position: 11, status: "future" });
    expect(r.weeks[1].days).toBeUndefined();
    expect(vi.mocked(icu.getActivities).mock.calls[0].slice(0, 2)).toEqual(["2026-10-05", "2026-12-27"]);
    expect(vi.mocked(icu.getEvents).mock.calls[0][2]).toBe("WORKOUT,TARGET");
  });

  it("reads weekly TARGET events and ranks them between manual targets and planned workouts", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([
      { id: 1, category: "TARGET", start_date_local: "2026-10-05T00:00:00", load_target: 310 },
      { id: 2, category: "WORKOUT", start_date_local: "2026-10-07T00:00:00", type: "Ride", load_target: 90 },
      { id: 3, category: "WORKOUT", start_date_local: "2026-10-14T00:00:00", type: "Ride", load_target: 90 },
      { id: 4, category: "TARGET", start_date_local: "2026-10-19T00:00:00", load_target: 325 },
    ]);
    vi.mocked(icu.getActivities).mockResolvedValue([]);

    const r = await computeWeeklyTracker(
      { weeksAfter: 3, targets: [{ week_start: "2026-10-19", tss: 400 }] },
      "2026-10-05",
    );

    expect(r.weeks.map((w) => [w.target_tss, w.target_source])).toEqual([
      [310, "target_event"],
      [90, "planned_events"],
      [400, "manual"],
      [null, "none"],
    ]);
    expect(r.weeks[0].planned_tss_by_sport.bike).toBe(90);
  });

  it("uses manual targets by date and flags weeks without any target", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([]);
    vi.mocked(icu.getActivities).mockResolvedValue([]);

    const r = await computeWeeklyTracker(
      {
        weeksBefore: 0,
        weeksAfter: 2,
        targets: [
          { week_start: "2026-10-08", tss: 300 },
          { week_start: "2026-10-12", tss: 350 },
        ],
      },
      "2026-10-05",
    );

    expect(r.weeks.map((w) => w.target_tss)).toEqual([300, 350, null]);
    expect(r.weeks.map((w) => w.target_source)).toEqual(["manual", "manual", "none"]);
    expect(r.weeks[2].completion_pct).toBeNull();
    expect(r.totals.weeks_without_target).toBe(1);
    expect(r.hint).toContain("1 of 3 weeks");
  });

  it("caps the window and treats Sunday as the end of the week", async () => {
    vi.mocked(icu.getEvents).mockResolvedValue([]);
    vi.mocked(icu.getActivities).mockResolvedValue([]);

    const r = await computeWeeklyTracker({ weeksBefore: 99, weeksAfter: 99, start: "2026-10-11" }, "2026-10-11");

    expect(r.weeks).toHaveLength(53);
    expect(r.weeks[26]).toMatchObject({ week_start: "2026-10-05", week_end: "2026-10-11", position: 0 });
    expect(r.weeks[26].days_left_including_today).toBeUndefined();
  });
});
