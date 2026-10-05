const BASE = "https://intervals.icu/api/v1";

import type {
  Activity,
  ActivityPowerCurvePayload,
  ActivityStreams,
  ActivityWeatherSummary,
  Athlete,
  AthleteSummary,
  BestEfforts,
  CalendarEvent,
  CurveResponse,
  FitnessModelEvent,
  Folder,
  Gear,
  HistogramBucket,
  IntervalsDTO,
  MapData,
  PowerCurveResponse,
  PowerHRCurve,
  PowerModel,
  PowerVsHRData,
  SportSettings,
  TrainingPlan,
  WeatherForecast,
  WellnessDay,
  Workout,
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

type ApiOpts = { body?: unknown; form?: FormData; as?: "text" | "base64" | "json" };

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
  init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res = await fetch(`${BASE}${path}`, init);
  // intervals.icu allows ~10 req/s per IP; analysis tools fire parallel calls, so retry short 429 waits
  for (let attempt = 0; res.status === 429 && attempt < MAX_429_RETRIES; attempt++) {
    const wait = Number(res.headers?.get("retry-after") ?? 1);
    if (!(wait <= MAX_RETRY_WAIT_S) || opts?.form) break;
    await new Promise((r) => setTimeout(r, Math.max(wait, 0.5) * 1000));
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    res = await fetch(`${BASE}${path}`, init);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retry = res.status === 429 ? ` (retry after ${res.headers.get("retry-after") ?? "?"}s)` : "";
    throw new Error(`intervals.icu ${res.status}${retry}: ${text.slice(0, 200)}`);
  }
  if (opts?.as === "text") return (await res.text()) as T;
  if (opts?.as === "base64") return Buffer.from(await res.arrayBuffer()).toString("base64") as T;
  if (method === "DELETE" && opts?.as !== "json") return { deleted: true } as T;
  // Several write endpoints answer 200 with an empty or non-JSON body
  const body = await res.text();
  if (!body) return { ok: true } as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    return body as T;
  }
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_429_RETRIES = 3;
const MAX_RETRY_WAIT_S = 5;

// Encodes a caller-supplied path segment so IDs like "1/../x" cannot change the endpoint
const seg = (v: string | number) => encodeURIComponent(String(v));

function ath(sub: string) {
  return `/athlete/${seg(athleteId)}${sub}`;
}

function act(id: string, sub = "") {
  return `/activity/${seg(id)}${sub}`;
}

const G = "GET";

type QueryVal = string | number | boolean | undefined | null | (string | number)[] | Record<string, unknown>[];

