// Read version from package.json at module load
import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "./intervals.js";
import { computeDecoupling } from "./tools/decoupling.js";
import { computeDfaAnalysis } from "./tools/dfa-alpha1.js";
import { computeDfrc } from "./tools/dfrc.js";
import { computeFatigueResistance } from "./tools/fatigue-resistance.js";
import { computeMetabolicProfile } from "./tools/metabolic.js";
import { computePolarization } from "./tools/polarization.js";
import { computeRecoveryIndex } from "./tools/recovery.js";
import { computeTrainingLoadRisk } from "./tools/training-load.js";
import { computeTrends } from "./tools/trends.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const VERSION: string = pkg.version;

// ---------- Helpers ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = z.string().regex(DATE_RE, "Must be YYYY-MM-DD");
const filtersArg = z
  .array(
    z
      .object({
        field_id: z.string().describe("Field, e.g. type, moving_time, distance, average_power, tags, indoor, race"),
        operator: z.string().optional().describe("Comparison operator, e.g. =, !=, >, <, >=, <=, contains"),
        value: z.unknown().describe("Value to compare with"),
        not: z.boolean().optional().describe("Negate the condition"),
      })
      .passthrough(),
  )
  .optional();
const curveOptsShape = {
  newest: dateStr.optional().describe("Reference end date for the curves YYYY-MM-DD"),
  include_ranks: z.boolean().optional().describe("Include population ranks"),
  sub_max_efforts: z.number().optional().describe("Also return N sub-maximal efforts per duration"),
  filters: filtersArg.describe("Only consider activities matching all these filters"),
  f1: filtersArg.describe("Comparison filter set 1: each curve is returned once per filter set"),
  f2: filtersArg.describe("Comparison filter set 2"),
  f3: filtersArg.describe("Comparison filter set 3"),
};
const ALLOWED_UPLOAD_EXT = /\.(fit|fit\.gz|tcx|gpx)$/i;

