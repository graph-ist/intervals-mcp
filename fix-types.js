import { readFileSync } from "fs";
import { join } from "path";

const BASE = "https://intervals.icu/api/v1";

// Load .env
const envFile = readFileSync(join(import.meta.dirname, ".env"), "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const apiKey = env.INTERVALS_API_KEY;
const athleteId = env.INTERVALS_ATHLETE_ID;
const auth = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");

async function updateActivity(id, payload) {
  const res = await fetch(`${BASE}/activity/${id}`, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  throw new Error(`${res.status}: ${text.slice(0, 200)}`);
}

async function getActivities(oldest, newest) {
  const res = await fetch(
    `${BASE}/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`,
    { headers: { Authorization: auth } }
  );
  return res.json();
}

const data = await getActivities("2026-02-01", "2026-03-26");

// VirtualRide → Ride
const virtualRides = data.filter((a) => a.type === "VirtualRide");
for (const vr of virtualRides) {
  await updateActivity(vr.id, { type: "Ride" });
  console.log("✓", vr.id, vr.start_date_local?.slice(0, 10), vr.name, "→ Ride");
}

console.log(`\nDone: ${virtualRides.length} VirtualRide → Ride`);
console.log(`Swim: ${data.filter((a) => a.type === "Swim").length} (already correct)`);
