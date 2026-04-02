// ---------- intervals.icu API response types ----------

/** Wellness day (GET /athlete/{id}/wellness) */
export interface WellnessDay {
  id: string; // YYYY-MM-DD
  ctl?: number;
  atl?: number;
  ctlLoad?: number;
  rampRate?: number;
  hrv?: number;
  restingHR?: number;
  avgSleepingHR?: number;
  sleepSecs?: number;
  sleepScore?: number;
  baevskySI?: number;
  spO2?: number;
  respiration?: number;
  readiness?: number;
  weight?: number;
  systolic?: number;
  diastolic?: number;
  [key: string]: unknown;
}

/** Activity (GET /activity/{id}) */
export interface Activity {
  id: string;
  name?: string;
  type?: string;
  icu_training_load?: number;
  [key: string]: unknown;
}

/** Activity streams (GET /activity/{id}/streams) */
export interface ActivityStreams {
  time?: StreamData;
  watts?: StreamData;
  heartrate?: StreamData;
  [key: string]: StreamData | undefined;
}

export type StreamData = number[] | { data: number[] };

/** Power-duration model from curve data */
export interface PowerModel {
  type: string;
  ftp?: number;
  criticalPower?: number;
  wPrime?: number;
  pMax?: number;
  [key: string]: unknown;
}

/** Power curve response (GET /athlete/{id}/power-curves) */
export interface PowerCurveResponse {
  list?: PowerCurve[];
  [key: string]: unknown;
}

export interface PowerCurve {
  secs?: number[];
  values?: number[];
  watts?: number[];
  powerModels?: PowerModel[];
  vo2max_5m?: number;
  [key: string]: unknown;
}

/** Sport settings (GET /athlete/{id}/sport-settings) */
export interface SportSettings {
  ftp?: number;
  lthr?: number;
  max_hr?: number;
  w_prime?: number;
  wPrime?: number;
  types?: string[];
  [key: string]: unknown;
}

/** Athlete profile (GET /athlete/{id}) */
export interface Athlete {
  weight?: number;
  [key: string]: unknown;
}
