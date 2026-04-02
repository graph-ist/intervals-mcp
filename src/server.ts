// Read version from package.json at module load
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "./intervals.js";
import { computeDecoupling } from "./tools/decoupling.js";
import { computeDfrc } from "./tools/dfrc.js";
import { computeMetabolicProfile } from "./tools/metabolic.js";
import { computeRecoveryIndex } from "./tools/recovery.js";
import { computeTrainingLoadRisk } from "./tools/training-load.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const VERSION: string = pkg.version;

// ---------- Helpers ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = z.string().regex(DATE_RE, "Must be YYYY-MM-DD");
const ALLOWED_UPLOAD_EXT = /\.(fit|fit\.gz|tcx|gpx)$/i;
const MAX_EVENTS_BATCH = 90;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function safeReturn(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolError(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function safe<T>(fn: () => Promise<T>): Promise<ToolResult> {
  try {
    const data = await fn();
    return safeReturn(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(`API error: ${msg}`);
  }
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- Server ----------

export function createServer(): { mcpServer: McpServer; toolCount: number; promptCount: number; version: string } {
  const server = new McpServer({
    name: "intervals-icu",
    version: VERSION,
  });

  // ---------- Prompts ----------

  const PROMPT_SUFFIX =
    "Interpreta ogni valore usando i reference_ranges della risposta — indica la fascia e il significato per l'atleta. No emoji.";

  server.prompt("morning_check", "Check mattutino: wellness, HRV, sonno, prontezza per la giornata", {}, async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Come sto oggi? Posso allenarmi forte o devo moderare?\n\nAnalizza recupero e wellness degli ultimi 7 giorni. Mostra Recovery Index, stato delle metriche fisiologiche rispetto alla baseline, trend recente, e segnali di attenzione.\n\n${PROMPT_SUFFIX}`,
        },
      },
    ],
  }));

  server.prompt("evening_check", "Check serale post-allenamento: recupero, carico, rischio", {}, async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Check serale post-allenamento. Come ha risposto il corpo al carico di oggi?\n\nAnalizza stato di recupero e rischio da carico (ACWR, Monotony, Strain). Segnala red flag e dammi indicazioni per domani.\n\n${PROMPT_SUFFIX}`,
        },
      },
    ],
  }));

  server.prompt(
    "weekly_review",
    "Review domenicale: settimana completa, volume, carico, trend",
    {
      oldest: dateStr.optional().describe("Data inizio YYYY-MM-DD (default: 7 giorni fa)"),
      newest: dateStr.optional().describe("Data fine YYYY-MM-DD (default: oggi)"),
    },
    async ({ oldest, newest }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review settimanale dal ${oldest ?? daysAgo(7)} al ${newest ?? today()}.\n\nAnalizza volume per sport, carico (TSS, CTL/ATL/TSB), rischio (ACWR/Monotony), recupero e wellness. Dai un voto alla settimana e suggerimenti per la prossima.\n\n${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "activity_review",
    "Analisi post-attivita: dettagli, zone, sforzo, decoupling",
    {
      activity_id: z.string().describe("ID attivita su intervals.icu"),
    },
    async ({ activity_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Analizza l'attività ${activity_id} in dettaglio.\n\nMostra riepilogo, metriche chiave, laps/split e zone. Se ha dati di potenza, includi decoupling aerobico e dFRC. Evidenzia punti di forza e cosa migliorare.\n\n${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  // ---------- Tools ----------

  // --- get_athlete ---
  server.tool("get_athlete", "Get athlete profile, settings, and current fitness (CTL/ATL/TSB)", {}, () =>
    safe(() => icu.getAthlete()),
  );

  // --- get_recent_activities ---
  server.tool(
    "get_recent_activities",
    "Get recent activities. Use to find latest workouts.",
    { days: z.number().optional().describe("How many days back (default 14)") },
    ({ days }) => safe(() => icu.getActivities(daysAgo(days ?? 14), today())),
  );

  // --- search_activities ---
  server.tool(
    "search_activities",
    "Search activities by text query (name, type, etc.)",
    {
      query: z.string().describe("Search query"),
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
    },
    ({ activity_id, types }) => safe(() => icu.getActivityStreams(activity_id, types)),
  );

  // --- get_activity_power_curve ---
  server.tool(
    "get_activity_power_curve",
    "Get power curve (best efforts at each duration) for an activity",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivityPowerCurve(activity_id)),
  );

  // --- get_activity_pace_curve ---
  server.tool(
    "get_activity_pace_curve",
    "Get pace curve (best paces at each duration) for an activity",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivityPaceCurve(activity_id)),
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

  // --- get_training_load_risk ---
  server.tool(
    "get_training_load_risk",
    "Training load risk analysis: Monotony, Strain (Foster 1998), ACWR acute:chronic workload ratio with injury risk zones (Gabbett 2016). Flags spikes, monotonous blocks, and cumulative overload. Uses CTL/ATL from intervals.icu (EWMA model) and daily TSS. IMPORTANT: always interpret every numeric value using the reference_ranges in the response — state which range it falls into and what it means for the athlete.",
    {
      days: z.number().optional().describe("Days of history (default 42, min 14)"),
    },
    async ({ days }) => {
      try {
        const result = await computeTrainingLoadRisk(days ?? 42, daysAgo, today);
        if (!result) return toolError("Insufficient data (need ≥ 7 days).");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_aerobic_decoupling ---
  server.tool(
    "get_aerobic_decoupling",
    "Calculate aerobic decoupling (Pw:Hr drift) for a steady-state activity. Compares power:HR efficiency between the first and second half. Drift > 5% indicates insufficient aerobic base or pacing issues. Based on Friel/Coggan methodology. IMPORTANT: always interpret every numeric value using the reference_ranges in the response.",
    {
      activity_id: z.string().describe("Activity ID"),
      exclude_start_minutes: z.number().optional().describe("Minutes to exclude from start for warm-up (default 10)"),
      exclude_end_minutes: z.number().optional().describe("Minutes to exclude from end for cool-down (default 5)"),
    },
    async ({ activity_id, exclude_start_minutes, exclude_end_minutes }) => {
      try {
        const result = await computeDecoupling(activity_id, exclude_start_minutes ?? 10, exclude_end_minutes ?? 5);
        if (result === null) return toolError("Missing streams or insufficient valid data for decoupling analysis.");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_wellness_data ---
  server.tool(
    "get_wellness_data",
    "Get wellness data: CTL, ATL, TSB, weight, restingHR, HRV, sleep, mood, fatigue, etc.",
    { days: z.number().optional().describe("How many days back (default 30)") },
    ({ days }) => safe(() => icu.getWellness(daysAgo(days ?? 30), today())),
  );

  // --- get_fitness_summary ---
  server.tool(
    "get_fitness_summary",
    "Get athlete training volume and load totals for a date range: total hours, km, TSS, number of activities broken down by sport. This is INPUT load data (what you did), not OUTPUT readiness (how your body responded). Use get_recovery_index for readiness, get_training_load_risk for load risk patterns.",
    {
      oldest: dateStr.optional().describe("Start date YYYY-MM-DD (default 42 days ago)"),
      newest: dateStr.optional().describe("End date YYYY-MM-DD (default today)"),
    },
    ({ oldest, newest }) => safe(() => icu.getAthleteSummary(oldest ?? daysAgo(42), newest ?? today())),
  );

  // --- get_power_curves ---
  server.tool(
    "get_power_curves",
    "Get power curves (season bests, recent, etc.)",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, Swim, etc."),
      curves: z
        .array(z.string())
        .optional()
        .describe("Curve specs: 1y (past year), 42d (past 42 days), s0 (current season), s1 (previous season), all"),
    },
    ({ sport, curves }) => safe(() => icu.getPowerCurves(sport ?? "Ride", curves ?? ["1y"])),
  );

  // --- get_pace_curves ---
  server.tool(
    "get_pace_curves",
    "Get pace curves for running",
    {
      sport: z.string().optional().describe("Sport type: Run (default), Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y, 42d, s0, s1, all"),
    },
    ({ sport, curves }) => safe(() => icu.getPaceCurves(sport ?? "Run", curves ?? ["1y"])),
  );

  // --- get_hr_curves ---
  server.tool(
    "get_hr_curves",
    "Get heart rate curves",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y, 42d, s0, s1, all"),
    },
    ({ sport, curves }) => safe(() => icu.getHRCurves(sport ?? "Ride", curves ?? ["1y"])),
  );

  // --- get_sport_settings ---
  server.tool("get_sport_settings", "Get sport settings (zones, FTP, threshold pace, max HR, etc.)", {}, () =>
    safe(() => icu.getSportSettings()),
  );

  // --- get_events ---
  server.tool(
    "get_events",
    "Get calendar events (workouts, races, notes) for a date range. Replaces get_training_plan and get_planned_workouts.",
    {
      oldest: dateStr.optional().describe("Start date YYYY-MM-DD (default today)"),
      newest: dateStr.optional().describe("End date YYYY-MM-DD (default 14 days from now)"),
      category: z.enum(["WORKOUT", "RACE", "NOTE"]).optional().describe("Filter by event category (default: all)"),
    },
    ({ oldest, newest, category }) => safe(() => icu.getEvents(oldest ?? today(), newest ?? daysFromNow(14), category)),
  );

  // --- get_power_hr_curve ---
  server.tool(
    "get_power_hr_curve",
    "Get power vs HR relationship curve for a date range (aerobic efficiency trend)",
    {
      oldest: dateStr.optional().describe("Start date (default 90 days ago)"),
      newest: dateStr.optional().describe("End date (default today)"),
    },
    ({ oldest, newest }) => safe(() => icu.getPowerHRCurve(oldest ?? daysAgo(90), newest ?? today())),
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
    },
    async ({ events }) => {
      if (events.length > MAX_EVENTS_BATCH) return toolError(`Too many events (max ${MAX_EVENTS_BATCH}).`);
      try {
        const data = await icu.createEvents(events);
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
    "Delete an event from the intervals.icu calendar",
    {
      event_id: z.number().describe("Event ID to delete"),
    },
    ({ event_id }) => safe(() => icu.deleteEvent(event_id)),
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
    },
    ({ type, settings }) => safe(() => icu.updateSportSettings(type, settings)),
  );

  // --- upload_activity ---
  server.tool(
    "upload_activity",
    "Upload an activity file (FIT, TCX, GPX or gzipped) to intervals.icu",
    {
      file_path: z.string().describe("Absolute path to the activity file"),
    },
    async ({ file_path }) => {
      if (!ALLOWED_UPLOAD_EXT.test(file_path)) {
        return {
          content: [{ type: "text", text: "Only .fit, .fit.gz, .tcx, .gpx files are allowed." }],
          isError: true,
        };
      }
      const resolved = resolve(file_path);
      if (resolved !== file_path) {
        return {
          content: [{ type: "text", text: "Only absolute paths are allowed (no relative segments)." }],
          isError: true,
        };
      }
      let fileData: Buffer;
      try {
        fileData = Buffer.from(await readFile(resolved));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Cannot read file: ${msg}` }], isError: true };
      }
      const filename = basename(resolved);
      try {
        const data = await icu.uploadActivity(fileData, filename);
        return safeReturn(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`Upload failed: ${msg}`);
      }
    },
  );

  // --- get_folders ---
  server.tool("get_folders", "Get workout library folders and plans", {}, () => safe(() => icu.getFolders()));

  // --- update_wellness ---
  server.tool(
    "update_wellness",
    "Update wellness data for a date (weight, restingHR, HRV, sleep, mood, fatigue, comments, etc.)",
    {
      date: dateStr.describe("Date YYYY-MM-DD"),
      data: z
        .record(z.string(), z.unknown())
        .describe(
          "Wellness fields to update (weight, restingHR, hrv, sleepSecs, sleepQuality, soreness, fatigue, stress, mood, motivation, injury, spO2, comments, etc.)",
        ),
    },
    ({ date, data }) => safe(() => icu.updateWellness(date, data)),
  );

  // --- get_recovery_index ---
  server.tool(
    "get_recovery_index",
    "Composite recovery & readiness dashboard. Computes z-scores of HRV (rMSSD), resting HR, sleep, Baevsky stress index, SpO₂, and respiratory rate against individual 30-day baselines. Returns per-metric status (green/amber/red), an overall Recovery Index 0-100, trend arrows, and red-flag alerts. Requires device-synced wellness data. IMPORTANT: always interpret every numeric value using the reference_ranges in the response — state which range it falls into and what it means for the athlete.",
    {
      days: z.number().optional().describe("Days of history for analysis (default 30, min 14)"),
    },
    async ({ days }) => {
      try {
        const result = await computeRecoveryIndex(days ?? 30, daysAgo, today);
        if (!result) return toolError("Insufficient wellness data (need ≥ 7 days with device sync).");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_activity_dfrc ---
  server.tool(
    "get_activity_dfrc",
    "Calculate Dynamic Functional Reserve Capacity (dFRC) for an activity. Shows real-time depletion and recovery of the anaerobic battery (W'/FRC) throughout the workout, based on Skiba's W'bal differential model. Returns summary stats and time-series chart data. IMPORTANT: always interpret every numeric value using the reference_ranges in the response.",
    {
      activity_id: z.string().describe("Activity ID"),
      model: z
        .enum(["FFT_CURVES", "MORTON_3P", "ECP", "MS_2P", "sport_settings"])
        .optional()
        .describe(
          "PD model source for FTP/W'. FFT_CURVES (default, matches intervals.icu UI), MORTON_3P, ECP (highest W'), MS_2P, or sport_settings (manual values). Ignored if both ftp_override and frc_override are set.",
        ),
      curve: z.string().optional().describe("Power curve time window: 42d (default), 1y, s0, all"),
      ftp_override: z.number().optional().describe("Override FTP (watts). Takes priority over model."),
      frc_override: z.number().optional().describe("Override FRC/W' (joules). Takes priority over model."),
    },
    async ({ activity_id, model, curve, ftp_override, frc_override }) => {
      try {
        const result = await computeDfrc(activity_id, model, curve, ftp_override, frc_override);
        if (!result) return toolError("No power data available for this activity.");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_metabolic_profile ---
  server.tool(
    "get_metabolic_profile",
    "Compute a metabolic profile with estimated VLaMax (maximum glycolytic rate), energy system contribution breakdown across the power-duration curve, and key physiological metrics (Pmax, MAP/VO2max power, FTP, FRC). Based on Mader's bioenergetic model applied to the athlete's power-duration data. Returns chart-ready data for a metabolic fingerprint visualization. IMPORTANT: always interpret every numeric value using the reference_ranges in the response — state which range it falls into and what it means for the athlete.",
    {
      sport: z.string().optional().describe("Sport type for power curve: Ride (default), Run, etc."),
      curve_type: z
        .string()
        .optional()
        .describe(
          "Curve spec: 1y (past year, default), 42d (past 42 days), s0 (current season), s1 (previous season), all",
        ),
    },
    async ({ sport, curve_type }) => {
      try {
        const result = await computeMetabolicProfile(sport, curve_type);
        if (!result)
          return toolError(
            "No power-duration curve data available. Ensure you have recent activities with power data.",
          );
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  return { mcpServer: server, toolCount: 30, promptCount: 4, version: VERSION };
}
