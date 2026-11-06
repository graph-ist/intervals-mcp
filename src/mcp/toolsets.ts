/*
 * Every tool belongs to exactly one toolset. INTERVALS_TOOLSETS chooses which toolsets a server registers, so a
 * client loads only the definitions it needs. A tool missing from this map makes createServer() throw.
 */
export const TOOLSETS = {
  // Readiness, analysis, wellness, activity reads, athlete and sport settings, the calendar
  core: [
    "get_training_load_risk",
    "get_aerobic_decoupling",
    "get_recovery_index",
    "get_readiness_check",
    "get_activity_dfrc",
    "get_metabolic_profile",
    "get_fatigue_resistance",
    "get_polarization_analysis",
    "get_longitudinal_trends",
    "get_load_tracker",
    "get_wellness_data",
    "get_wellness_day",
    "update_wellness",
    "update_wellness_bulk",
    "get_recent_activities",
    "search_activities",
    "search_activities_full",
    "get_activity_detail",
    "get_activity_streams",
    "get_activity_intervals",
    "get_activity_interval_stats",
    "search_intervals",
    "get_activity_map",
    "get_activity_weather",
    "get_activity_tags",
    "get_activity_segments",
    "get_activities_around",
    "get_activities_by_ids",
    "get_matching_activities",
    "update_activity",
    "create_manual_activity",
    "get_athlete",
    "get_athlete_profile",
    "get_athlete_connections",
    "get_athlete_settings",
    "update_athlete",
    "get_fitness_summary",
    "get_sport_settings",
    "create_sport_settings",
    "update_sport_settings",
    "update_sport_settings_bulk",
    "apply_sport_settings",
    "delete_sport_settings",
    "get_weather_config",
    "update_weather_config",
    "list_tags",
    "get_events",
    "get_event",
    "update_event",
    "delete_event",
    "mark_event_done",
    "get_fitness_model_events",
    "get_weather_forecast",
    "get_shared_event",
  ],
  // Training plans, bulk calendar changes, the workout library
  planning: [
    "create_training_plan",
    "duplicate_events",
    "bulk_delete_events",
    "delete_events_range",
    "get_training_plan",
    "update_training_plan",
    "apply_plan",
    "apply_plan_changes",
    "get_folders",
    "create_folder",
    "update_folder",
    "delete_folder",
    "get_workouts",
    "get_workout",
    "create_workout",
    "create_workouts_bulk",
    "update_workout",
    "delete_workout",
    "duplicate_workouts",
    "convert_workout",
    "update_plan_workouts",
  ],
  // Power, pace and HR curves, histograms, best efforts
  curves: [
    "get_power_curves",
    "get_pace_curves",
    "get_hr_curves",
    "get_power_hr_curve",
    "get_mmp_model",
    "get_pace_distances",
    "get_activity_power_curve",
    "get_activity_pace_curve",
    "get_activity_hr_curve",
    "get_activity_power_curves",
    "get_activity_power_curves_range",
    "get_activity_pace_curves_range",
    "get_activity_hr_curves_range",
    "get_activity_best_efforts",
    "get_activity_power_vs_hr",
    "get_activity_power_histogram",
    "get_activity_histogram",
    "get_activity_time_at_hr",
    "get_activity_model",
  ],
  // Editing recorded data: streams, intervals, deletions, bulk manual activities
  activity_edit: [
    "update_activity_streams",
    "update_activity_intervals",
    "update_activity_interval",
    "delete_activity_intervals",
    "split_activity_interval",
    "delete_activity",
    "delete_activity_tombstone",
    "create_manual_activities_bulk",
  ],
  // Uploads, downloads and CSV exports (base64 or text payloads)
  files: [
    "upload_activity",
    "upload_activity_streams_csv",
    "upload_wellness_csv",
    "import_workout_file",
    "download_activity_file",
    "download_activity_fit_files",
    "download_event_workout",
    "download_workouts_zip",
    "export_csv",
  ],
  gear: [
    "get_gear",
    "create_gear",
    "update_gear",
    "delete_gear",
    "replace_gear",
    "create_gear_reminder",
    "update_gear_reminder",
    "delete_gear_reminder",
    "recalculate_gear_stats",
  ],
  // Routes, chats and activity comments
  social: [
    "list_routes",
    "get_route",
    "update_route",
    "get_route_similarity",
    "list_chats",
    "list_groups",
    "get_chat",
    "list_chat_messages",
    "send_chat_message",
    "update_chat_message",
    "delete_chat_message",
    "mark_chat_seen",
    "block_chat",
    "list_activity_messages",
    "add_activity_message",
  ],
  // Custom charts, fields and panels
  custom: [
    "create_custom_chart",
    "list_custom_items",
    "get_custom_item",
    "update_custom_item",
    "delete_custom_item",
    "reorder_custom_items",
    "upload_custom_item_image",
  ],
  // Coaching several athletes
  coach: [
    "list_athletes",
    "update_athlete_plans",
    "update_events_range",
    "get_folder_shared_with",
    "update_folder_shared_with",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Toolset = keyof typeof TOOLSETS;
export const TOOLSET_NAMES = Object.keys(TOOLSETS) as Toolset[];

/** Default for the remote (HTTP) transport; stdio registers everything. */
export const DEFAULT_REMOTE_TOOLSETS: Toolset[] = ["core", "planning"];

const TOOLSET_OF = new Map<string, Toolset>();
for (const name of TOOLSET_NAMES) {
  for (const tool of TOOLSETS[name]) {
    if (TOOLSET_OF.has(tool)) throw new Error(`Tool ${tool} is in two toolsets`);
    TOOLSET_OF.set(tool, name);
  }
}

export function toolsetOf(tool: string): Toolset | undefined {
  return TOOLSET_OF.get(tool);
}

/** Parses INTERVALS_TOOLSETS ("core,planning" or "all"); undefined or empty gives the fallback. Unknown names throw. */
export function parseToolsets(value: string | undefined, fallback: Toolset[] | "all"): Toolset[] {
  const raw = (value ?? "").trim();
  if (!raw) return fallback === "all" ? [...TOOLSET_NAMES] : [...fallback];
  const names = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("all")) return [...TOOLSET_NAMES];
  const unknown = names.filter((n) => !(TOOLSET_NAMES as string[]).includes(n));
  if (unknown.length) {
    throw new Error(`Unknown toolset(s) ${unknown.join(", ")}. Valid: ${TOOLSET_NAMES.join(", ")}, all`);
  }
  return [...new Set(names)] as Toolset[];
}