// Resolves symlinks before checking, so a link named x.fit cannot point at .env or other files
async function checkUploadPath(filePath: string, opts: ServerOptions): Promise<string | null> {
  if (!opts.allowAnyLocalPath && !opts.uploadDir) {
    return "Local file upload is disabled on this server: send file_base64 + filename instead.";
  }
  if (!isAbsolute(filePath)) return "file_path must be absolute.";
  let real: string;
  try {
    real = await realpath(filePath);
  } catch {
    return "File not found.";
  }
  if (!ALLOWED_UPLOAD_EXT.test(real)) return "Only .fit, .fit.gz, .tcx, .gpx files are allowed.";
  if (opts.uploadDir) {
    const root = await realpath(opts.uploadDir).catch(() => null);
    const rel = root ? relative(root, real) : "..";
    if (rel.startsWith("..") || isAbsolute(rel)) return "file_path must be inside the configured upload directory.";
  }
  const info = await stat(real);
  if (!info.isFile()) return "file_path is not a regular file.";
  if (info.size > MAX_UPLOAD_BYTES) return `File larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  return null;
}
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

export type ServerOptions = {
  /** Allow upload_activity to read any absolute path (local stdio use). */
  allowAnyLocalPath?: boolean;
  /** If set, upload_activity file_path must resolve inside this directory. */
  uploadDir?: string;
};

const READ_ONLY_TOOL = /^(get|list|search|export|download|convert)_/;
const DESTRUCTIVE_TOOL =
  /^(delete_|bulk_delete_)|^(update_activity_streams|upload_activity_streams_csv|update_folder_shared_with|update_events_range|replace_gear|block_chat)$/;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function createServer(opts: ServerOptions = { allowAnyLocalPath: true }): {
  mcpServer: McpServer;
  toolCount: number;
  promptCount: number;
  version: string;
} {
  const server = new McpServer({
    name: "intervals-icu",
    version: VERSION,
  });

  // Count registrations and attach MCP annotations so clients can ask confirmation before writes/deletes
  let toolCount = 0;
  let promptCount = 0;
  const registerTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
  const registerPrompt = server.prompt.bind(server) as (...args: unknown[]) => unknown;
  const patchable = server as unknown as { tool: typeof registerTool; prompt: typeof registerPrompt };
  patchable.tool = (...args: unknown[]) => {
    toolCount++;
    const name = String(args[0]);
    if (args.length === 4) {
      const readOnly = READ_ONLY_TOOL.test(name);
      args.splice(3, 0, {
        readOnlyHint: readOnly,
        ...(!readOnly && { destructiveHint: DESTRUCTIVE_TOOL.test(name) }),
        openWorldHint: name === "send_chat_message" || name === "add_activity_message",
      });
    }
    return registerTool(...args);
  };
  patchable.prompt = (...args: unknown[]) => {
    promptCount++;
    return registerPrompt(...args);
  };

  // ---------- Prompts ----------

  const PROMPT_SUFFIX =
    "Interpreta ogni valore usando i reference_ranges della risposta — indica la fascia e il significato per l'atleta. No emoji.";

  server.prompt(
    "morning_check",
    "Check mattutino: red-flag scanner rapido — verifica se ci sono motivi per scostare dal piano settimanale",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Check mattutino rapido. Questo NON è uno strumento decisionale quotidiano — serve solo a identificare red-flag che giustificano uno scostamento dal piano settimanale già stabilito.

Regola operativa: se il Recovery Index è tra 55 e 80 e non ci sono anomalie multigiorno (≥3 giorni consecutivi di trend negativo su indicatori indipendenti), il piano settimanale si esegue come previsto. Il rumore giornaliero dell'HRV (±15-20% intra-individuale, Plews et al. 2012) NON è motivo per modificare la sessione.

Intervieni solo se:
1. RI < 40 oggi
2. Pattern multigiorno: ≥3 giorni consecutivi sotto baseline su ≥2 metriche indipendenti (autonomico + strutturale)
3. Red flag singolo severo: HRV z < -2.0, RHR z < -2.0, SpO₂ < 93%

Output richiesto:
- RI di oggi con stato
- Eventali red flag (se nessuna, scrivi "Nessuna anomalia — esegui il piano")
- Solo se ci sono red flag: suggerimento di modifica specifico e reversibile

${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "weekly_review",
    "Review settimanale e pianificazione: strumento PRIMARIO di decisione. Analisi della settimana conclusa + impostazione della prossima.",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review settimanale dal ${daysAgo(7)} al ${today()}.

Questo è lo strumento PRIMARIO di decisione. Le scelte di volume, intensità e distribuzione si fanno qui, non nei check giornalieri.

PARTE 1 — ANALISI SETTIMANA CONCLUSA:
- Volume per sport (ore, km, TSS)
- Carico: CTL/ATL/TSB trend, ACWR, Monotony/Strain
- Recupero: RI medio della settimana, trend, giorni con red flag
- Aderenza al piano: sessioni completate vs pianificate, scostamenti e motivi
- Trend longitudinali: EF, HRR, potenza se disponibili

PARTE 2 — PIANIFICAZIONE PROSSIMA SETTIMANA:
- Stato attuale di forma (TSB) e tendenza CTL
- Settimana di carico, mantenimento o scarico? Giustifica con i dati
- Volume target (ore/TSS) e distribuzione intensità (polarizzata: 80/20 o piramidale)
- Sessioni chiave raccomandate con obiettivo fisiologico
- Criteri di intervento giornaliero: definisci soglie specifiche per questa settimana che giustificherebbero uno scostamento dal piano (es. "se RI < 45 per 2+ giorni, sostituire la Z4 di giovedì con Z2")

Principio guida: la varianza giornaliera è rumore (Plews et al. 2012). Solo pattern multigiorno su indicatori indipendenti sono segnale. I check giornalieri servono solo come trigger per eccezioni definite qui.

${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "activity_review",
    "Analisi post-attivita: trova automaticamente l'ultima Ride/Run/Swim di oggi e la analizza in dettaglio",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Analisi post-attività.

1. Cerca le attività di oggi con get_recent_activities (days=1). Filtra solo tipo Ride, Run, VirtualRide, VirtualRun o Swim. Ignora WeightTraining, Pilates, Yoga e simili. Prendi la più recente.
2. Se non trovi nulla oggi, cerca ieri (days=2).
3. Se non trovi nulla, rispondi "Nessuna attività Ride/Run/Swim trovata negli ultimi 2 giorni."

Per l'attività trovata, analizza in dettaglio:
- Riepilogo e metriche chiave
- Laps/split e zone
- Se ha dati di potenza: decoupling aerobico e dFRC
- Punti di forza e cosa migliorare

${PROMPT_SUFFIX}`,
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
        if (result === null)
          return toolError(
            "Decoupling needs both power and heart-rate streams and ≥ 60 valid samples after the excluded warm-up/cool-down (activities without a power meter cannot be analysed).",
          );
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
    {
      days: z.number().optional().describe("How many days back (default 30)"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Only return these fields (smaller response), e.g. ['id','hrv','restingHR','sleepSecs']"),
    },
    ({ days, fields }) => safe(() => icu.getWellness(daysAgo(days ?? 30), today(), fields)),
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

  // --- get_sport_settings ---
  server.tool(
    "get_sport_settings",
    "Get sport settings (zones, FTP, threshold pace, max HR, etc.). Without sport returns all sports.",
    { sport: z.string().optional().describe("Sport type or settings ID, e.g. Ride, Run") },
    ({ sport }) => safe(() => (sport ? icu.getSportSettingsById(sport) : icu.getSportSettings())),
  );

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

  // --- upload_activity ---
  server.tool(
    "upload_activity",
    "Upload an activity file (FIT, TCX, GPX or gzipped) to intervals.icu. Pass file_base64 + filename (works remotely) or file_path (only where the server allows local files). Set paired_event_id to link it to a planned workout.",
    {
      file_base64: z
        .string()
        .max(MAX_UPLOAD_BYTES * 1.4)
        .optional()
        .describe("File content, base64"),
      filename: z.string().optional().describe("File name with extension, required with file_base64"),
      file_path: z.string().optional().describe("Absolute path to the activity file on the server machine"),
      name: z.string().optional().describe("Activity name"),
      description: z.string().optional().describe("Activity description"),
      device_name: z.string().optional().describe("Recording device, e.g. Garmin Edge 540"),
      external_id: z.string().optional().describe("ID of the activity in the source system"),
      paired_event_id: z.number().int().optional().describe("Planned workout event ID to pair with"),
    },
    async ({ file_base64, filename: givenName, file_path, ...uploadOpts }) => {
      let fileData: Buffer;
      let filename: string;
      if (file_base64) {
        if (!givenName || !ALLOWED_UPLOAD_EXT.test(givenName)) {
          return toolError("filename ending in .fit, .fit.gz, .tcx or .gpx is required with file_base64.");
        }
        fileData = Buffer.from(file_base64, "base64");
        filename = basename(givenName);
      } else if (file_path) {
        const pathError = await checkUploadPath(file_path, opts);
        if (pathError) return toolError(pathError);
        try {
          fileData = Buffer.from(await readFile(await realpath(file_path)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return toolError(`Cannot read file: ${msg}`);
        }
        filename = basename(file_path);
      } else {
        return toolError("Provide file_base64 + filename, or file_path.");
      }
      if (fileData.length === 0 || fileData.length > MAX_UPLOAD_BYTES) {
        return toolError(`File must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
      }
      try {
        const data = await icu.uploadActivity(fileData, filename, uploadOpts);
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
    "Composite recovery & readiness dashboard. Computes z-scores of HRV (rMSSD), resting HR, sleep, Baevsky stress index, SpO₂, and respiratory rate against individual 30-day baselines. Returns per-metric status (green/amber/red), an overall Recovery Index 0-100, trend arrows, and red-flag alerts. Requires device-synced wellness data. IMPORTANT: (1) always interpret every numeric value using the reference_ranges in the response. (2) Single-day readings are NOISE, not signal — HRV has ±15-20% intra-individual daily variance (Plews et al. 2012). Do NOT recommend training changes based on a single day's RI. Only multi-day patterns (≥3 days of converging trends across independent metrics) warrant plan modifications. Use the interpretation_guidance in the response for decision rules.",
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

  // ======================== HIGH PRIORITY TOOLS ========================

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

  // --- get_weather_forecast ---
  server.tool(
    "get_weather_forecast",
    "Get weather forecast for the athlete's configured locations. Use to plan outdoor workouts.",
    {},
    () => safe(() => icu.getWeatherForecast()),
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

  // --- get_training_plan ---
  server.tool(
    "get_training_plan",
    "Get the athlete's current assigned training plan (folder, start date, last applied)",
    {},
    () => safe(() => icu.getTrainingPlan()),
  );

  // --- get_gear ---
  server.tool(
    "get_gear",
    "Get athlete's gear: bikes, shoes, equipment with distance/time/activities tracked and maintenance reminders",
    {},
    () => safe(() => icu.getGear()),
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

  // --- delete_activity ---
  server.tool(
    "delete_activity",
    "Delete an activity from intervals.icu. This action is irreversible.",
    {
      activity_id: z.string().describe("Activity ID to delete"),
    },
    ({ activity_id }) => safe(() => icu.deleteActivity(activity_id)),
  );

  // ======================== MEDIUM PRIORITY TOOLS ========================

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

  // --- get_fitness_model_events ---
  server.tool(
    "get_fitness_model_events",
    "Get events that influence the fitness model: eFTP changes, fitness resets, season starts, custom CTL/ATL days",
    {},
    () => safe(() => icu.getFitnessModelEvents()),
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

  // --- get_workouts ---
  server.tool(
    "get_workouts",
    "List all workouts in the athlete's workout library (templates, not calendar events)",
    {},
    () => safe(() => icu.getWorkouts()),
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

  // --- get_fatigue_resistance ---
  server.tool(
    "get_fatigue_resistance",
    "Durability analysis: compare fresh vs fatigued power curves to quantify power retention under fatigue. Computes Fatigue Resistance Score (FRS) at key durations (5s to 60min). Based on Maunder et al. (2021) durability framework. FRS > 90% = excellent durability. IMPORTANT: always interpret every numeric value using the reference_ranges in the response.",
    {
      sport: z.string().optional().describe("Sport type (default Ride)"),
      curve_type: z.string().optional().describe("Curve period, e.g. '42d', '1y', 'season' (default '42d')"),
    },
    async ({ sport, curve_type }) => {
      try {
        const result = await computeFatigueResistance(sport, curve_type);
        if (!result) return toolError("Insufficient power curve data for fatigue resistance analysis.");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_dfa_alpha1 ---
  server.tool(
    "get_dfa_alpha1",
    "DFA α1 threshold detection. Computes α1 from the activity's beat-to-beat RR intervals (chest strap with HRV/RR logging enabled) and estimates HRVT1 (α1=0.75 ≈ VT1) and HRVT2 (α1=0.50 ≈ VT2) as HR and power, by regression as in Rogers et al. (2021). Best on a graded ramp test. Optical/wrist HR and Apple Watch do NOT provide RR data. IMPORTANT: report the confidence field and interpret values using the reference_ranges in the response.",
    {
      activity_id: z.string().describe("Activity ID from a graded ramp test or steady-ramp effort"),
    },
    async ({ activity_id }) => {
      try {
        const result = await computeDfaAnalysis(activity_id);
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_polarization_analysis ---
  server.tool(
    "get_polarization_analysis",
    "Training intensity distribution (TID) on Seiler's 3-zone model (Z1-2 below LT1 | Z3-4 between LT1 and LT2 | Z5+ above LT2), aggregated from power zones for rides and HR/pace zones otherwise. Returns the Polarization Index of Treff et al. (2019) and the distribution type (polarized, pyramidal, threshold, HIIT, base). IMPORTANT: always interpret every numeric value using the reference_ranges in the response.",
    {
      days: z.number().optional().describe("Days to analyze (default 28)"),
      sport: z.string().optional().describe("Sport type (default Ride)"),
    },
    async ({ days, sport }) => {
      try {
        const result = await computePolarization(days ?? 28, sport ?? "Ride");
        if (!result) return toolError("No activities found with zone data for this sport/period.");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- get_longitudinal_trends ---
  server.tool(
    "get_longitudinal_trends",
    "Longitudinal trend analysis for key performance and recovery markers. Tracks EF (efficiency factor), power, HRR (heart rate recovery), decoupling, CTL, HRV, resting HR, weight, and sleep over time using linear regression. Flags significant changes indicating progression, overreaching, or stagnation. Includes HRR trend (Daanen et al., 2012). IMPORTANT: always interpret every value using the direction and change_pct fields.",
    {
      days: z.number().optional().describe("Days of history to analyze (default 90, min 14)"),
      sport: z.string().optional().describe("Sport type for activity metrics (default Ride)"),
    },
    async ({ days, sport }) => {
      try {
        const result = await computeTrends(days ?? 90, sport ?? "Ride");
        if (!result) return toolError("Insufficient data for trend analysis (need ≥ 3 data points).");
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // ======================== LIBRARY / EVENT EXTRAS ========================

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
  server.tool(
    "mark_event_done",
    "Mark a planned calendar workout as done: creates a manual activity matching the planned event (use when the athlete did the session without a device file).",
    { event_id: z.number().describe("Event ID of the planned workout") },
    ({ event_id }) => safe(() => icu.markEventDone(event_id)),
  );

  // --- download_event_workout ---
  server.tool(
    "download_event_workout",
    "Export a planned calendar workout as a file for other platforms: zwo (Zwift), mrc, erg (text) or fit (returned base64-encoded).",
    {
      event_id: z.number().describe("Event ID of the planned workout"),
      format: z.enum(["zwo", "mrc", "erg", "fit"]).describe("Output format"),
    },
    async ({ event_id, format }) => {
      try {
        const content = await icu.downloadEventWorkout(event_id, format);
        return safeReturn({ format, encoding: format === "fit" ? "base64" : "text", content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
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

  // --- apply_sport_settings ---
  server.tool(
    "apply_sport_settings",
    "Apply the current sport settings (FTP, thresholds, zones) to matching past activities so their zones/loads are recalculated. Runs asynchronously on intervals.icu. Use after update_sport_settings.",
    { type: z.string().describe("Sport type or settings ID: Ride, Run, Swim, etc.") },
    ({ type }) => safe(() => icu.applySportSettings(type)),
  );

  // ======================== MEDIUM PRIORITY (BATCH 2) ========================

  const recordArg = z.record(z.string(), z.unknown());

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

  // --- update_wellness_bulk ---
  server.tool(
    "update_wellness_bulk",
    "Update several wellness days in one call. Only the provided fields are changed.",
    {
      records: z
        .array(z.object({ id: dateStr.describe("Day YYYY-MM-DD") }).passthrough())
        .max(MAX_EVENTS_BATCH)
        .describe("Wellness records: { id: 'YYYY-MM-DD', weight?, restingHR?, hrv?, sleepSecs?, ... }"),
    },
    ({ records }) => safe(() => icu.updateWellnessBulk(records)),
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

  // --- create_gear ---
  server.tool(
    "create_gear",
    "Create a gear item or component (bike, shoes, chain, tyre, etc.)",
    {
      name: z.string().describe("Gear name"),
      type: z.string().describe("Gear type: Bike, Shoes, Chain, Tyre, Wheelset, etc."),
      extra: recordArg.optional().describe("Other fields: purchased, notes, distance, time, component_ids, etc."),
    },
    ({ name, type, extra }) => safe(() => icu.createGear({ name, type, ...extra })),
  );

  // --- update_gear ---
  server.tool(
    "update_gear",
    "Update a gear item or component (name, notes, retired date, etc.)",
    { gear_id: z.string().describe("Gear ID (see get_gear)"), updates: recordArg.describe("Fields to update") },
    ({ gear_id, updates }) => safe(() => icu.updateGear(gear_id, updates)),
  );

  // --- delete_gear ---
  server.tool(
    "delete_gear",
    "Delete a gear item or component. Irreversible.",
    { gear_id: z.string().describe("Gear ID") },
    ({ gear_id }) => safe(() => icu.deleteGear(gear_id)),
  );

  // --- replace_gear ---
  server.tool(
    "replace_gear",
    "Retire a component and replace it with a copy that keeps the same maintenance reminders",
    {
      gear_id: z.string().describe("Component ID to retire"),
      replacement: recordArg.describe("New component fields (name, type, purchased, etc.)"),
    },
    ({ gear_id, replacement }) => safe(() => icu.replaceGear(gear_id, replacement)),
  );

  // --- create_gear_reminder ---
  server.tool(
    "create_gear_reminder",
    "Create a maintenance reminder on a gear item, triggered by distance, time, activities or days",
    {
      gear_id: z.string().describe("Gear ID"),
      name: z.string().describe("Reminder name, e.g. 'Replace chain'"),
      distance: z.number().optional().describe("Trigger distance in meters"),
      time: z.number().optional().describe("Trigger time in seconds"),
      activities: z.number().optional().describe("Trigger after N activities"),
      days: z.number().optional().describe("Trigger after N days"),
    },
    ({ gear_id, ...reminder }) => safe(() => icu.createGearReminder(gear_id, reminder)),
  );

  // --- update_gear_reminder ---
  server.tool(
    "update_gear_reminder",
    "Update, reset or snooze a gear maintenance reminder",
    {
      gear_id: z.string().describe("Gear ID"),
      reminder_id: z.number().describe("Reminder ID (see get_gear)"),
      updates: recordArg.describe("Reminder fields to change (name, distance, time, activities, days)"),
      reset: z.boolean().optional().describe("Reset the reminder counters (maintenance done)"),
      snooze_days: z.number().optional().describe("Snooze for N days"),
    },
    ({ gear_id, reminder_id, updates, reset, snooze_days }) =>
      safe(() => icu.updateGearReminder(gear_id, reminder_id, updates, reset ?? false, snooze_days ?? 0)),
  );

  // --- delete_gear_reminder ---
  server.tool(
    "delete_gear_reminder",
    "Delete a gear maintenance reminder",
    { gear_id: z.string().describe("Gear ID"), reminder_id: z.number().describe("Reminder ID") },
    ({ gear_id, reminder_id }) => safe(() => icu.deleteGearReminder(gear_id, reminder_id)),
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

  // ======================== LOW PRIORITY (BATCH 3) ========================

  const MAX_FILE_CHARS = 2_000_000;
  const fileFormat = z.enum(["zwo", "mrc", "erg", "fit"]);

  // Large files would blow up the MCP response, so refuse instead of truncating
  async function fileResult(fn: () => Promise<string>, extra: Record<string, unknown>): Promise<ToolResult> {
    try {
      const content = await fn();
      if (content.length > MAX_FILE_CHARS) {
        return toolError(`File too large for an MCP response (${(content.length / 1e6).toFixed(1)} MB encoded).`);
      }
      return safeReturn({ ...extra, content });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`API error: ${msg}`);
    }
  }

  // --- download_workouts_zip ---
  server.tool(
    "download_workouts_zip",
    "Download all planned workouts in a date range as a zip of zwo, mrc, erg or fit files (zip returned base64-encoded, max ~1.5 MB)",
    {
      format: fileFormat.describe("File format inside the zip"),
      oldest: dateStr.describe("First day YYYY-MM-DD"),
      newest: dateStr.describe("Last day YYYY-MM-DD (inclusive)"),
    },
    ({ format, oldest, newest }) =>
      fileResult(() => icu.downloadWorkoutsZip(format, oldest, newest), {
        mime: "application/zip",
        encoding: "base64",
      }),
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

  // --- list_tags ---
  server.tool(
    "list_tags",
    "List all tags applied to calendar events or to library workouts. For activity tags use get_activity_tags.",
    { kind: z.enum(["event", "workout"]).describe("Which tags") },
    ({ kind }) => safe(() => icu.getTags(kind)),
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

  // --- get_activity_segments ---
  server.tool(
    "get_activity_segments",
    "Get the segments matched in an activity",
    { activity_id: z.string().describe("Activity ID") },
    ({ activity_id }) => safe(() => icu.getActivitySegments(activity_id)),
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

  // --- get_pace_distances ---
  server.tool(
    "get_pace_distances",
    "List the distances used for pace curves; with a sport it also returns the best-effort defaults for that sport",
    { sport: z.string().optional().describe("Sport settings ID or type, e.g. Run") },
    ({ sport }) => safe(() => icu.getPaceDistances(sport)),
  );

  // --- download_activity_file ---
  server.tool(
    "download_activity_file",
    "Download an activity file: original uploaded file, intervals.icu generated fit, or generated gpx (gpx as text, others base64, max ~1.5 MB). Not available for Strava activities.",
    {
      activity_id: z.string().describe("Activity ID"),
      kind: z.enum(["original", "fit", "gpx"]).describe("Which file"),
    },
    ({ activity_id, kind }) =>
      fileResult(() => icu.downloadActivityFile(activity_id, kind), {
        kind,
        encoding: kind === "gpx" ? "text" : "base64",
      }),
  );

  // --- export_csv ---
  server.tool(
    "export_csv",
    "Export data as CSV text for spreadsheets or external analysis: activities, wellness, gear, events, athlete power/pace/HR curves, per-activity curves range, or a single activity's streams, curves and power vs HR.",
    {
      resource: z.enum(icu.CSV_RESOURCES).describe("What to export"),
      oldest: dateStr.optional().describe("Start date YYYY-MM-DD (date-based resources)"),
      newest: dateStr.optional().describe("End date YYYY-MM-DD (date-based resources)"),
      cols: z.array(z.string()).optional().describe("Wellness only: columns to include"),
      sport: z.string().optional().describe("Curves: sport type (default Ride)"),
      curves: z.array(z.string()).optional().describe("Athlete curves: curve specs (default 1y)"),
      activity_id: z.string().optional().describe("Required for activity_* resources"),
      types: z.array(z.string()).optional().describe("activity_streams only: stream types"),
    },
    ({ resource, oldest, newest, cols, sport, curves, activity_id, types }) =>
      fileResult(
        () => icu.exportCsv(resource, { oldest, newest, cols, sport, curves, activityId: activity_id, types }),
        {
          resource,
          encoding: "text",
        },
      ),
  );

  // --- get_wellness_day ---
  server.tool(
    "get_wellness_day",
    "Get the wellness record of a single day",
    { date: dateStr.describe("Date YYYY-MM-DD") },
    ({ date }) => safe(() => icu.getWellnessDay(date)),
  );

  // --- upload_wellness_csv ---
  server.tool(
    "upload_wellness_csv",
    "Import wellness records from CSV text. The header row must use wellness field names, with an 'id' column holding the day (YYYY-MM-DD).",
    {
      csv: z.string().min(1).max(MAX_FILE_CHARS).describe("CSV content including header row"),
      ignore_missing_fields: z.boolean().optional().describe("Ignore columns that are not known wellness fields"),
    },
    ({ csv, ignore_missing_fields }) => safe(() => icu.uploadWellnessCsv(csv, ignore_missing_fields ?? false)),
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

  // --- get_matching_activities ---
  server.tool(
    "get_matching_activities",
    "List activities matched by a sport settings entry (those whose zones apply_sport_settings would update)",
    { settings_id: z.string().describe("Sport settings ID or type, e.g. Ride") },
    ({ settings_id }) => safe(() => icu.getMatchingActivities(settings_id)),
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

  // --- recalculate_gear_stats ---
  server.tool(
    "recalculate_gear_stats",
    "Recalculate distance, time and activity count of a gear item from the activities assigned to it",
    { gear_id: z.string().describe("Gear ID") },
    ({ gear_id }) => safe(() => icu.recalculateGearStats(gear_id)),
  );

  // --- list_routes ---
  server.tool("list_routes", "List the athlete's routes with activity counts (GPS path not included)", {}, () =>
    safe(() => icu.listRoutes()),
  );

  // --- get_route ---
  server.tool(
    "get_route",
    "Get a route by ID, optionally with the GPS path",
    {
      route_id: z.number().describe("Route ID (see list_routes)"),
      include_path: z.boolean().optional().describe("Include latlngs of the GPS path (large)"),
    },
    ({ route_id, include_path }) => safe(() => icu.getRoute(route_id, include_path ?? false)),
  );

  // --- update_route ---
  server.tool(
    "update_route",
    "Update a route (name, description, tags, commute flag, rename_activities)",
    { route_id: z.number().describe("Route ID"), updates: recordArg.describe("Fields to update") },
    ({ route_id, updates }) => safe(() => icu.updateRoute(route_id, updates)),
  );

  // --- get_route_similarity ---
  server.tool(
    "get_route_similarity",
    "How similar two routes are (0-1), with distances and activity counts. Use to decide whether to merge routes.",
    { route_id: z.number().describe("Route ID"), other_route_id: z.number().describe("Route ID to compare with") },
    ({ route_id, other_route_id }) => safe(() => icu.getRouteSimilarity(route_id, other_route_id)),
  );

  // --- list_chats ---
  server.tool(
    "list_chats",
    "List the athlete's chats (private, group, activity) with unread counts, most recently active first",
    {},
    () => safe(() => icu.listChats()),
  );

  // --- list_groups ---
  server.tool("list_groups", "List the groups the athlete belongs to", {}, () => safe(() => icu.listGroups()));

  // --- get_chat ---
  server.tool(
    "get_chat",
    "Get a chat by ID, including members",
    { chat_id: z.number().describe("Chat ID (see list_chats)") },
    ({ chat_id }) => safe(() => icu.getChat(chat_id)),
  );

  // --- list_chat_messages ---
  server.tool(
    "list_chat_messages",
    "List messages of a chat, most recent first",
    {
      chat_id: z.number().describe("Chat ID"),
      before_id: z.number().optional().describe("Only messages older than this message ID (pagination)"),
      limit: z.number().optional().describe("Max messages (default 30, max 100)"),
    },
    ({ chat_id, before_id, limit }) => safe(() => icu.listChatMessages(chat_id, before_id, limit)),
  );

  // --- list_activity_messages ---
  server.tool(
    "list_activity_messages",
    "List comments on an activity",
    {
      activity_id: z.string().describe("Activity ID"),
      since_id: z.number().optional().describe("Only messages after this message ID"),
      limit: z.number().optional().describe("Max messages (default 100)"),
    },
    ({ activity_id, since_id, limit }) => safe(() => icu.listActivityMessages(activity_id, since_id, limit)),
  );

  // --- add_activity_message ---
  server.tool(
    "add_activity_message",
    "Post a comment on an activity. Visible to everyone with access to the activity; confirm the text with the user first.",
    {
      activity_id: z.string().describe("Activity ID"),
      content: z.string().min(1).max(4000).describe("Comment text"),
    },
    ({ activity_id, content }) => safe(() => icu.addActivityMessage(activity_id, content)),
  );

  // --- send_chat_message ---
  server.tool(
    "send_chat_message",
    "Send a real chat message to a chat or directly to an athlete. Other people will see it; confirm recipient and text with the user first.",
    {
      content: z.string().min(1).max(4000).describe("Message text"),
      chat_id: z.number().optional().describe("Existing chat ID"),
      to_athlete_id: z.string().optional().describe("Athlete ID for a private message (when no chat_id)"),
    },
    ({ content, chat_id, to_athlete_id }) => {
      if (chat_id === undefined && to_athlete_id === undefined) return toolError("Provide chat_id or to_athlete_id.");
      return safe(() =>
        icu.sendChatMessage({
          type: "TEXT",
          content,
          ...(chat_id !== undefined && { chat_id }),
          ...(to_athlete_id !== undefined && { to_athlete_id }),
        }),
      );
    },
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

  // ======================== FULL COVERAGE (BATCH 4) ========================

  // --- update_chat_message ---
  server.tool(
    "update_chat_message",
    "Edit a chat message you sent (only content or answer can be changed). Others will see the edit.",
    {
      chat_id: z.number().describe("Chat ID"),
      message_id: z.number().describe("Message ID"),
      content: z.string().min(1).max(4000).optional().describe("New text"),
      answer: z.string().optional().describe("New answer (for request-type messages)"),
    },
    ({ chat_id, message_id, content, answer }) =>
      safe(() =>
        icu.updateChatMessage(chat_id, message_id, {
          ...(content !== undefined && { content }),
          ...(answer !== undefined && { answer }),
        }),
      ),
  );

  // --- delete_chat_message ---
  server.tool(
    "delete_chat_message",
    "Delete a chat message. Irreversible — confirm with the user first.",
    { chat_id: z.number().describe("Chat ID"), message_id: z.number().describe("Message ID") },
    ({ chat_id, message_id }) => safe(() => icu.deleteChatMessage(chat_id, message_id)),
  );

  // --- mark_chat_seen ---
  server.tool(
    "mark_chat_seen",
    "Mark a chat as read up to a given message",
    { chat_id: z.number().describe("Chat ID"), message_id: z.number().describe("Last seen message ID") },
    ({ chat_id, message_id }) => safe(() => icu.markChatSeen(chat_id, message_id)),
  );

  // --- block_chat ---
  server.tool(
    "block_chat",
    "Block or unblock the other athlete in a private chat. Confirm with the user first.",
    {
      chat_id: z.number().describe("Private chat ID"),
      blocked: z.boolean().describe("true to block, false to unblock"),
    },
    ({ chat_id, blocked }) => safe(() => icu.setChatBlocked(chat_id, blocked)),
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

  // --- import_workout_file ---
  server.tool(
    "import_workout_file",
    "Import a workout file into a library folder: .zwo, .mrc, .erg as text, or .fit as base64",
    {
      folder_id: z.number().describe("Library folder ID"),
      sport: z.string().describe("Sport type: Ride, Run, Swim, etc."),
      filename: z
        .string()
        .regex(/\.(zwo|mrc|erg|fit)$/i, "Must end in .zwo, .mrc, .erg or .fit")
        .describe("File name with extension"),
      content: z.string().min(1).max(MAX_FILE_CHARS).describe("File content: text for zwo/mrc/erg, base64 for fit"),
    },
    ({ folder_id, sport, filename, content }) =>
      safe(() => icu.importWorkoutFile(folder_id, sport, content, filename, /\.fit$/i.test(filename))),
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

  // --- upload_custom_item_image ---
  server.tool(
    "upload_custom_item_image",
    "Upload a new image (base64 PNG/JPG) for a custom item",
    {
      item_id: z.number().describe("Custom item ID"),
      filename: z
        .string()
        .regex(/\.(png|jpe?g|gif|webp)$/i, "Must be an image file name")
        .describe("Image file name"),
      image_base64: z.string().min(1).max(MAX_FILE_CHARS).describe("Image content, base64"),
    },
    ({ item_id, filename, image_base64 }) => safe(() => icu.uploadCustomItemImage(item_id, image_base64, filename)),
  );

  // --- upload_activity_streams_csv ---
  server.tool(
    "upload_activity_streams_csv",
    "Update activity streams from CSV text. Column headers must match those returned by export_csv with resource=activity_streams.",
    {
      activity_id: z.string().describe("Activity ID"),
      csv: z.string().min(1).max(MAX_FILE_CHARS).describe("CSV content including header row"),
    },
    ({ activity_id, csv }) => safe(() => icu.uploadActivityStreamsCsv(activity_id, csv)),
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

  // --- download_activity_fit_files ---
  server.tool(
    "download_activity_fit_files",
    "Download a zip of intervals.icu generated fit files for several activities (base64, max ~1.5 MB). Strava activities are excluded.",
    {
      activity_ids: z.array(z.string()).min(1).max(50).describe("Activity IDs"),
      power: z.boolean().optional().describe("Include power data (default true)"),
      hr: z.boolean().optional().describe("Include heart rate data (default true)"),
    },
    ({ activity_ids, power, hr }) =>
      fileResult(() => icu.downloadActivityFitFiles(activity_ids, power ?? true, hr ?? true), {
        mime: "application/zip",
        encoding: "base64",
      }),
  );

  // --- delete_activity_tombstone ---
  server.tool(
    "delete_activity_tombstone",
    "Remove the tombstone left by a deleted activity so the same file can be uploaded or synced again",
    { activity_id: z.string().describe("ID of the deleted activity") },
    ({ activity_id }) => safe(() => icu.deleteActivityTombstone(activity_id)),
  );

  return { mcpServer: server, toolCount, promptCount, version: VERSION };
}
