import * as icu from "../intervals.js";
import type { PowerModel } from "../types.js";
import { extractStream } from "./utils.js";

export async function computeDfrc(
  activity_id: string,
  model?: string,
  curve?: string,
  ftp_override?: number,
  frc_override?: number,
) {
  const [streams, activity] = await Promise.all([
    icu.getActivityStreams(activity_id, ["time", "watts"]),
    icu.getActivity(activity_id),
  ]);

  const sportType = activity?.type ?? "Ride";
  let ftp = ftp_override;
  let frc = frc_override;
  let modelUsed = "override";
  const preferredModel = model ?? "FFT_CURVES";
  const curveWindow = curve ?? "42d";

  const [curves, settings] = await Promise.all([
    icu.getPowerCurves(sportType, [curveWindow]).catch(() => null),
    icu.getSportSettings(),
  ]);

  const curveData = curves?.list?.[0];
  const pdModels: PowerModel[] = curveData?.powerModels ?? [];
  const ssArr = Array.isArray(settings) ? settings : [settings];
  const ss = ssArr.find((s) => s.types?.includes(sportType)) ?? ssArr[0];

  const availableModels: { id: string; ftp: number; wPrime: number; pMax?: number }[] = [];
  for (const m of pdModels) {
    availableModels.push({
      id: m.type,
      ftp: m.ftp ?? m.criticalPower ?? 0,
      wPrime: m.wPrime ?? 0,
      ...(m.pMax ? { pMax: m.pMax } : {}),
    });
  }
  availableModels.push({
    id: "sport_settings",
    ftp: ss?.ftp ?? 200,
    wPrime: ss?.w_prime ?? ss?.wPrime ?? 20000,
  });

  if (!ftp || !frc) {
    if (preferredModel === "sport_settings") {
      if (!ftp) ftp = ss?.ftp ?? 200;
      if (!frc) frc = ss?.w_prime ?? ss?.wPrime ?? 20000;
      modelUsed = "sport_settings";
    } else {
      const pdModel =
        pdModels.find((m) => m.type === preferredModel) ??
        pdModels.find((m) => m.type === "FFT_CURVES") ??
        pdModels.find((m) => m.type === "MORTON_3P");

      if (pdModel) {
        if (!ftp) ftp = pdModel.ftp ?? pdModel.criticalPower;
        if (!frc) frc = pdModel.wPrime;
        modelUsed = pdModel.type;
      } else {
        if (!ftp) ftp = ss?.ftp ?? 200;
        if (!frc) frc = ss?.w_prime ?? ss?.wPrime ?? 20000;
        modelUsed = "sport_settings";
      }
    }
  }

  let timeArr: number[];
  let powerArr: number[];

  if (Array.isArray(streams)) {
    const streamArr = streams as { type: string; data?: number[] }[];
    const timeStream = streamArr.find((s) => s.type === "time");
    const wattsStream = streamArr.find((s) => s.type === "watts");
    timeArr = timeStream?.data ?? [];
    powerArr = wattsStream?.data ?? [];
  } else {
    timeArr = extractStream(streams?.time);
    powerArr = extractStream(streams?.watts);
  }

  if (powerArr.length === 0) return null;

  if (timeArr.length === 0) {
    timeArr = powerArr.map((_: number, i: number) => i);
  }

  // Skiba's W'bal differential model
  const dfrcValues: number[] = new Array(powerArr.length);
  let wBal = frc!;

  for (let i = 0; i < powerArr.length; i++) {
    const p = powerArr[i] ?? 0;
    const dt = i > 0 ? Math.max(timeArr[i] - timeArr[i - 1], 0) : 0;

    if (dt > 0) {
      if (p > ftp!) {
        wBal = wBal - (p - ftp!) * dt;
      } else {
        wBal = frc! - (frc! - wBal) * Math.exp((-(ftp! - p) * dt) / frc!);
      }
    }
    dfrcValues[i] = wBal;
  }

  const totalDuration = timeArr[timeArr.length - 1];
  let minDfrc = frc!;
  let sumDfrc = 0;
  let timeBelowZero = 0;
  let timeBelow25 = 0;

  for (let i = 0; i < dfrcValues.length; i++) {
    const dt = i > 0 ? Math.max(timeArr[i] - timeArr[i - 1], 0) : 0;
    if (dfrcValues[i] < minDfrc) minDfrc = dfrcValues[i];
    sumDfrc += dfrcValues[i];
    if (dfrcValues[i] < 0) timeBelowZero += dt;
    if (dfrcValues[i] < frc! * 0.25) timeBelow25 += dt;
  }

  const step = Math.max(1, Math.floor(powerArr.length / 500));
  const chartData: { t: number; p: number; dfrc: number; pct: number }[] = [];
  for (let i = 0; i < powerArr.length; i += step) {
    chartData.push({
      t: timeArr[i],
      p: powerArr[i],
      dfrc: Math.round(dfrcValues[i]),
      pct: Math.round((dfrcValues[i] / frc!) * 100),
    });
  }

  return {
    activity: { id: activity_id, name: activity?.name, type: sportType },
    parameters: {
      model: modelUsed,
      ftp: ftp!,
      frc_joules: frc!,
      frc_kj: Math.round(frc! / 100) / 10,
    },
    available_models: availableModels,
    summary: {
      duration_seconds: totalDuration,
      min_dfrc_joules: Math.round(minDfrc),
      min_dfrc_kj: Math.round(minDfrc / 100) / 10,
      min_dfrc_pct: Math.round((minDfrc / frc!) * 100),
      max_depletion_pct: Math.round((1 - minDfrc / frc!) * 100),
      time_below_zero_seconds: timeBelowZero,
      time_below_25pct_seconds: timeBelow25,
      avg_dfrc_pct: Math.round((sumDfrc / dfrcValues.length / frc!) * 100),
    },
    chart_data: chartData,
    reference_ranges: {
      dfrc_pct: [
        { range: "75–100%", label: "Pieno", meaning: "Riserva anaerobica quasi intatta — sforzo sotto soglia" },
        {
          range: "50–75%",
          label: "Parzialmente usato",
          meaning: "Sforzi sopra soglia ma gestibili — ritmo gara sostenibile",
        },
        { range: "25–50%", label: "Basso", meaning: "Riserva limitata — pochi scatti rimasti, gestire il pacing" },
        { range: "0–25%", label: "Critico", meaning: "Quasi esaurito — uno sforzo intenso può portare al collasso" },
        { range: "< 0%", label: "In debito", meaning: "W' esaurito — potenza sopra-soglia non più sostenibile" },
      ],
      max_depletion_pct: [
        { range: "< 50%", label: "Conservativo", meaning: "Attività facile o sotto soglia — batteria poco usata" },
        { range: "50–75%", label: "Moderato", meaning: "Sforzo significativo — tipico gara endurance" },
        { range: "75–100%", label: "Profondo", meaning: "Quasi al limite — tipico crono o finale di gara" },
        {
          range: "> 100%",
          label: "In debito",
          meaning: "Andato oltre il limite — recupero parziale durante l'attività",
        },
      ],
      frc_kj: [
        { range: "< 10 kJ", label: "Basso", meaning: "Capacità anaerobica limitata — evitare scatti ripetuti" },
        { range: "10–15 kJ", label: "Moderato", meaning: "Tipico amatore endurance" },
        { range: "15–20 kJ", label: "Buono", meaning: "Buona capacità per attacchi e scatti" },
        { range: "20–30 kJ", label: "Alto", meaning: "Forte anaerobicamente — gestisce bene il ritmo variabile" },
        { range: "> 30 kJ", label: "Elite", meaning: "Capacità anaerobica eccezionale" },
      ],
    },
  };
}
