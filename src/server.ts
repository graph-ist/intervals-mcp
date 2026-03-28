import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "./intervals.js";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- Helpers ----------

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

export function createServer(): McpServer {
  const server = new McpServer({
    name: "intervals-icu",
    version: "0.2.0",
  });

  // ---------- Resources ----------

  // (glossario-triathlon and baseline-test removed — use prompts instead)

  // ---------- Prompts ----------

  server.prompt(
    "morning_check",
    "Check mattutino: wellness, HRV, sonno, prontezza per la giornata",
    {},
    async () => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Dammi il punto della situazione per oggi.\n\nUsa get_recovery_index e get_wellness_data (ultimi 7 giorni).\n\nMostra Recovery Index, metriche fisiologiche con fascia e confronto baseline, trend 7 giorni, segnali di attenzione, e raccomandazione per la giornata.\nInterpreta ogni valore usando i reference_ranges. No emoji.`,
        },
      }],
    })
  );

  server.prompt(
    "recovery_check",
    "Check serale post-allenamento: recupero, carico, rischio",
    {},
    async () => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Check serale post-allenamento.\n\nUsa get_recovery_index e get_training_load_risk.\n\nMostra Recovery Index, metriche fisiologiche con fascia, ACWR/Monotony/Strain con rischio, segnali di attenzione, e raccomandazione per domani.\nInterpreta ogni valore usando i reference_ranges. No emoji.`,
        },
      }],
    })
  );

  server.prompt(
    "weekly_review",
    "Review domenicale: settimana completa, volume, carico, trend",
    {
      oldest: z.string().optional().describe("Data inizio YYYY-MM-DD (default: 7 giorni fa)"),
      newest: z.string().optional().describe("Data fine YYYY-MM-DD (default: oggi)"),
    },
    async ({ oldest, newest }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Review settimanale dal ${oldest ?? daysAgo(7)} al ${newest ?? today()}.\n\nRecupera get_recent_activities, get_fitness_summary, get_training_load_risk, get_recovery_index, get_wellness_data (7 giorni).\n\nMostra volume per sport, TSS, CTL/ATL/TSB, ACWR e rischio carico, Recovery Index, trend della settimana, voto e suggerimenti per la prossima settimana.\nInterpreta ogni valore usando i reference_ranges. No emoji.`,
        },
      }],
    })
  );

  server.prompt(
    "activity_review",
    "Analisi post-attivita: dettagli, zone, sforzo, decoupling",
    {
      activity_id: z.string().describe("ID attivita su intervals.icu"),
    },
    async ({ activity_id }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Analizza l'attivita ${activity_id}.\n\nRecupera get_activity_detail. Se bike con potenza, aggiungi get_aerobic_decoupling e get_activity_dfrc.\n\nMostra riepilogo, metriche chiave, laps/split, zone, decoupling e dFRC se disponibili, punti di forza e cosa migliorare.\nInterpreta i valori usando i reference_ranges. No emoji.`,
        },
      }],
    })
  );

  // ---------- Tools ----------

  // --- get_athlete ---
  server.tool("get_athlete", "Get athlete profile, settings, and current fitness (CTL/ATL/TSB)", {}, async () => {
    const data = await icu.getAthlete();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // --- get_recent_activities ---
  server.tool(
    "get_recent_activities",
    "Get recent activities. Use to find latest workouts.",
    { days: z.number().optional().describe("How many days back (default 14)") },
    async ({ days }) => {
      const data = await icu.getActivities(daysAgo(days ?? 14), today());
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- search_activities ---
  server.tool(
    "search_activities",
    "Search activities by text query (name, type, etc.)",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ query, limit }) => {
      const data = await icu.searchActivities(query, limit ?? 10);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_activity_detail ---
  server.tool(
    "get_activity_detail",
    "Get full activity details including laps, intervals, and zones",
    { activity_id: z.string().describe("Activity ID") },
    async ({ activity_id }) => {
      const data = await icu.getActivity(activity_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_activity_streams ---
  server.tool(
    "get_activity_streams",
    "Get time-series data streams for an activity (power, heart rate, pace, cadence, etc.)",
    {
      activity_id: z.string().describe("Activity ID"),
      types: z.array(z.string()).describe("Stream types: watts, heartrate, velocity_smooth, cadence, altitude, latlng, distance, time"),
    },
    async ({ activity_id, types }) => {
      const data = await icu.getActivityStreams(activity_id, types);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_activity_power_curve ---
  server.tool(
    "get_activity_power_curve",
    "Get power curve (best efforts at each duration) for an activity",
    { activity_id: z.string().describe("Activity ID") },
    async ({ activity_id }) => {
      const data = await icu.getActivityPowerCurve(activity_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_activity_pace_curve ---
  server.tool(
    "get_activity_pace_curve",
    "Get pace curve (best paces at each duration) for an activity",
    { activity_id: z.string().describe("Activity ID") },
    async ({ activity_id }) => {
      const data = await icu.getActivityPaceCurve(activity_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_activity_hr_curve ---
  server.tool(
    "get_activity_hr_curve",
    "Get heart rate curve (best HR at each duration) for an activity",
    { activity_id: z.string().describe("Activity ID") },
    async ({ activity_id }) => {
      const data = await icu.getActivityHRCurve(activity_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_activity_power_vs_hr ---
  server.tool(
    "get_activity_power_vs_hr",
    "Get power vs heart rate plot for an activity (aerobic efficiency/decoupling)",
    { activity_id: z.string().describe("Activity ID") },
    async ({ activity_id }) => {
      const data = await icu.getActivityPowerVsHR(activity_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_training_load_risk ---
  server.tool(
    "get_training_load_risk",
    "Training load risk analysis: Monotony, Strain (Foster 1998), ACWR acute:chronic workload ratio with injury risk zones (Gabbett 2016). Flags spikes, monotonous blocks, and cumulative overload. Uses CTL/ATL from intervals.icu (EWMA model) and daily TSS. IMPORTANT: always interpret every numeric value using the reference_ranges in the response — state which range it falls into and what it means for the athlete.",
    {
      days: z.number().optional().describe("Days of history (default 42, min 14)"),
    },
    async ({ days }) => {
      const N = Math.max(14, days ?? 42);
      const data = await icu.getWellness(daysAgo(N), today()) as any[];
      if (!data || data.length < 7) {
        return { content: [{ type: "text", text: "Insufficient data (need ≥ 7 days)." }] };
      }
      data.sort((a: any, b: any) => a.id.localeCompare(b.id));

      // Daily loads
      const dailyLoads = data.map((d: any) => ({ date: d.id, load: d.ctlLoad ?? 0, ctl: d.ctl ?? 0, atl: d.atl ?? 0 }));

      // --- Rolling 7-day Monotony & Strain (Foster 1998) ---
      const weekly: any[] = [];
      for (let i = 6; i < dailyLoads.length; i++) {
        const week = dailyLoads.slice(i - 6, i + 1);
        const loads = week.map(d => d.load);
        const sum = loads.reduce((s, v) => s + v, 0);
        const mean = sum / 7;
        const sd = Math.sqrt(loads.reduce((s, v) => s + (v - mean) ** 2, 0) / 7);
        const monotony = sd > 0 ? mean / sd : 0;
        const strain = sum * monotony;

        let monotony_risk: string;
        if (monotony > 2.0) monotony_risk = "high";
        else if (monotony > 1.5) monotony_risk = "moderate";
        else monotony_risk = "low";

        weekly.push({
          week_ending: dailyLoads[i].date,
          weekly_load: Math.round(sum),
          daily_mean: Math.round(mean),
          monotony: Math.round(monotony * 100) / 100,
          monotony_risk,
          strain: Math.round(strain),
        });
      }

      // --- ACWR: ATL / CTL (EWMA-based from intervals.icu) ---
      const acwrHistory: any[] = [];
      for (const d of dailyLoads) {
        if (d.ctl <= 0) continue;
        const acwr = Math.round((d.atl / d.ctl) * 100) / 100;
        let risk_zone: string;
        if (acwr < 0.8) risk_zone = "undertraining";
        else if (acwr <= 1.3) risk_zone = "sweet_spot";
        else if (acwr <= 1.5) risk_zone = "danger_zone";
        else risk_zone = "spike";

        acwrHistory.push({
          date: d.date,
          atl: Math.round(d.atl * 10) / 10,
          ctl: Math.round(d.ctl * 10) / 10,
          acwr,
          risk_zone,
        });
      }

      // --- Summary flags ---
      const flags: string[] = [];
      const lastWeek = weekly[weekly.length - 1];
      if (lastWeek?.monotony > 2.0) flags.push(`Monotony high (${lastWeek.monotony}) — uniform load increases illness/injury risk (Foster 1998)`);
      if (lastWeek?.strain > 4000) flags.push(`Strain very high (${lastWeek.strain}) — cumulative overload risk`);

      const lastAcwr = acwrHistory[acwrHistory.length - 1];
      if (lastAcwr?.acwr > 1.5) flags.push(`ACWR spike (${lastAcwr.acwr}) — 3-5× injury risk (Gabbett 2016)`);
      else if (lastAcwr?.acwr > 1.3) flags.push(`ACWR elevated (${lastAcwr.acwr}) — ~2× injury risk (danger zone)`);
      else if (lastAcwr?.acwr < 0.8) flags.push(`ACWR low (${lastAcwr.acwr}) — detraining risk`);

      // Week-over-week load change
      if (weekly.length >= 2) {
        const prev = weekly[weekly.length - 2].weekly_load;
        const curr = lastWeek.weekly_load;
        if (prev > 0) {
          const pctChange = Math.round(((curr - prev) / prev) * 100);
          if (pctChange > 30) flags.push(`Weekly load spike +${pctChange}% week-over-week (>30% threshold)`);
        }
      }

      const result = {
        today: {
          acwr: lastAcwr,
          monotony: lastWeek,
          flags: flags.length > 0 ? flags : ["No risk flags — training load looks balanced"],
        },
        weekly_history: weekly.slice(-6), // last 6 weeks
        acwr_history: acwrHistory.slice(-14), // last 14 days
        daily_loads: dailyLoads.slice(-14),
        reference_ranges: {
          acwr: [
            { range: "< 0.80", label: "Undertraining", meaning: "Carico troppo basso — rischio decondizionamento e perdita di fitness" },
            { range: "0.80–1.30", label: "Sweet spot", meaning: "Zona ottimale — rischio infortunio minimizzato, buon adattamento" },
            { range: "1.30–1.50", label: "Danger zone", meaning: "Carico acuto elevato vs cronico — ~2× rischio infortunio" },
            { range: "> 1.50", label: "Spike", meaning: "Incremento brusco — 3-5× rischio infortunio, ridurre subito" },
          ],
          monotony: [
            { range: "< 1.5", label: "Bassa", meaning: "Buona variazione del carico giorno per giorno" },
            { range: "1.5–2.0", label: "Moderata", meaning: "Carico abbastanza uniforme — attenzione" },
            { range: "> 2.0", label: "Alta", meaning: "Carico troppo uniforme — associato a malattie (URTI) e infortuni" },
          ],
          weekly_load_tss: [
            { range: "< 300", label: "Basso", meaning: "Volume leggero — recupero o off-season" },
            { range: "300–500", label: "Moderato", meaning: "Volume base — mantenimento fitness" },
            { range: "500–700", label: "Alto", meaning: "Volume significativo — blocco di carico" },
            { range: "700–900", label: "Molto alto", meaning: "Settimana intensa — richiede recupero" },
            { range: "> 900", label: "Estremo", meaning: "Camp o settimana gara multipla — rischio sovraccarico" },
          ],
          ctl_fitness: [
            { range: "< 30", label: "Basso", meaning: "Fitness base — principiante o post-pausa" },
            { range: "30–50", label: "Moderato", meaning: "Amatore regolare" },
            { range: "50–80", label: "Buono", meaning: "Amatore allenato — può gestire blocchi impegnativi" },
            { range: "80–110", label: "Alto", meaning: "Atleta dedicato / semi-pro" },
            { range: "> 110", label: "Elite", meaning: "Volume pro — richiede gestione attenta del recupero" },
          ],
          tsb_form: [
            { range: "+15 a +25", label: "Fresco", meaning: "Picco di forma per gara o test" },
            { range: "+5 a +15", label: "Riposato", meaning: "Buona forma, pronto per intensità" },
            { range: "−5 a +5", label: "Neutro", meaning: "Equilibrio carico/recupero" },
            { range: "−15 a −5", label: "Affaticato", meaning: "Normale durante blocchi di carico" },
            { range: "−30 a −15", label: "Sovraccarico", meaning: "Fatica significativa — pianificare scarico" },
            { range: "< −30", label: "Critico", meaning: "Rischio overreaching — riposo necessario" },
          ],
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
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
      const excludeStart = (exclude_start_minutes ?? 10) * 60;
      const excludeEnd = (exclude_end_minutes ?? 5) * 60;

      // Fetch streams and activity in parallel
      const [streams, activity] = await Promise.all([
        icu.getActivityStreams(activity_id, ["time", "watts", "heartrate"]) as Promise<any>,
        icu.getActivity(activity_id) as Promise<any>,
      ]);

      const timeArr: number[] = streams?.time?.data ?? streams?.time ?? [];
      const powerArr: number[] = streams?.watts?.data ?? streams?.watts ?? [];
      const hrArr: number[] = streams?.heartrate?.data ?? streams?.heartrate ?? [];

      if (timeArr.length === 0 || powerArr.length === 0 || hrArr.length === 0) {
        return { content: [{ type: "text", text: "Missing streams (need time, watts, heartrate)." }] };
      }

      const totalDuration = timeArr[timeArr.length - 1];
      const startCut = excludeStart;
      const endCut = totalDuration - excludeEnd;

      // Filter to analysis window and valid data points (HR > 0, power > 0)
      const validPoints: { t: number; p: number; hr: number }[] = [];
      for (let i = 0; i < timeArr.length; i++) {
        if (timeArr[i] >= startCut && timeArr[i] <= endCut && powerArr[i] > 0 && hrArr[i] > 0) {
          validPoints.push({ t: timeArr[i], p: powerArr[i], hr: hrArr[i] });
        }
      }

      if (validPoints.length < 60) {
        return { content: [{ type: "text", text: "Insufficient valid data after excluding warm-up/cool-down." }] };
      }

      const midpoint = Math.floor(validPoints.length / 2);
      const firstHalf = validPoints.slice(0, midpoint);
      const secondHalf = validPoints.slice(midpoint);

      function halfStats(pts: typeof validPoints) {
        const avgP = pts.reduce((s, p) => s + p.p, 0) / pts.length;
        const avgHR = pts.reduce((s, p) => s + p.hr, 0) / pts.length;
        return { avgP: Math.round(avgP), avgHR: Math.round(avgHR * 10) / 10, ef: avgP / avgHR };
      }

      const h1 = halfStats(firstHalf);
      const h2 = halfStats(secondHalf);

      const decoupling = ((h1.ef - h2.ef) / h1.ef) * 100;

      let assessment: string;
      if (Math.abs(decoupling) < 3) assessment = "Excellent coupling — strong aerobic base";
      else if (Math.abs(decoupling) < 5) assessment = "Good — aerobic base adequate";
      else if (decoupling > 0 && decoupling < 8) assessment = "Moderate drift — aerobic base needs work";
      else if (decoupling >= 8) assessment = "Significant drift — insufficient aerobic fitness or pacing issue";
      else assessment = "Negative drift — unusual, check data quality or early fatigue";

      // Also compute rolling EF for chart data (30-second windows)
      const efCurve: { t_min: number; ef: number; power: number; hr: number }[] = [];
      const windowSize = 30; // seconds
      for (let i = 0; i < validPoints.length; i += Math.max(1, Math.floor(validPoints.length / 100))) {
        const windowPts = validPoints.filter(p =>
          p.t >= validPoints[i].t && p.t < validPoints[i].t + windowSize
        );
        if (windowPts.length >= 5) {
          const avgP = windowPts.reduce((s, p) => s + p.p, 0) / windowPts.length;
          const avgHR = windowPts.reduce((s, p) => s + p.hr, 0) / windowPts.length;
          efCurve.push({
            t_min: Math.round((validPoints[i].t - startCut) / 60 * 10) / 10,
            ef: Math.round((avgP / avgHR) * 1000) / 1000,
            power: Math.round(avgP),
            hr: Math.round(avgHR),
          });
        }
      }

      const result = {
        activity: { id: activity_id, name: activity?.name, type: activity?.type },
        analysis_window: {
          start_min: Math.round(startCut / 60),
          end_min: Math.round(endCut / 60),
          duration_min: Math.round((endCut - startCut) / 60),
          valid_points: validPoints.length,
        },
        first_half: { avg_power: h1.avgP, avg_hr: h1.avgHR, efficiency_factor: Math.round(h1.ef * 1000) / 1000 },
        second_half: { avg_power: h2.avgP, avg_hr: h2.avgHR, efficiency_factor: Math.round(h2.ef * 1000) / 1000 },
        decoupling_pct: Math.round(decoupling * 100) / 100,
        assessment,
        ef_curve: efCurve,
        reference_ranges: {
          decoupling_pct: [
            { range: "< 3%", label: "Eccellente", meaning: "Base aerobica solida — HR stabile, buon adattamento periferico" },
            { range: "3–5%", label: "Buono", meaning: "Base adeguata — la HR sale leggermente nella 2ª metà" },
            { range: "5–8%", label: "Moderato", meaning: "Base aerobica da migliorare — più volume Z2 necessario" },
            { range: "> 8%", label: "Significativo", meaning: "Drift HR eccessivo — fitness aerobico insufficiente, o pacing troppo aggressivo, o disidratazione" },
            { range: "< 0% (negativo)", label: "Inusuale", meaning: "HR scende nella 2ª metà — controllare dati o warm-up troppo lungo" },
          ],
          efficiency_factor: [
            { range: "Trend ↑ nel tempo", label: "Miglioramento", meaning: "A parità di potenza serve meno HR — adattamento aerobico in corso" },
            { range: "Stabile", label: "Mantenimento", meaning: "Fitness aerobico costante" },
            { range: "Trend ↓ nel tempo", label: "Peggioramento", meaning: "Possibile overtraining, malattia o decondizionamento" },
          ],
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- get_wellness_data ---
  server.tool(
    "get_wellness_data",
    "Get wellness data: CTL, ATL, TSB, weight, restingHR, HRV, sleep, mood, fatigue, etc.",
    { days: z.number().optional().describe("How many days back (default 30)") },
    async ({ days }) => {
      const data = await icu.getWellness(daysAgo(days ?? 30), today());
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_fitness_summary ---
  server.tool(
    "get_fitness_summary",
    "Get athlete training volume and load totals for a date range: total hours, km, TSS, number of activities broken down by sport. This is INPUT load data (what you did), not OUTPUT readiness (how your body responded). Use get_recovery_index for readiness, get_training_load_risk for load risk patterns.",
    {
      oldest: z.string().optional().describe("Start date YYYY-MM-DD (default 42 days ago)"),
      newest: z.string().optional().describe("End date YYYY-MM-DD (default today)"),
    },
    async ({ oldest, newest }) => {
      const data = await icu.getAthleteSummary(oldest ?? daysAgo(42), newest ?? today());
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_power_curves ---
  server.tool(
    "get_power_curves",
    "Get power curves (season bests, recent, etc.)",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y (past year), 42d (past 42 days), s0 (current season), s1 (previous season), all"),
    },
    async ({ sport, curves }) => {
      const data = await icu.getPowerCurves(sport ?? "Ride", curves ?? ["1y"]);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_pace_curves ---
  server.tool(
    "get_pace_curves",
    "Get pace curves for running",
    {
      sport: z.string().optional().describe("Sport type: Run (default), Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y, 42d, s0, s1, all"),
    },
    async ({ sport, curves }) => {
      const data = await icu.getPaceCurves(sport ?? "Run", curves ?? ["1y"]);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_hr_curves ---
  server.tool(
    "get_hr_curves",
    "Get heart rate curves",
    {
      sport: z.string().optional().describe("Sport type: Ride (default), Run, Swim, etc."),
      curves: z.array(z.string()).optional().describe("Curve specs: 1y, 42d, s0, s1, all"),
    },
    async ({ sport, curves }) => {
      const data = await icu.getHRCurves(sport ?? "Ride", curves ?? ["1y"]);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_sport_settings ---
  server.tool(
    "get_sport_settings",
    "Get sport settings (zones, FTP, threshold pace, max HR, etc.)",
    {},
    async () => {
      const data = await icu.getSportSettings();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_events ---
  server.tool(
    "get_events",
    "Get calendar events (workouts, races, notes) for a date range. Replaces get_training_plan and get_planned_workouts.",
    {
      oldest: z.string().optional().describe("Start date YYYY-MM-DD (default today)"),
      newest: z.string().optional().describe("End date YYYY-MM-DD (default 14 days from now)"),
      category: z.enum(["WORKOUT", "RACE", "NOTE"]).optional().describe("Filter by event category (default: all)"),
    },
    async ({ oldest, newest, category }) => {
      const data = await icu.getEvents(oldest ?? today(), newest ?? daysFromNow(14), category);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_power_hr_curve ---
  server.tool(
    "get_power_hr_curve",
    "Get power vs HR relationship curve for a date range (aerobic efficiency trend)",
    {
      oldest: z.string().optional().describe("Start date (default 90 days ago)"),
      newest: z.string().optional().describe("End date (default today)"),
    },
    async ({ oldest, newest }) => {
      const data = await icu.getPowerHRCurve(oldest ?? daysAgo(90), newest ?? today());
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
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
    async ({ name, type, config }) => {
      const data = await icu.createCustomItem({ name, type, ...config });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- create_training_plan ---
  server.tool(
    "create_training_plan",
    "Create multiple workout events on the intervals.icu calendar in batch. Use this to build a periodized training plan with TSS targets. Each event needs at minimum: start_date_local (YYYY-MM-DD), category ('WORKOUT'), type (sport: 'Run','Ride','Swim','Brick'), name, and optionally load_target (TSS) and description.",
    {
      events: z.array(z.object({
        start_date_local: z.string().describe("Date YYYY-MM-DD"),
        category: z.string().default("WORKOUT").describe("Event category: WORKOUT, NOTE, TARGET, RACE"),
        type: z.string().describe("Sport type: Run, Ride, Swim, Brick, WeightTraining, etc."),
        name: z.string().describe("Workout name"),
        description: z.string().optional().describe("Workout description/instructions"),
        load_target: z.number().optional().describe("TSS/load target for this workout"),
        moving_time: z.number().optional().describe("Target duration in seconds"),
        distance: z.number().optional().describe("Target distance in meters"),
        color: z.string().optional().describe("Event color hex"),
      })).describe("Array of events to create"),
    },
    async ({ events }) => {
      const data = await icu.createEvents(events);
      return { content: [{ type: "text", text: `Created ${data.length} events:\n${JSON.stringify(data, null, 2)}` }] };
    }
  );

  // --- update_event ---
  server.tool(
    "update_event",
    "Update an existing event on the intervals.icu calendar",
    {
      event_id: z.number().describe("Event ID to update"),
      updates: z.record(z.string(), z.unknown()).describe("Fields to update (name, description, load_target, type, etc.)"),
    },
    async ({ event_id, updates }) => {
      const data = await icu.updateEvent(event_id, updates);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- delete_event ---
  server.tool(
    "delete_event",
    "Delete an event from the intervals.icu calendar",
    {
      event_id: z.number().describe("Event ID to delete"),
    },
    async ({ event_id }) => {
      const data = await icu.deleteEvent(event_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- update_sport_settings ---
  server.tool(
    "update_sport_settings",
    "Update sport settings (FTP, LTHR, MaxHR, W', zones, etc.) by sport type",
    {
      type: z.string().describe("Sport type: Ride, Run, Swim, etc."),
      settings: z.record(z.string(), z.unknown()).describe("Settings to update (ftp, lthr, max_hr, w_prime, p_max, threshold_pace, power_zones, hr_zones, etc.)"),
    },
    async ({ type, settings }) => {
      const data = await icu.updateSportSettings(type, settings);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- upload_activity ---
  server.tool(
    "upload_activity",
    "Upload an activity file (FIT, TCX, GPX or gzipped) to intervals.icu",
    {
      file_path: z.string().describe("Absolute path to the activity file"),
    },
    async ({ file_path }) => {
      const fileData = readFileSync(file_path);
      const filename = basename(file_path);
      const data = await icu.uploadActivity(fileData, filename);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- get_folders ---
  server.tool(
    "get_folders",
    "Get workout library folders and plans",
    {},
    async () => {
      const data = await icu.getFolders();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- update_wellness ---
  server.tool(
    "update_wellness",
    "Update wellness data for a date (weight, restingHR, HRV, sleep, mood, fatigue, comments, etc.)",
    {
      date: z.string().describe("Date YYYY-MM-DD"),
      data: z.record(z.string(), z.unknown()).describe("Wellness fields to update (weight, restingHR, hrv, sleepSecs, sleepQuality, soreness, fatigue, stress, mood, motivation, injury, spO2, comments, etc.)"),
    },
    async ({ date, data }) => {
      const result = await icu.updateWellness(date, data);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- get_recovery_index ---
  server.tool(
    "get_recovery_index",
    "Composite recovery & readiness dashboard. Computes z-scores of HRV (rMSSD), resting HR, sleep, Baevsky stress index, SpO₂, and respiratory rate against individual 30-day baselines. Returns per-metric status (green/amber/red), an overall Recovery Index 0-100, trend arrows, and red-flag alerts. Requires device-synced wellness data. IMPORTANT: always interpret every numeric value using the reference_ranges in the response — state which range it falls into and what it means for the athlete.",
    {
      days: z.number().optional().describe("Days of history for analysis (default 30, min 14)"),
    },
    async ({ days }) => {
      const N = Math.max(14, days ?? 30);
      // Fetch N + 30 days so we have baseline for the oldest analysis day
      const data = await icu.getWellness(daysAgo(N + 30), today()) as any[];
      if (!data || data.length < 7) {
        return { content: [{ type: "text", text: "Insufficient wellness data (need ≥ 7 days with device sync)." }] };
      }

      // Sort chronologically
      data.sort((a: any, b: any) => a.id.localeCompare(b.id));

      // Metrics we track: [field, higher_is_better]
      const METRICS: [string, boolean][] = [
        ["hrv", true],           // rMSSD — higher = more parasympathetic = better
        ["restingHR", false],    // lower = better
        ["avgSleepingHR", false],// lower = better
        ["sleepSecs", true],     // more sleep = better
        ["sleepScore", true],    // higher = better
        ["baevskySI", false],    // lower = less stress = better
        ["spO2", true],          // higher = better
        ["respiration", false],  // lower = better (elevated = stress/fatigue)
      ];

      // Compute rolling 30-day mean and SD for each metric
      function stats(arr: number[]): { mean: number; sd: number } {
        if (arr.length === 0) return { mean: 0, sd: 1 };
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
        return { mean, sd: Math.max(Math.sqrt(variance), 0.001) };
      }

      // Build daily analysis for last N days
      const analysisStart = data.length > N ? data.length - N : 0;
      const results: any[] = [];

      for (let i = analysisStart; i < data.length; i++) {
        const day = data[i];
        const dayResult: any = { date: day.id, metrics: {}, readiness_device: day.readiness ?? null };

        for (const [field, higherBetter] of METRICS) {
          const val = day[field];
          if (val == null) continue;

          // Baseline: up to 30 days before this day
          const baseline: number[] = [];
          for (let j = Math.max(0, i - 30); j < i; j++) {
            const v = data[j]?.[field];
            if (v != null) baseline.push(v);
          }
          if (baseline.length < 5) continue;

          const { mean, sd } = stats(baseline);
          const zRaw = (val - mean) / sd;
          // Positive z = good if higherBetter, bad if !higherBetter
          const z = higherBetter ? zRaw : -zRaw;

          let status: string;
          if (z >= -0.5) status = "green";
          else if (z >= -1.5) status = "amber";
          else status = "red";

          // 7-day trend
          const recent7: number[] = [];
          for (let j = Math.max(0, i - 6); j <= i; j++) {
            const v = data[j]?.[field];
            if (v != null) recent7.push(v);
          }
          let trend = "→";
          if (recent7.length >= 3) {
            const first = recent7.slice(0, Math.floor(recent7.length / 2));
            const second = recent7.slice(Math.floor(recent7.length / 2));
            const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
            const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
            const delta = (avgSecond - avgFirst) / sd;
            if (higherBetter) {
              trend = delta > 0.3 ? "↑" : delta < -0.3 ? "↓" : "→";
            } else {
              trend = delta < -0.3 ? "↑" : delta > 0.3 ? "↓" : "→";
            }
          }

          dayResult.metrics[field] = {
            value: Math.round(val * 100) / 100,
            baseline_mean: Math.round(mean * 100) / 100,
            z_score: Math.round(z * 100) / 100,
            status,
            trend,
          };
        }

        // Composite Recovery Index (0-100)
        const metricEntries = Object.values(dayResult.metrics) as any[];
        if (metricEntries.length >= 3) {
          // Weighted z-scores → sigmoid → 0-100
          const weights: Record<string, number> = {
            hrv: 3,
            restingHR: 2,
            avgSleepingHR: 2,
            sleepSecs: 2,
            sleepScore: 2,
            baevskySI: 2,
            spO2: 1,
            respiration: 1,
          };
          let wSum = 0, zSum = 0;
          for (const [field, m] of Object.entries(dayResult.metrics) as [string, any][]) {
            const w = weights[field] ?? 1;
            zSum += m.z_score * w;
            wSum += w;
          }
          const avgZ = zSum / wSum;
          // Sigmoid mapping: z=0 → 70 (normal), z=+2 → ~95, z=-2 → ~30
          const recoveryIndex = Math.round(100 / (1 + Math.exp(-1.2 * (avgZ + 0.5))));
          dayResult.recovery_index = recoveryIndex;

          // Classification
          if (recoveryIndex >= 80) dayResult.status = "Recovered";
          else if (recoveryIndex >= 60) dayResult.status = "Moderate";
          else if (recoveryIndex >= 40) dayResult.status = "Strained";
          else dayResult.status = "At risk";
        }

        // Red flags
        const flags: string[] = [];
        const hrvM = dayResult.metrics.hrv;
        if (hrvM && hrvM.z_score < -2) flags.push(`HRV critically low (${hrvM.value} ms, z=${hrvM.z_score})`);
        const rhrM = dayResult.metrics.restingHR;
        if (rhrM && rhrM.z_score < -2) flags.push(`Resting HR elevated (${rhrM.value} bpm, z=${rhrM.z_score})`);
        const baeM = dayResult.metrics.baevskySI;
        if (baeM && baeM.z_score < -1.5) flags.push(`Autonomic stress high (Baevsky SI=${baeM.value}, z=${baeM.z_score})`);
        const spo2M = dayResult.metrics.spO2;
        if (spo2M && spo2M.value < 95) flags.push(`SpO₂ low (${spo2M.value}%)`);
        if (day.systolic && day.systolic > 140) flags.push(`Systolic BP elevated (${day.systolic} mmHg)`);
        if (day.diastolic && day.diastolic > 90) flags.push(`Diastolic BP elevated (${day.diastolic} mmHg)`);
        if (flags.length > 0) dayResult.red_flags = flags;

        // Blood pressure if available
        if (day.systolic && day.diastolic) {
          dayResult.blood_pressure = { systolic: day.systolic, diastolic: day.diastolic };
        }

        // Training load context
        dayResult.training_load = { ctl: day.ctl, atl: day.atl, tsb: day.ctl - day.atl, ramp_rate: day.rampRate };

        results.push(dayResult);
      }

      // Summary: today + trend
      const todayResult = results[results.length - 1];
      const summary = {
        today: todayResult,
        period_days: results.length,
        avg_recovery_index: Math.round(results.reduce((s, r) => s + (r.recovery_index ?? 0), 0) / results.filter(r => r.recovery_index != null).length),
        red_flag_days: results.filter(r => r.red_flags?.length > 0).length,
        history: results.slice(-7), // last 7 days detail
        reference_ranges: {
          recovery_index: [
            { range: "≥ 80", label: "Recovered", meaning: "Pronto per intensità alta, intervalli, gare" },
            { range: "60–79", label: "Moderate", meaning: "Allenamento base/endurance OK, evitare intensità massimale" },
            { range: "40–59", label: "Strained", meaning: "Corpo sotto stress — ridurre volume e intensità" },
            { range: "< 40", label: "At risk", meaning: "Riposo attivo o completo, rischio overtraining/malattia" },
          ],
          tsb_form: [
            { range: "+15 a +25", label: "Fresco", meaning: "Picco di forma, ideale per gara o test" },
            { range: "+5 a +15", label: "Riposato", meaning: "Buona forma, può spingere" },
            { range: "−5 a +5", label: "Neutro", meaning: "Equilibrio carico/recupero" },
            { range: "−15 a −5", label: "Affaticato", meaning: "Accumulo di fatica — normale in blocchi di carico" },
            { range: "−30 a −15", label: "Sovraccarico", meaning: "Fatica significativa — monitorare recovery" },
            { range: "< −30", label: "Critico", meaning: "Rischio overreaching — necessario scarico" },
          ],
          hrv_rmssd: [
            { range: "z ≥ 0", label: "Sopra baseline", meaning: "Buon tono vagale, recovery adeguato" },
            { range: "z −0.5 a 0", label: "Nella norma", meaning: "Variazione fisiologica normale" },
            { range: "z −1.5 a −0.5", label: "Sotto baseline", meaning: "Possibile fatica accumulata o stress" },
            { range: "z < −1.5", label: "Drop significativo", meaning: "Stress autonomico — controllare sonno, carico, malattia" },
          ],
          resting_hr: [
            { range: "z ≥ 0", label: "Nella norma o sotto", meaning: "Buon recupero" },
            { range: "z −0.5 a 0", label: "Leggermente sopra", meaning: "Variazione normale" },
            { range: "z −1.5 a −0.5", label: "Elevata", meaning: "Possibile fatica, disidratazione o stress" },
            { range: "z < −1.5", label: "Molto elevata", meaning: "Segnale d'allarme — verificare malattia/overtraining" },
          ],
          sleep_hours: [
            { range: "≥ 8h", label: "Ottimale", meaning: "Recovery completo, adattamento massimizzato" },
            { range: "7–8h", label: "Adeguato", meaning: "Sufficiente per la maggior parte degli atleti" },
            { range: "6–7h", label: "Insufficiente", meaning: "Compromesso il recupero, +30% rischio infortunio" },
            { range: "< 6h", label: "Critico", meaning: "Impatto severo su performance, reazione, immunità" },
          ],
          baevsky_si: [
            { range: "< 50", label: "Basso", meaning: "Dominanza parasimpatica, buon recupero" },
            { range: "50–150", label: "Normale", meaning: "Equilibrio autonomico" },
            { range: "150–500", label: "Elevato", meaning: "Attivazione simpatica — stress, fatica o malattia" },
            { range: "> 500", label: "Molto elevato", meaning: "Stress autonomico severo" },
          ],
          spo2: [
            { range: "97–100%", label: "Normale", meaning: "Saturazione ottimale" },
            { range: "95–96%", label: "Basso-normale", meaning: "Accettabile a livello del mare" },
            { range: "93–94%", label: "Basso", meaning: "Possibile altitudine, affaticamento o patologia" },
            { range: "< 93%", label: "Critico", meaning: "Consultare un medico" },
          ],
          blood_pressure: [
            { range: "< 120/80", label: "Ottimale", meaning: "Pressione ideale" },
            { range: "120–129/<80", label: "Elevata", meaning: "Monitorare, stile di vita" },
            { range: "130–139/80–89", label: "Ipertensione stadio 1", meaning: "Consultare medico" },
            { range: "≥ 140/≥ 90", label: "Ipertensione stadio 2", meaning: "Trattamento necessario" },
          ],
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // --- get_activity_dfrc ---
  server.tool(
    "get_activity_dfrc",
    "Calculate Dynamic Functional Reserve Capacity (dFRC) for an activity. Shows real-time depletion and recovery of the anaerobic battery (W'/FRC) throughout the workout, based on Skiba's W'bal differential model. Returns summary stats and time-series chart data. IMPORTANT: always interpret every numeric value using the reference_ranges in the response.",
    {
      activity_id: z.string().describe("Activity ID"),
      model: z.enum(["FFT_CURVES", "MORTON_3P", "ECP", "MS_2P", "sport_settings"]).optional()
        .describe("PD model source for FTP/W'. FFT_CURVES (default, matches intervals.icu UI), MORTON_3P, ECP (highest W'), MS_2P, or sport_settings (manual values). Ignored if both ftp_override and frc_override are set."),
      curve: z.string().optional().describe("Power curve time window: 42d (default), 1y, s0, all"),
      ftp_override: z.number().optional().describe("Override FTP (watts). Takes priority over model."),
      frc_override: z.number().optional().describe("Override FRC/W' (joules). Takes priority over model."),
    },
    async ({ activity_id, model, curve, ftp_override, frc_override }) => {
      // Fetch power stream and activity in parallel
      const [streams, activity] = await Promise.all([
        icu.getActivityStreams(activity_id, ["time", "watts"]) as Promise<any>,
        icu.getActivity(activity_id) as Promise<any>,
      ]);

      const sportType = activity?.type ?? "Ride";
      let ftp = ftp_override;
      let frc = frc_override;
      let modelUsed = "override";
      const preferredModel = model ?? "FFT_CURVES";
      const curveWindow = curve ?? "42d";

      // Fetch power curves and sport settings to list all available models
      const [curves, settings] = await Promise.all([
        icu.getPowerCurves(sportType, [curveWindow]).catch(() => null) as Promise<any>,
        icu.getSportSettings() as Promise<any>,
      ]);

      const curveData = (curves as any)?.list?.[0];
      const pdModels: any[] = curveData?.powerModels ?? [];
      const ss = Array.isArray(settings)
        ? settings.find((s: any) => s.types?.includes(sportType)) ?? settings[0]
        : settings;

      // Build available models list
      const availableModels: { id: string; ftp: number; wPrime: number; pMax?: number }[] = [];
      for (const m of pdModels) {
        availableModels.push({
          id: m.type,
          ftp: m.ftp ?? m.criticalPower,
          wPrime: m.wPrime,
          ...(m.pMax ? { pMax: m.pMax } : {}),
        });
      }
      availableModels.push({
        id: "sport_settings",
        ftp: ss?.ftp ?? 200,
        wPrime: ss?.w_prime ?? ss?.wPrime ?? 20000,
      });

      if (!ftp || !frc) {
        if (preferredModel === "sport_settings") {
          if (!ftp) ftp = ss?.ftp ?? 200;
          if (!frc) frc = ss?.w_prime ?? ss?.wPrime ?? 20000;
          modelUsed = "sport_settings";
        } else {
          const pdModel = pdModels.find((m: any) => m.type === preferredModel)
            ?? pdModels.find((m: any) => m.type === "FFT_CURVES")
            ?? pdModels.find((m: any) => m.type === "MORTON_3P");

          if (pdModel) {
            if (!ftp) ftp = pdModel.ftp ?? pdModel.criticalPower;
            if (!frc) frc = pdModel.wPrime;
            modelUsed = pdModel.type;
          } else {
            if (!ftp) ftp = ss?.ftp ?? 200;
            if (!frc) frc = ss?.w_prime ?? ss?.wPrime ?? 20000;
            modelUsed = "sport_settings";
          }
        }
      }

      // Extract time and power arrays (handle different API response shapes)
      let timeArr: number[];
      let powerArr: number[];

      if (Array.isArray(streams)) {
        const timeStream = streams.find((s: any) => s.type === "time");
        const wattsStream = streams.find((s: any) => s.type === "watts");
        timeArr = timeStream?.data ?? [];
        powerArr = wattsStream?.data ?? [];
      } else {
        timeArr = streams?.time?.data ?? streams?.time ?? [];
        powerArr = streams?.watts?.data ?? streams?.watts ?? [];
      }

      if (powerArr.length === 0) {
        return { content: [{ type: "text", text: "No power data available for this activity." }] };
      }

      // Generate time array if missing (assume 1-second recording)
      if (timeArr.length === 0) {
        timeArr = powerArr.map((_: number, i: number) => i);
      }

      // ---- Compute dFRC using Skiba's W'bal differential model ----
      // When P > FTP: W'bal drains linearly at (P - FTP) joules/sec
      // When P <= FTP: W'bal recovers exponentially toward W'
      //   W'bal = W' - (W' - W'bal_prev) * exp(-(FTP - P) * dt / W')
      const dfrcValues: number[] = new Array(powerArr.length);
      let wBal = frc!;

      for (let i = 0; i < powerArr.length; i++) {
        const p = powerArr[i] ?? 0;
        const dt = i > 0 ? Math.max(timeArr[i] - timeArr[i - 1], 0) : 0;

        if (dt > 0) {
          if (p > ftp!) {
            wBal = wBal - (p - ftp!) * dt;
          } else {
            wBal = frc! - (frc! - wBal) * Math.exp(-(ftp! - p) * dt / frc!);
          }
        }
        dfrcValues[i] = wBal;
      }

      // ---- Summary statistics ----
      const totalDuration = timeArr[timeArr.length - 1];
      let minDfrc = frc!;
      let sumDfrc = 0;
      let timeBelowZero = 0;
      let timeBelow25 = 0;

      for (let i = 0; i < dfrcValues.length; i++) {
        const dt = i > 0 ? Math.max(timeArr[i] - timeArr[i - 1], 0) : 0;
        if (dfrcValues[i] < minDfrc) minDfrc = dfrcValues[i];
        sumDfrc += dfrcValues[i];
        if (dfrcValues[i] < 0) timeBelowZero += dt;
        if (dfrcValues[i] < frc! * 0.25) timeBelow25 += dt;
      }

      // Downsample for output: target ~500 points max
      const step = Math.max(1, Math.floor(powerArr.length / 500));
      const chartData: { t: number; p: number; dfrc: number; pct: number }[] = [];
      for (let i = 0; i < powerArr.length; i += step) {
        chartData.push({
          t: timeArr[i],
          p: powerArr[i],
          dfrc: Math.round(dfrcValues[i]),
          pct: Math.round((dfrcValues[i] / frc!) * 100),
        });
      }

      const result = {
        activity: { id: activity_id, name: activity?.name, type: sportType },
        parameters: {
          model: modelUsed,
          ftp: ftp!,
          frc_joules: frc!,
          frc_kj: Math.round(frc! / 100) / 10,
        },
        available_models: availableModels,
        summary: {
          duration_seconds: totalDuration,
          min_dfrc_joules: Math.round(minDfrc),
          min_dfrc_kj: Math.round(minDfrc / 100) / 10,
          min_dfrc_pct: Math.round((minDfrc / frc!) * 100),
          max_depletion_pct: Math.round((1 - minDfrc / frc!) * 100),
          time_below_zero_seconds: timeBelowZero,
          time_below_25pct_seconds: timeBelow25,
          avg_dfrc_pct: Math.round((sumDfrc / dfrcValues.length / frc!) * 100),
        },
        chart_data: chartData,
        reference_ranges: {
          dfrc_pct: [
            { range: "75–100%", label: "Pieno", meaning: "Riserva anaerobica quasi intatta — sforzo sotto soglia" },
            { range: "50–75%", label: "Parzialmente usato", meaning: "Sforzi sopra soglia ma gestibili — ritmo gara sostenibile" },
            { range: "25–50%", label: "Basso", meaning: "Riserva limitata — pochi scatti rimasti, gestire il pacing" },
            { range: "0–25%", label: "Critico", meaning: "Quasi esaurito — uno sforzo intenso può portare al collasso" },
            { range: "< 0%", label: "In debito", meaning: "W' esaurito — potenza sopra-soglia non più sostenibile" },
          ],
          max_depletion_pct: [
            { range: "< 50%", label: "Conservativo", meaning: "Attività facile o sotto soglia — batteria poco usata" },
            { range: "50–75%", label: "Moderato", meaning: "Sforzo significativo — tipico gara endurance" },
            { range: "75–100%", label: "Profondo", meaning: "Quasi al limite — tipico crono o finale di gara" },
            { range: "> 100%", label: "In debito", meaning: "Andato oltre il limite — recupero parziale durante l'attività" },
          ],
          frc_kj: [
            { range: "< 10 kJ", label: "Basso", meaning: "Capacità anaerobica limitata — evitare scatti ripetuti" },
            { range: "10–15 kJ", label: "Moderato", meaning: "Tipico amatore endurance" },
            { range: "15–20 kJ", label: "Buono", meaning: "Buona capacità per attacchi e scatti" },
            { range: "20–30 kJ", label: "Alto", meaning: "Forte anaerobicamente — gestisce bene il ritmo variabile" },
            { range: "> 30 kJ", label: "Elite", meaning: "Capacità anaerobica eccezionale" },
          ],
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- get_metabolic_profile ---
  server.tool(
    "get_metabolic_profile",
    "Compute a metabolic profile with estimated VLaMax (maximum glycolytic rate), energy system contribution breakdown across the power-duration curve, and key physiological metrics (Pmax, MAP/VO2max power, FTP, FRC). Based on Mader's bioenergetic model applied to the athlete's power-duration data. Returns chart-ready data for a metabolic fingerprint visualization. IMPORTANT: always interpret every numeric value using the reference_ranges in the response — state which range it falls into and what it means for the athlete.",
    {
      sport: z.string().optional().describe("Sport type for power curve: Ride (default), Run, etc."),
      curve_type: z.string().optional().describe("Curve spec: 1y (past year, default), 42d (past 42 days), s0 (current season), s1 (previous season), all"),
    },
    async ({ sport, curve_type }) => {
      const curveType = curve_type ?? "1y";
      const sportType = sport ?? "Ride";

      // Fetch power curves, sport settings, and athlete profile in parallel
      const [curves, settings, athlete] = await Promise.all([
        icu.getPowerCurves(sportType, [curveType]) as Promise<any>,
        icu.getSportSettings() as Promise<any>,
        icu.getAthlete() as Promise<any>,
      ]);

      // Extract power-duration data
      // API returns DataCurveSetPowerCurve: { list: [{ secs: int[], values: int[], ... }] }
      // or PowerCurve: { secs: int[], values: int[], watts: int[], ... }
      let pdData: { secs: number; watts: number }[] = [];
      let curveData: any = null;

      // Unwrap: could be { list: [...] } or direct array
      const curveList = curves?.list ?? (Array.isArray(curves) ? curves : [curves]);

      for (const curve of curveList) {
        if (!curve) continue;
        const secsArr = curve.secs;
        const wattsArr = curve.values ?? curve.watts;
        if (Array.isArray(secsArr) && Array.isArray(wattsArr)) {
          curveData = curve;
          for (let i = 0; i < secsArr.length; i++) {
            if (wattsArr[i] != null && wattsArr[i] > 0) {
              pdData.push({ secs: secsArr[i], watts: wattsArr[i] });
            }
          }
          if (pdData.length > 0) break;
        }
      }

      if (pdData.length === 0) {
        return { content: [{ type: "text", text: "No power-duration curve data available. Ensure you have recent activities with power data." }] };
      }

      // Sort by duration
      pdData.sort((a, b) => a.secs - b.secs);

      // Get athlete settings
      const ss = Array.isArray(settings)
        ? settings.find((s: any) => s.types?.includes(sportType)) ?? settings[0]
        : settings;

      const ftp = ss?.ftp ?? 250;
      const mass = athlete?.weight ?? 75;

      // Key power values from PD curve (find closest)
      function powerAt(targetSecs: number): number {
        for (const p of pdData) { if (p.secs === targetSecs) return p.watts; }
        let best = pdData[0];
        let bestDiff = Math.abs(pdData[0].secs - targetSecs);
        for (const p of pdData) {
          const diff = Math.abs(p.secs - targetSecs);
          if (diff < bestDiff) { bestDiff = diff; best = p; }
        }
        return best.watts;
      }

      const P1 = powerAt(1);
      const P5 = powerAt(5);
      const P15 = powerAt(15);
      const P30 = powerAt(30);
      const P60 = powerAt(60);
      const P300 = powerAt(300);   // 5 min — MAP/VO2max proxy
      const P1200 = powerAt(1200); // 20 min
      const P3600 = powerAt(3600); // 60 min

      // Pmax from PD model (more accurate than P1 MMP)
      const pdModelPmax: number = curveData?.powerModels?.find((m: any) => m.pMax)?.pMax ?? P1;

      // ==================================================================
      // Mader Bioenergetic Model — VLaMax estimation
      //
      // Three energy systems during maximal effort of duration T:
      //   1. Aerobic:    P_aer(t) = MAP × (1 - e^(-t/τ_VO2))
      //   2. Alactic:    P_PCr(t) = P_PCr_0 × e^(-t/τ_PCr)
      //   3. Glycolytic: P_glyc = P_total - P_aer - P_PCr  (residual)
      //
      // Parameters:
      //   τ_VO2 = 30s  (VO2 on-kinetics, Rossiter et al. 2002)
      //   τ_PCr = 23s  (PCr depletion, NMR studies)
      //   K = 6.3      (calibrated vs field lactate test, VLaMax = 0.34)
      //
      // References:
      //   Mader (2003). Eur J Appl Physiol.
      //   Heck & Schulz (2002). Z Sportmed.
      //   Rossiter et al. (2002). J Physiol.
      // ==================================================================

      const TAU_VO2 = 30;
      const TAU_PCR = 23;
      const K_CONV = 6.3;
      const MAP = P300;

      // Scan durations 10-30s for peak glycolytic flux
      const testDurations = [10, 12, 15, 18, 20, 25, 30];
      let bestVlamax = 0;
      let bestDuration = 0;

      for (const T of testDurations) {
        const Pt = powerAt(T);
        const E_total = Pt * T;
        const E_aer = MAP * (T + TAU_VO2 * (Math.exp(-T / TAU_VO2) - 1));
        const P_PCr_0 = Math.max(0, pdModelPmax - MAP);
        const E_PCr = P_PCr_0 * TAU_PCR * (1 - Math.exp(-T / TAU_PCR));
        const E_glyc = Math.max(0, E_total - E_aer - E_PCr);
        const vla = E_glyc / (K_CONV * mass * T);
        if (vla > bestVlamax) { bestVlamax = vla; bestDuration = T; }
      }

      const vlamax = bestVlamax;

      // ---- Energy system contribution (Mader 3-component) ----
      const energyBreakdown: {
        secs: number; watts: number;
        aerobic_pct: number; pcr_pct: number; glycolytic_pct: number;
        aerobic_w: number; pcr_w: number; glycolytic_w: number;
      }[] = [];

      const sampleDurations = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200];

      for (const t of sampleDurations) {
        const P_total = powerAt(t);
        if (P_total <= 0) continue;

        const P_aer = Math.min(MAP, MAP * (1 - Math.exp(-t / TAU_VO2)));
        const P_PCr_0 = Math.max(0, pdModelPmax - MAP);
        const P_pcr = P_PCr_0 * Math.exp(-t / TAU_PCR);
        const P_glyc = Math.max(0, P_total - P_aer - P_pcr);
        const total = P_aer + P_pcr + P_glyc;

        energyBreakdown.push({
          secs: t, watts: P_total,
          aerobic_w: Math.round(P_aer), pcr_w: Math.round(P_pcr), glycolytic_w: Math.round(P_glyc),
          aerobic_pct: Math.round((P_aer / total) * 100),
          pcr_pct: Math.round((P_pcr / total) * 100),
          glycolytic_pct: Math.round((P_glyc / total) * 100),
        });
      }

      // VLaMax classification
      let vlamax_class: string;
      if (vlamax >= 0.8) vlamax_class = "Very High (sprinter)";
      else if (vlamax >= 0.6) vlamax_class = "High (explosive)";
      else if (vlamax >= 0.45) vlamax_class = "Moderate (all-rounder)";
      else if (vlamax >= 0.3) vlamax_class = "Low (endurance)";
      else vlamax_class = "Very Low (ultra-endurance)";

      // ---- Coggan Power Profile Classification (Allen & Coggan 2010, Table 3.3) ----
      // Thresholds in W/kg for male cyclists. Each array: [Untrained, Fair, Moderate, Good, Very Good, Excellent, Exceptional, World Class]
      const cogganTable: Record<string, number[]> = {
        "5s":    [6.3,  8.3,  9.8, 11.0, 12.3, 13.6, 15.1, 17.1],
        "1min":  [3.5,  5.1,  6.2,  7.0,  7.8,  8.8,  9.9, 11.5],
        "5min":  [2.1,  2.8,  3.4,  3.9,  4.4,  5.0,  5.6,  6.4],
        "ftp":   [1.8,  2.4,  2.9,  3.3,  3.7,  4.2,  4.7,  5.4],
      };
      const cogganLevels = ["Untrained", "Fair", "Moderate", "Good", "Very Good", "Excellent", "Exceptional", "World Class"];

      function classifyCoggan(wkg: number, key: string): { level: string; percentile_approx: number } {
        const thresholds = cogganTable[key];
        let idx = 0;
        for (let i = thresholds.length - 1; i >= 0; i--) {
          if (wkg >= thresholds[i]) { idx = i; break; }
        }
        return { level: cogganLevels[idx], percentile_approx: Math.round((idx / 7) * 100) };
      }

      const cogganProfile = {
        "5s":   { w_per_kg: Math.round(P5 / mass * 100) / 100,   ...classifyCoggan(P5 / mass, "5s") },
        "1min": { w_per_kg: Math.round(P60 / mass * 100) / 100,  ...classifyCoggan(P60 / mass, "1min") },
        "5min": { w_per_kg: Math.round(P300 / mass * 100) / 100, ...classifyCoggan(P300 / mass, "5min") },
        "ftp":  { w_per_kg: Math.round(ftp / mass * 100) / 100,  ...classifyCoggan(ftp / mass, "ftp") },
      };

      // ---- Fatigue Resistance Index (Pinot & Grappe 2015) ----
      // FRI = FTP / MAP × 100. Measures sustainable fraction of maximal aerobic power.
      const fri = Math.round((ftp / MAP) * 1000) / 10;
      let fri_class: string;
      if (fri >= 82) fri_class = "Excellent — high fatigue resistance (GC / TT specialist)";
      else if (fri >= 78) fri_class = "Good — strong endurance profile";
      else if (fri >= 74) fri_class = "Moderate — balanced";
      else if (fri >= 70) fri_class = "Low — explosive but fatigable";
      else fri_class = "Very Low — sprinter profile, poor sustainability";

      // ---- Estimated VO2max ----
      const vo2max_est = curveData?.vo2max_5m ?? Math.round(MAP / mass * 1000 / 75 * 10) / 10;

      // FRC from PD model
      const fftModel = curveData?.powerModels?.find((m: any) => m.type === "FFT_CURVES");
      const frc = fftModel?.wPrime ?? ss?.w_prime ?? ss?.wPrime ?? 20000;

      const result = {
        athlete: { weight_kg: mass, sport: sportType, curve_type: curveType },
        key_metrics: {
          pmax_watts: Math.round(pdModelPmax),
          p5s_watts: Math.round(P5),
          p15s_watts: Math.round(P15),
          p30s_watts: Math.round(P30),
          p1min_watts: Math.round(P60),
          map_5min_watts: Math.round(P300),
          p20min_watts: Math.round(P1200),
          ftp_watts: ftp,
          frc_joules: frc,
          frc_kj: Math.round(frc / 100) / 10,
          vo2max_est,
          w_per_kg_ftp: Math.round(ftp / mass * 100) / 100,
          w_per_kg_map: Math.round(P300 / mass * 100) / 100,
        },
        coggan_power_profile: cogganProfile,
        fatigue_resistance: {
          fri_pct: fri,
          classification: fri_class,
          note: "FRI = FTP/MAP × 100 (Pinot & Grappe 2015). Higher = more sustainable endurance.",
        },
        vlamax: {
          value_mmol_L_s: Math.round(vlamax * 1000) / 1000,
          value_mmol_L_min: Math.round(vlamax * 60 * 100) / 100,
          peak_duration_s: bestDuration,
          classification: vlamax_class,
          model: "Mader bioenergetic (3-component: aerobic τ=30s, PCr τ=23s, glycolytic residual, K=6.3 calibrated vs lactate test)",
          note: "Accuracy depends on having maximal sprint efforts (10-30s) in the power curve. Without recent all-out short efforts, VLaMax may be overestimated.",
        },
        energy_system_breakdown: energyBreakdown,
        power_duration_curve: pdData.filter((_p, i) => i % Math.max(1, Math.floor(pdData.length / 200)) === 0),
        reference_ranges: {
          vlamax_mmol_L_s: [
            { range: "< 0.30", label: "Molto basso", meaning: "Ultra-endurance — minima produzione di lattato, eccellente per Ironman e granfondo" },
            { range: "0.30–0.44", label: "Basso", meaning: "Endurance — profilo triatleta/climber, buona clearance del lattato" },
            { range: "0.45–0.59", label: "Moderato", meaning: "All-rounder — bilanciato tra resistenza e potenza, tipico strada" },
            { range: "0.60–0.79", label: "Alto", meaning: "Esplosivo — forte anaerobicamente, buono per criterium e CX" },
            { range: "≥ 0.80", label: "Molto alto", meaning: "Sprinter — massima capacità glicolitica, pista e sprint" },
          ],
          fri_pct: [
            { range: "≥ 82%", label: "Eccellente", meaning: "Sostiene quasi tutta la MAP — GC/crono specialist" },
            { range: "78–81%", label: "Buono", meaning: "Profilo endurance forte" },
            { range: "74–77%", label: "Moderato", meaning: "Bilanciato" },
            { range: "70–73%", label: "Basso", meaning: "Esplosivo ma fatigabile — puncheur" },
            { range: "< 70%", label: "Molto basso", meaning: "Sprinter puro — potenza non sostenibile" },
          ],
          vo2max_ml_kg_min: [
            { range: "< 35", label: "Basso", meaning: "Sedentario o principiante" },
            { range: "35–45", label: "Medio", meaning: "Amatore ricreativo" },
            { range: "45–55", label: "Buono", meaning: "Amatore allenato" },
            { range: "55–65", label: "Molto buono", meaning: "Atleta competitivo" },
            { range: "65–75", label: "Eccellente", meaning: "Elite / semi-pro" },
            { range: "> 75", label: "World class", meaning: "Professionista di alto livello" },
          ],
          ftp_w_per_kg: [
            { range: "< 2.5", label: "Principiante", meaning: "Prime fasi di allenamento strutturato" },
            { range: "2.5–3.2", label: "Intermedio", meaning: "Amatore regolare" },
            { range: "3.2–4.0", label: "Avanzato", meaning: "Amatore competitivo — cat. 3-4" },
            { range: "4.0–4.7", label: "Molto forte", meaning: "Agonista serio — cat. 1-2" },
            { range: "4.7–5.5", label: "Elite", meaning: "Pro continental / nazionale" },
            { range: "> 5.5", label: "World class", meaning: "WorldTour / GT contender" },
          ],
        },
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}
