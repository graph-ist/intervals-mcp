import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { curveOptsShape, dateStr, daysAgo, filtersArg, safe, today, toolError } from "../helpers.js";

export function registerCurveTools(server: McpServer): void {
  // --- get_athlete_curves ---
  server.tool(
    "get_athlete_curves",
    "Athlete power, pace or heart-rate curves (season bests, recent, fatigued). Use f1/f2/f3 filter sets to compare curves (e.g. indoor vs outdoor).",
    {
      kind: z.enum(["power", "pace", "hr"]).describe("Which curves"),
      sport: z.string().optional().describe("Sport type (default Ride for power and hr, Run for pace)"),
      curves: z
        .array(z.string())
        .optional()
        .describe(
          "Curve specs: 1y (default), 2y, 42d, s0 (current season), s1, all, r.2025-01-01.2025-03-31 (date range). Power only: add -kj0/-kj1 for fatigued curves",
        ),
      gap: z.boolean().optional().describe("Pace only: gradient adjusted pace curves"),
      pm_type: z
        .enum(["MS_2P", "MORTON_3P", "FFT_CURVES", "ECP", "CS"])
        .optional()
        .describe("Model to fit: MS_2P, MORTON_3P, FFT_CURVES or ECP for power; CS (critical speed) for pace"),
      ...curveOptsShape,
    },
    ({ kind, sport, curves, gap, pm_type, newest, include_ranks, sub_max_efforts, filters, f1, f2, f3 }) => {
      if (gap != null && kind !== "pace") return Promise.resolve(toolError("gap applies only to kind=pace."));
      if (pm_type && (kind === "hr" || (kind === "pace") !== (pm_type === "CS"))) {
        return Promise.resolve(toolError("pm_type: use MS_2P, MORTON_3P, FFT_CURVES or ECP with power, CS with pace."));
      }
      const specs = curves ?? ["1y"];
      const common = { newest, subMaxEfforts: sub_max_efforts, filters, f1, f2, f3 };
      if (kind === "power") {
        return safe(() =>
          icu.getPowerCurves(sport ?? "Ride", specs, undefined, {
            ...common,
            pmType: pm_type,
            includeRanks: include_ranks,
          }),
        );
      }
      if (kind === "pace") {
        return safe(() =>
          icu.getPaceCurves(sport ?? "Run", specs, { ...common, gap, pmType: pm_type, includeRanks: include_ranks }),
        );
      }
      return safe(() => icu.getHRCurves(sport ?? "Ride", specs, common));
    },
  );

  // --- get_activity_curves_range ---
  server.tool(
    "get_activity_curves_range",
    "Best power or heart rate at given durations, or best pace at given distances, for each activity in a date range. Use to track progression over time (e.g. 5-min power across all rides).",
    {
      kind: z.enum(["power", "pace", "hr"]).describe("Which metric"),
      oldest: dateStr.describe("Start date YYYY-MM-DD"),
      newest: dateStr.describe("End date YYYY-MM-DD"),
      sport: z.string().optional().describe("Sport type (default Ride for power and hr, Run for pace)"),
      secs: z.array(z.number()).optional().describe("Power and hr: durations in seconds (e.g. [5, 60, 300, 1200])"),
      distances: z.array(z.number()).optional().describe("Pace: distances in meters (e.g. [400, 1000, 5000])"),
      gap: z.boolean().optional().describe("Pace only: gradient adjusted pace"),
      fatigue: z
        .enum(["kj0", "kj1"])
        .optional()
        .describe("Power only: the athlete's predefined fatigued curves (requires sport)"),
      filters: filtersArg.describe("Only activities matching all these filters"),
    },
    ({ kind, oldest, newest, sport, secs, distances, gap, fatigue, filters }) => {
      if (kind === "pace" && secs) return Promise.resolve(toolError("Use distances, not secs, with kind=pace."));
      if (kind !== "pace" && (distances || gap != null)) {
        return Promise.resolve(toolError("distances and gap apply only to kind=pace."));
      }
      if (fatigue && kind !== "power") return Promise.resolve(toolError("fatigue applies only to kind=power."));
      if (kind === "power")
        return safe(() => icu.getActivityPowerCurvesRange(oldest, newest, sport, secs, { filters, fatigue }));
      if (kind === "pace")
        return safe(() => icu.getActivityPaceCurvesRange(oldest, newest, sport, distances, gap, filters));
      return safe(() => icu.getActivityHRCurvesRange(oldest, newest, sport, secs, filters));
    },
  );

  // --- get_activity_pace_curve ---
  server.tool(
    "get_activity_pace_curve",
    "Get pace curve (best paces at each duration) for an activity",
    {
      activity_id: z.string().describe("Activity ID"),
      gap: z.boolean().optional().describe("Use gradient adjusted pace"),
    },
    ({ activity_id, gap }) => safe(() => icu.getActivityPaceCurve(activity_id, gap)),
  );

  // --- get_activity_hr_curve ---
  server.tool(
    "get_activity_hr_curve",
    "Get heart rate curve (best HR at each duration) for an activity",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivityHRCurve(activity_id)),
  );

  // --- get_activity_power_vs_hr ---
  server.tool(
    "get_activity_power_vs_hr",
    "Get power vs heart rate plot for an activity (aerobic efficiency/decoupling)",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivityPowerVsHR(activity_id)),
  );

  // --- get_power_hr_curve ---
  server.tool(
    "get_power_hr_curve",
    "Get power vs HR relationship curve for a date range (aerobic efficiency trend)",
    {
      oldest: dateStr.optional().describe("Start date (default 90 days ago)"),
      newest: dateStr.optional().describe("End date (default today)"),
      sport: z.string().optional().describe("Sport type, e.g. Ride"),
      filters: filtersArg.describe("Only consider activities matching all these filters"),
    },
    ({ oldest, newest, sport, filters }) =>
      safe(() => icu.getPowerHRCurve(oldest ?? daysAgo(90), newest ?? today(), sport, filters)),
  );

  // --- get_activity_best_efforts ---
  server.tool(
    "get_activity_best_efforts",
    "Find best efforts in an activity for a given duration or distance. Returns top N segments ranked by average value.",
    {
      activity_id: z.string().describe("Activity ID"),
      stream: z.string().describe("Stream to search: watts, heartrate, velocity_smooth, cadence"),
      duration: z.number().optional().describe("Duration of each effort in seconds"),
      distance: z.number().optional().describe("Distance of each effort in meters"),
      count: z.number().optional().describe("Number of efforts to return (default 8)"),
      min_value: z.number().optional().describe("Minimum average value; efforts expand to include it"),
      exclude_intervals: z.boolean().optional().describe("Ignore parts of the stream inside work intervals"),
      start_index: z.number().optional().describe("First stream index to consider"),
      end_index: z.number().optional().describe("Last stream index to consider (exclusive)"),
    },
    ({ activity_id, stream, duration, distance, count, min_value, exclude_intervals, start_index, end_index }) =>
      safe(() =>
        icu.getActivityBestEfforts(activity_id, {
          stream,
          duration,
          distance,
          count,
          minValue: min_value,
          excludeIntervals: exclude_intervals,
          startIndex: start_index,
          endIndex: end_index,
        }),
      ),
  );

  // --- get_activity_power_histogram ---
  server.tool(
    "get_activity_power_histogram",
    "Get power distribution histogram for an activity: time spent in each power bucket",
    {
      activity_id: z.string().describe("Activity ID"),
      bucket_size: z.number().optional().describe("Watts per bucket (default 25)"),
    },
    ({ activity_id, bucket_size }) => safe(() => icu.getActivityPowerHistogram(activity_id, bucket_size)),
  );

  // --- get_mmp_model ---
  server.tool(
    "get_mmp_model",
    "Get the athlete's power-duration model (Critical Power, W', Pmax, FTP) used to resolve %MMP workout steps",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, etc."),
    },
    ({ sport }) => safe(() => icu.getMMPModel(sport ?? "Ride")),
  );

  // --- get_activity_histogram ---
  server.tool(
    "get_activity_histogram",
    "Get the distribution of time spent at heart rate (hr), pace (pace) or gradient adjusted pace (gap) buckets for an activity. For power use get_activity_power_histogram.",
    {
      activity_id: z.string().describe("Activity ID"),
      kind: z.enum(["hr", "pace", "gap"]).describe("Which histogram"),
      bucket_size: z.number().optional().describe("Bucket width (bpm for hr)"),
    },
    ({ activity_id, kind, bucket_size }) => safe(() => icu.getActivityHistogram(activity_id, kind, bucket_size)),
  );

  // --- get_activity_time_at_hr ---
  server.tool(
    "get_activity_time_at_hr",
    "Get time spent at each heart rate value during an activity",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivityTimeAtHR(activity_id)),
  );

  // --- get_activity_model ---
  server.tool(
    "get_activity_model",
    "Get an activity analysis model: hr-load-model (how heart-rate training load was computed) or power-spike-model (power spike detection thresholds)",
    {
      activity_id: z.string().describe("Activity ID"),
      kind: z.enum(["hr-load-model", "power-spike-model"]).describe("Which model"),
    },
    ({ activity_id, kind }) => safe(() => icu.getActivityModel(activity_id, kind)),
  );

  // --- get_activity_power_curves ---
  server.tool(
    "get_activity_power_curves",
    "Power curve (best power at each duration) of one activity; optionally for several streams (e.g. watts, watts_per_kg) and fresh/fatigued variants in one call",
    {
      activity_id: z.string().describe("Activity ID"),
      types: z.array(z.string()).optional().describe("Streams (default watts)"),
      fatigue: z
        .array(z.enum(["normal", "kj0", "kj1"]))
        .optional()
        .describe("Normal and/or fatigued curves (default normal)"),
    },
    ({ activity_id, types, fatigue }) => safe(() => icu.getActivityPowerCurves(activity_id, types, fatigue)),
  );

  // --- get_pace_distances ---
  server.tool(
    "get_pace_distances",
    "List the distances used for pace curves; with a sport it also returns the best-effort defaults for that sport",
    { sport: z.string().optional().describe("Sport settings ID or type, e.g. Run") },
    ({ sport }) => safe(() => icu.getPaceDistances(sport)),
  );
}
