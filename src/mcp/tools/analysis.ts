import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computeDecoupling } from "../../analytics/decoupling.js";
import { computeDfrc } from "../../analytics/dfrc.js";
import { computeFatigueResistance } from "../../analytics/fatigue-resistance.js";
import { computeMetabolicProfile } from "../../analytics/metabolic.js";
import { computePolarization } from "../../analytics/polarization.js";
import { computeRecoveryIndex } from "../../analytics/recovery.js";
import { computeTrainingLoadRisk } from "../../analytics/training-load.js";
import { computeTrends } from "../../analytics/trends.js";
import { computeWeeklyTracker } from "../../analytics/weekly-tracker.js";
import { dateStr, daysAgo, safeReturn, today, toolError } from "../helpers.js";

export function registerAnalysisTools(server: McpServer): void {
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

  // Disabled: needs beat-to-beat RR data (chest strap with HRV logging); re-enable together with the dfa-alpha1 import.
  // // --- get_dfa_alpha1 ---
  // server.tool(
  //   "get_dfa_alpha1",
  //   "DFA α1 threshold detection. Computes α1 from the activity's beat-to-beat RR intervals (chest strap with HRV/RR logging enabled) and estimates HRVT1 (α1=0.75 ≈ VT1) and HRVT2 (α1=0.50 ≈ VT2) as HR and power, by regression as in Rogers et al. (2021). Best on a graded ramp test. Optical/wrist HR and Apple Watch do NOT provide RR data. IMPORTANT: report the confidence field and interpret values using the reference_ranges in the response.",
  //   {
  //     activity_id: z.string().describe("Activity ID from a graded ramp test or steady-ramp effort"),
  //   },
  //   async ({ activity_id }) => {
  //     try {
  //       const result = await computeDfaAnalysis(activity_id);
  //       return safeReturn(result);
  //     } catch (err) {
  //       const msg = err instanceof Error ? err.message : String(err);
  //       return toolError(`API error: ${msg}`);
  //     }
  //   },
  // );

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

  // --- get_weekly_load_tracker ---
  server.tool(
    "get_weekly_load_tracker",
    "Weekly TSS tracker for the next 12 weeks (about 3 months, Monday to Sunday), the first column always being the current week. Only swim, bike and run count; every other activity (strength, Hike, Yoga, ...) is reported separately as other_tss_not_counted. For each week returns the TSS target (manual 'targets', else the weekly TARGET calendar event, else the sum of planned workout load), the TSS done split by swim, bike and run, completion %, remaining TSS, and for the current week the per-day cumulative TSS so its column can be filled day by day. Weeks without a target have target_tss null (empty column). Render it as vertical columns (see chart_hint in the response).",
    {
      weeks_before: z.number().int().min(0).max(26).optional().describe("Weeks before the current one (default 0)"),
      weeks_after: z.number().int().min(0).max(26).optional().describe("Weeks after the current one (default 11)"),
      start: dateStr.optional().describe("Any date in the week that opens the window, YYYY-MM-DD (default today)"),
      targets: z
        .array(
          z.object({
            week_start: dateStr.describe("Any date inside the week, YYYY-MM-DD"),
            tss: z.number().min(0).describe("Weekly TSS target"),
          }),
        )
        .max(60)
        .optional()
        .describe("Manual weekly TSS targets. They override TARGET events and planned workout load"),
    },
    async ({ weeks_before, weeks_after, start, targets }) => {
      try {
        const result = await computeWeeklyTracker(
          { weeksBefore: weeks_before, weeksAfter: weeks_after, start, targets },
          today(),
        );
        return safeReturn(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );
}