// Skips empty values; arrays of scalars are comma-joined, arrays of objects (activity filters) are JSON-encoded
export function qs(params: Record<string, QueryVal>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      const encoded =
        typeof v[0] === "object" ? JSON.stringify(v) : (v as (string | number)[]).map((x) => String(x)).join(",");
      parts.push(`${k}=${encodeURIComponent(encoded)}`);
    } else {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export type ActivityFilters = Record<string, unknown>[];
export type CurveOpts = {
  newest?: string;
  now?: string;
  includeRanks?: boolean;
  subMaxEfforts?: number;
  pmType?: string;
  gap?: boolean;
  filters?: ActivityFilters;
  f1?: ActivityFilters;
  f2?: ActivityFilters;
  f3?: ActivityFilters;
};

// ---------- API functions ----------

export const getAthlete = () => api<Athlete>(G, ath(""));
export const getActivities = (
  oldest: string,
  newest: string,
  opts: { limit?: number; fields?: string[]; routeId?: number } = {},
) =>
  api<Activity[]>(
    G,
    ath(`/activities${qs({ oldest, newest, limit: opts.limit, fields: opts.fields, route_id: opts.routeId })}`),
  );
export const searchActivities = (query: string, limit = 10) =>
  api<Activity[]>(G, ath(`/activities/search${qs({ q: query, limit })}`));
export const getActivity = (id: string, intervals = true) => api<Activity>(G, act(id, `?intervals=${intervals}`));
export const getActivityStreams = (id: string, types: string[], includeDefaults?: boolean) =>
  api<ActivityStreams>(G, act(id, `/streams${qs({ types, includeDefaults })}`));
export const getActivityPowerCurve = (id: string, fatigue?: "kj0" | "kj1") =>
  api<CurveResponse>(G, act(id, `/power-curve${qs({ fatigue })}`));
export const getActivityPaceCurve = (id: string, gap?: boolean) =>
  api<CurveResponse>(G, act(id, `/pace-curve${qs({ gap })}`));
export const getActivityHRCurve = (id: string) => api<CurveResponse>(G, act(id, "/hr-curve"));
export const getActivityPowerVsHR = (id: string) => api<PowerVsHRData>(G, act(id, "/power-vs-hr"));
export const getWellness = (oldest: string, newest: string, fields?: string[]) =>
  api<WellnessDay[]>(G, ath(`/wellness${qs({ oldest, newest, fields })}`));

export type EventListOpts = {
  limit?: number;
  calendarId?: number;
  resolve?: boolean;
  ext?: "zwo" | "mrc" | "erg" | "fit";
  powerRange?: number;
  hrRange?: number;
  paceRange?: number;
  locale?: string;
};
export function getEvents(oldest: string, newest: string, category?: string, opts: EventListOpts = {}) {
  const query = qs({
    oldest,
    newest,
    category,
    limit: opts.limit,
    calendar_id: opts.calendarId,
    resolve: opts.resolve,
    ext: opts.ext,
    powerRange: opts.powerRange,
    hrRange: opts.hrRange,
    paceRange: opts.paceRange,
    locale: opts.locale,
  });
  return api<CalendarEvent[]>(G, ath(`/events${query}`));
}

// intervals.icu events API rejects date-only values (422): it needs YYYY-MM-DDTHH:mm:ss
export function normalizeEventDates<T extends Record<string, unknown>>(event: T): T {
  const d = event.start_date_local;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return { ...event, start_date_local: `${d}T00:00:00` };
  return event;
}

export const createEvent = (payload: Record<string, unknown>) =>
  api("POST", ath("/events"), { body: normalizeEventDates(payload) });
function curveQuery(sportType: string, curves: string[], opts: CurveOpts) {
  return qs({
    type: sportType,
    curves,
    newest: opts.newest,
    now: opts.now,
    includeRanks: opts.includeRanks,
    subMaxEfforts: opts.subMaxEfforts,
    pmType: opts.pmType,
    gap: opts.gap,
    filters: opts.filters,
    f1: opts.f1,
    f2: opts.f2,
    f3: opts.f3,
  });
}
// Fatigued curves are requested with a -kj0/-kj1 suffix on the curve id, not a separate parameter
export const getPowerCurves = (sportType: string, curves: string[], fatigue?: string, opts: CurveOpts = {}) => {
  const ids = fatigue ? curves.map((c) => `${c}-${fatigue}`) : curves;
  return api<PowerCurveResponse>(G, ath(`/power-curves${curveQuery(sportType, ids, opts)}`));
};
export const getPaceCurves = (sportType: string, curves: string[], opts: CurveOpts = {}) =>
  api<CurveResponse>(G, ath(`/pace-curves${curveQuery(sportType, curves, opts)}`));
export const getHRCurves = (sportType: string, curves: string[], opts: CurveOpts = {}) =>
  api<CurveResponse>(G, ath(`/hr-curves${curveQuery(sportType, curves, opts)}`));
export const getSportSettings = () => api<SportSettings | SportSettings[]>(G, ath("/sport-settings"));
export const getSportSettingsById = (id: string) => api<SportSettings>(G, ath(`/sport-settings/${seg(id)}`));
export const getAthleteSummary = (oldest: string, newest: string, tags?: string[]) =>
  api<AthleteSummary>(G, ath(`/athlete-summary${qs({ start: oldest, end: newest, tags })}`));
export const getPowerHRCurve = (oldest: string, newest: string, sportType?: string, filters?: ActivityFilters) =>
  api<PowerHRCurve>(G, ath(`/power-hr-curve${qs({ start: oldest, end: newest, type: sportType, filters })}`));

export const createEvents = (
  events: Record<string, unknown>[],
  opts: { upsert?: boolean; upsertOnUid?: boolean; updatePlanApplied?: boolean } = {},
) =>
  api<unknown[]>(
    "POST",
    ath(
      `/events/bulk${qs({
        upsert: opts.upsert,
        upsertOnUid: opts.upsertOnUid ?? false,
        updatePlanApplied: opts.updatePlanApplied ?? false,
      })}`,
    ),
    { body: events.map(normalizeEventDates) },
  );

export const markEventDone = (eventId: number) => api<Activity>("POST", ath(`/events/${eventId}/mark-done`));

// zwo/mrc/erg are XML/text; fit is binary and returned base64-encoded
export const downloadEventWorkout = (eventId: number, ext: "zwo" | "mrc" | "erg" | "fit") =>
  api<string>(G, ath(`/events/${eventId}/download.${ext}`), { as: ext === "fit" ? "base64" : "text" });

export const getWorkout = (id: number) => api<Workout>(G, ath(`/workouts/${id}`));
export const createWorkout = (payload: Record<string, unknown>) =>
  api<Workout>("POST", ath("/workouts"), { body: payload });
export const createWorkouts = (payloads: Record<string, unknown>[]) =>
  api<Workout[]>("POST", ath("/workouts/bulk"), { body: payloads });
export const updateWorkout = (id: number, payload: Record<string, unknown>) =>
  api<Workout>("PUT", ath(`/workouts/${id}`), { body: payload });
export const deleteWorkout = (id: number, others = false) =>
  api<number[]>("DELETE", ath(`/workouts/${id}?others=${others}`), { as: "json" });

export const createFolder = (payload: Record<string, unknown>) =>
  api<Folder>("POST", ath("/folders"), { body: payload });
export const updateFolder = (id: number, payload: Record<string, unknown>) =>
  api<Folder>("PUT", ath(`/folders/${id}`), { body: payload });
export const deleteFolder = (id: number) =>
  api<Record<string, unknown>>("DELETE", ath(`/folders/${id}`), { as: "json" });

export const getActivityIntervalStats = (id: string, startIndex: number, endIndex: number) =>
  api<Record<string, unknown>>(G, act(id, `/interval-stats?start_index=${startIndex}&end_index=${endIndex}`));

export const applySportSettings = (type: string) =>
  api<Record<string, unknown>>("PUT", ath(`/sport-settings/${seg(type)}/apply`));

export const updateEvent = (id: number, payload: Record<string, unknown>) =>
  api("PUT", ath(`/events/${id}`), { body: normalizeEventDates(payload) });
export const deleteEvent = (id: number, opts: { others?: boolean; notBefore?: string } = {}) =>
  api("DELETE", ath(`/events/${id}${qs({ others: opts.others, notBefore: opts.notBefore })}`));
export const createCustomItem = (payload: Record<string, unknown>) =>
  api("POST", ath("/custom-item"), { body: payload });
export const getFolders = () => api<Folder[]>(G, ath("/folders"));
export const updateSportSettings = (type: string, settings: Record<string, unknown>, recalcHrZones = true) =>
  api("PUT", ath(`/sport-settings/${seg(type)}?recalcHrZones=${recalcHrZones}`), { body: settings });
export const updateWellness = (date: string, data: Record<string, unknown>) =>
  api("PUT", ath(`/wellness/${seg(date)}`), { body: data });

export type UploadOpts = {
  name?: string;
  description?: string;
  device_name?: string;
  external_id?: string;
  paired_event_id?: number;
};
export async function uploadActivity(fileData: Buffer, filename: string, opts: UploadOpts = {}) {
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array(fileData)], filename));
  return api("POST", ath(`/activities${qs(opts)}`), { form: formData });
}

