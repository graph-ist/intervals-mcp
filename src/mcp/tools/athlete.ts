import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { dateStr, daysAgo, recordArg, safe, today } from "../helpers.js";

export function registerAthleteTools(server: McpServer): void {
  // --- get_athlete ---
  server.tool("get_athlete", "Get athlete profile, settings, and current fitness (CTL/ATL/TSB)", {}, () =>
    safe(() => icu.getAthlete()),
  );

  // --- get_fitness_summary ---
  server.tool(
    "get_fitness_summary",
    "Get athlete training volume and load totals for a date range: total hours, km, TSS, number of activities broken down by sport. This is INPUT load data (what you did), not OUTPUT readiness (how your body responded). Use get_recovery_index for readiness, get_training_load_risk for load risk patterns.",
    {
      oldest: dateStr.optional().describe("Start date YYYY-MM-DD (default 42 days ago)"),
      newest: dateStr.optional().describe("End date YYYY-MM-DD (default today)"),
      tags: z.array(z.string()).optional().describe("Coach: only athletes with one of these tags"),
    },
    ({ oldest, newest, tags }) => safe(() => icu.getAthleteSummary(oldest ?? daysAgo(42), newest ?? today(), tags)),
  );

  // --- get_sport_settings ---
  server.tool(
    "get_sport_settings",
    "Get sport settings (zones, FTP, threshold pace, max HR, etc.). Without sport returns all sports.",
    { sport: z.string().optional().describe("Sport type or settings ID, e.g. Ride, Run") },
    ({ sport }) => safe(() => (sport ? icu.getSportSettingsById(sport) : icu.getSportSettings())),
  );

  // --- create_custom_chart ---
  server.tool(
    "create_custom_chart",
    "Create a custom chart/field in intervals.icu",
    {
      name: z.string().describe("Chart name"),
      type: z.string().describe("Chart type"),
      config: z.record(z.string(), z.unknown()).describe("Chart configuration"),
    },
    ({ name, type, config }) => safe(() => icu.createCustomItem({ name, type, ...config })),
  );

  // --- update_sport_settings ---
  server.tool(
    "update_sport_settings",
    "Update sport settings (FTP, LTHR, MaxHR, W', zones, etc.) by sport type",
    {
      type: z.string().describe("Sport type: Ride, Run, Swim, etc."),
      settings: z
        .record(z.string(), z.unknown())
        .describe(
          "Settings to update (ftp, lthr, max_hr, w_prime, p_max, threshold_pace, power_zones, hr_zones, etc.)",
        ),
      recalc_hr_zones: z.boolean().optional().describe("Recalculate HR zones from the new thresholds (default true)"),
    },
    ({ type, settings, recalc_hr_zones }) =>
      safe(() => icu.updateSportSettings(type, settings, recalc_hr_zones ?? true)),
  );

  // --- apply_sport_settings ---
  server.tool(
    "apply_sport_settings",
    "Apply the current sport settings (FTP, thresholds, zones) to matching past activities so their zones/loads are recalculated. Runs asynchronously on intervals.icu. Use after update_sport_settings.",
    { type: z.string().describe("Sport type or settings ID: Ride, Run, Swim, etc.") },
    ({ type }) => safe(() => icu.applySportSettings(type)),
  );

  // --- update_athlete ---
  server.tool(
    "update_athlete",
    "Update the athlete profile (weight, resting HR, date of birth, timezone, units, etc.)",
    { updates: recordArg.describe("Fields to update, e.g. icu_weight, icu_resting_hr, icu_date_of_birth, timezone") },
    ({ updates }) => safe(() => icu.updateAthlete(updates)),
  );

  // --- list_athletes ---
  server.tool(
    "list_athletes",
    "List the athletes the caller follows or coaches (including the caller). Requires an API key (not OAuth).",
    {},
    () => safe(() => icu.listAthletes()),
  );

  // --- create_sport_settings ---
  server.tool(
    "create_sport_settings",
    "Create sport settings for a sport that has none yet (starts from defaults)",
    {
      types: z.array(z.string()).describe("Activity types covered by these settings, e.g. ['Ride','VirtualRide']"),
      settings: recordArg.optional().describe("Initial values (ftp, lthr, max_hr, threshold_pace, etc.)"),
    },
    ({ types, settings }) => safe(() => icu.createSportSettings({ types, ...settings })),
  );

  // --- list_custom_items ---
  server.tool("list_custom_items", "List custom items: custom charts, fields, panels and zones", {}, () =>
    safe(() => icu.listCustomItems()),
  );

  // --- get_custom_item ---
  server.tool(
    "get_custom_item",
    "Get a custom item (chart, field, panel) by ID",
    { item_id: z.number().describe("Custom item ID (see list_custom_items)") },
    ({ item_id }) => safe(() => icu.getCustomItem(item_id)),
  );

  // --- update_custom_item ---
  server.tool(
    "update_custom_item",
    "Update a custom item (name, description, content/config, visibility)",
    { item_id: z.number().describe("Custom item ID"), updates: recordArg.describe("Fields to update") },
    ({ item_id, updates }) => safe(() => icu.updateCustomItem(item_id, updates)),
  );

  // --- delete_custom_item ---
  server.tool(
    "delete_custom_item",
    "Delete a custom item. Irreversible.",
    { item_id: z.number().describe("Custom item ID") },
    ({ item_id }) => safe(() => icu.deleteCustomItem(item_id)),
  );

  // --- list_tags ---
  server.tool(
    "list_tags",
    "List all tags applied to calendar events or to library workouts. For activity tags use get_activity_tags.",
    { kind: z.enum(["event", "workout"]).describe("Which tags") },
    ({ kind }) => safe(() => icu.getTags(kind)),
  );

  // --- get_athlete_profile ---
  server.tool(
    "get_athlete_profile",
    "Get the athlete's public profile info: bio, location, shared folders and custom items",
    {},
    () => safe(() => icu.getAthleteProfile()),
  );

  // --- get_athlete_connections ---
  server.tool(
    "get_athlete_connections",
    "List which devices and platforms are connected (Garmin, Polar, Suunto, Wahoo, Zwift, Strava, etc.)",
    {},
    () => safe(() => icu.getAthleteConnections()),
  );

  // --- get_athlete_settings ---
  server.tool(
    "get_athlete_settings",
    "Get the athlete's UI settings for phone, tablet or desktop",
    { device_class: z.enum(["phone", "tablet", "desktop"]).describe("Device class") },
    ({ device_class }) => safe(() => icu.getAthleteSettings(device_class)),
  );

  // --- update_sport_settings_bulk ---
  server.tool(
    "update_sport_settings_bulk",
    "Update settings of several sports in one call. Each object must include its sport settings id (see get_sport_settings).",
    {
      settings: z.array(recordArg).describe("Array of sport settings objects, each with id plus fields to change"),
      recalc_hr_zones: z.boolean().optional().describe("Recalculate HR zones from the new thresholds"),
    },
    ({ settings, recalc_hr_zones }) => safe(() => icu.updateSportSettingsBulk(settings, recalc_hr_zones ?? false)),
  );

  // --- delete_sport_settings ---
  server.tool(
    "delete_sport_settings",
    "Delete the settings of a sport (by numeric settings id from get_sport_settings). Irreversible.",
    { settings_id: z.number().describe("Sport settings ID") },
    ({ settings_id }) => safe(() => icu.deleteSportSettings(settings_id)),
  );

  // --- get_weather_config ---
  server.tool("get_weather_config", "Get the weather forecast locations configured for the athlete", {}, () =>
    safe(() => icu.getWeatherConfig()),
  );

  // --- update_weather_config ---
  server.tool(
    "update_weather_config",
    "Replace the weather forecast configuration: { forecasts: [{ label, lat, lon, location, enabled }] }",
    { config: recordArg.describe("Weather config object with a forecasts array") },
    ({ config }) => safe(() => icu.updateWeatherConfig(config)),
  );

  // --- reorder_custom_items ---
  server.tool(
    "reorder_custom_items",
    "Re-order custom items (charts, fields, panels)",
    {
      items: z
        .array(z.object({ id: z.number().describe("Custom item ID"), index: z.number().describe("New position") }))
        .min(1),
    },
    ({ items }) =>
      safe(async () => {
        await icu.reorderCustomItems(items);
        return { reordered: items.length };
      }),
  );
}
