import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { curveOptsShape, dateStr, daysAgo, filtersArg, safe, today } from "../helpers.js";

export function registerCurveTools(server: McpServer): void {
  // --- get_activity_power_curve ---
  server.tool(
    "get_activity_power_curve",
    "Get power curve (best efforts at each duration) for an activity",
    {
      activity_id: z.string().describe("Activity ID"),
      fatigue: z.enum(["kj0", "kj1"]).optional().describe("Return the athlete's predefined fatigued curve"),
    },
    ({ activity_id, fatigue }) => safe(() => icu.getActivityPowerCurve(activity_id, fatigue)),
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

  // --- get_power_curves ---
  server.tool(
    "get_power_curves",
    "Get power curves (season bests, recent, etc.). Use f1/f2/f3 filter sets to compare curves (e.g. indoor vs outdoor).",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, Swim, etc."),
      curves: z
        .array(z.string())
        .optional()
        .describe(
          "Curve specs: 1y, 2y, 42d, s0 (current season), s1, all, r.2025-01-01.2025-03-31 (date range). Add -kj0/-kj1 suffix for fatigued curves",
        ),
      pm_type: z.enum(["MS_2P", "MORTON_3P", "FFT_CURVES", "ECP"]).optional().describe("Power model to fit"),
      ...curveOptsShape,
    },
    ({ sport, curves, pm_type, newest, include_ranks, sub_max_efforts, filters, f1, f2, f3 }) =>
      safe(() =>
        icu.getPowerCurves(sport ?? "Ride", curves ?? ["1y"], undefined, {
          pmType: pm_type,
          newest,
          includeRanks: include_ranks,
          subMaxEfforts: sub_max_efforts,
          filters,
          f1,
          f2,
          f3,
        }),
      ),
  );

  // --- get_pace_curves ---
  server.tool(
    "get_pace_curves",
    "Get pace curves (running, swimming). Use f1/f2/f3 filter sets to compare curves.",
    {
      sport: z.string().optional().describe("Sport type: Run (default), Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y, 42d, s0, s1, all, r.YYYY-MM-DD.YYYY-MM-DD"),
      gap: z.boolean().optional().describe("Gradient adjusted pace curves"),
      pm_type: z.enum(["CS"]).optional().describe("Critical speed model"),
      ...curveOptsShape,
    },
    ({ sport, curves, gap, pm_type, newest, include_ranks, sub_max_efforts, filters, f1, f2, f3 }) =>
      safe(() =>
        icu.getPaceCurves(sport ?? "Run", curves ?? ["1y"], {
          gap,
          pmType: pm_type,
          newest,
          includeRanks: include_ranks,
          subMaxEfforts: sub_max_efforts,
          filters,
          f1,
          f2,
          f3,
        }),
      ),
  );

  // --- get_hr_curves ---
  server.tool(
    "get_hr_curves",
    "Get heart rate curves. Use f1/f2/f3 filter sets to compare curves.",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y, 42d, s0, s1, all, r.YYYY-MM-DD.YYYY-MM-DD"),
      ...curveOptsShape,
    },
    ({ sport, curves, newest, sub_max_efforts, filters, f1, f2, f3 }) =>
      safe(() =>
        icu.getHRCurves(sport ?? "Ride", curves ?? ["1y"], {
          newest,
          subMaxEfforts: sub_max_efforts,
          filters,
          f1,
          f2,
          f3,
        }),
      ),
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

  // --- get_activity_power_curves_range ---
  server.tool(
    "get_activity_power_curves_range",
    "Get best power for each activity in a date range at specific durations. Use to track power progression over time (e.g. see 5min power trend across all rides).",
    {
      oldest: dateStr.describe("Start date YYYY-MM-DD"),
      newest: dateStr.describe("End date YYYY-MM-DD"),
      sport: z.string().optional().describe("Sport type: Ride (default), Run, etc."),
      secs: z.array(z.number()).optional().describe("Specific durations in seconds (e.g. [5, 60, 300, 1200])"),
      filters: filtersArg.describe("Only activities matching all these filters"),
      fatigue: z
        .enum(["kj0", "kj1"])
        .optional()
        .describe("Use the athlete's predefined fatigued curves (requires sport)"),
    },
    ({ oldest, newest, sport, secs, filters, fatigue }) =>
      safe(() => icu.getActivityPowerCurvesRange(oldest, newest, sport, secs, { filters, fatigue })),
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

  // --- get_activity_pace_curves_range ---
  server.tool(
    "get_activity_pace_curves_range",
    "Best pace for each activity in a date range at specific distances. Use to track pace progression over time.",
    {
      oldest: dateStr.describe("Start date YYYY-MM-DD"),
      newest: dateStr.describe("End date YYYY-MM-DD"),
      sport: z.string().optional().describe("Sport type: Run (default), Swim, etc."),
      distances: z.array(z.number()).optional().describe("Distances in meters (e.g. [400, 1000, 5000])"),
      gap: z.boolean().optional().describe("Use gradient adjusted pace"),
      filters: filtersArg.describe("Only activities matching all these filters"),
    },
    ({ oldest, newest, sport, distances, gap, filters }) =>
      safe(() => icu.getActivityPaceCurvesRange(oldest, newest, sport, distances, gap, filters)),
  );

  // --- get_activity_hr_curves_range ---
  server.tool(
    "get_activity_hr_curves_range",
    "Best heart rate for each activity in a date range at specific durations. Use to track HR progression over time.",
    {
      oldest: dateStr.describe("Start date YYYY-MM-DD"),
      newest: dateStr.describe("End date YYYY-MM-DD"),
      sport: z.string().optional().describe("Sport type: Ride (default), Run, etc."),
      secs: z.array(z.number()).optional().describe("Durations in seconds (e.g. [60, 300, 1200])"),
      filters: filtersArg.describe("Only activities matching all these filters"),
    },
    ({ oldest, newest, sport, secs, filters }) =>
      safe(() => icu.getActivityHRCurvesRange(oldest, newest, sport, secs, filters)),
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
    "Get power curves of one activity for several streams (e.g. watts, watts_per_kg) and fresh/fatigued variants in one call",
    {
      activity_id: z.string().describe("Activity ID"),
      types: z.array(z.string()).optional().describe("Streams (default watts)"),
      fatigue: z
        .array(z.enum(["normal", "kj0", "kj1"]))
        .optional()
        .describe("Normal and/or fatigued curves"),
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