// ---------- NEW API functions ----------

// HIGH priority
export const updateActivity = (id: string, payload: Record<string, unknown>) =>
  api<Activity>("PUT", act(id), { body: payload });
export const getActivityIntervals = (id: string) => api<IntervalsDTO>(G, act(id, "/intervals"));
export const getActivityBestEfforts = (
  id: string,
  opts: {
    stream: string;
    duration?: number;
    distance?: number;
    count?: number;
    minValue?: number;
    excludeIntervals?: boolean;
    startIndex?: number;
    endIndex?: number;
  },
) => api<BestEfforts>(G, act(id, `/best-efforts${qs(opts)}`));
export const getWeatherForecast = () => api<WeatherForecast>(G, ath("/weather-forecast"));
export const searchIntervals = (opts: {
  minSecs: number;
  maxSecs: number;
  minIntensity: number;
  maxIntensity: number;
  type?: string;
  minReps?: number;
  maxReps?: number;
  limit?: number;
}) => api<Activity[]>(G, ath(`/activities/interval-search${qs(opts)}`));
export const getTrainingPlan = () => api<TrainingPlan>(G, ath("/training-plan"));
export const getGear = () => api<Gear[]>(G, ath("/gear"));
export const duplicateEvents = (eventIds: number[], numCopies: number, weeksBetween: number) =>
  api<CalendarEvent[]>("POST", ath("/duplicate-events"), { body: { eventIds, numCopies, weeksBetween } });
