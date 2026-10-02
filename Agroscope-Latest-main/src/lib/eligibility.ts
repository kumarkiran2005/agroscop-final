/**
 * Government-scheme eligibility engine. Pure functions only — no React, no I/O.
 *
 * Land size, state and farmer category are HARD GATES rather than merely
 * weighted criteria: a plain weighted sum scores a 0.5-acre farmer at ~79%
 * against a 5-acre-minimum scheme, which would render as "possible" when they
 * are flatly ineligible. A failed gate forces status "not-eligible" and caps the
 * displayed score at 45, while passing criteria still populate matched[] so the
 * "why didn't I qualify" card stays informative.
 *
 * Crop, irrigation and the asset flags are weighted, not gating — those vary by
 * district notification and are worth surfacing as "possible".
 */
import { SCHEMES } from "@/data/schemes";
import type {
  FarmerCategory,
  FarmerProfile,
  MatchResult,
  MatchStatus,
  Scheme,
  ScoredScheme,
} from "@/types/scheme";

/**
 * Official Indian holding bands. Boundaries resolve upward: exactly 2.5 acres is
 * small, exactly 5 is semi-medium, exactly 25 is medium.
 */
export function getFarmerCategory(landAcres: number): FarmerCategory {
  if (landAcres < 2.5) return "marginal";
  if (landAcres < 5) return "small";
  if (landAcres < 10) return "semi-medium";
  if (landAcres <= 25) return "medium";
  return "large";
}

const WEIGHT = {
  land: 3,
  state: 3,
  crop: 3,
  category: 2,
  irrigation: 1,
  electricity: 1,
  solarPump: 1,
  tractor: 1,
} as const;

const ELIGIBLE_AT = 80;
const POSSIBLE_AT = 50;
/** A failed hard gate can never present as a near-match. */
const GATE_FAIL_CEILING = 45;

/** 4 → "4 acres", 0.5 → "0.5 acres", 3.20 → "3.2 acres". */
function acres(value: number): string {
  return `${Number(value.toFixed(2))} acres`;
}

