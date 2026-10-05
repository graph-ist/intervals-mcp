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

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