export const getActivityPowerCurvesRange = (
  oldest: string,
  newest: string,
  sport?: string,
  secs?: number[],
  opts: { filters?: ActivityFilters; fatigue?: string } = {},
) =>
  api<ActivityPowerCurvePayload>(
    G,
    ath(
      `/activity-power-curves${qs({ oldest, newest, type: sport, secs, filters: opts.filters, fatigue: opts.fatigue })}`,
    ),
  );
export const deleteActivity = (id: string) => api("DELETE", act(id));

// MEDIUM priority
export const getActivityMap = (id: string, opts: { bounds?: number[]; boundsOnly?: boolean; weather?: boolean } = {}) =>
  api<MapData>(G, act(id, `/map${qs(opts)}`));
export const getActivityWeather = (id: string, startIndex?: number, endIndex?: number) =>
  api<ActivityWeatherSummary>(G, act(id, `/weather-summary${qs({ start_index: startIndex, end_index: endIndex })}`));
export const getActivityPowerHistogram = (id: string, bucketSize?: number) =>
  api<HistogramBucket[]>(G, act(id, `/power-histogram${bucketSize ? `?bucketSize=${bucketSize}` : ""}`));
export const getMMPModel = (sport: string) => api<PowerModel>(G, ath(`/mmp-model${qs({ type: sport })}`));
export const getFitnessModelEvents = () => api<FitnessModelEvent[]>(G, ath("/fitness-model-events"));
export const getActivityTags = () => api<string[]>(G, ath("/activity-tags"));
export const createManualActivity = (payload: Record<string, unknown>) =>
  api<Activity>("POST", ath("/activities/manual"), { body: payload });
export const getWorkouts = () => api<Workout[]>(G, ath("/workouts"));
export const updateActivityIntervals = (id: string, intervals: Record<string, unknown>[], replaceAll = true) =>
  api<IntervalsDTO>("PUT", act(id, `/intervals?all=${replaceAll}`), { body: intervals });
export const bulkDeleteEvents = (events: { id?: number; external_id?: string }[]) =>
  api("PUT", ath("/events/bulk-delete"), { body: events });

// ---------- MEDIUM priority (batch 2) ----------

// Events and plans
export const getEvent = (id: number) => api<CalendarEvent>(G, ath(`/events/${id}`));
export const deleteEventsRange = (oldest: string, newest?: string, category?: string, createdById?: string) =>
  api("DELETE", ath(`/events${qs({ oldest, newest, category, createdById })}`));
export const applyPlan = (startDateLocal: string, folderId: number, extraWorkouts?: Record<string, unknown>[]) =>
  api<Record<string, unknown>>("POST", ath("/events/apply-plan"), {
    body: {
      start_date_local: startDateLocal,
      folder_id: folderId,
      ...(extraWorkouts?.length && { extra_workouts: extraWorkouts }),
    },
  });
