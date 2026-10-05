import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { dateStr, daysFromNow, MAX_EVENTS_BATCH, safe, safeReturn, today, toolError } from "../helpers.js";

export function registerEventTools(server: McpServer): void {
  // --- get_events ---
  server.tool(
    "get_events",
    "Get calendar events (workouts, races, notes) for a date range. Use resolve=true to get targets converted to watts/bpm/pace.",
    {
      oldest: dateStr.optional().describe("Start date YYYY-MM-DD (default today)"),
      newest: dateStr.optional().describe("End date YYYY-MM-DD (default 14 days from now)"),
      category: z
        .string()
        .optional()
        .describe(
          "Comma separated categories: WORKOUT, RACE_A, RACE_B, RACE_C, NOTE, TARGET, HOLIDAY, SICK, INJURED, etc.",
        ),
      limit: z.number().optional().describe("Max events"),
      calendar_id: z.number().optional().describe("Only events from this calendar"),
      resolve: z.boolean().optional().describe("Resolve power/HR/pace targets to watts, bpm and m/s"),
      ext: z
        .enum(["zwo", "mrc", "erg", "fit"])
        .optional()
        .describe("Attach each workout converted to this format (base64), large response"),
      power_range: z.number().optional().describe("% to turn fixed power targets into a range (outdoor)"),
      hr_range: z.number().optional().describe("% to turn fixed HR targets into a range"),
      pace_range: z.number().optional().describe("% to turn fixed pace targets into a range"),
      locale: z.string().optional().describe("Locale for multi-language workout steps, e.g. it, en"),
    },
    ({ oldest, newest, category, limit, calendar_id, resolve, ext, power_range, hr_range, pace_range, locale }) =>
      safe(() =>
        icu.getEvents(oldest ?? today(), newest ?? daysFromNow(14), category, {
          limit,
          calendarId: calendar_id,
          resolve,
          ext,
          powerRange: power_range,
          hrRange: hr_range,
          paceRange: pace_range,
          locale,
        }),
      ),
  );

  // --- create_training_plan ---
  server.tool(
    "create_training_plan",
    `Create multiple workout events on the intervals.icu calendar in batch. Use this to build a periodized training plan with TSS targets. Each event needs at minimum: start_date_local (YYYY-MM-DD), category ('WORKOUT'), type (sport: 'Run','Ride','Swim','Brick'), name, and optionally load_target (TSS) and description.

IMPORTANT — description MUST use intervals.icu Workout Builder syntax so the workout renders as a structured visual chart (colored bars, zones, targets). Rules:
- Each step starts with '- ' on its own line.
- Duration: 30s, 10m, 1m30, 1h. Distance: 300m, 5km.
- Power: 200w, 80% (of FTP), Z2 (zone). Range: 155-178w, 80-90%.
- Heart rate: 150 HR, 80% HR, Z2 HR. Pace: 5:00 Pace, Z2 Pace, 1:53-1:57 Pace.
- Cadence: 85-90rpm.
- Ramp: Ramp 100-200w, Ramp 60-80%.
- Repeats: put "4x" on the header line before the steps.
- Section headers (Warm Up, Main Set, Cool Down, etc.) are free text lines WITHOUT '-'.
- Text before the first target in a step becomes the step prompt: "- Recovery 30s 50%" → prompt is "Recovery".
- Rest/recovery steps: "- 30s rest" or "- 40s Z1 Pace".

Bike example:
"Warm Up\\n- 15m 60% 90rpm\\n\\nMain Set 4x\\n- 5m 100% 85-90rpm\\n- 3m 50%\\n\\nCool Down\\n- 10m 55% 90rpm"

Run example:
"Easy Run\\n- 40m Z2 HR\\n\\nStrides 4x\\n- 20s Z5 Pace\\n- 40s Z1 Pace\\n\\nCool Down\\n- 5m Z1 HR"

Do NOT use prose descriptions like "90 min Z2 puro. Potenza 155-178W" — always use the structured syntax above.`,
    {
      events: z
        .array(
          z.object({
            start_date_local: dateStr.describe("Date YYYY-MM-DD"),
            category: z.string().default("WORKOUT").describe("Event category: WORKOUT, NOTE, TARGET, RACE"),
            type: z.string().describe("Sport type: Run, Ride, Swim, Brick, WeightTraining, etc."),
            name: z.string().describe("Workout name"),
            description: z
              .string()
              .optional()
              .describe(
                "Workout description in intervals.icu Workout Builder syntax (structured steps, NOT prose). See tool description for format rules and examples.",
              ),
            load_target: z.number().optional().describe("TSS/load target for this workout"),
            moving_time: z.number().optional().describe("Target duration in seconds"),
            distance: z.number().optional().describe("Target distance in meters"),
            color: z.string().optional().describe("Event color hex"),
          }),
        )
        .describe("Array of events to create"),
      upsert: z
        .boolean()
        .optional()
        .describe("Update events with matching external_id created by this app instead of duplicating"),
      upsert_on_uid: z.boolean().optional().describe("Update events with matching uid instead of creating new ones"),
      update_plan_applied: z.boolean().optional().describe("Stamp created/updated events with a new plan_applied date"),
    },
    async ({ events, upsert, upsert_on_uid, update_plan_applied }) => {
      if (events.length > MAX_EVENTS_BATCH) return toolError(`Too many events (max ${MAX_EVENTS_BATCH}).`);
      try {
        const data = await icu.createEvents(events, {
          upsert,
          upsertOnUid: upsert_on_uid,
          updatePlanApplied: update_plan_applied,
        });
        return safeReturn({ created: data.length, events: data });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- update_event ---
  server.tool(
    "update_event",
    "Update an existing event on the intervals.icu calendar. When updating the description field for Ride or Run workouts, use intervals.icu Workout Builder syntax (structured steps with '- duration target cadence' format, section headers, repeats with Nx). See create_training_plan tool description for full syntax rules.",
    {
      event_id: z.number().describe("Event ID to update"),
      updates: z
        .record(z.string(), z.unknown())
        .describe(
          "Fields to update (name, description, load_target, type, etc.). Use Workout Builder syntax for description.",
        ),
    },
    ({ event_id, updates }) => safe(() => icu.updateEvent(event_id, updates)),
  );

  // --- delete_event ---
  server.tool(
    "delete_event",
    "Delete an event from the intervals.icu calendar. With others=true also deletes the events added at the same time (e.g. a whole applied plan).",
    {
      event_id: z.number().describe("Event ID to delete"),
      others: z.boolean().optional().describe("Also delete other events added at the same time"),
      not_before: dateStr.optional().describe("With others: do not delete events before this date YYYY-MM-DD"),
    },
    ({ event_id, others, not_before }) => safe(() => icu.deleteEvent(event_id, { others, notBefore: not_before })),
  );

  // --- get_weather_forecast ---
  server.tool(
    "get_weather_forecast",
    "Get weather forecast for the athlete's configured locations. Use to plan outdoor workouts.",
    {},
    () => safe(() => icu.getWeatherForecast()),
  );

  // --- get_training_plan ---
  server.tool(
    "get_training_plan",
    "Get the athlete's current assigned training plan (folder, start date, last applied)",
    {},
    () => safe(() => icu.getTrainingPlan()),
  );

  // --- duplicate_events ---
  server.tool(
    "duplicate_events",
    "Duplicate one or more calendar events (workouts, notes). Use to copy a week of training by passing all event IDs.",
    {
      event_ids: z.array(z.number().int()).min(1).max(200).describe("Event IDs to duplicate"),
      num_copies: z.number().int().min(1).max(52).describe("Number of copies to create"),
      weeks_between: z.number().int().min(0).max(52).describe("Weeks between each copy"),
    },
    ({ event_ids, num_copies, weeks_between }) => safe(() => icu.duplicateEvents(event_ids, num_copies, weeks_between)),
  );

  // --- get_fitness_model_events ---
  server.tool(
    "get_fitness_model_events",
    "Get events that influence the fitness model: eFTP changes, fitness resets, season starts, custom CTL/ATL days",
    {},
    () => safe(() => icu.getFitnessModelEvents()),
  );

  // --- bulk_delete_events ---
  server.tool(
    "bulk_delete_events",
    "Delete multiple calendar events at once by ID",
    {
      events: z
        .array(z.object({ id: z.number().int().describe("Event ID") }))
        .min(1)
        .max(500)
        .describe("Array of events to delete"),
    },
    ({ events }) => safe(() => icu.bulkDeleteEvents(events)),
  );

  // --- mark_event_done ---
  server.tool(
    "mark_event_done",
    "Mark a planned calendar workout as done: creates a manual activity matching the planned event (use when the athlete did the session without a device file).",
    { event_id: z.number().describe("Event ID of the planned workout") },
    ({ event_id }) => safe(() => icu.markEventDone(event_id)),
  );

  // --- get_event ---
  server.tool(
    "get_event",
    "Get a single calendar event (planned workout, note, race) by ID",
    { event_id: z.number().describe("Event ID") },
    ({ event_id }) => safe(() => icu.getEvent(event_id)),
  );

  // --- delete_events_range ---
  server.tool(
    "delete_events_range",
    "Delete ALL calendar events in a date range, optionally limited to categories (e.g. WORKOUT). Irreversible — confirm range with the user first. If newest is omitted, all future events from oldest are deleted.",
    {
      oldest: dateStr.describe("First day YYYY-MM-DD"),
      newest: dateStr.optional().describe("Last day YYYY-MM-DD (inclusive)"),
      category: z.string().optional().describe("Comma separated categories, e.g. WORKOUT,NOTE"),
      created_by_id: z.string().optional().describe("Only delete events created by this athlete ID"),
    },
    ({ oldest, newest, category, created_by_id }) =>
      safe(() => icu.deleteEventsRange(oldest, newest, category, created_by_id)),
  );

  // --- apply_plan ---
  server.tool(
    "apply_plan",
    "Apply a library training plan (folder of type PLAN, see get_folders) to the calendar starting on a given date",
    {
      folder_id: z.number().describe("Plan folder ID"),
      start_date: dateStr.describe("Date YYYY-MM-DD the plan starts on"),
      extra_workouts: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Additional workout objects to apply together with the plan"),
    },
    ({ folder_id, start_date, extra_workouts }) =>
      safe(() => icu.applyPlan(`${start_date}T00:00:00`, folder_id, extra_workouts)),
  );

  // --- apply_plan_changes ---
  server.tool(
    "apply_plan_changes",
    "Push changes made to the athlete's current plan into the calendar (only workouts from today onward are updated)",
    {},
    () => safe(() => icu.applyPlanChanges()),
  );

  // --- update_training_plan ---
  server.tool(
    "update_training_plan",
    "Change the athlete's assigned training plan",
    {
      training_plan_id: z.number().describe("Plan folder ID"),
      training_plan_start_date: dateStr.optional().describe("Plan start date YYYY-MM-DD"),
      training_plan_alias: z.string().optional().describe("Display alias"),
    },
    (args) => safe(() => icu.updateTrainingPlan(args)),
  );

  // --- update_events_range ---
  server.tool(
    "update_events_range",
    "Bulk-update visibility flags of all events in a date range. Only hide_from_athlete and athlete_cannot_edit can be changed (coach feature).",
    {
      oldest: dateStr.describe("First day YYYY-MM-DD"),
      newest: dateStr.describe("Last day YYYY-MM-DD (inclusive)"),
      hide_from_athlete: z.boolean().optional().describe("Hide the events from the athlete"),
      athlete_cannot_edit: z.boolean().optional().describe("Prevent the athlete from editing the events"),
    },
    ({ oldest, newest, hide_from_athlete, athlete_cannot_edit }) =>
      safe(() =>
        icu.updateEventsRange(oldest, newest, {
          ...(hide_from_athlete !== undefined && { hide_from_athlete }),
          ...(athlete_cannot_edit !== undefined && { athlete_cannot_edit }),
        }),
      ),
  );

  // --- get_shared_event ---
  server.tool(
    "get_shared_event",
    "Get a shared event (e.g. a public race) with its courses",
    {
      shared_event_id: z.number().describe("Shared event ID (shared_event_id field of a calendar event)"),
      full_course: z.boolean().optional().describe("Include full course info (map, weather)"),
    },
    ({ shared_event_id, full_course }) => safe(() => icu.getSharedEvent(shared_event_id, full_course ?? false)),
  );

  // --- update_athlete_plans ---
  server.tool(
    "update_athlete_plans",
    "Coach: change the training plan of several athletes at once",
    {
      plans: z
        .array(
          z.object({
            id: z.string().describe("Athlete ID"),
            training_plan_id: z.number().describe("Plan folder ID"),
            training_plan_start_date: dateStr.optional().describe("Plan start date YYYY-MM-DD"),
            training_plan_alias: z.string().optional(),
          }),
        )
        .min(1)
        .describe("One entry per athlete"),
    },
    ({ plans }) => safe(() => icu.updateAthletePlans(plans)),
  );
}
