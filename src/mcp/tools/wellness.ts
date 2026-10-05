import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { dateStr, daysAgo, MAX_EVENTS_BATCH, safe, today } from "../helpers.js";

export function registerWellnessTools(server: McpServer): void {
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

  // --- get_wellness_day ---
  server.tool(
    "get_wellness_day",
    "Get the wellness record of a single day",
    { date: dateStr.describe("Date YYYY-MM-DD") },
    ({ date }) => safe(() => icu.getWellnessDay(date)),
  );
}