export const applyPlanChanges = () => api<Record<string, unknown>>("PUT", ath("/apply-plan-changes"));
export const updateTrainingPlan = (payload: Record<string, unknown>) =>
  api<TrainingPlan>("PUT", ath("/training-plan"), { body: payload });

// Library
export const duplicateWorkouts = (workoutIds: number[], numCopies: number, weeksBetween: number) =>
  api<Workout[]>("POST", ath("/duplicate-workouts"), { body: { workoutIds, numCopies, weeksBetween } });
export const convertWorkout = (ext: "zwo" | "mrc" | "erg" | "fit", workout: Record<string, unknown>) =>
  api<string>("POST", ath(`/download-workout.${ext}`), {
    body: workout,
    as: ext === "fit" ? "base64" : "text",
  });

// Activity analysis
export const getActivityHistogram = (id: string, kind: "hr" | "pace" | "gap", bucketSize?: number) =>
  api<HistogramBucket[]>(G, act(id, `/${kind}-histogram${bucketSize ? `?bucketSize=${bucketSize}` : ""}`));
export const getActivityTimeAtHR = (id: string) => api<Record<string, unknown>>(G, act(id, "/time-at-hr"));
export const getActivityPaceCurvesRange = (
  oldest: string,
  newest: string,
  sport?: string,
  distances?: number[],
  gap?: boolean,
  filters?: ActivityFilters,
) =>
  api<Record<string, unknown>>(
    G,
    ath(`/activity-pace-curves${qs({ oldest, newest, type: sport, distances, gap, filters })}`),
  );
export const getActivityHRCurvesRange = (
  oldest: string,
  newest: string,
  sport?: string,
  secs?: number[],
  filters?: ActivityFilters,
) => api<Record<string, unknown>>(G, ath(`/activity-hr-curves${qs({ oldest, newest, type: sport, secs, filters })}`));
export const getActivitiesAround = (activityId: string, limit?: number, routeId?: number) =>
  api<Activity[]>(G, ath(`/activities-around${qs({ activity_id: activityId, limit, route_id: routeId })}`));
export const getActivitiesByIds = (ids: string[], intervals = false) =>
  api<Activity[]>(G, ath(`/activities/${ids.map(encodeURIComponent).join(",")}?intervals=${intervals}`));

// Activity edits
export const updateActivityStreams = (id: string, streams: Record<string, unknown>[]) =>
  api<Record<string, unknown>>("PUT", act(id, "/streams"), { body: streams });
export const updateActivityInterval = (id: string, intervalId: number, payload: Record<string, unknown>) =>
  api<IntervalsDTO>("PUT", act(id, `/intervals/${intervalId}`), { body: payload });
export const deleteActivityIntervals = (id: string, intervals: Record<string, unknown>[]) =>
  api<IntervalsDTO>("PUT", act(id, "/delete-intervals"), { body: intervals });
export const createManualActivitiesBulk = (activities: Record<string, unknown>[]) =>
  api<Activity[]>("POST", ath("/activities/manual/bulk"), { body: activities });

// Wellness, athlete, sport settings
export async function updateWellnessBulk(records: Record<string, unknown>[]) {
  await api("PUT", ath("/wellness-bulk"), { body: records, as: "text" });
  return { updated: records.length };
}
export const updateAthlete = (payload: Record<string, unknown>) => api<Athlete>("PUT", ath(""), { body: payload });
export const listAthletes = () => api<Record<string, unknown>[]>(G, "/athletes");
export const createSportSettings = (payload: Record<string, unknown>) =>
  api<SportSettings>("POST", ath("/sport-settings"), { body: payload });

// Gear
export const createGear = (payload: Record<string, unknown>) => api<Gear>("POST", ath("/gear"), { body: payload });
export const updateGear = (id: string, payload: Record<string, unknown>) =>
  api<Gear>("PUT", ath(`/gear/${seg(id)}`), { body: payload });
