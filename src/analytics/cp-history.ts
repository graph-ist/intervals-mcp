import * as icu from "../intervals.js";
import { addDays, today as todayFn } from "../mcp/helpers.js";
import type { PowerCurve, PowerModel } from "../types.js";

const MODEL_TYPES = ["MORTON_3P", "MS_2P", "FFT_CURVES", "ECP"] as const;
export type CpModel = (typeof MODEL_TYPES)[number];
const PEAK_SECS = [5, 60, 300, 1200] as const;

type MonthRange = { month: string; start: string; end: string; spec: string; partial: boolean };

/** Calendar months ending with the month that contains `ref`; the current month ends at `ref`. */
export function monthRanges(ref: string, months: number): MonthRange[] {
  const [y, m] = ref.split("-").map(Number);
  const out: MonthRange[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 10);
    const last = addDays(new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 10), -1);
    const end = last > ref ? ref : last;
    out.push({ month: first.slice(0, 7), start: first, end, spec: `r.${first}.${end}`, partial: end < last });
  }
  return out;
}

function peak(curve: PowerCurve, secs: number): number | null {
  const s = curve.secs ?? [];
  const v = curve.values ?? curve.watts ?? [];
  const i = s.indexOf(secs);
  return i >= 0 && v[i] != null && v[i] > 0 ? v[i] : null;
}

const round = (v: number | undefined | null) => (v == null ? null : Math.round(v));

/** Summarises one monthly curve: peaks, the fitted models and how many activities set the curve. */
export function summariseMonth(range: MonthRange, curve: PowerCurve | undefined, model: CpModel) {
  if (!curve || !(curve.secs?.length ?? 0)) {
    return { month: range.month, from: range.start, to: range.end, partial: range.partial, has_data: false };
  }
  const models = Object.fromEntries(
    ((curve.powerModels ?? []) as PowerModel[])
      .filter((p) => (MODEL_TYPES as readonly string[]).includes(p.type))
      .map((p) => [p.type, { cp: round(p.criticalPower ?? p.ftp), w_prime: round(p.wPrime), p_max: round(p.pMax) }]),
  ) as Record<string, { cp: number | null; w_prime: number | null; p_max: number | null }>;
  const ids = Array.isArray(curve.activity_id) ? new Set(curve.activity_id as string[]) : null;
  const primary = models[model] ?? null;
  return {
    month: range.month,
    from: range.start,
    to: range.end,
    partial: range.partial,
    has_data: true,
    cp: primary?.cp ?? null,
    w_prime: primary?.w_prime ?? null,
    p_max: primary?.p_max ?? null,
    peaks: Object.fromEntries(PEAK_SECS.map((s) => [`${s}s`, peak(curve, s)])),
    activities_on_curve: ids ? ids.size : null,
    models,
  };
}

export async function computeCpHistory(opts: { months?: number; sport?: string; model?: CpModel; newest?: string }) {
  const months = Math.min(Math.max(Math.floor(opts.months ?? 12), 1), 24);
  const sport = opts.sport ?? "Ride";
  const model = opts.model ?? "MORTON_3P";
  const ref = opts.newest ?? todayFn();
  const ranges = monthRanges(ref, months);

  const res = await icu.getPowerCurves(
    sport,
    ranges.map((r) => r.spec),
  );
  // intervals.icu omits months without rides, so curves are matched by id, never by position
  const byId = new Map((res?.list ?? []).map((c) => [String(c.id ?? ""), c]));
  const rows = ranges.map((r) => summariseMonth(r, byId.get(r.spec), model));

  const withCp = rows.filter((r) => "cp" in r && r.cp != null) as Extract<
    (typeof rows)[number],
    { cp: number | null }
  >[];
  const first = withCp[0];
  const last = withCp[withCp.length - 1];
  const change =
    first && last && first !== last
      ? {
          from_month: first.month,
          to_month: last.month,
          cp_watts: (last.cp ?? 0) - (first.cp ?? 0),
          w_prime_joules: last.w_prime != null && first.w_prime != null ? last.w_prime - first.w_prime : null,
          p_max_watts: last.p_max != null && first.p_max != null ? last.p_max - first.p_max : null,
        }
      : null;

  return {
    sport,
    model,
    months: rows,
    months_without_rides: rows.filter((r) => !r.has_data).map((r) => r.month),
    change,
    note: "Each month is fitted only on that month's best efforts (intervals.icu power-duration models). A month without maximal efforts between about 3 and 20 minutes gives a CP below the athlete's real one, and W' and Pmax need short all-out efforts: read low values together with peaks and activities_on_curve before calling them a loss of fitness. The current month is partial.",
  };
}
