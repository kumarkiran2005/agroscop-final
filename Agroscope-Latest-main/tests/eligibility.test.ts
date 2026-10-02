import assert from "node:assert/strict";
import {
  fetchSchemesFromApi,
  getBenefitCadence,
  getFarmerCategory,
  getSchemes,
  scoreScheme,
  summarizeMatches,
} from "@/lib/eligibility";
import type { FarmerProfile, Scheme, ScoredScheme } from "@/types/scheme";
import { done, it } from "./harness";

// --- farmer category --------------------------------------------------------

it("classifies a half-acre holding as marginal", () => {
  assert.equal(getFarmerCategory(0.5), "marginal");
});

it("classifies 2.4 acres as marginal and 2.5 as small", () => {
  assert.equal(getFarmerCategory(2.4), "marginal");
  assert.equal(getFarmerCategory(2.5), "small");
});

it("treats 5 acres as semi-medium, not small", () => {
  assert.equal(getFarmerCategory(4.9), "small");
  assert.equal(getFarmerCategory(5), "semi-medium");
});

it("treats 25 acres as medium and 25.1 as large", () => {
  assert.equal(getFarmerCategory(10), "medium");
  assert.equal(getFarmerCategory(25), "medium");
  assert.equal(getFarmerCategory(25.1), "large");
});

it("classifies 40 acres as large", () => {
  assert.equal(getFarmerCategory(40), "large");
});

// --- test fixtures -----------------------------------------------------------

const BASE_PROFILE: FarmerProfile = {
  state: "Andhra Pradesh",
  landAcres: 4,
  crop: "paddy",
  irrigation: "borewell",
  farmerCategory: "small",
  hasElectricity: true,
  hasSolarPump: false,
  hasTractor: false,
};

/** A fully-specified scheme: totalWeight 14 (land+state+crop+cat+irr+elec+solar). */
const FULL_SCHEME: Scheme = {
  id: "test-full",
  name: "Test Full Scheme",
  authority: "state",
  states: ["Andhra Pradesh", "Telangana"],
  crops: ["paddy"],
  landMinAcres: 0,
  landMaxAcres: 10,
  farmerCategories: ["marginal", "small"],
  irrigation: ["borewell", "canal"],
  requiresElectricity: true,
  requiresNoSolarPump: true,
  category: "solar",
  benefitType: "Solar pump subsidy",
  estimatedBenefit: "Up to 60% subsidy",
  benefitValueINR: 45000,
  description: "Test fixture.",
  documents: ["Aadhaar"],
  applicationUrl: "https://example.gov.in",
};

/** Wildcards everywhere: all-India, any crop, any category, uncapped land. */
const OPEN_SCHEME: Scheme = {
  id: "test-open",
  name: "Test Open Scheme",
  authority: "central",
  states: "all",
  crops: "any",
  landMinAcres: 0,
  landMaxAcres: Infinity,
  farmerCategories: "any",
  category: "income-support",
  benefitType: "Income support",
  estimatedBenefit: "₹6,000/year",
  benefitValueINR: 6000,
  description: "Test fixture.",
  documents: ["Aadhaar"],
  applicationUrl: "https://example.gov.in",
};

// --- scoring ----------------------------------------------------------------

it("scores a perfect match at 100 and eligible", () => {
  const result = scoreScheme(BASE_PROFILE, FULL_SCHEME);
  assert.equal(result.score, 100);
  assert.equal(result.status, "eligible");
  assert.equal(result.missing.length, 0);
});

it("scores an all-wildcard scheme at 100 for any farmer", () => {
  const marginal = { ...BASE_PROFILE, landAcres: 0.5, farmerCategory: "marginal" as const };
  const large = { ...BASE_PROFILE, landAcres: 40, farmerCategory: "large" as const };
  assert.equal(scoreScheme(marginal, OPEN_SCHEME).status, "eligible");
  assert.equal(scoreScheme(large, OPEN_SCHEME).status, "eligible");
});

it("caps a land-gate failure at 45 and forces not-eligible", () => {
  const scheme: Scheme = { ...FULL_SCHEME, landMinAcres: 5, landMaxAcres: 25 };
  const result = scoreScheme({ ...BASE_PROFILE, landAcres: 3.2 }, scheme);
  assert.equal(result.status, "not-eligible");
  assert.ok(result.score <= 45, `expected <=45, got ${result.score}`);
  assert.ok(
    result.missing.some((m) => m.includes("at least 5 acres") && m.includes("3.2")),
    `missing[] should name the shortfall, got ${JSON.stringify(result.missing)}`
  );
  assert.ok(result.matched.length > 0, "passing criteria must still be listed");
});