export const deleteGear = (id: string) => api("DELETE", ath(`/gear/${seg(id)}`));
export const replaceGear = (id: string, payload: Record<string, unknown>) =>
  api<Gear[]>("POST", ath(`/gear/${seg(id)}/replace`), { body: payload });
export const createGearReminder = (gearId: string, payload: Record<string, unknown>) =>
  api<Gear>("POST", ath(`/gear/${seg(gearId)}/reminder`), { body: payload });
export const updateGearReminder = (
  gearId: string,
  reminderId: number,
  payload: Record<string, unknown>,
  reset = false,
  snoozeDays = 0,
) =>
  api<Gear>("PUT", ath(`/gear/${seg(gearId)}/reminder/${reminderId}?reset=${reset}&snoozeDays=${snoozeDays}`), {
    body: payload,
  });
export const deleteGearReminder = (gearId: string, reminderId: number) =>
  api<Gear>("DELETE", ath(`/gear/${seg(gearId)}/reminder/${reminderId}`), { as: "json" });

// Custom items
export const listCustomItems = () => api<Record<string, unknown>[]>(G, ath("/custom-item"));
export const getCustomItem = (id: number) => api<Record<string, unknown>>(G, ath(`/custom-item/${id}`));
export const updateCustomItem = (id: number, payload: Record<string, unknown>) =>
  api<Record<string, unknown>>("PUT", ath(`/custom-item/${id}`), { body: payload });
export const deleteCustomItem = (id: number) => api("DELETE", ath(`/custom-item/${id}`));

// ---------- LOW priority (batch 3) ----------

type Rec = Record<string, unknown>;

// Events and library
export const downloadWorkoutsZip = (ext: "zwo" | "mrc" | "erg" | "fit", oldest: string, newest: string) =>
  api<string>(G, ath(`/workouts.zip${qs({ ext, oldest, newest })}`), { as: "base64" });
export const updateEventsRange = (oldest: string, newest: string, payload: Rec) =>
  api<CalendarEvent[]>("PUT", ath(`/events${qs({ oldest, newest })}`), { body: payload });
export const getTags = (kind: "event" | "workout") => api<string[]>(G, ath(`/${kind}-tags`));
export const getFolderSharedWith = (folderId: number) => api<Rec[]>(G, ath(`/folders/${folderId}/shared-with`));
export const updateFolderSharedWith = (folderId: number, shared: Rec[]) =>
  api<Rec[]>("PUT", ath(`/folders/${folderId}/shared-with`), { body: shared });

// Activity analysis and files
export const getActivitySegments = (id: string) => api<Rec[]>(G, act(id, "/segments"));
export const getActivityModel = (id: string, kind: "hr-load-model" | "power-spike-model") =>
  api<Rec>(G, act(id, `/${kind}`));
export const getActivityPowerCurves = (id: string, types?: string[], fatigue?: string[]) =>
  api<Rec[]>(G, act(id, `/power-curves${qs({ types, fatigue })}`));
export const searchActivitiesFull = (query: string, limit?: number) =>
  api<Activity[]>(G, ath(`/activities/search-full${qs({ q: query, limit })}`));
export const getPaceDistances = (sport?: string) =>
  api<Rec>(G, sport ? ath(`/sport-settings/${seg(sport)}/pace_distances`) : "/pace_distances");
export const downloadActivityFile = (id: string, kind: "original" | "fit" | "gpx") => {
  const sub = kind === "original" ? "/file" : `/${kind}-file`;
  return api<string>(G, act(id, sub), { as: kind === "gpx" ? "text" : "base64" });
};
export const CSV_RESOURCES = [
  "activities",
  "wellness",
  "gear",
  "events",
  "power_curves",
  "pace_curves",
  "hr_curves",
  "activity_power_curves_range",
  "activity_pace_curves_range",
  "activity_hr_curves_range",
  "activity_streams",
  "activity_power_curve",
  "activity_pace_curve",
  "activity_hr_curve",
  "activity_power_vs_hr",
] as const;
export type CsvResource = (typeof CSV_RESOURCES)[number];
export type CsvOpts = {
  oldest?: string;
  newest?: string;
  cols?: string[];
  sport?: string;
  curves?: string[];
  activityId?: string;
  types?: string[];
};

