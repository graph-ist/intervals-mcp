const BASE = "https://intervals.icu/api/v1";

import type {
  Activity,
  ActivityStreams,
  Athlete,
  AthleteSummary,
  CalendarEvent,
  CurveResponse,
  Folder,
  PowerCurveResponse,
  PowerHRCurve,
  PowerVsHRData,
  SportSettings,
  WellnessDay,
} from "./types.js";

let apiKey: string;
let athleteId: string;
let configured = false;

export function configure(key: string, athlete: string) {
  apiKey = key;
  athleteId = athlete;
  configured = true;
}

// ---------- Unified HTTP helper ----------

type ApiOpts = { body?: unknown; form?: FormData };

async function api<T>(method: string, path: string, opts?: ApiOpts): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
  };
  const init: RequestInit = { method, headers };

  if (opts?.form) {
    init.body = opts.form; // FormData sets its own Content-Type
  } else if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers.Accept = "application/json";
    init.body = JSON.stringify(opts.body);
  } else {
    headers.Accept = "application/json";
  }

  if (!configured) throw new Error("intervals.icu client not configured — call configure() first");
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  if (method === "DELETE") return { deleted: true } as T;
  return res.json() as Promise<T>;
}

function ath(sub: string) {
  return `/athlete/${athleteId}${sub}`;
}

function act(id: string, sub = "") {
  return `/activity/${id}${sub}`;
}

const G = "GET";

// ---------- API functions ----------

export const getAthlete = () => api<Athlete>(G, ath(""));
export const getActivities = (oldest: string, newest: string) =>
  api<Activity[]>(G, ath(`/activities?oldest=${oldest}&newest=${newest}`));
export const searchActivities = (query: string, limit = 10) =>
  api<Activity[]>("POST", ath("/activity-search"), { body: { query, limit } });
export const getActivity = (id: string, intervals = true) => api<Activity>(G, act(id, `?intervals=${intervals}`));
export const getActivityStreams = (id: string, types: string[]) =>
  api<ActivityStreams>(G, act(id, `/streams?types=${types.join(",")}`));
export const getActivityPowerCurve = (id: string) => api<CurveResponse>(G, act(id, "/power-curve"));
export const getActivityPaceCurve = (id: string) => api<CurveResponse>(G, act(id, "/pace-curve"));
export const getActivityHRCurve = (id: string) => api<CurveResponse>(G, act(id, "/hr-curve"));
export const getActivityPowerVsHR = (id: string) => api<PowerVsHRData>(G, act(id, "/power-vs-hr"));
export const getWellness = (oldest: string, newest: string) =>
  api<WellnessDay[]>(G, ath(`/wellness?oldest=${oldest}&newest=${newest}`));

export function getEvents(oldest: string, newest: string, category?: string) {
  let url = ath(`/events?oldest=${oldest}&newest=${newest}`);
  if (category) url += `&category=${category}`;
  return api<CalendarEvent[]>(G, url);
}

export const createEvent = (payload: Record<string, unknown>) => api("POST", ath("/events"), { body: payload });
export const getPowerCurves = (sportType: string, curves: string[]) =>
  api<PowerCurveResponse>(G, ath(`/power-curves?type=${sportType}&curves=${curves.join(",")}`));
export const getPaceCurves = (sportType: string, curves: string[]) =>
  api<CurveResponse>(G, ath(`/pace-curves?type=${sportType}&curves=${curves.join(",")}`));
export const getHRCurves = (sportType: string, curves: string[]) =>
  api<CurveResponse>(G, ath(`/hr-curves?type=${sportType}&curves=${curves.join(",")}`));
export const getSportSettings = () => api<SportSettings | SportSettings[]>(G, ath("/sport-settings"));
export const getAthleteSummary = (oldest: string, newest: string) =>
  api<AthleteSummary>(G, ath(`/athlete-summary?oldest=${oldest}&newest=${newest}`));
export const getPowerHRCurve = (oldest: string, newest: string) =>
  api<PowerHRCurve>(G, ath(`/power-hr-curve?oldest=${oldest}&newest=${newest}`));

export async function createEvents(events: Record<string, unknown>[]) {
  const results: unknown[] = [];
  // Process in chunks of 5 to avoid rate limits while still parallelizing
  for (let i = 0; i < events.length; i += 5) {
    const chunk = events.slice(i, i + 5);
    const batch = await Promise.all(chunk.map((e) => api("POST", ath("/events"), { body: e })));
    results.push(...batch);
  }
  return results;
}

export const updateEvent = (id: number, payload: Record<string, unknown>) =>
  api("PUT", ath(`/events/${id}`), { body: payload });
export const deleteEvent = (id: number) => api("DELETE", ath(`/events/${id}`));
export const createCustomItem = (payload: Record<string, unknown>) =>
  api("POST", ath("/custom-items"), { body: payload });
export const getFolders = () => api<Folder[]>(G, ath("/folders"));
export const updateSportSettings = (type: string, settings: Record<string, unknown>) =>
  api("PUT", ath(`/sport-settings/${type}?recalcHrZones=true`), { body: settings });
export const updateWellness = (date: string, data: Record<string, unknown>) =>
  api("PUT", ath(`/wellness/${date}`), { body: data });

export async function uploadActivity(fileData: Buffer, filename: string) {
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array(fileData)], filename));
  return api("POST", ath("/activities"), { form: formData });
}
