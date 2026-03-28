const BASE = "https://intervals.icu/api/v1";

let apiKey: string;
let athleteId: string;

export function configure(key: string, athlete: string) {
  apiKey = key;
  athleteId = athlete;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function ath(sub: string) {
  return `/athlete/${athleteId}${sub}`;
}

function act(id: string, sub = "") {
  return `/activity/${id}${sub}`;
}

// ---------- API functions ----------

export function getAthlete() {
  return request(ath(""));
}

export function getActivities(oldest: string, newest: string) {
  return request(ath(`/activities?oldest=${oldest}&newest=${newest}`));
}

export function searchActivities(query: string, limit = 10) {
  return post(ath("/activity-search"), { query, limit });
}

export function getActivity(id: string, intervals = true) {
  return request(act(id, `?intervals=${intervals}`));
}

export function getActivityStreams(id: string, types: string[]) {
  return request(act(id, `/streams?types=${types.join(",")}`));
}

export function getActivityPowerCurve(id: string) {
  return request(act(id, "/power-curve"));
}

export function getActivityPaceCurve(id: string) {
  return request(act(id, "/pace-curve"));
}

export function getActivityHRCurve(id: string) {
  return request(act(id, "/hr-curve"));
}

export function getActivityPowerVsHR(id: string) {
  return request(act(id, "/power-vs-hr"));
}

export function getWellness(oldest: string, newest: string) {
  return request(ath(`/wellness?oldest=${oldest}&newest=${newest}`));
}

export function getEvents(oldest: string, newest: string, category?: string) {
  let url = ath(`/events?oldest=${oldest}&newest=${newest}`);
  if (category) url += `&category=${category}`;
  return request(url);
}

export function createEvent(payload: Record<string, unknown>) {
  return post(ath("/events"), payload);
}

export function getPowerCurves(sportType: string, curves: string[]) {
  return request(ath(`/power-curves?type=${sportType}&curves=${curves.join(",")}`));
}

export function getPaceCurves(sportType: string, curves: string[]) {
  return request(ath(`/pace-curves?type=${sportType}&curves=${curves.join(",")}`));
}

export function getHRCurves(sportType: string, curves: string[]) {
  return request(ath(`/hr-curves?type=${sportType}&curves=${curves.join(",")}`));
}

export function getSportSettings() {
  return request(ath("/sport-settings"));
}

export function getAthleteSummary(oldest: string, newest: string) {
  return request(ath(`/athlete-summary?oldest=${oldest}&newest=${newest}`));
}

export function getPowerHRCurve(oldest: string, newest: string) {
  return request(ath(`/power-hr-curve?oldest=${oldest}&newest=${newest}`));
}

export async function createEvents(events: Record<string, unknown>[]) {
  const results = [];
  for (const event of events) {
    const result = await post(ath("/events"), event);
    results.push(result);
  }
  return results;
}

export async function updateEvent(id: number, payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}${ath(`/events/${id}`)}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function deleteEvent(id: number) {
  const res = await fetch(`${BASE}${ath(`/events/${id}`)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return { deleted: true };
}

export function createCustomItem(payload: Record<string, unknown>) {
  return post(ath("/custom-items"), payload);
}

export function getFolders() {
  return request(ath("/folders"));
}

export async function updateSportSettings(type: string, settings: Record<string, unknown>) {
  const res = await fetch(`${BASE}${ath(`/sport-settings/${type}`)}?recalcHrZones=true`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function uploadActivity(fileData: Buffer, filename: string) {
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array(fileData)], filename));
  const res = await fetch(`${BASE}${ath("/activities")}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
    },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function updateWellness(date: string, data: Record<string, unknown>) {
  const res = await fetch(`${BASE}${ath(`/wellness/${date}`)}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
