import { z } from "zod";

export type ServerOptions = {
  /** Allow upload_activity to read any absolute path (local stdio use). */
  allowAnyLocalPath?: boolean;
  /** If set, upload_activity file_path must resolve inside this directory. */
  uploadDir?: string;
};

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export const MAX_EVENTS_BATCH = 90;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dateStr = z.string().regex(DATE_RE, "Must be YYYY-MM-DD");
export const filtersArg = z
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
export const curveOptsShape = {
  newest: dateStr.optional().describe("Reference end date for the curves YYYY-MM-DD"),
  include_ranks: z.boolean().optional().describe("Include population ranks"),
  sub_max_efforts: z.number().optional().describe("Also return N sub-maximal efforts per duration"),
  filters: filtersArg.describe("Only consider activities matching all these filters"),
  f1: filtersArg.describe("Comparison filter set 1: each curve is returned once per filter set"),
  f2: filtersArg.describe("Comparison filter set 2"),
  f3: filtersArg.describe("Comparison filter set 3"),
};
export const recordArg = z.record(z.string(), z.unknown());

export function safeReturn(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function toolError(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export async function safe<T>(fn: () => Promise<T>): Promise<ToolResult> {
  try {
    const data = await fn();
    return safeReturn(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(`API error: ${msg}`);
  }
}

// Calendar dates follow the athlete's time zone, not UTC: just after local midnight "today" must already be the new day.
// Undefined means the process time zone, used until initTimeZone() resolves.
let timeZone: string | undefined;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function setTimeZone(tz: string | undefined): void {
  timeZone = tz && isValidTimeZone(tz) ? tz : undefined;
}

export function getTimeZone(): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Uses INTERVALS_TIMEZONE if valid, else the `timezone` of the athlete profile; keeps the process zone on failure. */
export async function initTimeZone(override: string | undefined, fetchAthlete: () => Promise<{ timezone?: unknown }>) {
  if (override) {
    if (isValidTimeZone(override)) return setTimeZone(override);
    console.error(`INTERVALS_TIMEZONE "${override}" is not a valid IANA time zone: ignored`);
  }
  try {
    const { timezone } = await fetchAthlete();
    if (typeof timezone === "string" && isValidTimeZone(timezone)) setTimeZone(timezone);
  } catch (err) {
    console.error("Cannot read the athlete time zone:", err instanceof Error ? err.message : err);
  }
}

/** YYYY-MM-DD of an instant in the configured time zone. */
export function localDate(at: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Shifts a YYYY-MM-DD date by n calendar days (no DST effects: the arithmetic is on the date, not on an instant). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function today(): string {
  return localDate();
}

export function daysAgo(n: number): string {
  return addDays(today(), -n);
}

export function daysFromNow(n: number): string {
  return addDays(today(), n);
}
