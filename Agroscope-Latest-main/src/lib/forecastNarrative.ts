/**
 * Thirty-day residue supply series with a named cause behind every move.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, HONESTLY
 *
 * These are MODELLED demonstration figures, not a prediction and not a live
 * feed. The product's own forecast endpoint returns a single headline number
 * per crop (see server/services/forecastService.js); it has no daily series
 * and no explanation of movement. This module authors that daily detail at
 * full fidelity so the analytics surface has something real to show, and
 * every screen that renders it labels the output as modelled.
 *
 * Nothing here invents a commercial claim — no prices, counterparties,
 * volumes traded, or capabilities. It models physical supply behaviour:
 * harvest cycles, mandi closures, monsoon interruption, festival labour.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * DETERMINISM
 *
 * The series is a pure function of (crop, city). Re-renders, refetches and
 * navigation return byte-identical output, so the chart never reshuffles
 * under the user. Math.random() is deliberately not used.
 */

export type DriverKind = "harvest" | "weather" | "logistics" | "demand" | "closure";

export interface ForecastDay {
  day: number;
  /** Supply in kg for this day. */
  predictedKg: number;
  /** Trailing 7-day mean; null until enough days exist to form one. */
  ma7: number | null;
  /**
   * Deviation from the local 7-day trend, as a percentage.
   *
   * Deliberately NOT day-over-day change. Against the previous day, a
   * transporter shortage that follows a mandi closure reads as a large
   * INCREASE — the recovery from the closure swamps the shortage's own
   * effect — so the number would contradict the cause printed beside it.
   * Measured against trend, the sign always agrees with the driver, and a
   * quiet day early in the series can no longer produce a 380% swing off a
   * near-zero base.
   */
  changePct: number;
  /** Why this day moved. Present only on days that actually moved. */
  driver: string | null;
  driverKind: DriverKind | null;
}

export interface ForecastSeries {
  days: ForecastDay[];
  peak: ForecastDay;
  trough: ForecastDay;
  totalKg: number;
  meanKg: number;
  /** Standard deviation as a share of the mean. */
  volatilityPct: number;
  volatilityLabel: "Low" | "Moderate" | "High";
  latest: ForecastDay;
  /**
   * Period momentum: the final week's mean against the previous week's.
   *
   * Use this, not `latest.changePct`, for any at-a-glance indicator. A
   * single day's change is dominated by whether day 30 happened to land on
   * a mandi closure, which reports a 70% collapse for what is actually a
   * routine weekly holiday. The week-over-week mean is the honest read of
   * which way a grade is heading.
   */
  momentumPct: number;
  /** Days carrying a driver, most significant first. */
  events: ForecastDay[];
}

/* ── Deterministic noise ──────────────────────────────────────────────── */