function capLabel(landMaxAcres: number): string {
  return Number.isFinite(landMaxAcres) ? `${landMaxAcres} acres` : "no upper limit";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Score one scheme against one farmer.
 *
 * Wildcard rule: a scheme-side wildcard ("all" / "any") is an automatic pass and
 * counts toward both matched and total weight. A profile-side sentinel ("all" /
 * "any") means the farmer has not answered, so the criterion is skipped entirely
 * and counts toward neither — unanswered questions never lower a score.
 *
 * @param profile the farmer's answers
 * @param scheme the scheme to test against
 * @returns score 0-100, status, and farmer-readable matched/missing reasons
 */
export function scoreScheme(profile: FarmerProfile, scheme: Scheme): MatchResult {
  const matched: string[] = [];
  const missing: string[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;
  let gateFailed = false;

  // --- Gate 1: land size (always applicable) ---
  totalWeight += WEIGHT.land;
  if (profile.landAcres >= scheme.landMinAcres && profile.landAcres <= scheme.landMaxAcres) {
    matchedWeight += WEIGHT.land;
    matched.push(
      Number.isFinite(scheme.landMaxAcres)
        ? `✓ ${acres(profile.landAcres)} is within the ${scheme.landMinAcres}–${scheme.landMaxAcres} acre range`
        : `✓ ${acres(profile.landAcres)} qualifies — this scheme has ${capLabel(scheme.landMaxAcres)}`
    );
  } else {
    gateFailed = true;
    missing.push(
      profile.landAcres < scheme.landMinAcres
        ? `✗ Requires at least ${scheme.landMinAcres} acres — you have ${acres(profile.landAcres)}`
        : `✗ For holdings up to ${capLabel(scheme.landMaxAcres)} — you have ${acres(profile.landAcres)}`
    );
  }

  // --- Gate 2: state ---
  if (scheme.states === "all") {
    totalWeight += WEIGHT.state;
    matchedWeight += WEIGHT.state;
    matched.push("✓ Available across all of India");
  } else if (profile.state !== "all") {
    totalWeight += WEIGHT.state;
    if (scheme.states.includes(profile.state)) {
      matchedWeight += WEIGHT.state;
      matched.push(`✓ ${profile.state} is an eligible state`);
    } else {
      gateFailed = true;
      missing.push(`✗ Not offered in ${profile.state} — runs in ${scheme.states.join(", ")}`);
    }
  }

  // --- Crop ---
  if (scheme.crops === "any") {
    totalWeight += WEIGHT.crop;
    matchedWeight += WEIGHT.crop;
    matched.push("✓ Open to all crops");
  } else if (profile.crop !== "any") {
    totalWeight += WEIGHT.crop;
    if (scheme.crops.includes(profile.crop)) {
      matchedWeight += WEIGHT.crop;
      matched.push(`✓ ${titleCase(profile.crop)} is a covered crop`);
    } else {
      missing.push(`✗ Covers ${scheme.crops.join(", ")} — not ${profile.crop}`);
    }
  }

  // --- Gate 3: farmer category ---
  // A scheme that names its holding classes is stating a statutory limit, so a
  // mismatch disqualifies. Without this it is only 2 of ~11 weight, and a
  // marginal-farmers-only scheme scored 82% for a large farmer.
  totalWeight += WEIGHT.category;
  if (scheme.farmerCategories === "any") {
    matchedWeight += WEIGHT.category;
    matched.push("✓ Open to every holding size class");
  } else if (scheme.farmerCategories.includes(profile.farmerCategory)) {
    matchedWeight += WEIGHT.category;
    matched.push(`✓ ${titleCase(profile.farmerCategory)} farmer category is eligible`);
  } else {
    gateFailed = true;
    missing.push(
      `✗ For ${scheme.farmerCategories.join(", ")} farmers — your holding is ${profile.farmerCategory}`
    );
  }

  // --- Irrigation ---
  const irrigation = scheme.irrigation;
  if (irrigation && irrigation.length > 0) {
    if (irrigation.includes("any")) {
      totalWeight += WEIGHT.irrigation;
      matchedWeight += WEIGHT.irrigation;
      matched.push("✓ Any irrigation source accepted");
    } else if (profile.irrigation !== "any") {
      totalWeight += WEIGHT.irrigation;
      if (irrigation.includes(profile.irrigation)) {
        matchedWeight += WEIGHT.irrigation;
        matched.push(`✓ ${titleCase(profile.irrigation)} irrigation qualifies`);
      } else {
        missing.push(`✗ Needs ${irrigation.join(" or ")} irrigation — you have ${profile.irrigation}`);
      }
    }
  }

  // --- Electricity ---
  if (scheme.requiresElectricity === true) {
    totalWeight += WEIGHT.electricity;
    if (profile.hasElectricity) {
      matchedWeight += WEIGHT.electricity;
      matched.push("✓ Electricity connection available");
    } else {
      missing.push("✗ Requires an electricity connection");
    }
  }

  // --- No existing solar pump ---
  if (scheme.requiresNoSolarPump === true) {
    totalWeight += WEIGHT.solarPump;
    if (!profile.hasSolarPump) {
      matchedWeight += WEIGHT.solarPump;
      matched.push("✓ No existing solar pump");
    } else {
      missing.push("✗ For farmers without an existing solar pump");
    }
  }

  // --- No existing tractor ---
  if (scheme.requiresNoTractor === true) {
    totalWeight += WEIGHT.tractor;
    if (!profile.hasTractor) {
      matchedWeight += WEIGHT.tractor;
      matched.push("✓ No existing tractor");
    } else {
      missing.push("✗ For farmers without an existing tractor");
    }
  }

  const raw = totalWeight === 0 ? 100 : Math.round((matchedWeight / totalWeight) * 100);
  const score = gateFailed ? Math.min(raw, GATE_FAIL_CEILING) : raw;
  const status: MatchStatus = gateFailed
    ? "not-eligible"
    : score >= ELIGIBLE_AT
      ? "eligible"
      : score >= POSSIBLE_AT
        ? "possible"
        : "not-eligible";

  return { score, status, matched, missing };
}

/**
 * Whether a scheme's value recurs every year or lands once.
 *
 * Derived from category rather than stored per scheme so the dataset stays
 * editable without a second field to keep in sync. Income, insurance, credit
 * (interest saved) and input support recur; anything that buys an asset does
 * not. A handful of entries sit awkwardly — PMEGP margin money is one-time
 * inside a recurring category — but the split exists to stop a single
 * implausible figure being presented, not to be an accounting ledger.
 */
export function getBenefitCadence(scheme: Scheme): "annual" | "one-time" {
  switch (scheme.category) {
    case "income-support":
    case "insurance":
    case "credit":
    case "seed":
    case "fertilizer":
    case "organic":
      return "annual";
    default:
      return "one-time";
  }
}

export type MatchSummary = {
  eligible: number;
  possible: number;
  notEligible: number;
  /** Recurring value per year across eligible schemes. Indicative, not owed. */
  annualINR: number;
  /** One-off capital assistance across eligible schemes. Indicative, not owed. */
  oneTimeINR: number;
  /**
   * Eligible schemes kept OUT of the totals because the profile is too vague to
   * claim them. A farmer lives in one state and grows a couple of crops, so
   * summing every state's scheme and every crop's scheme at once would be
   * nonsense. The UI turns this into a prompt to narrow the profile.
   */
  excludedVagueSchemes: number;
};

type SummarizeOptions = {
  /** True once the farmer has chosen a state, which lets state schemes count. */
  stateSpecified: boolean;
  /** True once a crop is chosen, which lets crop-specific schemes count. */
  cropSpecified: boolean;
};

/**
 * Aggregate scored schemes for the summary strip.
 *
 * Only "eligible" rows contribute value — including "possible" rows would
 * inflate the headline with schemes the farmer may well not qualify for. Totals
 * are split by cadence because summing a ₹6,000/year transfer with an ₹8 lakh
 * capital subsidy produces a number that is technically a sum and practically a
 * lie.
 */
export function summarizeMatches(
  entries: ScoredScheme[],
  options: SummarizeOptions = { stateSpecified: false, cropSpecified: false }
): MatchSummary {
  const summary: MatchSummary = {
    eligible: 0,
    possible: 0,
    notEligible: 0,
    annualINR: 0,
    oneTimeINR: 0,
    excludedVagueSchemes: 0,
  };
  for (const { scheme, match } of entries) {
    if (match.status === "eligible") {
      summary.eligible += 1;
      const needsState = scheme.authority === "state" && !options.stateSpecified;
      const needsCrop = scheme.crops !== "any" && !options.cropSpecified;
      if (needsState || needsCrop) {
        summary.excludedVagueSchemes += 1;
        continue;
      }
      const value = scheme.benefitValueINR ?? 0;
      if (getBenefitCadence(scheme) === "annual") {
        summary.annualINR += value;
      } else {
        summary.oneTimeINR += value;
      }
    } else if (match.status === "possible") {
      summary.possible += 1;
    } else {
      summary.notEligible += 1;
    }
  }
  return summary;
}

/**
 * The single data seam for the schemes feature. Components call this and never
 * import the dataset directly, so the source can change without touching UI.
 */
export async function getSchemes(): Promise<Scheme[]> {
  return SCHEMES;
}

/**
 * Live-source stub. Not wired up — see the header of src/data/schemes.ts for the
 * three-step swap.
 *
 * Throws rather than returning [] so a half-finished integration surfaces as a
 * visible error instead of an empty results page that looks like "no matches".
 *
 * JSON note: `landMaxAcres: Infinity` cannot round-trip through JSON. Send null
 * (or omit) for uncapped schemes and map it back here:
 *   landMaxAcres: raw.landMaxAcres ?? Infinity
 */
export async function fetchSchemesFromApi(): Promise<Scheme[]> {
  // TODO: replace with a real request, e.g.
  //   const res = await fetch("/api/schemes");
  //   if (!res.ok) throw new Error(`Scheme API ${res.status}`);
  //   const raw: unknown[] = await res.json();
  //   return raw.map(toScheme); // validate + restore Infinity
  throw new Error("fetchSchemesFromApi is not wired up yet; getSchemes() serves the seed dataset");
}
