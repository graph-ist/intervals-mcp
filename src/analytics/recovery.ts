import * as icu from "../intervals.js";
import type { WellnessDay } from "../types.js";

interface MetricResult {
  value: number;
  baseline_mean: number;
  z_score: number;
  status: string;
  trend: string;
}

interface DayResult {
  date: string;
  metrics: Record<string, MetricResult>;
  readiness_device: number | null;
  recovery_index?: number;
  status?: string;
  red_flags?: string[];
  blood_pressure?: { systolic: number; diastolic: number };
  training_load: { ctl: number; atl: number; tsb: number; ramp_rate: number | undefined };
}

const METRICS: [keyof WellnessDay, boolean][] = [
  ["hrv", true],
  ["restingHR", false],
  ["avgSleepingHR", false],
  ["sleepSecs", true],
  ["sleepScore", true],
  ["baevskySI", false],
  ["spO2", true],
  ["respiration", false],
  // Subjective fields, intervals.icu 1-4 scales where 1 is the best state
  // (mood 1=Great, motivation 1=Extreme, sleepQuality 1=Great, fatigue/soreness/stress/injury 1=Low/None)
  ["mood", false],
  ["motivation", false],
  ["sleepQuality", false],
  ["fatigue", false],
  ["soreness", false],
  ["stress", false],
  ["injury", false],
];

const WEIGHTS: Record<string, number> = {
  hrv: 3,
  restingHR: 2,
  avgSleepingHR: 2,
  sleepSecs: 2,
  sleepScore: 2,
  baevskySI: 2,
  spO2: 1,
  respiration: 1,
  // Subjective: lower weight individually but collectively significant (Saw et al., 2016)
  mood: 1,
  motivation: 1,
  sleepQuality: 1,
  fatigue: 1,
  soreness: 1,
  stress: 1,
  injury: 1,
};

function stats(arr: number[]): { mean: number; sd: number } {
  if (arr.length === 0) return { mean: 0, sd: 1 };
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return { mean, sd: Math.max(Math.sqrt(variance), 0.001) };
}

// Status bands: >= 80 Recovered, 55-79 Moderate, 40-54 Strained, < 40 At risk
export function recoveryStatus(ri: number): "Recovered" | "Moderate" | "Strained" | "At risk" {
  if (ri >= 80) return "Recovered";
  if (ri >= 55) return "Moderate";
  if (ri >= 40) return "Strained";
  return "At risk";
}

// Below this SpO2 a single reading is a severe red flag (93-94% is reported in reference_ranges as low, not flagged)
export const SPO2_RED_FLAG = 93;

