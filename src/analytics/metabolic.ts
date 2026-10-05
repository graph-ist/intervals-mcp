import * as icu from "../intervals.js";
import type { PowerCurve } from "../types.js";

export async function computeMetabolicProfile(sport?: string, curve_type?: string) {
  const curveType = curve_type ?? "1y";
  const sportType = sport ?? "Ride";

  const [curves, settings, athlete] = await Promise.all([
    icu.getPowerCurves(sportType, [curveType]),
    icu.getSportSettings(),
    icu.getAthlete(),
  ]);

  const pdData: { secs: number; watts: number }[] = [];
  let curveData: PowerCurve | null = null;

  const curveList: PowerCurve[] = curves?.list ?? ((Array.isArray(curves) ? curves : [curves]) as PowerCurve[]);

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

  if (pdData.length === 0) return null;

  pdData.sort((a, b) => a.secs - b.secs);

  const ssArr = Array.isArray(settings) ? settings : [settings];
  const ss = ssArr.find((s) => s.types?.includes(sportType)) ?? ssArr[0];

  const ftp = ss?.ftp ?? 250;
  const mass = athlete?.weight ?? 75;

  function powerAt(targetSecs: number): number {
    for (const p of pdData) {
      if (p.secs === targetSecs) return p.watts;
    }
    let best = pdData[0];
    let bestDiff = Math.abs(pdData[0].secs - targetSecs);
    for (const p of pdData) {
      const diff = Math.abs(p.secs - targetSecs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best.watts;
  }

  const P5 = powerAt(5);
  const P15 = powerAt(15);
  const P30 = powerAt(30);
  const P60 = powerAt(60);
  const P300 = powerAt(300);
  const P1200 = powerAt(1200);

  const pdModelPmax: number = curveData?.powerModels?.find((m) => m.pMax)?.pMax ?? powerAt(1);

  // Mader Bioenergetic Model — VLaMax estimation
  const TAU_VO2 = 30;
  const TAU_PCR = 23;
  const K_CONV = 6.3;
  const MAP = P300;

  const testDurations = [10, 12, 15, 18, 20, 25, 30];
  let bestVlamax = 0;
  let bestDuration = 0;

  for (const T of testDurations) {
    const Pt = powerAt(T);
    const E_total = Pt * T;
    const E_aer = MAP * (T + TAU_VO2 * (Math.exp(-T / TAU_VO2) - 1));
    const P_PCr_0 = Math.max(0, pdModelPmax - MAP);
    const E_PCr = P_PCr_0 * TAU_PCR * (1 - Math.exp(-T / TAU_PCR));
    const E_glyc = Math.max(0, E_total - E_aer - E_PCr);
    const vla = E_glyc / (K_CONV * mass * T);
    if (vla > bestVlamax) {
      bestVlamax = vla;
      bestDuration = T;
    }
  }

  const vlamax = bestVlamax;

  // Energy system contribution
  const energyBreakdown: {
    secs: number;
    watts: number;
    aerobic_pct: number;
    pcr_pct: number;
    glycolytic_pct: number;
    aerobic_w: number;
    pcr_w: number;
    glycolytic_w: number;
  }[] = [];

  const sampleDurations = [
    1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200,
  ];

  for (const t of sampleDurations) {
    const P_total = powerAt(t);
    if (P_total <= 0) continue;

    const P_aer = Math.min(MAP, MAP * (1 - Math.exp(-t / TAU_VO2)));
    const P_PCr_0 = Math.max(0, pdModelPmax - MAP);
    const P_pcr = P_PCr_0 * Math.exp(-t / TAU_PCR);
    const P_glyc = Math.max(0, P_total - P_aer - P_pcr);
    const total = P_aer + P_pcr + P_glyc;

    energyBreakdown.push({
      secs: t,
      watts: P_total,
      aerobic_w: Math.round(P_aer),
      pcr_w: Math.round(P_pcr),
      glycolytic_w: Math.round(P_glyc),
      aerobic_pct: Math.round((P_aer / total) * 100),
      pcr_pct: Math.round((P_pcr / total) * 100),
      glycolytic_pct: Math.round((P_glyc / total) * 100),
    });
  }

  // VLaMax classification
  let vlamax_class: string;
  if (vlamax >= 0.8) vlamax_class = "Very High (sprinter)";
  else if (vlamax >= 0.6) vlamax_class = "High (explosive)";
  else if (vlamax >= 0.45) vlamax_class = "Moderate (all-rounder)";
  else if (vlamax >= 0.3) vlamax_class = "Low (endurance)";
  else vlamax_class = "Very Low (ultra-endurance)";

  // Coggan Power Profile (Allen & Coggan 2010): published bottom (Untrained) and top (World Class) W/kg per sex;
  // the 8 categories are approximated as equal bands between them, as the published table is close to linear
  const female = String((athlete as Record<string, unknown> | undefined)?.sex ?? "").toUpperCase() === "F";
  const cogganRange: Record<string, [number, number]> = female
    ? { "5s": [8.17, 19.42], "1min": [4.7, 9.29], "5min": [1.87, 6.61], ftp: [1.5, 5.69] }
    : { "5s": [10.17, 24.04], "1min": [5.64, 11.5], "5min": [2.33, 7.6], ftp: [1.86, 6.4] };
  const cogganTable: Record<string, number[]> = Object.fromEntries(
    Object.entries(cogganRange).map(([k, [lo, hi]]) => [
      k,
      Array.from({ length: 8 }, (_, i) => Math.round((lo + ((hi - lo) * i) / 8) * 100) / 100),
    ]),
  );
  const cogganLevels = [
    "Untrained",
    "Fair",
    "Moderate",
    "Good",
    "Very Good",
    "Excellent",
    "Exceptional",
    "World Class",
  ];

  function classifyCoggan(wkg: number, key: string): { level: string; band: string } {
    const thresholds = cogganTable[key];
    let idx = 0;
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (wkg >= thresholds[i]) {
        idx = i;
        break;
      }
    }
    return { level: cogganLevels[idx], band: `${idx + 1}/8` };
  }

  const cogganProfile = {
    "5s": { w_per_kg: Math.round((P5 / mass) * 100) / 100, ...classifyCoggan(P5 / mass, "5s") },
    "1min": { w_per_kg: Math.round((P60 / mass) * 100) / 100, ...classifyCoggan(P60 / mass, "1min") },
    "5min": { w_per_kg: Math.round((P300 / mass) * 100) / 100, ...classifyCoggan(P300 / mass, "5min") },
    ftp: { w_per_kg: Math.round((ftp / mass) * 100) / 100, ...classifyCoggan(ftp / mass, "ftp") },
  };

  // Fatigue Resistance Index
  const fri = Math.round((ftp / MAP) * 1000) / 10;
  let fri_class: string;
  if (fri >= 82) fri_class = "Excellent — high fatigue resistance (GC / TT specialist)";
  else if (fri >= 78) fri_class = "Good — strong endurance profile";
  else if (fri >= 74) fri_class = "Moderate — balanced";
  else if (fri >= 70) fri_class = "Low — explosive but fatigable";
  else fri_class = "Very Low — sprinter profile, poor sustainability";

  // ACSM cycle-ergometry estimate from 5-min power: VO2max ≈ 10.8 · W/kg + 7
  const vo2max_est = Math.round((curveData?.vo2max_5m ?? 10.8 * (MAP / mass) + 7) * 10) / 10;

  const fftModel = curveData?.powerModels?.find((m) => m.type === "FFT_CURVES");
  const frc = fftModel?.wPrime ?? ss?.w_prime ?? ss?.wPrime ?? 20000;

  return {
    athlete: { weight_kg: mass, sport: sportType, curve_type: curveType },
    key_metrics: {
      pmax_watts: Math.round(pdModelPmax),
      p5s_watts: Math.round(P5),
      p15s_watts: Math.round(P15),
      p30s_watts: Math.round(P30),
      p1min_watts: Math.round(P60),
      map_5min_watts: Math.round(P300),
      p20min_watts: Math.round(P1200),
      ftp_watts: ftp,
      frc_joules: frc,
      frc_kj: Math.round(frc / 100) / 10,
      vo2max_est,
      w_per_kg_ftp: Math.round((ftp / mass) * 100) / 100,
      w_per_kg_map: Math.round((P300 / mass) * 100) / 100,
    },
    coggan_power_profile: cogganProfile,
    coggan_table: { sex: female ? "F" : "M", lower_bounds_w_per_kg: cogganTable, levels: cogganLevels },
    fatigue_resistance: {
      fri_pct: fri,
      classification: fri_class,
      note: "FRI = FTP/MAP × 100 (Pinot & Grappe 2015). Higher = more sustainable endurance.",
    },
    vlamax: {
      value_mmol_L_s: Math.round(vlamax * 1000) / 1000,
      value_mmol_L_min: Math.round(vlamax * 60 * 100) / 100,
      peak_duration_s: bestDuration,
      classification: vlamax_class,
      model:
        "Mader bioenergetic (3-component: aerobic τ=30s, PCr τ=23s, glycolytic residual, K=6.3 calibrated vs lactate test)",
      note: "Heuristic estimate from the power curve, NOT a lab value: it depends on assumed constants (τ, K) and on having true all-out 10-30 s efforts. Use for trends on the same athlete, not for comparison with INSCYD/lab tests.",
    },
    energy_system_breakdown: energyBreakdown,
    power_duration_curve: pdData.filter((_p, i) => i % Math.max(1, Math.floor(pdData.length / 200)) === 0),
    reference_ranges: {
      vlamax_mmol_L_s: [
        {
          range: "< 0.30",
          label: "Molto basso",
          meaning: "Ultra-endurance — minima produzione di lattato, eccellente per Ironman e granfondo",
        },
        {
          range: "0.30–0.44",
          label: "Basso",
          meaning: "Endurance — profilo triatleta/climber, buona clearance del lattato",
        },
        {
          range: "0.45–0.59",
          label: "Moderato",
          meaning: "All-rounder — bilanciato tra resistenza e potenza, tipico strada",
        },
        { range: "0.60–0.79", label: "Alto", meaning: "Esplosivo — forte anaerobicamente, buono per criterium e CX" },
        { range: "≥ 0.80", label: "Molto alto", meaning: "Sprinter — massima capacità glicolitica, pista e sprint" },
      ],
      fri_pct: [
        { range: "≥ 82%", label: "Eccellente", meaning: "Sostiene quasi tutta la MAP — GC/crono specialist" },
        { range: "78–81%", label: "Buono", meaning: "Profilo endurance forte" },
        { range: "74–77%", label: "Moderato", meaning: "Bilanciato" },
        { range: "70–73%", label: "Basso", meaning: "Esplosivo ma fatigabile — puncheur" },
        { range: "< 70%", label: "Molto basso", meaning: "Sprinter puro — potenza non sostenibile" },
      ],
      vo2max_ml_kg_min: [
        { range: "< 35", label: "Basso", meaning: "Sedentario o principiante" },
        { range: "35–45", label: "Medio", meaning: "Amatore ricreativo" },
        { range: "45–55", label: "Buono", meaning: "Amatore allenato" },
        { range: "55–65", label: "Molto buono", meaning: "Atleta competitivo" },
        { range: "65–75", label: "Eccellente", meaning: "Elite / semi-pro" },
        { range: "> 75", label: "World class", meaning: "Professionista di alto livello" },
      ],
      ftp_w_per_kg: [
        { range: "< 2.5", label: "Principiante", meaning: "Prime fasi di allenamento strutturato" },
        { range: "2.5–3.2", label: "Intermedio", meaning: "Amatore regolare" },
        { range: "3.2–4.0", label: "Avanzato", meaning: "Amatore competitivo — cat. 3-4" },
        { range: "4.0–4.7", label: "Molto forte", meaning: "Agonista serio — cat. 1-2" },
        { range: "4.7–5.5", label: "Elite", meaning: "Pro continental / nazionale" },
        { range: "> 5.5", label: "World class", meaning: "WorldTour / GT contender" },
      ],
    },
  };
}