export function exportCsv(resource: CsvResource, opts: CsvOpts = {}) {
  const { oldest, newest, cols, sport, curves, activityId, types } = opts;
  const text = { as: "text" as const };
  const needId = () => {
    if (!activityId) throw new Error(`activity_id is required for ${resource}`);
    return activityId;
  };
  switch (resource) {
    case "activities":
      return api<string>(G, ath(`/activities.csv${qs({ oldest, newest })}`), text);
    case "wellness":
      return api<string>(G, ath(`/wellness.csv${qs({ oldest, newest, cols })}`), text);
    case "gear":
      return api<string>(G, ath("/gear.csv"), text);
    case "events":
      return api<string>(G, ath(`/events.csv${qs({ oldest, newest })}`), text);
    case "power_curves":
    case "pace_curves":
    case "hr_curves": {
      const path = resource.replace("_", "-");
      return api<string>(G, ath(`/${path}.csv${qs({ type: sport ?? "Ride", curves: curves ?? ["1y"] })}`), text);
    }
    case "activity_power_curves_range":
    case "activity_pace_curves_range":
    case "activity_hr_curves_range": {
      const path = resource.replace("_range", "").replace(/_/g, "-");
      return api<string>(G, ath(`/${path}.csv${qs({ oldest, newest, type: sport })}`), text);
    }
    case "activity_streams":
      return api<string>(G, act(needId(), `/streams.csv${qs({ types })}`), text);
    case "activity_power_curve":
      return api<string>(G, act(needId(), "/power-curve.csv"), text);
    case "activity_pace_curve":
      return api<string>(G, act(needId(), "/pace-curve.csv"), text);
    case "activity_hr_curve":
      return api<string>(G, act(needId(), "/hr-curve.csv"), text);
    case "activity_power_vs_hr":
      return api<string>(G, act(needId(), "/power-vs-hr.csv"), text);
  }
}

// Wellness
export const getWellnessDay = (date: string) => api<WellnessDay>(G, ath(`/wellness/${seg(date)}`));
export function uploadWellnessCsv(csv: string, ignoreMissingFields = false) {
  const form = new FormData();
  form.append("file", new File([csv], "wellness.csv", { type: "text/csv" }));
  return api<Rec>("POST", ath(`/wellness?ignoreMissingFields=${ignoreMissingFields}`), { form });
}

// Athlete and sport settings
export const getAthleteProfile = () => api<Rec>(G, ath("/profile"));
export const getAthleteConnections = () => api<Rec>(G, ath("/connections"));
export const getAthleteSettings = (deviceClass: "phone" | "tablet" | "desktop") =>
  api<Rec>(G, ath(`/settings/${deviceClass}`));
export const updateSportSettingsBulk = (settings: Rec[], recalcHrZones = false) =>
  api<SportSettings[]>("PUT", ath(`/sport-settings?recalcHrZones=${recalcHrZones}`), { body: settings });
export const deleteSportSettings = (id: number) => api("DELETE", ath(`/sport-settings/${id}`));
export const getMatchingActivities = (sportSettingsId: string) =>
  api<Rec[]>(G, ath(`/sport-settings/${seg(sportSettingsId)}/matching-activities`));
export const getWeatherConfig = () => api<Rec>(G, ath("/weather-config"));
export const updateWeatherConfig = (config: Rec) => api<Rec>("PUT", ath("/weather-config"), { body: config });

// Gear
export const recalculateGearStats = (gearId: string) => api<Rec>(G, ath(`/gear/${seg(gearId)}/calc`));

// Routes
export const listRoutes = () => api<Rec[]>(G, ath("/routes"));
export const getRoute = (routeId: number, includePath = false) =>
  api<Rec>(G, ath(`/routes/${routeId}?includePath=${includePath}`));
