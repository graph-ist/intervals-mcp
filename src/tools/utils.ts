import type { StreamData } from "../types.js";

/** Extract a numeric array from an intervals.icu stream (handles both raw arrays and {data} wrappers). */
export function extractStream(s: StreamData | undefined): number[] {
  if (!s) return [];
  return Array.isArray(s) ? s : (s.data ?? []);
}