it("caps an over-cap land failure at 45", () => {
  const scheme: Scheme = { ...FULL_SCHEME, landMinAcres: 0, landMaxAcres: 5 };
  const result = scoreScheme({ ...BASE_PROFILE, landAcres: 40 }, scheme);
  assert.equal(result.status, "not-eligible");
  assert.ok(result.score <= 45);
});

it("caps a state-gate failure at 45 and forces not-eligible", () => {
  const result = scoreScheme({ ...BASE_PROFILE, state: "Punjab" }, FULL_SCHEME);
  assert.equal(result.status, "not-eligible");
  assert.ok(result.score <= 45);
  assert.ok(result.missing.some((m) => m.includes("Punjab")));
});

it("disqualifies a farmer category the scheme does not cover", () => {
  const marginalOnly: Scheme = { ...FULL_SCHEME, farmerCategories: ["marginal"] };
  const result = scoreScheme({ ...BASE_PROFILE, farmerCategory: "large" }, marginalOnly);
  assert.equal(result.status, "not-eligible");
  assert.ok(result.score <= 45, `expected <=45, got ${result.score}`);
  assert.ok(result.missing.some((m) => m.includes("marginal")));
});

it("rates a crop mismatch as possible, not eligible", () => {
  const result = scoreScheme({ ...BASE_PROFILE, crop: "cotton" }, FULL_SCHEME);
  assert.equal(result.score, 79);
  assert.equal(result.status, "possible");
});

it("rates an irrigation mismatch as eligible with a note", () => {
  const result = scoreScheme({ ...BASE_PROFILE, irrigation: "rainfed" }, FULL_SCHEME);
  assert.equal(result.score, 93);
  assert.equal(result.status, "eligible");
  assert.equal(result.missing.length, 1);
});

it("does not penalise unspecified profile fields", () => {
  const vague: FarmerProfile = { ...BASE_PROFILE, state: "all", crop: "any", irrigation: "any" };
  const result = scoreScheme(vague, FULL_SCHEME);
  assert.equal(result.score, 100);
  assert.equal(result.status, "eligible");
});

it("fails the solar criterion when a pump is already installed", () => {
  const result = scoreScheme({ ...BASE_PROFILE, hasSolarPump: true }, FULL_SCHEME);
  assert.ok(result.missing.some((m) => m.includes("solar pump")));
  assert.ok(result.score < 100);
});

it("fails the electricity criterion when there is no connection", () => {
  const result = scoreScheme({ ...BASE_PROFILE, hasElectricity: false }, FULL_SCHEME);
  assert.ok(result.missing.some((m) => m.includes("electricity")));
});

it("ignores tractor ownership unless the scheme opts in", () => {
  const withTractor = { ...BASE_PROFILE, hasTractor: true };
  assert.equal(scoreScheme(withTractor, FULL_SCHEME).score, 100);
  const tractorScheme: Scheme = { ...OPEN_SCHEME, requiresNoTractor: true };
  assert.ok(scoreScheme(withTractor, tractorScheme).missing.some((m) => m.includes("tractor")));
});

it("describes an uncapped range without printing Infinity", () => {
  const result = scoreScheme(BASE_PROFILE, OPEN_SCHEME);
  assert.ok(
    result.matched.every((m) => !m.includes("Infinity")),
    `matched[] leaked Infinity: ${JSON.stringify(result.matched)}`
  );
});

it("formats acres without a trailing .0", () => {
  const result = scoreScheme({ ...BASE_PROFILE, landAcres: 4 }, FULL_SCHEME);
  assert.ok(result.matched.some((m) => m.includes("4 acres") && !m.includes("4.0")));
});

// --- summary ----------------------------------------------------------------

const PASS: ScoredScheme["match"] = { score: 100, status: "eligible", matched: [], missing: [] };

