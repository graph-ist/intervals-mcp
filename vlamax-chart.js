#!/usr/bin/env node
/**
 * vlamax-chart.js — Generate a Metabolic Profile + VLaMax chart.
 *
 * Usage:
 *   node vlamax-chart.js [--sport=Ride] [--curve=current] [--mass=75]
 *
 * Reads .env for INTERVALS_API_KEY and INTERVALS_ATHLETE_ID.
 * Produces vlamax-chart.html and opens it in the default browser.
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
  console.error("Missing .env file");
  process.exit(1);
}

const API_KEY = env.INTERVALS_API_KEY;
const ATHLETE_ID = env.INTERVALS_ATHLETE_ID ?? "0";
if (!API_KEY) { console.error("INTERVALS_API_KEY not set"); process.exit(1); }

const AUTH = "Basic " + Buffer.from("API_KEY:" + API_KEY).toString("base64");
const BASE = "https://intervals.icu/api/v1";

// ---- Parse args ----
const args = process.argv.slice(2);
function argVal(name) {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : null;
}
const sportType = argVal("sport") ?? "Ride";
const curveType = argVal("curve") ?? "1y";
const massOverride = argVal("mass") ? Number(argVal("mass")) : null;

// ---- API ----
async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: AUTH, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Main ----
async function main() {
  console.log(`Fetching metabolic profile (${sportType}, ${curveType})…`);

  const [curves, settings, athlete] = await Promise.all([
    api(`/athlete/${ATHLETE_ID}/power-curves?type=${sportType}&curves=${curveType}`),
    api(`/athlete/${ATHLETE_ID}/sport-settings`),
    api(`/athlete/${ATHLETE_ID}`),
  ]);

  // ---- Parse power-duration data ----
  // API returns DataCurveSetPowerCurve: { list: [{ secs: int[], values: int[] }] }
  let pdData = [];
  const curveList = curves?.list ?? (Array.isArray(curves) ? curves : [curves]);

  let curveData = null;
  for (const curve of curveList) {
    if (!curve) continue;
    const secsArr = curve.secs;
    const wattsArr = curve.values ?? curve.watts;
    if (Array.isArray(secsArr) && Array.isArray(wattsArr)) {
      curveData = curve;
      for (let i = 0; i < secsArr.length; i++) {
        if (wattsArr[i] != null && wattsArr[i] > 0) {
          pdData.push({ secs: secsArr[i], watts: wattsArr[i] });
        }
      }
      if (pdData.length > 0) break;
    }
  }

  if (pdData.length === 0) {
    console.error("No power-duration data available.");
    process.exit(1);
  }

  pdData.sort((a, b) => a.secs - b.secs);

  // ---- Athlete settings ----
  const ss = Array.isArray(settings)
    ? settings.find((s) => s.types?.includes(sportType)) ?? settings[0]
    : settings;

  const ftp = ss?.ftp ?? 250;
  const mass = massOverride ?? athlete?.weight ?? 75;

  // Interpolate power at duration t from MMP data
  function powerAt(t) {
    // Exact match first
    for (const p of pdData) { if (p.secs === t) return p.watts; }
    // Closest neighbor
    let best = pdData[0], bestDiff = Math.abs(pdData[0].secs - t);
    for (const p of pdData) {
      const d = Math.abs(p.secs - t);
      if (d < bestDiff) { bestDiff = d; best = p; }
    }
    return best.watts;
  }

  // Key power outputs
  const P1_mmp = powerAt(1);
  const P5 = powerAt(5), P15 = powerAt(15), P30 = powerAt(30);
  const P60 = powerAt(60), P300 = powerAt(300);
  const P1200 = powerAt(1200), P3600 = powerAt(3600);
  const MAP = P300; // Maximal Aerobic Power ≈ 5-min MMP

  // ===========================================================================
  // Mader Bioenergetic Model — VLaMax estimation
  // (see references in model comment block below)
  // ===========================================================================

  const TAU_VO2 = 30;   // seconds
  const TAU_PCR = 23;   // seconds
  const K_CONV = 6.3;   // calibrated conversion constant

  // Compute VLaMax and energy breakdown for a given Pmax
  function computeProfile(pmax) {
    const testDurations = [10, 12, 15, 18, 20, 25, 30];
    let bestVla = 0, bestT = 0;

    for (const T of testDurations) {
      const Pt = powerAt(T);
      const E_total = Pt * T;
      const E_aer = MAP * (T + TAU_VO2 * (Math.exp(-T / TAU_VO2) - 1));
      const P_PCr_0 = Math.max(0, pmax - MAP);
      const E_PCr = P_PCr_0 * TAU_PCR * (1 - Math.exp(-T / TAU_PCR));
      const E_glyc = Math.max(0, E_total - E_aer - E_PCr);
      const vla = E_glyc / (K_CONV * mass * T);
      if (vla > bestVla) { bestVla = vla; bestT = T; }
    }

    const sampleDurations = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600];
    const breakdown = [];
    for (const t of sampleDurations) {
      const Pt = powerAt(t);
      if (Pt <= 0) continue;
      const P_aer = Math.min(MAP, MAP * (1 - Math.exp(-t / TAU_VO2)));
      const P_PCr_0 = Math.max(0, pmax - MAP);
      const P_pcr = P_PCr_0 * Math.exp(-t / TAU_PCR);
      const P_glyc = Math.max(0, Pt - P_aer - P_pcr);
      const total = P_aer + P_pcr + P_glyc;
      breakdown.push({
        label: t < 60 ? `${t}s` : t < 3600 ? `${Math.round(t / 60)}m` : `${(t / 3600).toFixed(0)}h`,
        aerobic_pct: Math.round((P_aer / total) * 100),
        pcr_pct: Math.round((P_pcr / total) * 100),
        glycolytic_pct: Math.round((P_glyc / total) * 100),
      });
    }

    let cls;
    if (bestVla >= 0.8) cls = "Very High (sprinter)";
    else if (bestVla >= 0.6) cls = "High (explosive)";
    else if (bestVla >= 0.45) cls = "Moderate (all-rounder)";
    else if (bestVla >= 0.3) cls = "Low (endurance)";
    else cls = "Very Low (ultra-endurance)";

    return {
      pmax,
      vlamax: bestVla,
      vlamax_per_min: Math.round(bestVla * 60 * 100) / 100,
      peak_duration: bestT,
      classification: cls,
      breakdown,
    };
  }

  // Build all Pmax variants
  const pdModels = curveData?.powerModels ?? [];
  const pmaxVariants = [];

  for (const m of pdModels) {
    if (m.pMax) {
      pmaxVariants.push({ id: m.type, label: `${m.type} (Pmax=${m.pMax}W, CP=${m.criticalPower}W, W'=${(m.wPrime/1000).toFixed(1)}kJ)`, pmax: m.pMax });
    }
  }
  // Add P1 MMP
  pmaxVariants.push({ id: "MMP_1s", label: `MMP 1s (P1=${P1_mmp}W)`, pmax: P1_mmp });
  // Add sport settings Pmax if different
  const ssPmax = ss?.p_max ?? ss?.pMax;
  if (ssPmax && !pmaxVariants.find(v => v.pmax === ssPmax)) {
    pmaxVariants.push({ id: "sport_settings", label: `Sport Settings (Pmax=${ssPmax}W)`, pmax: ssPmax });
  }

  // Deduplicate by Pmax value (keep first)
  const seenPmax = new Set();
  const uniqueVariants = pmaxVariants.filter(v => {
    if (seenPmax.has(v.pmax)) return false;
    seenPmax.add(v.pmax);
    return true;
  });

  // Compute profiles for each variant
  const allProfiles = {};
  for (const v of uniqueVariants) {
    allProfiles[v.id] = { ...computeProfile(v.pmax), label: v.label };
  }

  // Default: highest Pmax model variant (usually the most accurate)
  const defaultId = uniqueVariants.find(v => v.id === "FFT_CURVES")?.id
    ?? uniqueVariants.find(v => v.id === "MORTON_3P")?.id
    ?? uniqueVariants[0]?.id;

  const defaultProfile = allProfiles[defaultId];

  console.log(`Found ${uniqueVariants.length} Pmax variants:`);
  uniqueVariants.forEach(v => {
    const p = allProfiles[v.id];
    console.log(`  ${v.label} → VLaMax=${p.vlamax.toFixed(3)} at T=${p.peak_duration}s — ${p.classification}`);
  });

  // ---- Downsample PD curve for chart ----
  const step = Math.max(1, Math.floor(pdData.length / 300));
  const pdChart = pdData.filter((_, i) => i % step === 0);

  // FRC from FFT model
  const fftModel = curveData?.powerModels?.find(m => m.type === "FFT_CURVES");
  const frc = fftModel?.wPrime ?? ss?.w_prime ?? ss?.wPrime ?? 20000;

  console.log(`\nDefault: ${defaultId}, FTP: ${ftp}W, MAP: ${MAP}W, mass: ${mass}kg`);

  // ---- Generate HTML ----
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Metabolic Profile — VLaMax</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #0f0f23; color: #e0e0e0; padding: 20px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #fff; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 12px; }
  .controls { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
  .controls label { font-size: 0.85rem; color: #aaa; }
  .controls select {
    background: #1a1a3e; color: #e0e0e0; border: 1px solid #333;
    border-radius: 6px; padding: 8px 12px; font-size: 0.85rem; cursor: pointer;
    min-width: 360px;
  }
  .controls select:focus { outline: none; border-color: #ff9ff3; }

  .dashboard { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
  @media (max-width: 900px) { .dashboard { grid-template-columns: 1fr; } }

  .card { background: #1a1a3e; border-radius: 10px; padding: 16px 20px; }
  .card h2 { font-size: 0.9rem; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }

  .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .metric { text-align: center; }
  .metric-label { font-size: 0.65rem; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  .metric-value { font-size: 1.3rem; font-weight: 700; margin-top: 2px; }
  .metric-unit { font-size: 0.7rem; color: #666; }

  .color-pmax { color: #ff6b6b; }
  .color-frc { color: #feca57; }
  .color-map { color: #48dbfb; }
  .color-ftp { color: #0abde3; }

  .vlamax-display { display: flex; align-items: center; gap: 20px; }
  .vlamax-big { font-size: 3rem; font-weight: 800; color: #ff9ff3; }
  .vlamax-unit { font-size: 0.85rem; color: #888; }
  .vlamax-class { font-size: 1.1rem; color: #ff9ff3; margin-top: 4px; }

  .gauge-container { flex: 1; }
  .gauge-bar { height: 14px; border-radius: 7px; position: relative;
    background: linear-gradient(to right, #0abde3, #48dbfb, #1dd1a1, #feca57, #ff6b6b, #ee5a24); }
  .gauge-indicator { position: absolute; top: -4px; width: 4px; height: 22px;
    background: #fff; border-radius: 2px; transform: translateX(-50%); box-shadow: 0 0 6px rgba(255,255,255,0.8); }
  .gauge-labels { display: flex; justify-content: space-between; font-size: 0.6rem; color: #666; margin-top: 4px; }

  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  @media (max-width: 900px) { .chart-row { grid-template-columns: 1fr; } }
  .chart-box { background: #1a1a3e; border-radius: 10px; padding: 16px; }
  .chart-box h3 { font-size: 0.8rem; color: #888; text-transform: uppercase; margin-bottom: 8px; }
  .chart-wrap { position: relative; width: 100%; height: 320px; }
  canvas { border-radius: 6px; }
</style>
</head>
<body>

<h1>Metabolic Profile</h1>
<p class="subtitle">${sportType} · ${curveType} curve · ${mass} kg · FTP ${ftp}W · MAP ${MAP}W</p>

<div class="controls">
  <label for="pmaxSelect">Pmax source:</label>
  <select id="pmaxSelect"></select>
</div>

<div class="dashboard">
  <!-- Key Metrics -->
  <div class="card">
    <h2>Power Profile</h2>
    <div class="metrics-grid">
      <div class="metric">
        <div class="metric-label">Pmax</div>
        <div class="metric-value color-pmax" id="statPmax"></div>
        <div class="metric-unit" id="statPmaxWkg"></div>
      </div>
      <div class="metric">
        <div class="metric-label">15s</div>
        <div class="metric-value color-pmax">${Math.round(P15)}</div>
        <div class="metric-unit">${(P15/mass).toFixed(1)} W/kg</div>
      </div>
      <div class="metric">
        <div class="metric-label">1 min</div>
        <div class="metric-value color-frc">${Math.round(P60)}</div>
        <div class="metric-unit">${(P60/mass).toFixed(1)} W/kg</div>
      </div>
      <div class="metric">
        <div class="metric-label">MAP (5m)</div>
        <div class="metric-value color-map">${Math.round(P300)}</div>
        <div class="metric-unit">${(P300/mass).toFixed(1)} W/kg</div>
      </div>
      <div class="metric">
        <div class="metric-label">FTP</div>
        <div class="metric-value color-ftp">${ftp}</div>
        <div class="metric-unit">${(ftp/mass).toFixed(2)} W/kg</div>
      </div>
      <div class="metric">
        <div class="metric-label">FRC</div>
        <div class="metric-value color-frc">${(frc/1000).toFixed(1)}</div>
        <div class="metric-unit">kJ</div>
      </div>
      <div class="metric">
        <div class="metric-label">20 min</div>
        <div class="metric-value color-ftp">${Math.round(P1200)}</div>
        <div class="metric-unit">${(P1200/mass).toFixed(1)} W/kg</div>
      </div>
      <div class="metric">
        <div class="metric-label">60 min</div>
        <div class="metric-value color-ftp">${Math.round(P3600)}</div>
        <div class="metric-unit">${(P3600/mass).toFixed(1)} W/kg</div>
      </div>
    </div>
  </div>

  <!-- VLaMax -->
  <div class="card">
    <h2>VLaMax — Glycolytic Capacity</h2>
    <div class="vlamax-display">
      <div>
        <div class="vlamax-big" id="statVlamax"></div>
        <div class="vlamax-unit" id="statVlamaxDetail"></div>
        <div class="vlamax-class" id="statVlamaxClass"></div>
      </div>
      <div class="gauge-container">
        <div class="gauge-bar">
          <div class="gauge-indicator" id="gaugeIndicator"></div>
        </div>
        <div class="gauge-labels">
          <span>0.1</span><span>Ultra-End</span><span>Endurance</span><span>All-round</span><span>Explosive</span><span>Sprint</span><span>1.2</span>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="chart-row">
  <!-- Power-Duration Curve -->
  <div class="chart-box">
    <h3>Power-Duration Curve</h3>
    <div class="chart-wrap"><canvas id="pdChart"></canvas></div>
  </div>

  <!-- Energy System Contribution -->
  <div class="chart-box">
    <h3>Energy System Contribution</h3>
    <div class="chart-wrap"><canvas id="energyChart"></canvas></div>
  </div>
</div>

<script>
const profiles = ${JSON.stringify(allProfiles)};
const defaultId = ${JSON.stringify(defaultId)};
const mass = ${mass};

// Populate dropdown
const select = document.getElementById('pmaxSelect');
for (const [id, p] of Object.entries(profiles)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = p.label + ' → VLaMax ' + p.vlamax.toFixed(2) + ' mmol/L/s';
  if (id === defaultId) opt.selected = true;
  select.appendChild(opt);
}

// ---- Power-Duration Curve (static) ----
const pdLabels = ${JSON.stringify(pdChart.map(p => {
    if (p.secs < 60) return p.secs + 's';
    if (p.secs < 3600) return Math.round(p.secs/60) + 'm';
    return (p.secs / 3600).toFixed(1) + 'h';
  }))};
const pdWatts = ${JSON.stringify(pdChart.map(p => Math.round(p.watts)))};

new Chart(document.getElementById('pdChart'), {
  type: 'line',
  data: {
    labels: pdLabels,
    datasets: [
      {
        label: 'Power (W)',
        data: pdWatts,
        borderColor: '#48dbfb',
        backgroundColor: 'rgba(72, 219, 251, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
      },
      {
        label: 'FTP',
        data: new Array(pdLabels.length).fill(${ftp}),
        borderColor: 'rgba(10, 189, 227, 0.4)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#888', usePointStyle: true, font: { size: 10 } } },
      tooltip: { backgroundColor: 'rgba(15,15,35,0.95)', titleColor: '#fff', bodyColor: '#ddd' },
    },
    scales: {
      x: { ticks: { color: '#555', maxTicksLimit: 15, maxRotation: 0 }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { title: { display: true, text: 'Watts', color: '#48dbfb' }, ticks: { color: '#48dbfb' }, grid: { color: 'rgba(255,255,255,0.04)' }, min: 0 },
    },
  },
});

// ---- Energy System Stacked Bar (dynamic) ----
const p0 = profiles[defaultId];
const eLabels = p0.breakdown.map(b => b.label);

const energyChart = new Chart(document.getElementById('energyChart'), {
  type: 'bar',
  data: {
    labels: eLabels,
    datasets: [
      { label: 'PCr (Alactic)', data: p0.breakdown.map(b => b.pcr_pct), backgroundColor: '#ff6b6b', borderRadius: 2 },
      { label: 'Glycolytic (Lactic)', data: p0.breakdown.map(b => b.glycolytic_pct), backgroundColor: '#feca57', borderRadius: 2 },
      { label: 'Aerobic', data: p0.breakdown.map(b => b.aerobic_pct), backgroundColor: '#0abde3', borderRadius: 2 },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#888', usePointStyle: true, font: { size: 10 } } },
      tooltip: {
        backgroundColor: 'rgba(15,15,35,0.95)', titleColor: '#fff', bodyColor: '#ddd',
        callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y + '%' },
      },
    },
    scales: {
      x: { stacked: true, ticks: { color: '#555' }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { stacked: true, max: 100, title: { display: true, text: '%', color: '#888' },
           ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
    },
  },
});

function updateProfile(id) {
  const p = profiles[id];
  if (!p) return;

  // Stats
  document.getElementById('statPmax').textContent = p.pmax;
  document.getElementById('statPmaxWkg').textContent = (p.pmax / mass).toFixed(1) + ' W/kg';
  document.getElementById('statVlamax').textContent = p.vlamax_per_min;
  document.getElementById('statVlamaxDetail').textContent =
    'mmol/L/min (' + p.vlamax.toFixed(2) + ' mmol/L/s · peak at ' + p.peak_duration + 's)';
  document.getElementById('statVlamaxClass').textContent = p.classification;

  // Gauge
  const gaugePct = Math.min(100, Math.max(0, ((p.vlamax - 0.1) / (1.2 - 0.1)) * 100));
  document.getElementById('gaugeIndicator').style.left = gaugePct + '%';

  // Energy chart
  energyChart.data.datasets[0].data = p.breakdown.map(b => b.pcr_pct);
  energyChart.data.datasets[1].data = p.breakdown.map(b => b.glycolytic_pct);
  energyChart.data.datasets[2].data = p.breakdown.map(b => b.aerobic_pct);
  energyChart.update('none');
}

// Init
updateProfile(defaultId);

// Listen
select.addEventListener('change', (e) => updateProfile(e.target.value));
<\/script>
</body>
</html>`;

  const outPath = new URL("vlamax-chart.html", import.meta.url).pathname;
  writeFileSync(outPath, html);
  console.log(`Chart written to ${outPath}`);

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
