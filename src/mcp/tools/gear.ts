import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { recordArg, safe } from "../helpers.js";

export function registerGearTools(server: McpServer): void {
  // --- get_gear ---
  server.tool(
    "get_gear",
    "Get athlete's gear: bikes, shoes, equipment with distance/time/activities tracked and maintenance reminders",
    {},
    () => safe(() => icu.getGear()),
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

  // --- recalculate_gear_stats ---
  server.tool(
    "recalculate_gear_stats",
    "Recalculate distance, time and activity count of a gear item from the activities assigned to it",
    { gear_id: z.string().describe("Gear ID") },
    ({ gear_id }) => safe(() => icu.recalculateGearStats(gear_id)),
  );
}
