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
  timezone?: string;
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
  timezone?: string;
  [key: string]: unknown;
}

/** Calendar event (GET /athlete/{id}/events) */
export interface CalendarEvent {
  id: number;
  start_date_local?: string;
  category?: string;
  type?: string;
  name?: string;
  description?: string;
  load_target?: number;
  [key: string]: unknown;
}

/** Folder (GET /athlete/{id}/folders) */
export interface Folder {
  id: number;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

/** Generic curve response (pace/HR curves) */
export interface CurveResponse {
  list?: CurveData[];
  [key: string]: unknown;
}

export interface CurveData {
  secs?: number[];
  values?: number[];
  [key: string]: unknown;
}

/** Power vs HR plot data */
export interface PowerVsHRData {
  watts?: number[];
  heartrate?: number[];
  [key: string]: unknown;
}

/** Athlete summary (GET /athlete/{id}/athlete-summary) */
export interface AthleteSummary {
  totals?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Power-HR curve (GET /athlete/{id}/power-hr-curve) */
export interface PowerHRCurve {
  watts?: number[];
  heartrate?: number[];
  [key: string]: unknown;
}

/** Intervals DTO (GET /activity/{id}/intervals) */
export interface IntervalsDTO {
  id?: string;
  icu_intervals?: Interval[];
  icu_groups?: IntervalGroup[];
  [key: string]: unknown;
}

export interface Interval {
  id?: number;
  type?: string;
  start_index?: number;
  end_index?: number;
  moving_time?: number;
  average_watts?: number;
  average_heartrate?: number;
  average_cadence?: number;
  average_speed?: number;
  distance?: number;
  intensity?: number;
  training_load?: number;
  joules?: number;
  zone?: number;
  label?: string;
  gap?: number;
  decoupling?: number;
  [key: string]: unknown;
}

export interface IntervalGroup {
  id?: string;
  count?: number;
  moving_time?: number;
  average_watts?: number;
  average_heartrate?: number;
  [key: string]: unknown;
}

/** Best efforts (GET /activity/{id}/best-efforts) */
export interface BestEfforts {
  efforts?: Effort[];
}

export interface Effort {
  start_index?: number;
  end_index?: number;
  average?: number;
  duration?: number;
  distance?: number;
}

/** Weather forecast (GET /athlete/{id}/weather-forecast) */
export interface WeatherForecast {
  forecasts?: ForecastItem[];
  [key: string]: unknown;
}

export interface ForecastItem {
  id?: number;
  location?: string;
  label?: string;
  lat?: number;
  lon?: number;
  [key: string]: unknown;
}

/** Training plan (GET /athlete/{id}/training-plan) */
export interface TrainingPlan {
  athlete_id?: string;
  training_plan_id?: number;
  training_plan_start_date?: string;
  training_plan?: Folder;
  [key: string]: unknown;
}

/** Gear (GET /athlete/{id}/gear) */
export interface Gear {
  id?: string;
  name?: string;
  type?: string;
  distance?: number;
  time?: number;
  activities?: number;
  retired?: string;
  reminders?: GearReminder[];
  [key: string]: unknown;
}

export interface GearReminder {
  id?: number;
  name?: string;
  distance?: number;
  time?: number;
  percent_used?: number;
  [key: string]: unknown;
}

/** Activity power curves in date range */
export interface ActivityPowerCurvePayload {
  secs?: number[];
  curves?: ActivityPowerCurve[];
  [key: string]: unknown;
}

export interface ActivityPowerCurve {
  id?: string;
  start_date_local?: string;
  watts?: number[];
  [key: string]: unknown;
}

/** Map data (GET /activity/{id}/map) */
export interface MapData {
  bounds?: number[][];
  latlngs?: number[][];
  [key: string]: unknown;
}

/** Activity weather summary */
export interface ActivityWeatherSummary {
  average_temp?: number;
  average_weather_temp?: number;
  average_feels_like?: number;
  average_wind_speed?: number;
  average_wind_gust?: number;
  prevailing_wind_deg?: number;
  headwind_percent?: number;
  tailwind_percent?: number;
  max_rain?: number;
  [key: string]: unknown;
}

/** Power histogram bucket */
export interface HistogramBucket {
  start?: number;
  secs?: number;
  movingSecs?: number;
  watts?: number;
  hr?: number;
  cadence?: number;
}

/** Workout from library */
export interface Workout {
  id?: number;
  name?: string;
  description?: string;
  type?: string;
  folder_id?: number;
  moving_time?: number;
  icu_training_load?: number;
  [key: string]: unknown;
}

/** Fitness model events */
export interface FitnessModelEvent {
  id?: number;
  category?: string;
  start_date_local?: string;
  [key: string]: unknown;
}
