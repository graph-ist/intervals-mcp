import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { MAX_EVENTS_BATCH, safe, safeReturn, toolError } from "../helpers.js";

export function registerWorkoutTools(server: McpServer): void {
  const WORKOUT_SYNTAX_NOTE =
    "description MUST use intervals.icu Workout Builder syntax (steps starting with '- ', e.g. 'Warm Up\\n- 15m 60%\\n\\nMain Set 4x\\n- 5m 100%\\n- 3m 50%'). See create_training_plan for full syntax rules.";

  const workoutFields = {
    folder_id: z.number().describe("Library folder or plan ID (see get_folders)"),
    name: z.string().describe("Workout name"),
    type: z.string().describe("Sport type: Ride, Run, Swim, WeightTraining, etc."),
    description: z.string().optional().describe("Workout in Workout Builder syntax (structured steps, NOT prose)"),
    moving_time: z.number().optional().describe("Target duration in seconds"),
    distance: z.number().optional().describe("Target distance in meters"),
    icu_training_load: z.number().optional().describe("Target TSS/load"),
    indoor: z.boolean().optional().describe("Indoor workout"),
    color: z.string().optional().describe("Color hex"),
    tags: z.array(z.string()).optional().describe("Workout tags"),
    day: z.number().optional().describe("Day offset within a plan folder (0 = first day), only for PLAN folders"),
    file_contents: z.string().optional().describe("Alternative to description: contents of a .zwo, .mrc or .erg file"),
    file_contents_base64: z.string().optional().describe("Alternative to description: base64 contents of a .fit file"),
    filename: z.string().optional().describe("Original filename, required with file_contents(_base64)"),
  };

  // --- mark_event_done ---

  // --- get_folders ---
  server.tool("get_folders", "Get workout library folders and plans", {}, () => safe(() => icu.getFolders()));

  // --- get_workouts ---
  server.tool(
    "get_workouts",
    "List all workouts in the athlete's workout library (templates, not calendar events)",
    {},
    () => safe(() => icu.getWorkouts()),
  );

  // --- get_workout ---
  server.tool(
    "get_workout",
    "Get a single workout from the athlete's library by ID",
    { workout_id: z.number().describe("Workout ID (see get_workouts)") },
    ({ workout_id }) => safe(() => icu.getWorkout(workout_id)),
  );

  // --- create_workout ---
  server.tool(
    "create_workout",
    `Create a reusable workout in the athlete's workout library (a folder or plan), not on the calendar. ${WORKOUT_SYNTAX_NOTE}`,
    workoutFields,
    (args) => safe(() => icu.createWorkout(args)),
  );

  // --- create_workouts_bulk ---
  server.tool(
    "create_workouts_bulk",
    `Create multiple workouts in the library in one call. ${WORKOUT_SYNTAX_NOTE}`,
    {
      workouts: z.array(z.object(workoutFields)).max(MAX_EVENTS_BATCH).describe("Workouts to create"),
    },
    ({ workouts }) => safe(() => icu.createWorkouts(workouts)),
  );

  // --- update_workout ---
  server.tool(
    "update_workout",
    `Update a workout in the library. ${WORKOUT_SYNTAX_NOTE}`,
    {
      workout_id: z.number().describe("Workout ID"),
      updates: z
        .record(z.string(), z.unknown())
        .describe("Fields to update (name, description, type, moving_time, icu_training_load, folder_id, tags, etc.)"),
    },
    ({ workout_id, updates }) => safe(() => icu.updateWorkout(workout_id, updates)),
  );

  // --- delete_workout ---
  server.tool(
    "delete_workout",
    "Delete a workout from the library. If it is on a plan and others=true, other workouts added at the same time are deleted too. Irreversible.",
    {
      workout_id: z.number().describe("Workout ID"),
      others: z.boolean().optional().describe("Also delete others added at the same time (default false)"),
    },
    ({ workout_id, others }) => safe(() => icu.deleteWorkout(workout_id, others ?? false)),
  );

  // --- create_folder ---
  server.tool(
    "create_folder",
    "Create a workout library folder or a training plan",
    {
      name: z.string().describe("Folder or plan name"),
      type: z.enum(["FOLDER", "PLAN"]).describe("FOLDER for a simple folder, PLAN for a dated training plan"),
      description: z.string().optional().describe("Description"),
      extra: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Other fields (visibility, start_date_local, rollout_weeks, duration_weeks, activity_types, etc.)"),
    },
    ({ name, type, description, extra }) =>
      safe(() => icu.createFolder({ name, type, ...(description !== undefined && { description }), ...extra })),
  );

  // --- update_folder ---
  server.tool(
    "update_folder",
    "Update a workout library folder or training plan",
    {
      folder_id: z.number().describe("Folder or plan ID"),
      updates: z.record(z.string(), z.unknown()).describe("Fields to update (name, description, visibility, etc.)"),
    },
    ({ folder_id, updates }) => safe(() => icu.updateFolder(folder_id, updates)),
  );

  // --- delete_folder ---
  server.tool(
    "delete_folder",
    "Delete a workout library folder or plan INCLUDING ALL ITS WORKOUTS. Irreversible — confirm with the user first.",
    { folder_id: z.number().describe("Folder or plan ID") },
    ({ folder_id }) => safe(() => icu.deleteFolder(folder_id)),
  );

  // --- duplicate_workouts ---
  server.tool(
    "duplicate_workouts",
    "Duplicate workouts on a library training plan (repeat blocks every N weeks)",
    {
      workout_ids: z.array(z.number().int()).min(1).max(200).describe("Workout IDs to duplicate"),
      num_copies: z.number().int().min(1).max(52).describe("Number of copies"),
      weeks_between: z.number().int().min(0).max(52).describe("Weeks between copies"),
    },
    ({ workout_ids, num_copies, weeks_between }) =>
      safe(() => icu.duplicateWorkouts(workout_ids, num_copies, weeks_between)),
  );

  // --- convert_workout ---
  server.tool(
    "convert_workout",
    "Convert a library workout into a file for other platforms: zwo (Zwift), mrc, erg (text) or fit (base64), with targets resolved from the athlete's settings. Plain Workout Builder text cannot be converted directly: create it first with create_workout, or for calendar events use download_event_workout.",
    {
      format: z.enum(["zwo", "mrc", "erg", "fit"]).describe("Output format"),
      workout_id: z.number().int().describe("Library workout ID (see get_workouts)"),
    },
    async ({ format, workout_id }) => {
      try {
        const workout = await icu.getWorkout(workout_id);
        const content = await icu.convertWorkout(format, workout as unknown as Record<string, unknown>);
        return safeReturn({ format, encoding: format === "fit" ? "base64" : "text", content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_folder_shared_with ---
  server.tool(
    "get_folder_shared_with",
    "List athletes a library folder or plan is shared with",
    { folder_id: z.number().describe("Folder or plan ID") },
    ({ folder_id }) => safe(() => icu.getFolderSharedWith(folder_id)),
  );

  // --- update_folder_shared_with ---
  server.tool(
    "update_folder_shared_with",
    "Replace the share list of a library folder or plan. Pass the full desired list: athletes omitted are un-shared.",
    {
      folder_id: z.number().describe("Folder or plan ID"),
      shared_with: z
        .array(z.object({ id: z.string().describe("Athlete ID"), canEdit: z.boolean().optional() }))
        .describe("Athletes to share with"),
    },
    ({ folder_id, shared_with }) => safe(() => icu.updateFolderSharedWith(folder_id, shared_with)),
  );

  // --- update_plan_workouts ---
  server.tool(
    "update_plan_workouts",
    "Hide or show a range of workouts on a library plan from the athlete (only hide_from_athlete can be changed). Days are offsets from the plan start (0 = first day).",
    {
      folder_id: z.number().describe("Plan folder ID"),
      oldest_day: z.number().describe("First plan day offset (inclusive)"),
      newest_day: z.number().describe("Last plan day offset (inclusive)"),
      hide_from_athlete: z.boolean().describe("Hide the workouts from the athlete"),
    },
    ({ folder_id, oldest_day, newest_day, hide_from_athlete }) =>
      safe(() => icu.updatePlanWorkouts(folder_id, oldest_day, newest_day, { hide_from_athlete })),
  );
}
