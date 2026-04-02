import * as icu from "../intervals.js";

interface WeeklyStats {
  week_ending: string;
  weekly_load: number;
  daily_mean: number;
  monotony: number;
  monotony_risk: string;
  strain: number;
}

interface AcwrEntry {
  date: string;
  atl: number;
  ctl: number;
  acwr: number;
  risk_zone: string;
}

export async function computeTrainingLoadRisk(days: number, daysAgo: (n: number) => string, today: () => string) {
  const N = Math.max(14, days);
  const data = await icu.getWellness(daysAgo(N), today());
  if (!data || data.length < 7) {
    return null;
  }
  data.sort((a, b) => a.id.localeCompare(b.id));

  const dailyLoads = data.map((d) => ({ date: d.id, load: d.ctlLoad ?? 0, ctl: d.ctl ?? 0, atl: d.atl ?? 0 }));

  // Rolling 7-day Monotony & Strain (Foster 1998)
  const weekly: WeeklyStats[] = [];
  for (let i = 6; i < dailyLoads.length; i++) {
    const week = dailyLoads.slice(i - 6, i + 1);
    const loads = week.map((d) => d.load);
    const sum = loads.reduce((s, v) => s + v, 0);
    const mean = sum / 7;
    const sd = Math.sqrt(loads.reduce((s, v) => s + (v - mean) ** 2, 0) / 7);
    const monotony = sd > 0 ? mean / sd : 0;
    const strain = sum * monotony;

    let monotony_risk: string;
    if (monotony > 2.0) monotony_risk = "high";
    else if (monotony > 1.5) monotony_risk = "moderate";
    else monotony_risk = "low";

    weekly.push({
      week_ending: dailyLoads[i].date,
      weekly_load: Math.round(sum),
      daily_mean: Math.round(mean),
      monotony: Math.round(monotony * 100) / 100,
      monotony_risk,
      strain: Math.round(strain),
    });
  }

  // ACWR: ATL / CTL (EWMA-based from intervals.icu)
  const acwrHistory: AcwrEntry[] = [];
  for (const d of dailyLoads) {
    if (d.ctl <= 0) continue;
    const acwr = Math.round((d.atl / d.ctl) * 100) / 100;
    let risk_zone: string;
    if (acwr < 0.8) risk_zone = "undertraining";
    else if (acwr <= 1.3) risk_zone = "sweet_spot";
    else if (acwr <= 1.5) risk_zone = "danger_zone";
    else risk_zone = "spike";

    acwrHistory.push({
      date: d.date,
      atl: Math.round(d.atl * 10) / 10,
      ctl: Math.round(d.ctl * 10) / 10,
      acwr,
      risk_zone,
    });
  }

  // Summary flags
  const flags: string[] = [];
  const lastWeek = weekly[weekly.length - 1];
  if (lastWeek?.monotony > 2.0)
    flags.push(`Monotony high (${lastWeek.monotony}) — uniform load increases illness/injury risk (Foster 1998)`);
  if (lastWeek?.strain > 4000) flags.push(`Strain very high (${lastWeek.strain}) — cumulative overload risk`);

  const lastAcwr = acwrHistory[acwrHistory.length - 1];
  if (lastAcwr?.acwr > 1.5) flags.push(`ACWR spike (${lastAcwr.acwr}) — 3-5× injury risk (Gabbett 2016)`);
  else if (lastAcwr?.acwr > 1.3) flags.push(`ACWR elevated (${lastAcwr.acwr}) — ~2× injury risk (danger zone)`);
  else if (lastAcwr?.acwr < 0.8) flags.push(`ACWR low (${lastAcwr.acwr}) — detraining risk`);

  if (weekly.length >= 2) {
    const prev = weekly[weekly.length - 2].weekly_load;
    const curr = lastWeek.weekly_load;
    if (prev > 0) {
      const pctChange = Math.round(((curr - prev) / prev) * 100);
      if (pctChange > 30) flags.push(`Weekly load spike +${pctChange}% week-over-week (>30% threshold)`);
    }
  }

  return {
    today: {
      acwr: lastAcwr,
      monotony: lastWeek,
      flags: flags.length > 0 ? flags : ["No risk flags — training load looks balanced"],
    },
    weekly_history: weekly.slice(-6),
    acwr_history: acwrHistory.slice(-14),
    daily_loads: dailyLoads.slice(-14),
    reference_ranges: {
      acwr: [
        {
          range: "< 0.80",
          label: "Undertraining",
          meaning: "Carico troppo basso — rischio decondizionamento e perdita di fitness",
        },
        {
          range: "0.80–1.30",
          label: "Sweet spot",
          meaning: "Zona ottimale — rischio infortunio minimizzato, buon adattamento",
        },
        {
          range: "1.30–1.50",
          label: "Danger zone",
          meaning: "Carico acuto elevato vs cronico — ~2× rischio infortunio",
        },
        { range: "> 1.50", label: "Spike", meaning: "Incremento brusco — 3-5× rischio infortunio, ridurre subito" },
      ],
      monotony: [
        { range: "< 1.5", label: "Bassa", meaning: "Buona variazione del carico giorno per giorno" },
        { range: "1.5–2.0", label: "Moderata", meaning: "Carico abbastanza uniforme — attenzione" },
        { range: "> 2.0", label: "Alta", meaning: "Carico troppo uniforme — associato a malattie (URTI) e infortuni" },
      ],
      weekly_load_tss: [
        { range: "< 300", label: "Basso", meaning: "Volume leggero — recupero o off-season" },
        { range: "300–500", label: "Moderato", meaning: "Volume base — mantenimento fitness" },
        { range: "500–700", label: "Alto", meaning: "Volume significativo — blocco di carico" },
        { range: "700–900", label: "Molto alto", meaning: "Settimana intensa — richiede recupero" },
        { range: "> 900", label: "Estremo", meaning: "Camp o settimana gara multipla — rischio sovraccarico" },
      ],
      ctl_fitness: [
        { range: "< 30", label: "Basso", meaning: "Fitness base — principiante o post-pausa" },
        { range: "30–50", label: "Moderato", meaning: "Amatore regolare" },
        { range: "50–80", label: "Buono", meaning: "Amatore allenato — può gestire blocchi impegnativi" },
        { range: "80–110", label: "Alto", meaning: "Atleta dedicato / semi-pro" },
        { range: "> 110", label: "Elite", meaning: "Volume pro — richiede gestione attenta del recupero" },
      ],
      tsb_form: [
        { range: "+15 a +25", label: "Fresco", meaning: "Picco di forma per gara o test" },
        { range: "+5 a +15", label: "Riposato", meaning: "Buona forma, pronto per intensità" },
        { range: "−5 a +5", label: "Neutro", meaning: "Equilibrio carico/recupero" },
        { range: "−15 a −5", label: "Affaticato", meaning: "Normale durante blocchi di carico" },
        { range: "−30 a −15", label: "Sovraccarico", meaning: "Fatica significativa — pianificare scarico" },
        { range: "< −30", label: "Critico", meaning: "Rischio overreaching — riposo necessario" },
      ],
    },
  };
}
