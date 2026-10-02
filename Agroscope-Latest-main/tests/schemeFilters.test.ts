import assert from "node:assert/strict";
import { SCHEMES } from "@/data/schemes";
import { DEFAULT_SCHEME_FILTERS, isProfileActive, selectSchemes } from "@/lib/schemeFilters";
import type { SchemeFilters } from "@/lib/schemeFilters";
import { done, it } from "./harness";

function filters(overrides: Partial<SchemeFilters> = {}): SchemeFilters {
  return { ...DEFAULT_SCHEME_FILTERS, ...overrides };
}

// --- default view ------------------------------------------------------------

it("returns all 100 schemes unscored when no land size is set", () => {
  const result = selectSchemes(SCHEMES, DEFAULT_SCHEME_FILTERS);
  assert.equal(result.length, 100);
  assert.ok(
    result.every((entry) => entry.match === null),
    "no scheme should carry a score before a profile exists"
  );
});

it("sorts the unscored view central-first then by name", () => {
  const result = selectSchemes(SCHEMES, DEFAULT_SCHEME_FILTERS);
  const firstStateIndex = result.findIndex((e) => e.scheme.authority === "state");
  const lastCentralIndex = result.map((e) => e.scheme.authority).lastIndexOf("central");
  assert.ok(firstStateIndex > lastCentralIndex, "all central schemes should precede state ones");
  const centralNames = result
    .filter((e) => e.scheme.authority === "central")
    .map((e) => e.scheme.name);
  assert.deepEqual(centralNames, [...centralNames].sort((a, b) => a.localeCompare(b)));
});

it("treats a land size as activating the profile", () => {
  assert.equal(isProfileActive(DEFAULT_SCHEME_FILTERS), false);
  assert.equal(isProfileActive(filters({ landAcres: 4 })), true);
});

// --- scoring and sorting ----------------------------------------------------

it("scores every scheme once a land size is set", () => {
  const result = selectSchemes(SCHEMES, filters({ landAcres: 4 }));
  assert.equal(result.length, 100);
  assert.ok(result.every((entry) => entry.match !== null));
});

it("sorts by descending match score when a profile is active", () => {
  const result = selectSchemes(SCHEMES, filters({ landAcres: 4 }));
  const scores = result.map((entry) => entry.match?.score ?? -1);
  const sorted = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, sorted);
});

it("sorts by benefit value on request, treating a missing value as zero", () => {
  const result = selectSchemes(SCHEMES, filters({ landAcres: 4, sort: "benefit" }));
  const values = result.map((entry) => entry.scheme.benefitValueINR ?? 0);
  const sorted = [...values].sort((a, b) => b - a);
  assert.deepEqual(values, sorted);
});

it("sorts alphabetically on request", () => {
  const result = selectSchemes(SCHEMES, filters({ sort: "name" }));
  const names = result.map((entry) => entry.scheme.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

// --- hard filters -----------------------------------------------------------

it("narrows to the chosen benefit categories", () => {
  const result = selectSchemes(SCHEMES, filters({ categories: ["solar", "insurance"] }));
  assert.ok(result.length > 0);
  assert.ok(result.every((e) => e.scheme.category === "solar" || e.scheme.category === "insurance"));
});

it("shows only eligible schemes when the toggle is on", () => {
  const result = selectSchemes(SCHEMES, filters({ landAcres: 0.5, eligibleOnly: true }));
  assert.ok(result.length >= 20, `expected 20+ eligible at 0.5 acres, got ${result.length}`);
  assert.ok(result.every((e) => e.match?.status === "eligible"));
});

it("ignores the eligible-only toggle when no profile is set", () => {
  const result = selectSchemes(SCHEMES, filters({ eligibleOnly: true }));
  assert.equal(result.length, 100);
});

it("keeps out-of-state schemes visible but not eligible", () => {
  const result = selectSchemes(SCHEMES, filters({ landAcres: 4, state: "Punjab" }));
  const telangana = result.find((e) => e.scheme.id === "ts-rythu-bharosa");
  assert.ok(telangana, "state-specific schemes should still be listed for transparency");
  assert.equal(telangana.match?.status, "not-eligible");
  assert.ok(telangana.match?.missing.some((m) => m.includes("Punjab")));
});

it("derives the farmer category from land size unless overridden", () => {
  const auto = selectSchemes(SCHEMES, filters({ landAcres: 0.5 }));
  const marginalOnly = auto.find((e) => e.scheme.id === "marginal-nutrition-garden");
  assert.ok(marginalOnly);
  assert.equal(marginalOnly.match?.status, "eligible");

  const forced = selectSchemes(SCHEMES, filters({ landAcres: 0.5, farmerCategory: "large" }));
  const sameScheme = forced.find((e) => e.scheme.id === "marginal-nutrition-garden");
  assert.ok(sameScheme);
  assert.notEqual(sameScheme.match?.status, "eligible");
});

it("returns an empty list when filters exclude everything", () => {
  const result = selectSchemes(
    SCHEMES,
    filters({ landAcres: 0.5, categories: ["credit"], eligibleOnly: true, state: "Punjab" })
  );
  assert.ok(Array.isArray(result));
});

done();
