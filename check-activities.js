import { readFileSync } from "fs";

const env = {};
readFileSync("/Users/Q518331/Documents/GitHub/intervals-mcp/.env", "utf-8")
  .split("\n")
  .forEach((l) => {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

const auth =
  "Basic " +
  Buffer.from("API_KEY:" + env.INTERVALS_API_KEY).toString("base64");

const res = await fetch(
  `https://intervals.icu/api/v1/athlete/${env.INTERVALS_ATHLETE_ID}/activities?oldest=2026-02-01&newest=2026-03-26`,
  { headers: { Authorization: auth } }
);
const data = await res.json();

console.log("=== Tutte le attivita per data (solo giorni con possibili run mancanti) ===\n");

// All activities, grouped by date, show only non-Run/non-obvious types
for (const a of data) {
  const date = a.start_date_local?.slice(0, 10);
  const dist = Math.round((a.distance || 0) / 1000 * 10) / 10;
  const dur = Math.round((a.moving_time || 0) / 60);
  console.log(
    `${date} | ${a.id} | ${a.type.padEnd(16)} | ${a.name?.padEnd(30)} | ${dist}km | ${dur}min`
  );
}

console.log("\n=== Conteggio per tipo ===");
const byType = {};
data.forEach((a) => {
  byType[a.type] = (byType[a.type] || 0) + 1;
});
console.log(JSON.stringify(byType, null, 2));
