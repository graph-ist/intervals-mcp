import * as icu from "../intervals.js";
import type { StreamData } from "../types.js";

function extractStream(s: StreamData | undefined): number[] {
  if (!s) return [];
  return Array.isArray(s) ? s : (s.data ?? []);
}

export async function computeDecoupling(
  activity_id: string,
  exclude_start_minutes: number,
  exclude_end_minutes: number,
) {
  const excludeStart = exclude_start_minutes * 60;
  const excludeEnd = exclude_end_minutes * 60;

  const [streams, activity] = await Promise.all([
    icu.getActivityStreams(activity_id, ["time", "watts", "heartrate"]),
    icu.getActivity(activity_id),
  ]);

  const timeArr = extractStream(streams?.time);
  const powerArr = extractStream(streams?.watts);
  const hrArr = extractStream(streams?.heartrate);

  if (timeArr.length === 0 || powerArr.length === 0 || hrArr.length === 0) {
    return null; // missing streams
  }

  const totalDuration = timeArr[timeArr.length - 1];
  const startCut = excludeStart;
  const endCut = totalDuration - excludeEnd;

  const validPoints: { t: number; p: number; hr: number }[] = [];
  for (let i = 0; i < timeArr.length; i++) {
    if (timeArr[i] >= startCut && timeArr[i] <= endCut && powerArr[i] > 0 && hrArr[i] > 0) {
      validPoints.push({ t: timeArr[i], p: powerArr[i], hr: hrArr[i] });
    }
  }

  if (validPoints.length < 60) {
    return null; // not enough valid data
  }

  const midpoint = Math.floor(validPoints.length / 2);
  const firstHalf = validPoints.slice(0, midpoint);
  const secondHalf = validPoints.slice(midpoint);

  function halfStats(pts: typeof validPoints) {
    const avgP = pts.reduce((s, p) => s + p.p, 0) / pts.length;
    const avgHR = pts.reduce((s, p) => s + p.hr, 0) / pts.length;
    return { avgP: Math.round(avgP), avgHR: Math.round(avgHR * 10) / 10, ef: avgP / avgHR };
  }

  const h1 = halfStats(firstHalf);
  const h2 = halfStats(secondHalf);
  const decoupling = ((h1.ef - h2.ef) / h1.ef) * 100;

  let assessment: string;
  if (Math.abs(decoupling) < 3) assessment = "Excellent coupling — strong aerobic base";
  else if (Math.abs(decoupling) < 5) assessment = "Good — aerobic base adequate";
  else if (decoupling > 0 && decoupling < 8) assessment = "Moderate drift — aerobic base needs work";
  else if (decoupling >= 8) assessment = "Significant drift — insufficient aerobic fitness or pacing issue";
  else assessment = "Negative drift — unusual, check data quality or early fatigue";

  // Rolling EF for chart data (30-second windows)
  const efCurve: { t_min: number; ef: number; power: number; hr: number }[] = [];
  const windowSize = 30;
  for (let i = 0; i < validPoints.length; i += Math.max(1, Math.floor(validPoints.length / 100))) {
    const windowPts = validPoints.filter((p) => p.t >= validPoints[i].t && p.t < validPoints[i].t + windowSize);
    if (windowPts.length >= 5) {
      const avgP = windowPts.reduce((s, p) => s + p.p, 0) / windowPts.length;
      const avgHR = windowPts.reduce((s, p) => s + p.hr, 0) / windowPts.length;
      efCurve.push({
        t_min: Math.round(((validPoints[i].t - startCut) / 60) * 10) / 10,
        ef: Math.round((avgP / avgHR) * 1000) / 1000,
        power: Math.round(avgP),
        hr: Math.round(avgHR),
      });
    }
  }

  return {
    activity: { id: activity_id, name: activity?.name, type: activity?.type },
    analysis_window: {
      start_min: Math.round(startCut / 60),
      end_min: Math.round(endCut / 60),
      duration_min: Math.round((endCut - startCut) / 60),
      valid_points: validPoints.length,
    },
    first_half: { avg_power: h1.avgP, avg_hr: h1.avgHR, efficiency_factor: Math.round(h1.ef * 1000) / 1000 },
    second_half: { avg_power: h2.avgP, avg_hr: h2.avgHR, efficiency_factor: Math.round(h2.ef * 1000) / 1000 },
    decoupling_pct: Math.round(decoupling * 100) / 100,
    assessment,
    ef_curve: efCurve,
    reference_ranges: {
      decoupling_pct: [
        {
          range: "< 3%",
          label: "Eccellente",
          meaning: "Base aerobica solida — HR stabile, buon adattamento periferico",
        },
        { range: "3–5%", label: "Buono", meaning: "Base adeguata — la HR sale leggermente nella 2ª metà" },
        { range: "5–8%", label: "Moderato", meaning: "Base aerobica da migliorare — più volume Z2 necessario" },
        {
          range: "> 8%",
          label: "Significativo",
          meaning: "Drift HR eccessivo — fitness aerobico insufficiente, o pacing troppo aggressivo, o disidratazione",
        },
        {
          range: "< 0% (negativo)",
          label: "Inusuale",
          meaning: "HR scende nella 2ª metà — controllare dati o warm-up troppo lungo",
        },
      ],
      efficiency_factor: [
        {
          range: "Trend ↑ nel tempo",
          label: "Miglioramento",
          meaning: "A parità di potenza serve meno HR — adattamento aerobico in corso",
        },
        { range: "Stabile", label: "Mantenimento", meaning: "Fitness aerobico costante" },
        {
          range: "Trend ↓ nel tempo",
          label: "Peggioramento",
          meaning: "Possibile overtraining, malattia o decondizionamento",
        },
      ],
    },
  };
}
