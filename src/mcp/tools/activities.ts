import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { daysAgo, MAX_EVENTS_BATCH, recordArg, safe, today } from "../helpers.js";

export function registerActivityTools(server: McpServer): void {
  // --- get_recent_activities ---
  server.tool(
    "get_recent_activities",
    "Get recent activities. Use to find latest workouts.",
    {
      days: z.number().optional().describe("How many days back (default 14)"),
      limit: z.number().optional().describe("Return at most this many activities"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Only return these fields (much smaller response), e.g. ['id','name','type','start_date_local','icu_training_load']",
        ),
      route_id: z.number().optional().describe("Only activities on this route"),
    },
    ({ days, limit, fields, route_id }) =>
      safe(() => icu.getActivities(daysAgo(days ?? 14), today(), { limit, fields, routeId: route_id })),
  );

  // --- search_activities ---
  server.tool(
    "search_activities",
    "Search activities by name, or by exact tag if the query starts with # (returns summary info)",
    {
      query: z.string().describe("Name text or #tag"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    ({ query, limit }) => safe(() => icu.searchActivities(query, limit ?? 10)),
  );

  // --- get_activity_detail ---
  server.tool(
    "get_activity_detail",
    "Get full activity details including laps, intervals, and zones",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivity(activity_id)),
  );

  // --- get_activity_streams ---
  server.tool(
    "get_activity_streams",
    "Get time-series data streams for an activity (power, heart rate, pace, cadence, etc.)",
    {
      activity_id: z.string().describe("Activity ID"),
      types: z
        .array(z.string())
        .describe("Stream types: watts, heartrate, velocity_smooth, cadence, altitude, latlng, distance, time"),
      include_defaults: z.boolean().optional().describe("Also include the default streams"),
    },
    ({ activity_id, types, include_defaults }) =>
      safe(() => icu.getActivityStreams(activity_id, types, include_defaults)),
  );

  // --- update_activity ---
  server.tool(
    "update_activity",
    "Update an activity: rename, tag, set RPE/feel, change type, add description, etc.",
    {
      activity_id: z.string().describe("Activity ID"),
      updates: z
        .record(z.string(), z.unknown())
        .describe(
          "Fields to update: name, type, description, perceived_exertion (1-10), feel (1-5), tags (string[]), icu_ignore_time, sub_type (NONE/COMMUTE/WARMUP/COOLDOWN/RACE), etc.",
        ),
    },
    ({ activity_id, updates }) => safe(() => icu.updateActivity(activity_id, updates)),
  );

  // --- get_activity_intervals ---
  server.tool(
    "get_activity_intervals",
    "Get detailed interval data for an activity: work/recovery intervals with avg power, HR, cadence, pace, zone, distance, training load per interval",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivityIntervals(activity_id)),
  );

  // --- search_intervals ---
  server.tool(
    "search_intervals",
    "Search historical activities for intervals matching duration and intensity criteria. Find all activities with e.g. '5min efforts at 90-100% FTP'. Returns matching activities most recent first.",
    {
      min_secs: z.number().describe("Minimum interval duration in seconds"),
      max_secs: z.number().describe("Maximum interval duration in seconds"),
      min_intensity: z.number().describe("Minimum intensity percentage (of FTP)"),
      max_intensity: z.number().describe("Maximum intensity percentage (of FTP)"),
      type: z.enum(["AUTO", "POWER", "HR", "PACE"]).optional().describe("Interval type filter"),
      min_reps: z.number().optional().describe("Minimum number of matching intervals"),
      max_reps: z.number().optional().describe("Maximum number of matching intervals"),
      limit: z.number().optional().describe("Max results (default 30)"),
    },
    ({ min_secs, max_secs, min_intensity, max_intensity, type, min_reps, max_reps, limit }) =>
      safe(() =>
        icu.searchIntervals({
          minSecs: min_secs,
          maxSecs: max_secs,
          minIntensity: min_intensity,
          maxIntensity: max_intensity,
          type,
          minReps: min_reps,
          maxReps: max_reps,
          limit,
        }),
      ),
  );

  // --- delete_activity ---
  server.tool(
    "delete_activity",
    "Delete an activity from intervals.icu. This action is irreversible.",
    {
      activity_id: z.string().describe("Activity ID to delete"),
    },
    ({ activity_id }) => safe(() => icu.deleteActivity(activity_id)),
  );

  // --- get_activity_map ---
  server.tool(
    "get_activity_map",
    "Get GPS map data for an activity: bounds and lat/lng coordinates for the route",
    {
      activity_id: z.string().describe("Activity ID"),
      bounds: z
        .array(z.number())
        .length(4)
        .optional()
        .describe("Bounding box [left, top, right, bottom] to limit points"),
      bounds_only: z.boolean().optional().describe("Only return the map bounds (no points)"),
      weather: z.boolean().optional().describe("Include weather points"),
    },
    ({ activity_id, bounds, bounds_only, weather }) =>
      safe(() => icu.getActivityMap(activity_id, { bounds, boundsOnly: bounds_only, weather })),
  );

  // --- get_activity_weather ---
  server.tool(
    "get_activity_weather",
    "Get weather conditions during an activity (or a part of it): temperature, wind speed/direction, rain, headwind/tailwind percentage",
    {
      activity_id: z.string().describe("Activity ID"),
      start_index: z.number().optional().describe("First stream index of the portion"),
      end_index: z.number().optional().describe("Last stream index of the portion (exclusive)"),
    },
    ({ activity_id, start_index, end_index }) =>
      safe(() => icu.getActivityWeather(activity_id, start_index, end_index)),
  );

  // --- get_activity_tags ---
  server.tool("get_activity_tags", "List all tags that have been applied to the athlete's activities", {}, () =>
    safe(() => icu.getActivityTags()),
  );

  // --- create_manual_activity ---
  server.tool(
    "create_manual_activity",
    "Create a manual activity (e.g. strength training, yoga, activities without a device file)",
    {
      type: z.string().describe("Sport type: WeightTraining, Yoga, Hike, Swim, Run, Ride, etc."),
      name: z.string().describe("Activity name"),
      start_date_local: z.string().describe("Start date/time ISO-8601 (e.g. 2025-01-15T08:00:00)"),
      moving_time: z.number().optional().describe("Duration in seconds"),
      distance: z.number().optional().describe("Distance in meters"),
      description: z.string().optional().describe("Activity description/notes"),
      perceived_exertion: z.number().optional().describe("RPE 1-10"),
      extra: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Additional fields (icu_training_load, average_heartrate, calories, kg_lifted, etc.)"),
    },
    ({ type, name, start_date_local, moving_time, distance, description, perceived_exertion, extra }) =>
      safe(() =>
        icu.createManualActivity({
          type,
          name,
          start_date_local,
          ...(moving_time !== undefined && { moving_time }),
          ...(distance !== undefined && { distance }),
          ...(description !== undefined && { description }),
          ...(perceived_exertion !== undefined && { perceived_exertion }),
          ...extra,
        }),
      ),
  );

  // --- update_activity_intervals ---
  server.tool(
    "update_activity_intervals",
    "Update or replace intervals for an activity. Use to manually define work/recovery segments.",
    {
      activity_id: z.string().describe("Activity ID"),
      intervals: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of interval objects with start_index, end_index, type (WORK/RECOVERY), label, etc."),
      replace_all: z.boolean().optional().describe("Replace all existing intervals (default true) or merge"),
    },
    ({ activity_id, intervals, replace_all }) =>
      safe(() => icu.updateActivityIntervals(activity_id, intervals, replace_all ?? true)),
  );

  // --- get_activity_interval_stats ---
  server.tool(
    "get_activity_interval_stats",
    "Compute interval-like stats (avg/max power, HR, cadence, speed, NP, decoupling, etc.) for any arbitrary portion of an activity, by stream index (1 index = 1 sample, typically 1s). Use to analyze a specific climb, effort or segment.",
    {
      activity_id: z.string().describe("Activity ID"),
      start_index: z.number().describe("First stream index (inclusive)"),
      end_index: z.number().describe("Last stream index (exclusive)"),
    },
    ({ activity_id, start_index, end_index }) =>
      safe(() => icu.getActivityIntervalStats(activity_id, start_index, end_index)),
  );

  // --- get_activities_around ---
  server.tool(
    "get_activities_around",
    "List activities before and after a given activity, closest first. Useful for comparing a session with the ones around it.",
    {
      activity_id: z.string().describe("Center activity ID (not included in results)"),
      limit: z.number().optional().describe("Max activities (default 30)"),
      route_id: z.number().optional().describe("Only activities on this route"),
    },
    ({ activity_id, limit, route_id }) => safe(() => icu.getActivitiesAround(activity_id, limit, route_id)),
  );

  // --- get_activities_by_ids ---
  server.tool(
    "get_activities_by_ids",
    "Fetch several activities by ID in one call (missing ones are ignored)",
    {
      activity_ids: z.array(z.string()).min(1).max(50).describe("Activity IDs"),
      intervals: z.boolean().optional().describe("Include interval data"),
    },
    ({ activity_ids, intervals }) => safe(() => icu.getActivitiesByIds(activity_ids, intervals ?? false)),
  );

  // --- update_activity_streams ---
  server.tool(
    "update_activity_streams",
    "Overwrite or correct data streams of an activity (e.g. fix a bad power or HR stream). Each stream object has type (watts, heartrate, ...) and data array.",
    {
      activity_id: z.string().describe("Activity ID"),
      streams: z.array(recordArg).describe("Stream objects: { type, name?, data: [...] }"),
    },
    ({ activity_id, streams }) => safe(() => icu.updateActivityStreams(activity_id, streams)),
  );

  // --- update_activity_interval ---
  server.tool(
    "update_activity_interval",
    "Update or create a single interval on an activity",
    {
      activity_id: z.string().describe("Activity ID"),
      interval_id: z.number().describe("Interval ID (see get_activity_intervals)"),
      interval: recordArg.describe("Interval fields: start_index, end_index, type (WORK/RECOVERY), label, etc."),
    },
    ({ activity_id, interval_id, interval }) =>
      safe(() => icu.updateActivityInterval(activity_id, interval_id, interval)),
  );

  // --- delete_activity_intervals ---
  server.tool(
    "delete_activity_intervals",
    "Delete intervals from an activity",
    {
      activity_id: z.string().describe("Activity ID"),
      intervals: z.array(recordArg).describe("Interval objects to delete (as returned by get_activity_intervals)"),
    },
    ({ activity_id, intervals }) => safe(() => icu.deleteActivityIntervals(activity_id, intervals)),
  );

  // --- create_manual_activities_bulk ---
  server.tool(
    "create_manual_activities_bulk",
    "Create several manual activities at once. If external_id is set, existing activities with the same external_id are updated instead of duplicated.",
    {
      activities: z
        .array(
          z
            .object({
              type: z.string().describe("Sport type"),
              name: z.string().describe("Activity name"),
              start_date_local: z.string().describe("ISO-8601 date/time, e.g. 2025-01-15T08:00:00"),
              moving_time: z.number().optional().describe("Seconds"),
              distance: z.number().optional().describe("Meters"),
              description: z.string().optional(),
              external_id: z.string().optional(),
            })
            .passthrough(),
        )
        .max(MAX_EVENTS_BATCH),
    },
    ({ activities }) => safe(() => icu.createManualActivitiesBulk(activities)),
  );

  // --- get_activity_segments ---
  server.tool(
    "get_activity_segments",
    "Get the segments matched in an activity",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivitySegments(activity_id)),
  );

  // --- search_activities_full ---
  server.tool(
    "search_activities_full",
    "Search activities by name or tag (prefix with # for exact tag) and return full activity objects. Heavier than search_activities.",
    {
      query: z.string().describe("Name text or #tag"),
      limit: z.number().optional().describe("Max results"),
    },
    ({ query, limit }) => safe(() => icu.searchActivitiesFull(query, limit)),
  );

  // --- get_matching_activities ---
  server.tool(
    "get_matching_activities",
    "List activities matched by a sport settings entry (those whose zones apply_sport_settings would update)",
    { settings_id: z.string().describe("Sport settings ID or type, e.g. Ride") },
    ({ settings_id }) => safe(() => icu.getMatchingActivities(settings_id)),
  );

  // --- split_activity_interval ---
  server.tool(
    "split_activity_interval",
    "Split the interval containing a given stream index into two intervals",
    {
      activity_id: z.string().describe("Activity ID"),
      split_at: z.number().describe("Stream index to split at"),
    },
    ({ activity_id, split_at }) => safe(() => icu.splitActivityInterval(activity_id, split_at)),
  );

  // --- delete_activity_tombstone ---
  server.tool(
    "delete_activity_tombstone",
    "Remove the tombstone left by a deleted activity so the same file can be uploaded or synced again",
    { activity_id: z.string().describe("ID of the deleted activity") },
    ({ activity_id }) => safe(() => icu.deleteActivityTombstone(activity_id)),
  );
}
