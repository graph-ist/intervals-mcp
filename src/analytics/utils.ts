import type { StreamData } from "../types.js";

/** Extract a numeric array from an intervals.icu stream (handles both raw arrays and {data} wrappers). */
export function extractStream(s: StreamData | undefined): number[] {
  if (!s) return [];
  return Array.isArray(s) ? s : (s.data ?? []);
}

/** Get one stream by type: the API returns an array of {type, data}; older mocks use an object keyed by type. */
export function getStream(streams: unknown, type: string): number[] {
  if (Array.isArray(streams)) {
    const found = (streams as { type?: string; data?: number[] }[]).find((s) => s?.type === type);
    return found?.data ?? [];
  }
  return extractStream((streams as Record<string, StreamData | undefined> | undefined)?.[type]);
}

/** "Ride" also matches VirtualRide, GravelRide, MountainBikeRide...; "Run" matches VirtualRun, TrailRun. */
export function matchesSport(activityType: string | undefined, sport: string): boolean {
  if (!activityType) return false;
  const t = activityType.toLowerCase();
  const s = sport.toLowerCase();
  return t === s || t.endsWith(s);
}