it("counts each status and totals only eligible benefits", () => {
  const entries: ScoredScheme[] = [
    { scheme: { ...OPEN_SCHEME, id: "a", benefitValueINR: 6000 }, match: PASS },
    { scheme: { ...OPEN_SCHEME, id: "b", benefitValueINR: 45000 }, match: { ...PASS, score: 88 } },
    {
      scheme: { ...OPEN_SCHEME, id: "c", benefitValueINR: 20000 },
      match: { score: 60, status: "possible", matched: [], missing: [] },
    },
    {
      scheme: { ...OPEN_SCHEME, id: "d", benefitValueINR: 99000 },
      match: { score: 20, status: "not-eligible", matched: [], missing: [] },
    },
  ];
  const summary = summarizeMatches(entries);
  assert.equal(summary.eligible, 2);
  assert.equal(summary.possible, 1);
  assert.equal(summary.notEligible, 1);
  // Both eligible rows are income-support, so both land in the annual bucket.
  assert.equal(summary.annualINR, 51000);
  assert.equal(summary.oneTimeINR, 0);
});

it("splits annual support from one-time capital assistance", () => {
  const annual: Scheme = { ...OPEN_SCHEME, id: "annual", category: "income-support", benefitValueINR: 6000 };
  const capital: Scheme = { ...OPEN_SCHEME, id: "capital", category: "machinery", benefitValueINR: 800000 };
  const summary = summarizeMatches([
    { scheme: annual, match: PASS },
    { scheme: capital, match: PASS },
  ]);
  assert.equal(summary.annualINR, 6000);
  assert.equal(summary.oneTimeINR, 800000);
});

it("classifies benefit cadence by category", () => {
  assert.equal(getBenefitCadence({ ...OPEN_SCHEME, category: "insurance" }), "annual");
  assert.equal(getBenefitCadence({ ...OPEN_SCHEME, category: "credit" }), "annual");
  assert.equal(getBenefitCadence({ ...OPEN_SCHEME, category: "solar" }), "one-time");
  assert.equal(getBenefitCadence({ ...OPEN_SCHEME, category: "livestock" }), "one-time");
});

it("leaves state and crop-specific schemes out of the total until the profile narrows", () => {
  const stateScheme: Scheme = {
    ...OPEN_SCHEME,
    id: "state-one",
    authority: "state",
    states: ["Telangana"],
    benefitValueINR: 12000,
  };
  const cropScheme: Scheme = {
    ...OPEN_SCHEME,
    id: "crop-one",
    crops: ["sugarcane"],
    benefitValueINR: 14000,
  };
  const central: Scheme = { ...OPEN_SCHEME, id: "central-one", benefitValueINR: 6000 };
  const entries: ScoredScheme[] = [
    { scheme: stateScheme, match: PASS },
    { scheme: cropScheme, match: PASS },
    { scheme: central, match: PASS },
  ];

  const vague = summarizeMatches(entries);
  assert.equal(vague.eligible, 3, "they still count as eligible");
  assert.equal(vague.annualINR, 6000, "but their value is excluded from the total");
  assert.equal(vague.excludedVagueSchemes, 2);

  const specific = summarizeMatches(entries, { stateSpecified: true, cropSpecified: true });
  assert.equal(specific.annualINR, 32000);
  assert.equal(specific.excludedVagueSchemes, 0);
});

it("treats a missing benefitValueINR as zero", () => {
  const noValue: Scheme = { ...OPEN_SCHEME, id: "e", benefitValueINR: undefined };
  const summary = summarizeMatches([{ scheme: noValue, match: PASS }]);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.annualINR, 0);
  assert.equal(summary.oneTimeINR, 0);
});

it("returns zeroes for an empty list", () => {
  const summary = summarizeMatches([]);
  assert.deepEqual(summary, {
    eligible: 0,
    possible: 0,
    notEligible: 0,
    annualINR: 0,
    oneTimeINR: 0,
    excludedVagueSchemes: 0,
  });
});

// --- adapter ----------------------------------------------------------------
// `it()` is synchronous, so await first and assert on the settled result.
// Top-level await is legal here: the runner bundles test files to ESM.

const loadedSchemes = await getSchemes();

it("getSchemes resolves an array from the seed dataset", () => {
  assert.ok(Array.isArray(loadedSchemes));
});

let apiError: unknown = null;
try {
  await fetchSchemesFromApi();
} catch (err) {
  apiError = err;
}

it("fetchSchemesFromApi fails loudly rather than returning empty", () => {
  assert.ok(
    apiError instanceof Error && /not wired up/i.test(apiError.message),
    `expected a "not wired up" Error, got ${String(apiError)}`
  );
});

done();
