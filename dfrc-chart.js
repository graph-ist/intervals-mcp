#!/usr/bin/env node
/**
 * dfrc-chart.js — Generate an interactive dFRC chart for an activity.
 *
 * Usage:
 *   node dfrc-chart.js <activity_id> [--curve=42d|1y|all] [--ftp=NNN] [--frc=NNN]
 *
 * The chart includes a dropdown to toggle between PD models (FFT_CURVES, MORTON_3P, ECP, sport_settings).
 * Reads .env for INTERVALS_API_KEY and INTERVALS_ATHLETE_ID.
 * Produces dfrc-chart.html and opens it in the default browser.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// ---- Load .env ----
const env = {};
try {
  readFileSync(new URL(".env", import.meta.url), "utf-8")
    .split("\n")
    .forEach((l) => {
      const m = l.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    });
} catch {
  console.error("Missing .env file — copy .env.example and fill in your API key");
  process.exit(1);
}

const API_KEY = env.INTERVALS_API_KEY;
const ATHLETE_ID = env.INTERVALS_ATHLETE_ID ?? "0";
if (!API_KEY) {
  console.error("INTERVALS_API_KEY not set in .env");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from("API_KEY:" + API_KEY).toString("base64");
const BASE = "https://intervals.icu/api/v1";

// ---- Parse args ----
const args = process.argv.slice(2);
const activityId = args.find((a) => !a.startsWith("--"));
if (!activityId) {
  console.error("Usage: node dfrc-chart.js <activity_id> [--curve=42d|1y|all] [--ftp=NNN] [--frc=NNN]");
  process.exit(1);
}

const curveArg = args.find((a) => a.startsWith("--curve="));
const curveWindow = curveArg ? curveArg.split("=")[1] : "42d";

// ---- API helpers ----
async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: AUTH, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Compute dFRC for given FTP/FRC ----
function computeDfrc(timeArr, powerArr, ftp, frc) {
  const dfrc = new Array(powerArr.length);
  let wBal = frc;
  for (let i = 0; i < powerArr.length; i++) {
    const p = powerArr[i] ?? 0;
    const dt = i > 0 ? Math.max(timeArr[i] - timeArr[i - 1], 0) : 0;
    if (dt > 0) {
      if (p > ftp) {
        wBal = wBal - (p - ftp) * dt;
      } else {
        wBal = frc - (frc - wBal) * Math.exp(-(ftp - p) * dt / frc);
      }
    }
    dfrc[i] = wBal;
  }
  return dfrc;
}

// ---- Main ----
async function main() {
  console.log(`Fetching activity ${activityId}…`);

  const [streams, activity, curves, settings] = await Promise.all([
    api(`/activity/${activityId}/streams?types=time,watts`),
    api(`/activity/${activityId}?intervals=false`),
    api(`/athlete/${ATHLETE_ID}/power-curves?type=Ride&curves=${curveWindow}`),
    api(`/athlete/${ATHLETE_ID}/sport-settings`),
  ]);

  const sportType = activity?.type ?? "Ride";

  // Extract arrays
  let timeArr, powerArr;
  if (Array.isArray(streams)) {
    timeArr = streams.find((s) => s.type === "time")?.data ?? [];
    powerArr = streams.find((s) => s.type === "watts")?.data ?? [];
  } else {
    timeArr = streams?.time?.data ?? streams?.time ?? [];
    powerArr = streams?.watts?.data ?? streams?.watts ?? [];
  }

  if (powerArr.length === 0) {
    console.error("No power data for this activity.");
    process.exit(1);
  }
  if (timeArr.length === 0) timeArr = powerArr.map((_, i) => i);

  // Build all model configs
  const curveData = curves?.list?.[0];
  const pdModels = curveData?.powerModels ?? [];
  const ss = Array.isArray(settings)
    ? settings.find((s) => s.types?.includes(sportType)) ?? settings[0]
    : settings;

  const modelConfigs = [];

  for (const m of pdModels) {
    modelConfigs.push({
      id: m.type,
      label: `${m.type} (CP=${m.criticalPower}W, W'=${(m.wPrime/1000).toFixed(1)}kJ${m.pMax ? `, Pmax=${m.pMax}W` : ""})`,
      ftp: m.ftp ?? m.criticalPower,
      frc: m.wPrime,
    });
  }

  // Add sport_settings
  modelConfigs.push({
    id: "sport_settings",
    label: `Sport Settings (FTP=${ss?.ftp ?? 200}W, W'=${((ss?.w_prime ?? ss?.wPrime ?? 20000)/1000).toFixed(1)}kJ)`,
    ftp: ss?.ftp ?? 200,
    frc: ss?.w_prime ?? ss?.wPrime ?? 20000,
  });

  console.log(`Found ${modelConfigs.length} models for ${curveWindow}:`);
  modelConfigs.forEach((m) => console.log(`  ${m.label}`));

  // Downsample indices (target ~1000 points)
  const step = Math.max(1, Math.floor(powerArr.length / 1000));
  const indices = [];
  for (let i = 0; i < powerArr.length; i += step) indices.push(i);

  const labels = indices.map((i) => {
    const t = timeArr[i];
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    return `${mm}:${String(ss).padStart(2, "0")}`;
  });
  const powerSeries = indices.map((i) => powerArr[i]);

  // Compute dFRC for each model
  const allModelsData = {};
  for (const mc of modelConfigs) {
    const dfrc = computeDfrc(timeArr, powerArr, mc.ftp, mc.frc);
    const dfrcPctSeries = indices.map((i) => Math.round((dfrc[i] / mc.frc) * 100));
    const minDfrc = Math.min(...dfrc);
    allModelsData[mc.id] = {
      label: mc.label,
      ftp: mc.ftp,
      frc: mc.frc,
      dfrcPct: dfrcPctSeries,
      minDfrc,
      maxDepletion: Math.round((1 - minDfrc / mc.frc) * 100),
      minDfrcKj: Math.round(minDfrc / 100) / 10,
    };
  }

  const defaultModel = modelConfigs.find((m) => m.id === "FFT_CURVES")?.id ?? modelConfigs[0]?.id;
  console.log(`\nDefault model: ${defaultModel}`);

  // ---- Generate HTML ----
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>dFRC — ${activity?.name ?? activityId}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 16px; }
  .controls { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
  .controls label { font-size: 0.85rem; color: #aaa; }
  .controls select {
    background: #16213e; color: #e0e0e0; border: 1px solid #333;
    border-radius: 6px; padding: 8px 12px; font-size: 0.9rem; cursor: pointer;
    min-width: 320px;
  }
  .controls select:focus { outline: none; border-color: #bb86fc; }
  .stats { display: flex; gap: 24px; margin-bottom: 16px; flex-wrap: wrap; }
  .stat { background: #16213e; border-radius: 8px; padding: 12px 18px; min-width: 140px; }
  .stat-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-size: 1.5rem; font-weight: 700; margin-top: 2px; }
  .stat-value.ftp { color: #ffd700; }
  .stat-value.frc { color: #bb86fc; }
  .stat-value.depletion { color: #ff6b6b; }
  .chart-container { position: relative; width: 100%; height: 60vh; min-height: 400px; }
  canvas { border-radius: 8px; background: #16213e; }
</style>
</head>
<body>
<h1>dFRC — ${activity?.name ?? "Activity " + activityId}</h1>
<p class="subtitle">${sportType} · ${activity?.start_date_local?.slice(0, 10) ?? ""} · Power curve: ${curveWindow}</p>

<div class="controls">
  <label for="modelSelect">Modello PD:</label>
  <select id="modelSelect"></select>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-label">eFTP</div>
    <div class="stat-value ftp" id="statFtp"></div>
  </div>
  <div class="stat">
    <div class="stat-label">W' (FRC)</div>
    <div class="stat-value frc" id="statFrc"></div>
  </div>
  <div class="stat">
    <div class="stat-label">Max Depletion</div>
    <div class="stat-value depletion" id="statDepletion"></div>
  </div>
  <div class="stat">
    <div class="stat-label">Min dFRC</div>
    <div class="stat-value depletion" id="statMinDfrc"></div>
  </div>
</div>

<div class="chart-container">
  <canvas id="dfrcChart"></canvas>
</div>

<script>
const labels = ${JSON.stringify(labels)};
const powerData = ${JSON.stringify(powerSeries)};
const models = ${JSON.stringify(allModelsData)};
const defaultModel = ${JSON.stringify(defaultModel)};

// Populate dropdown
const select = document.getElementById('modelSelect');
for (const [id, m] of Object.entries(models)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = m.label;
  if (id === defaultModel) opt.selected = true;
  select.appendChild(opt);
}

// Create chart
const ctx = document.getElementById('dfrcChart').getContext('2d');
const m0 = models[defaultModel];

const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Power (W)',
        data: powerData,
        borderColor: 'rgba(255, 215, 0, 0.7)',
        backgroundColor: 'rgba(255, 215, 0, 0.05)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        yAxisID: 'yPower',
        order: 2,
      },
      {
        label: 'FTP',
        data: new Array(labels.length).fill(m0.ftp),
        borderColor: 'rgba(255, 215, 0, 0.3)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        yAxisID: 'yPower',
        order: 3,
      },
      {
        label: 'dFRC %',
        data: m0.dfrcPct,
        borderColor: '#bb86fc',
        backgroundColor: 'rgba(187, 134, 252, 0.15)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        yAxisID: 'yDfrc',
        order: 1,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#ccc', usePointStyle: true } },
      tooltip: {
        backgroundColor: 'rgba(22,33,62,0.95)',
        titleColor: '#fff',
        bodyColor: '#ddd',
        callbacks: {
          label: function(ctx) {
            if (ctx.dataset.label === 'FTP') return null;
            if (ctx.dataset.label === 'dFRC %') return 'dFRC: ' + ctx.parsed.y + '%';
            return 'Power: ' + ctx.parsed.y + ' W';
          }
        }
      },
    },
    scales: {
      x: {
        ticks: { color: '#666', maxTicksLimit: 20, maxRotation: 0 },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
      yPower: {
        type: 'linear', position: 'left',
        title: { display: true, text: 'Power (W)', color: '#ffd700' },
        ticks: { color: '#ffd700' },
        grid: { color: 'rgba(255,255,255,0.05)' },
        min: 0,
      },
      yDfrc: {
        type: 'linear', position: 'right',
        title: { display: true, text: 'dFRC %', color: '#bb86fc' },
        ticks: { color: '#bb86fc' },
        grid: { drawOnChartArea: false },
        min: Math.min(0, ...Object.values(models).map(m => Math.min(...m.dfrcPct) - 5)),
        max: 105,
      },
    },
  },
});

function updateModel(id) {
  const m = models[id];
  if (!m) return;
  // Update stats
  document.getElementById('statFtp').textContent = m.ftp + ' W';
  document.getElementById('statFrc').textContent = (m.frc / 1000).toFixed(1) + ' kJ';
  document.getElementById('statDepletion').textContent = m.maxDepletion + '%';
  document.getElementById('statMinDfrc').textContent = m.minDfrcKj + ' kJ';
  // Update chart
  chart.data.datasets[1].data = new Array(labels.length).fill(m.ftp);
  chart.data.datasets[2].data = m.dfrcPct;
  chart.update('none');
}

// Init stats
updateModel(defaultModel);

// Listen for changes
select.addEventListener('change', (e) => updateModel(e.target.value));
<\/script>
</body>
</html>`;

  const outPath = new URL("dfrc-chart.html", import.meta.url).pathname;
  writeFileSync(outPath, html);
  console.log(`\nChart written to ${outPath}`);

  // Open in browser
  try {
    if (process.platform === "darwin") execSync(`open "${outPath}"`);
    else if (process.platform === "linux") execSync(`xdg-open "${outPath}"`);
    else if (process.platform === "win32") execSync(`start "" "${outPath}"`);
  } catch {
    console.log("Open the file manually in your browser.");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
