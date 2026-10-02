import assert from "node:assert/strict";
import { SCHEMES } from "@/data/schemes";
import { getFarmerCategory, scoreScheme } from "@/lib/eligibility";
import type { FarmerProfile, Scheme } from "@/types/scheme";
import { done, it } from "./harness";

/** Every band must have real depth, including the two extremes from the brief. */
const BAND_PROBES: { label: string; acres: number; minEligible: number }[] = [
  { label: "0.5 acres (marginal)", acres: 0.5, minEligible: 20 },
  { label: "2 acres (marginal)", acres: 2, minEligible: 20 },
  { label: "4 acres (small)", acres: 4, minEligible: 20 },
  { label: "8 acres (semi-medium)", acres: 8, minEligible: 20 },
  { label: "15 acres (medium)", acres: 15, minEligible: 20 },
  { label: "40 acres (large)", acres: 40, minEligible: 20 },
  { label: "100 acres (large)", acres: 100, minEligible: 15 },
];

function profileFor(acres: number, overrides: Partial<FarmerProfile> = {}): FarmerProfile {
  return {
    state: "Andhra Pradesh",
    landAcres: acres,
    crop: "paddy",
    irrigation: "borewell",
    farmerCategory: getFarmerCategory(acres),
    hasElectricity: true,
    hasSolarPump: false,
    hasTractor: false,
    ...overrides,
  };
}

// --- shape -------------------------------------------------------------------

it("contains exactly 100 schemes", () => {
  assert.equal(SCHEMES.length, 100);
});

it("has unique ids", () => {
  const ids = SCHEMES.map((s) => s.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(", ")}`);
});

it("gives every scheme a usable https application URL", () => {
  const bad = SCHEMES.filter((s) => !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(s.applicationUrl));
  assert.deepEqual(bad.map((s) => s.id), [], "schemes with malformed applicationUrl");
});

it("gives every scheme non-empty required copy and documents", () => {
  const bad = SCHEMES.filter(
    (s) =>
      s.name.trim() === "" ||
      s.description.trim().length < 20 ||
      s.benefitType.trim() === "" ||
      s.estimatedBenefit.trim() === "" ||
      s.documents.length === 0
  );
  assert.deepEqual(bad.map((s) => s.id), [], "schemes missing required copy");
});

it("keeps land ranges coherent", () => {
  const bad = SCHEMES.filter((s) => s.landMinAcres < 0 || s.landMinAcres >= s.landMaxAcres);
  assert.deepEqual(bad.map((s) => s.id), [], "schemes with min >= max or negative min");
});

it("uses ISO dates for any deadline", () => {
  const bad = SCHEMES.filter((s) => s.deadline !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(s.deadline));
  assert.deepEqual(bad.map((s) => s.id), [], "schemes with non-ISO deadline");
});

it("marks state schemes with an explicit state list and central ones sensibly", () => {
  const bad = SCHEMES.filter((s) => s.authority === "state" && s.states === "all");
  assert.deepEqual(bad.map((s) => s.id), [], "state schemes must name their states");
});

// --- land-size coverage ------------------------------------------------------

for (const probe of BAND_PROBES) {
  it(`offers at least ${probe.minEligible} eligible schemes at ${probe.label}`, () => {
    const profile = profileFor(probe.acres);
    const eligible = SCHEMES.filter(
      (s) => scoreScheme(profile, s).status === "eligible"
    );
    assert.ok(
      eligible.length >= probe.minEligible,
      `only ${eligible.length} eligible at ${probe.acres} acres (want >= ${probe.minEligible})`
    );
  });
}

it("never leaves a farmer with an empty page anywhere from 0.5 to 100 acres", () => {
  for (let acres = 0.5; acres <= 100; acres += 0.5) {
    const profile = profileFor(acres);
    const visible = SCHEMES.filter((s) => scoreScheme(profile, s).status !== "not-eligible");
    assert.ok(visible.length >= 15, `only ${visible.length} matches at ${acres} acres`);
  }
});

// --- breadth -----------------------------------------------------------------

it("covers every scheme category", () => {
  const categories: Scheme["category"][] = [
    "income-support",
    "insurance",
    "solar",
    "machinery",
    "irrigation",
    "seed",
    "fertilizer",
    "credit",
    "livestock",
    "horticulture",
    "organic",
    "other",
  ];
  const present = new Set(SCHEMES.map((s) => s.category));
  const absent = categories.filter((c) => !present.has(c));
  assert.deepEqual(absent, [], `categories with no schemes: ${absent.join(", ")}`);
});

it("includes the well-known anchor schemes by id", () => {
  const required = ["pm-kisan", "pm-kusum-b", "pmfby", "kcc", "soil-health-card", "smam", "pkvy"];
  const missing = required.filter((id) => !SCHEMES.some((s) => s.id === id));
  assert.deepEqual(missing, [], `missing anchors: ${missing.join(", ")}`);
});

it("marks anchor schemes as verified", () => {
  const anchors = ["pm-kisan", "pmfby", "kcc", "ts-rythu-bharosa", "ap-annadata-sukhibhava"];
  for (const id of anchors) {
    const scheme = SCHEMES.find((s) => s.id === id);
    assert.ok(scheme, `${id} not found`);
    assert.equal(scheme.verified, true, `${id} should be marked verified`);
  }
});

it("does not double-count PM-KISAN inside the AP state top-up", () => {
  const ap = SCHEMES.find((s) => s.id === "ap-annadata-sukhibhava");
  assert.ok(ap);
  assert.equal(ap.benefitValueINR, 14000);
});

done();