export const updateRoute = (routeId: number, payload: Rec) =>
  api<Rec>("PUT", ath(`/routes/${routeId}`), { body: payload });
export const getRouteSimilarity = (routeId: number, otherId: number) =>
  api<Rec>(G, ath(`/routes/${routeId}/similarity/${otherId}`));

// Chats and comments
export const listChats = () => api<Rec[]>(G, ath("/chats"));
export const listGroups = () => api<Rec[]>(G, ath("/groups"));
export const getChat = (chatId: number) => api<Rec>(G, `/chats/${chatId}`);
export const listChatMessages = (chatId: number, beforeId?: number, limit?: number) =>
  api<Rec[]>(G, `/chats/${chatId}/messages${qs({ beforeId, limit })}`);
export const listActivityMessages = (activityId: string, sinceId?: number, limit?: number) =>
  api<Rec[]>(G, act(activityId, `/messages${qs({ sinceId, limit })}`));
export const addActivityMessage = (activityId: string, content: string) =>
  api<Rec>("POST", act(activityId, "/messages"), { body: { content } });
export const sendChatMessage = (payload: Rec) => api<Rec>("POST", "/chats/send-message", { body: payload });

// Shared events
export const getSharedEvent = (id: number, fullCourse = false) =>
  api<Rec>(G, `/shared-event/${id}?fullCourse=${fullCourse}`);

// ---------- Remaining endpoints (full coverage) ----------

function fileForm(content: string, filename: string, base64: boolean, mime?: string) {
  const bytes = base64 ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, mime ? { type: mime } : undefined));
  return form;
}

// Chat message management
export const updateChatMessage = (chatId: number, msgId: number, payload: Rec) =>
  api<Rec>("PUT", `/chats/${chatId}/messages/${msgId}`, { body: payload });
export const deleteChatMessage = (chatId: number, msgId: number) =>
  api<Rec>("DELETE", `/chats/${chatId}/messages/${msgId}`, { as: "json" });
export const markChatSeen = (chatId: number, msgId: number) =>
  api<Rec>("PUT", `/chats/${chatId}/messages/${msgId}/seen`);
export const setChatBlocked = (chatId: number, on: boolean) => api<Rec>("PUT", `/chats/${chatId}/block?on=${on}`);

// Library and plans
export const updatePlanWorkouts = (folderId: number, oldestDay: number, newestDay: number, payload: Rec) =>
  api<Workout[]>("PUT", ath(`/folders/${folderId}/workouts?oldest=${oldestDay}&newest=${newestDay}`), {
    body: payload,
  });
export const importWorkoutFile = (
  folderId: number,
  sportType: string,
  content: string,
  filename: string,
  base64: boolean,
) =>
  api<Workout>("POST", ath(`/folders/${folderId}/import-workout${qs({ type: sportType })}`), {
    form: fileForm(content, filename, base64),
  });
export const updateAthletePlans = (plans: Rec[]) => api<Rec>("PUT", "/athlete-plans", { body: plans });

// Custom items
export const reorderCustomItems = (items: Rec[]) =>
  api("PUT", ath("/custom-item-indexes"), { body: items, as: "text" });
export const uploadCustomItemImage = (itemId: number, base64: string, filename: string) =>
  api<Rec>("POST", ath(`/custom-item/${itemId}/image`), { form: fileForm(base64, filename, true) });

// Activities
export const uploadActivityStreamsCsv = (id: string, csv: string) =>
  api<Rec>("PUT", act(id, "/streams.csv"), { form: fileForm(csv, "streams.csv", false, "text/csv") });
export const splitActivityInterval = (id: string, splitAt: number) =>
  api<IntervalsDTO>("PUT", act(id, `/split-interval?splitAt=${splitAt}`));
export const downloadActivityFitFiles = (ids: string[], power = true, hr = true) =>
  api<string>("POST", ath(`/download-fit-files${qs({ ids, power, hr })}`), { as: "base64" });
export const deleteActivityTombstone = (id: string) => api("DELETE", act(id, "/tombstone"));