/** FNV-1a. Stable across runs and platforms, unlike a hashed string index. */
function seedFrom(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, good enough for shaping a demo series. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Driver vocabulary ────────────────────────────────────────────────── */

/**
 * Causes are drawn from how residue supply actually behaves in Indian
 * agriculture: mandis close weekly, monsoon halts field collection, labour
 * leaves for festivals, harvest arrives in a wave.
 */
const HARVEST_DRIVERS = [
  "Harvest wave peaks — combine crews clearing fields across the belt",
  "Second cutting begins; residue volumes climbing",
  "Threshing completed early in the district, residue released to yards",
  "Harvest tapering as the belt finishes its cycle",
];

const WEATHER_DRIVERS = [
  "Unseasonal rain — field collection halted, residue left to dry",
  "High moisture after overnight showers; loads held back for drying",
  "Clear dry spell — moisture down, baling resumed at full rate",
  "Heat wave accelerated drying; backlog cleared into the yards",
];

const LOGISTICS_DRIVERS = [
  "Transporter shortage — trucks diverted to grain movement",
  "Cold chain hub at capacity; intake throttled",
  "Fresh truck capacity released, backlog moving to hub",
  "Rail rake allotted for bulk biomass; dispatch cleared",
];

const DEMAND_DRIVERS = [
  "Biomass power plant restocking ahead of quarter close",
  "Pellet mill placed a bulk indent; offtake lifted",
  "Board mill procurement window opened",
];

const CLOSURE_DRIVERS = [
  "Mandi weekly closure — no arrivals recorded",
  "Regional festival — labour unavailable, collection paused",
  "Public holiday; yards operating on skeleton staff",
];

const POOLS: Record<DriverKind, string[]> = {
  harvest: HARVEST_DRIVERS,
  weather: WEATHER_DRIVERS,
  logistics: LOGISTICS_DRIVERS,
  demand: DEMAND_DRIVERS,
  closure: CLOSURE_DRIVERS,
};

export const DRIVER_LABEL: Record<DriverKind, string> = {
  harvest: "Harvest",
  weather: "Weather",
  logistics: "Logistics",
  demand: "Demand",
  closure: "Closure",
};

/* ── Series construction ──────────────────────────────────────────────── */

/**
 * @param cropKey  crop identifier, e.g. "paddy_husk"
 * @param city     hub city, e.g. "Chennai"
 * @param baseKg   headline 30-day total in kg, from the forecast endpoint.
 *                 The daily curve is shaped to sum to roughly this figure so
 *                 the chart and the headline number cannot contradict.
 */
export function buildForecastSeries(cropKey: string, city: string, baseKg: number): ForecastSeries {
  const rand = rng(seedFrom(`${cropKey}::${city}`));
  const dailyMean = Math.max(baseKg, 1) / 30;

  // Harvest arrives as a wave rather than a flat line: supply builds, peaks,
  // then tapers.
  //
  // The wave's centre is staggered per crop, and deliberately allowed to sit
  // OUTSIDE the 30-day window. Paddy, wheat, sugarcane, corn and coconut do
  // not all harvest in the same fortnight, so a grade may be ramping into its
  // season, cresting mid-window, or winding down from a peak that already
  // passed. Centring every crop mid-window put all five on the same declining
  // tail, which made every grade read as falling at once — a modelling
  // artefact, not a market.
  const phase = seedFrom(`phase::${cropKey}`) % 1000 / 1000; // 0..1, stable per crop
  const peakDay = Math.round(-8 + phase * 46); // roughly day -8 … 38
  const spread = 9 + rand() * 5;

  // Pre-assign event days so causes are spaced rather than clustered.
  const events = new Map<number, DriverKind>();
  const claim = (day: number, kind: DriverKind) => {
    if (day >= 1 && day <= 30 && !events.has(day)) events.set(day, kind);
  };

  // Weekly mandi closure — a real, recurring cause of zero-ish days.
  const closureOffset = 1 + Math.floor(rand() * 7);
  for (let d = closureOffset; d <= 30; d += 7) claim(d, "closure");

  claim(peakDay, "harvest");
  claim(Math.max(2, peakDay - 6), "harvest");
  claim(Math.min(29, peakDay + 7), "harvest");
  claim(3 + Math.floor(rand() * 4), "weather");
  claim(16 + Math.floor(rand() * 5), "weather");
  claim(8 + Math.floor(rand() * 4), "logistics");
  claim(23 + Math.floor(rand() * 5), "logistics");
  claim(13 + Math.floor(rand() * 4), "demand");
  claim(26 + Math.floor(rand() * 3), "demand");

  const pickedPerKind: Record<string, number> = {};

  // "Harvest wave peaks" is only true when the crest actually falls inside
  // the window. When the peak sits off-chart, start the harvest copy one
  // entry later so the series describes a cycle building or winding down
  // rather than claiming a peak the chart never shows.
  const peakInWindow = peakDay >= 1 && peakDay <= 30;
  if (!peakInWindow) pickedPerKind.harvest = 1;
  const pickDriver = (kind: DriverKind): string => {
    const pool = POOLS[kind];
    const i = (pickedPerKind[kind] ?? 0) % pool.length;
    pickedPerKind[kind] = i + 1;
    return pool[i];
  };

  // How each cause pushes supply. Closures floor the day; demand and clear
  // weather lift it; rain and transport shortfalls cut it.
  const impact: Record<DriverKind, number> = {
    closure: -0.72,
    weather: -0.3,
    logistics: -0.24,
    demand: 0.26,
    harvest: 0.3,
  };

  const raw: { value: number; driver: string | null; kind: DriverKind | null }[] = [];

  for (let day = 1; day <= 30; day++) {
    // Gaussian harvest wave around the peak.
    const wave = Math.exp(-((day - peakDay) ** 2) / (2 * spread ** 2));
    let value = dailyMean * (0.55 + 0.95 * wave);

    // Small deterministic texture so the line is never mechanically smooth.
    value *= 0.96 + rand() * 0.08;

    const kind = events.get(day) ?? null;
    let driver: string | null = null;

    if (kind) {
      driver = pickDriver(kind);
      let effect = impact[kind];
      // Weather and harvest read as recovery rather than loss on some days;
      // the copy pools carry both directions, so flip the sign to match.
      if (kind === "weather" && /Clear dry spell|Heat wave/.test(driver)) effect = 0.24;
      if (kind === "logistics" && /released|allotted/.test(driver)) effect = 0.2;
      if (kind === "harvest" && /tapering/.test(driver)) effect = -0.22;
      value *= 1 + effect;
    }

    raw.push({ value: Math.max(Math.round(value), 0), driver, kind });
  }

  // Normalise so the daily series reconciles with the headline total.
  const rawTotal = raw.reduce((s, r) => s + r.value, 0) || 1;
  const scale = baseKg / rawTotal;

  const scaled = raw.map((r) => Math.round(r.value * scale));

  /**
   * Centred 7-day mean — the local trend a day is measured against. Centred
   * rather than trailing so day 1 has a baseline too; a trailing window would
   * leave the first six days with nothing to compare to.
   */
  const baselineAt = (i: number): number => {
    const from = Math.max(0, i - 3);
    const to = Math.min(scaled.length, i + 4);
    let sum = 0;
    for (let j = from; j < to; j++) sum += scaled[j];
    return sum / (to - from);
  };

  const days: ForecastDay[] = raw.map((r, i) => {
    const predictedKg = scaled[i];
    const baseline = baselineAt(i);
    const changePct = baseline > 0 ? ((predictedKg - baseline) / baseline) * 100 : 0;
    return {
      day: i + 1,
      predictedKg,
      ma7: null,
      changePct: Number(changePct.toFixed(1)),
      driver: r.driver,
      driverKind: r.kind,
    };
  });

  // Trailing 7-day mean, the dashed reference line on the chart.
  for (let i = 0; i < days.length; i++) {
    if (i < 6) continue;
    let sum = 0;
    for (let j = i - 6; j <= i; j++) sum += days[j].predictedKg;
    days[i].ma7 = Math.round(sum / 7);
  }

  const values = days.map((d) => d.predictedKg);
  const meanKg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - meanKg) ** 2, 0) / values.length;
  const volatilityPct = meanKg > 0 ? (Math.sqrt(variance) / meanKg) * 100 : 0;

  const peak = days.reduce((a, b) => (b.predictedKg > a.predictedKg ? b : a), days[0]);
  const trough = days.reduce((a, b) => (b.predictedKg < a.predictedKg ? b : a), days[0]);

  const mean = (from: number, to: number) =>
    values.slice(from, to).reduce((a, b) => a + b, 0) / Math.max(to - from, 1);
  const lastWeek = mean(23, 30);
  const priorWeek = mean(16, 23);
  const momentumPct = priorWeek > 0 ? ((lastWeek - priorWeek) / priorWeek) * 100 : 0;

  return {
    days,
    peak,
    trough,
    totalKg: values.reduce((a, b) => a + b, 0),
    meanKg: Math.round(meanKg),
    volatilityPct: Number(volatilityPct.toFixed(1)),
    volatilityLabel: volatilityPct > 34 ? "High" : volatilityPct > 18 ? "Moderate" : "Low",
    latest: days[days.length - 1],
    momentumPct: Number(momentumPct.toFixed(1)),
    events: days
      .filter((d) => d.driver)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
  };
}