export async function computeRecoveryIndex(days: number, daysAgo: (n: number) => string, today: () => string) {
  const N = Math.max(14, days);
  const data = await icu.getWellness(daysAgo(N + 30), today());
  if (!data || data.length < 7) return null;

  data.sort((a, b) => a.id.localeCompare(b.id));

  const analysisStart = data.length > N ? data.length - N : 0;
  const results: DayResult[] = [];

  for (let i = analysisStart; i < data.length; i++) {
    const day = data[i];
    const dayResult: DayResult = { date: day.id, metrics: {}, readiness_device: day.readiness ?? null } as DayResult;

    for (const [field, higherBetter] of METRICS) {
      const rawVal = day[field] as number | undefined;
      if (rawVal == null) continue;
      // rMSSD is log-normally distributed: z-scores on ln(rMSSD) (Plews et al. 2012)
      const tf = (v: number) => (field === "hrv" ? Math.log(Math.max(v, 1)) : v);
      const val = tf(rawVal);

      const baseline: number[] = [];
      for (let j = Math.max(0, i - 30); j < i; j++) {
        const v = data[j]?.[field] as number | undefined;
        if (v != null) baseline.push(tf(v));
      }
      if (baseline.length < 5) continue;

      const { mean, sd } = stats(baseline);
      const zRaw = (val - mean) / sd;
      const z = higherBetter ? zRaw : -zRaw;

      let status: string;
      if (z >= -0.5) status = "green";
      else if (z >= -1.5) status = "amber";
      else status = "red";

      const recent7: number[] = [];
      for (let j = Math.max(0, i - 6); j <= i; j++) {
        const v = data[j]?.[field] as number | undefined;
        if (v != null) recent7.push(tf(v));
      }
      let trend = "→";
      if (recent7.length >= 3) {
        const first = recent7.slice(0, Math.floor(recent7.length / 2));
        const second = recent7.slice(Math.floor(recent7.length / 2));
        const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
        const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
        const delta = (avgSecond - avgFirst) / sd;
        if (higherBetter) {
          trend = delta > 0.3 ? "↑" : delta < -0.3 ? "↓" : "→";
        } else {
          trend = delta < -0.3 ? "↑" : delta > 0.3 ? "↓" : "→";
        }
      }

      dayResult.metrics[field] = {
        value: Math.round(rawVal * 100) / 100,
        baseline_mean: Math.round((field === "hrv" ? Math.exp(mean) : mean) * 100) / 100,
        z_score: Math.round(z * 100) / 100,
        status,
        trend,
      };
    }

    // Composite Recovery Index (0-100)
    const metricEntries = Object.values(dayResult.metrics);
    if (metricEntries.length >= 3) {
      let wSum = 0,
        zSum = 0;
      for (const [field, m] of Object.entries(dayResult.metrics)) {
        const w = WEIGHTS[field] ?? 1;
        zSum += m.z_score * w;
        wSum += w;
      }
      const avgZ = zSum / wSum;
      const recoveryIndex = Math.round(100 / (1 + Math.exp(-1.2 * (avgZ + 0.5))));
      dayResult.recovery_index = recoveryIndex;

      dayResult.status = recoveryStatus(recoveryIndex);
    }

    // Red flags
    const flags: string[] = [];
    const hrvM = dayResult.metrics.hrv;
    if (hrvM && hrvM.z_score < -2) flags.push(`HRV critically low (${hrvM.value} ms, z=${hrvM.z_score})`);
    const rhrM = dayResult.metrics.restingHR;
    if (rhrM && rhrM.z_score < -2) flags.push(`Resting HR elevated (${rhrM.value} bpm, z=${rhrM.z_score})`);
    const baeM = dayResult.metrics.baevskySI;
    if (baeM && baeM.z_score < -1.5) flags.push(`Autonomic stress high (Baevsky SI=${baeM.value}, z=${baeM.z_score})`);
    const spo2M = dayResult.metrics.spO2;
    if (spo2M && spo2M.value < SPO2_RED_FLAG) flags.push(`SpO₂ critically low (${spo2M.value}%)`);
    if (day.systolic && day.systolic > 140) flags.push(`Systolic BP elevated (${day.systolic} mmHg)`);
    if (day.diastolic && day.diastolic > 90) flags.push(`Diastolic BP elevated (${day.diastolic} mmHg)`);
    if (flags.length > 0) dayResult.red_flags = flags;

    if (day.systolic && day.diastolic) {
      dayResult.blood_pressure = { systolic: day.systolic, diastolic: day.diastolic };
    }

    dayResult.training_load = {
      ctl: day.ctl ?? 0,
      atl: day.atl ?? 0,
      tsb: (day.ctl ?? 0) - (day.atl ?? 0),
      ramp_rate: day.rampRate,
    };
    results.push(dayResult);
  }

  const todayResult = results[results.length - 1];

  // Count how many days have subjective data filled in
  const SUBJECTIVE_KEYS = ["mood", "motivation", "sleepQuality", "fatigue", "soreness", "stress", "injury"];
  const subjectiveDays = results.filter((r) => SUBJECTIVE_KEYS.some((k) => r.metrics[k] != null)).length;
  const hasSubjective = subjectiveDays > 0;
  const subjectiveFields = SUBJECTIVE_KEYS.filter((k) => todayResult?.metrics[k] != null);
  return {
    today: todayResult,
    period_days: results.length,
    avg_recovery_index: Math.round(
      results.reduce((s, r) => s + (r.recovery_index ?? 0), 0) /
        (results.filter((r) => r.recovery_index != null).length || 1),
    ),
    red_flag_days: results.filter((r) => (r.red_flags?.length ?? 0) > 0).length,
    subjective_data: {
      available: hasSubjective,
      days_with_data: subjectiveDays,
      today_fields: subjectiveFields,
      note: hasSubjective
        ? `Subjective data included (${subjectiveFields.length}/${SUBJECTIVE_KEYS.length} fields today). RI accuracy improved.`
        : "No subjective data found. Fill mood/fatigue/soreness/motivation/stress in intervals.icu wellness for better accuracy (Saw et al., 2016).",
    },
    history: results.slice(-7),
    reference_ranges: {
      recovery_index: [
        { range: "≥ 80", label: "Recovered", meaning: "Pronto per intensità alta, intervalli, gare" },
        { range: "55–79", label: "Moderate", meaning: "Stato normale: esegui il piano settimanale" },
        {
          range: "40–54",
          label: "Strained",
          meaning:
            "Un giorno isolato: annota il dato ed esegui il piano. Per ≥3 giorni con ≥2 metriche indipendenti convergenti: ridurre l'intensità, non il volume",
        },
        { range: "< 40", label: "At risk", meaning: "Riposo attivo o sessione Z1 breve, rivalutare nel weekly_review" },
      ],
      tsb_form: [
        { range: "+15 a +25", label: "Fresco", meaning: "Picco di forma, ideale per gara o test" },
        { range: "+5 a +15", label: "Riposato", meaning: "Buona forma, può spingere" },
        { range: "−5 a +5", label: "Neutro", meaning: "Equilibrio carico/recupero" },
        { range: "−15 a −5", label: "Affaticato", meaning: "Accumulo di fatica — normale in blocchi di carico" },
        { range: "−30 a −15", label: "Sovraccarico", meaning: "Fatica significativa — monitorare recovery" },
        { range: "< −30", label: "Critico", meaning: "Rischio overreaching — necessario scarico" },
      ],
      hrv_rmssd: [
        { range: "z ≥ 0", label: "Sopra baseline", meaning: "Buon tono vagale, recovery adeguato" },
        { range: "z −0.5 a 0", label: "Nella norma", meaning: "Variazione fisiologica normale" },
        { range: "z −1.5 a −0.5", label: "Sotto baseline", meaning: "Possibile fatica accumulata o stress" },
        {
          range: "z < −1.5",
          label: "Drop significativo",
          meaning: "Stress autonomico — controllare sonno, carico, malattia",
        },
      ],
      resting_hr: [
        { range: "z ≥ 0", label: "Nella norma o sotto", meaning: "Buon recupero" },
        { range: "z −0.5 a 0", label: "Leggermente sopra", meaning: "Variazione normale" },
        { range: "z −1.5 a −0.5", label: "Elevata", meaning: "Possibile fatica, disidratazione o stress" },
        { range: "z < −1.5", label: "Molto elevata", meaning: "Segnale d'allarme — verificare malattia/overtraining" },
      ],
      sleep_hours: [
        { range: "≥ 8h", label: "Ottimale", meaning: "Recovery completo, adattamento massimizzato" },
        { range: "7–8h", label: "Adeguato", meaning: "Sufficiente per la maggior parte degli atleti" },
        { range: "6–7h", label: "Insufficiente", meaning: "Compromesso il recupero, +30% rischio infortunio" },
        { range: "< 6h", label: "Critico", meaning: "Impatto severo su performance, reazione, immunità" },
      ],
      baevsky_si: [
        {
          range: "scala del dispositivo",
          label: "Valori assoluti non confrontabili",
          meaning:
            "Il Baevsky SI classico (50-500) dipende dall'algoritmo del dispositivo: alcune fonti riportano valori su scala ridotta (es. 2-10). Non usare soglie assolute: leggere z-score e trend rispetto alla propria baseline (z < -1.5 = stress simpatico sopra il solito).",
        },
      ],
      spo2: [
        { range: "97–100%", label: "Normale", meaning: "Saturazione ottimale" },
        { range: "95–96%", label: "Basso-normale", meaning: "Accettabile a livello del mare" },
        { range: "93–94%", label: "Basso", meaning: "Possibile altitudine, affaticamento o patologia" },
        { range: "< 93%", label: "Critico", meaning: "Consultare un medico" },
      ],
      blood_pressure: [
        { range: "< 120/80", label: "Ottimale", meaning: "Pressione ideale" },
        { range: "120–129/<80", label: "Elevata", meaning: "Monitorare, stile di vita" },
        { range: "130–139/80–89", label: "Ipertensione stadio 1", meaning: "Consultare medico" },
        { range: "≥ 140/≥ 90", label: "Ipertensione stadio 2", meaning: "Trattamento necessario" },
      ],
    },
    decision_basis:
      "The Recovery Index is this server's own index, not an intervals.icu value: use get_readiness_check for daily decisions and take from here only the severe flags (HRV or resting HR z below -2, SpO2 below 93%) and which metric moved.",
  };
}
