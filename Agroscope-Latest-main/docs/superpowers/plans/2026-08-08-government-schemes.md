# Government Schemes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/schemes` page that turns a farmer's land size and profile into a ranked, explained list of eligible Indian government agricultural schemes, backed by a 100-scheme seed dataset.

**Architecture:** Page-local filter state in `Schemes.tsx`; scheme data read through react-query calling a `getSchemes()` adapter (so a later swap to a live API touches no UI); pure scoring in `src/lib/eligibility.ts` invoked from a `useMemo`. Three presentational components (`SchemeCard`, `SchemeFilterPanel`, `SchemeSummaryStrip`) hold no data logic.

**Tech Stack:** React 18, TypeScript 5.8 (strict), Vite 5, Tailwind 3.4, shadcn/ui (Radix), react-router-dom 6, @tanstack/react-query 5, lucide-react. Tests: esbuild 0.21.5 + `node:assert/strict` via a custom runner (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-08-government-schemes-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **TypeScript strict, no `any`.** Not in source, not in tests. Use `unknown` + narrowing if needed.

  Important: **this repo is not strict.** `tsconfig.app.json` sets
  `"strict": false`, `"noImplicitAny": false`, `"strictNullChecks": false`, and
  `"include": ["src"]` — which also means `npx tsc --noEmit` never looks at
  `tests/` at all. Turning strict on globally would surface errors across the
  26+ files `DESIGN.md` already flags, so **do not touch `tsconfig.app.json`.**
  Instead Task 1 adds `tsconfig.strict.json`, scoped to this feature's pure
  logic plus its tests, and `npm run typecheck:strict` must stay clean. The
  three logic files import only from each other, so the scoped check has no
  third-party noise. React components cannot be strict-checked in isolation
  (they pull in shadcn and Radix types), so they are verified by the
  repo-wide `tsc`, eslint, and the Task 12 browser pass — write them with
  explicit prop types and no implicit `any` regardless.
- **No new npm dependencies.** Everything needed is already installed.
- **No new UI library.** Use only `src/components/ui/*` (shadcn) and `lucide-react` icons.
- **No hardcoded hex colors.** Semantic tokens only: `bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, `bg-primary`, `text-primary`, `bg-accent`, `text-accent`, `bg-destructive`, `text-destructive`. `DESIGN.md` lists 26 files that violate this; do not add a 27th.
- **`--accent` (ochre) is for measurement only** — progress bars, deadline chips, indicative totals. Never decorative.
- **No hover lift, no glow, no bounce.** `DESIGN.md`: "things decelerate, nothing rebounds." Cards and buttons do not translate on hover.
- **`--radius` is `0.25rem`.** Use Tailwind's `rounded` / `rounded-sm`, never `rounded-xl` or `rounded-full` (except the existing brand mark).
- **Typography utilities:** `.mark` for uppercase tracked labels, `.tabular` for any counted figure (acres, ₹, percentages), `.measure` / `.measure-tight` for prose width.
- **Currency:** always `new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })` for Indian digit grouping (₹2,14,000 not ₹214,000).
- **Copy stays English.** `TranslateOnNavigate` machine-translates on route change; do not add translation keys.
- **Benefits are indicative.** No UI surface may show a rupee figure without an adjacent "estimated"/"indicative" qualifier.
- **Light and dark must both work.** Every task's manual check covers both.
- **Every external link:** `target="_blank" rel="noopener noreferrer"`.
- **Accessibility:** all controls keyboard-reachable, `label.tsx` bound to every input, `aria-label` on icon-only buttons. Colour is never the only signal — pair every status colour with text.
- **Commit after every task.** Stage only the files that task names; the working tree has 11 unrelated modified files that must not be swept in. Never use `git add -A` or `git add .`.

---

## File Structure

| File | Responsibility | Created in |
|---|---|---|
| `scripts/run-tests.mjs` | Test runner: bundles `tests/**/*.test.ts` via esbuild, runs in node | Task 1 |
| `tests/harness.ts` | `it()` / `done()` assertion helpers | Task 1 |
| `tsconfig.strict.json` | Scoped `strict: true` check over this feature's logic + tests | Task 1 |
| `package.json` | Add `"test"` and `"typecheck:strict"` scripts | Task 1 |
| `src/types/scheme.ts` | Type definitions only, zero runtime code | Task 2 |
| `src/lib/eligibility.ts` | `getFarmerCategory`, `scoreScheme`, `summarizeMatches`, `getSchemes`, `fetchSchemesFromApi` | Tasks 2–4 |
| `tests/eligibility.test.ts` | Engine unit tests | Tasks 2–4 |
| `src/data/schemes.ts` | 100 schemes, `SCHEMES_DISCLAIMER`, derived option lists | Tasks 5–6 |
| `tests/schemes-data.test.ts` | Dataset invariants incl. land-band coverage | Tasks 5–6 |
| `src/components/SchemeCard.tsx` | One scheme + its match result | Task 7 |
| `src/components/SchemeSummaryStrip.tsx` | Aggregate counts + indicative total | Task 8 |
| `src/components/SchemeFilterPanel.tsx` | All filter controls, responsive container | Task 9 |
| `src/pages/Schemes.tsx` | Page shell, filter state, memoized scoring, grid | Task 10 |
| `src/App.tsx` | Lazy import + `/schemes` route | Task 10 |
| `src/pages/Home.tsx` | Masthead button + mobile Sheet entry | Task 11 |

Components go flat in `src/components/`, matching `DealCard.tsx` / `ProvisionSyncCard.tsx`. No new subfolder for three files.

---

### Task 1: Test harness

No test runner exists in this repo. Before any logic is written, build one — it must produce genuine red/green cycles with zero new dependencies. esbuild 0.21.5 is already present (a Vite dependency) and Node is v24.

This exact command chain was verified working before this plan was written:
`npx esbuild <file>.ts --bundle --format=esm --platform=node --alias:@=./src --outfile=<out>.mjs && node <out>.mjs`

**Files:**
- Create: `scripts/run-tests.mjs`
- Create: `tests/harness.ts`
- Create: `tsconfig.strict.json`
- Modify: `package.json` (scripts block, after `"lint"`)

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs every `tests/**/*.test.ts` and exits non-zero on failure. `npm run typecheck:strict` strict-checks this feature's logic and tests. `tests/harness.ts` exports `it(name: string, fn: () => void): void` and `done(): void`.

- [ ] **Step 1: Write the harness helpers**

Create `tests/harness.ts`:

```ts
/**
 * Minimal assertion harness. No test framework is installed; test files are
 * bundled by scripts/run-tests.mjs and executed as plain node modules, so a
 * thrown error means failure.
 */
const failures: string[] = [];

/** Run one named case. Records the failure instead of aborting the file. */
export function it(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(name);
    console.error(`  FAIL ${name}\n       ${message}`);
  }
}

/** Call at the end of every test file. Throws if any case failed. */
export function done(): void {
  if (failures.length > 0) {
    throw new Error(`${failures.length} case(s) failed: ${failures.join(", ")}`);
  }
}
```

- [ ] **Step 2: Write the runner**

Create `scripts/run-tests.mjs`:

```js
/**
 * Test runner. Bundles each tests/**\/*.test.ts through esbuild (resolving the
 * "@/" alias the same way vite.config.ts does) and imports the result. A test
 * file that throws is a failure.
 *
 * Usage: npm test
 */
import { build } from "esbuild";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, "tests");

function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findTests(full));
    else if (entry.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

const files = findTests(TEST_DIR).sort();
if (files.length === 0) {
  console.error("No test files found under tests/");
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "agro-tests-"));
let failed = 0;

for (const file of files) {
  const name = relative(TEST_DIR, file);
  const outfile = join(outDir, name.replace(/[\\/]/g, "_").replace(/\.ts$/, ".mjs"));
  console.log(`\n${name}`);
  await build({
    entryPoints: [file],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    alias: { "@": join(ROOT, "src") },
    logLevel: "error",
  });
  try {
    await import(pathToFileURL(outfile).href);
  } catch (err) {
    failed += 1;
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n${files.length - failed} file(s) passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Add the scoped strict typecheck config**

Create `tsconfig.strict.json`. This is the only place strictness is enforced —
`tsconfig.app.json` stays untouched. Verified working before this plan was
written (`npx tsc -p` on a scoped pure file exits 0).

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "skipLibCheck": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "src/types/scheme.ts",
    "src/lib/eligibility.ts",
    "src/data/schemes.ts",
    "tests/**/*.ts"
  ]
}
```

- [ ] **Step 4: Add the npm scripts**

In `package.json`, add two lines to `scripts` immediately after `"lint": "eslint ."`:

```json
    "test": "node scripts/run-tests.mjs",
    "typecheck:strict": "tsc -p tsconfig.strict.json",
```

- [ ] **Step 5: Prove the harness detects failure (RED)**

Create a throwaway `tests/harness.test.ts`:

```ts
import assert from "node:assert/strict";
import { done, it } from "./harness";

it("passes a true assertion", () => {
  assert.equal(1 + 1, 2);
});

it("this case is expected to fail", () => {
  assert.equal(1 + 1, 3);
});

done();
```

Run: `npm test`
Expected: exit code 1, output contains `FAIL this case is expected to fail` and `0 file(s) passed, 1 failed`.

- [ ] **Step 6: Prove the harness reports success (GREEN)**

Edit `tests/harness.test.ts` — change the second case to assert `1 + 1 === 2` and rename it `"passes a second assertion"`.

Run: `npm test`
Expected: exit code 0, `1 file(s) passed, 0 failed`.

Run: `npm run typecheck:strict`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add scripts/run-tests.mjs tests/harness.ts tests/harness.test.ts tsconfig.strict.json package.json
git commit -m "test: add dependency-free test runner for schemes work"
```

---

### Task 2: Types and `getFarmerCategory`

**Files:**
- Create: `src/types/scheme.ts`
- Create: `src/lib/eligibility.ts`
- Create: `tests/eligibility.test.ts`

**Interfaces:**
- Consumes: `it`, `done` from `tests/harness.ts`
- Produces: all types below (imported by every later task) and `getFarmerCategory(landAcres: number): FarmerCategory`.

- [ ] **Step 1: Write the types**

Create `src/types/scheme.ts`:

```ts
/** Official Indian operational-holding size classes. */
export type FarmerCategory = "marginal" | "small" | "semi-medium" | "medium" | "large";

export type SchemeCategory =
  | "income-support"
  | "insurance"
  | "solar"
  | "machinery"
  | "irrigation"
  | "seed"
  | "fertilizer"
  | "credit"
  | "livestock"
  | "horticulture"
  | "organic"
  | "other";

export type IrrigationType = "borewell" | "canal" | "rainfed" | "drip";

export type Scheme = {
  id: string;
  name: string;
  shortName?: string;
  authority: "central" | "state";
  /** "all" means all-India. */
  states: string[] | "all";
  /** "any" means crop-agnostic. */
  crops: string[] | "any";
  landMinAcres: number;
  /** Infinity when the scheme has no upper holding cap. */
  landMaxAcres: number;
  farmerCategories: FarmerCategory[] | "any";
  irrigation?: (IrrigationType | "any")[];
  requiresElectricity?: boolean;
  category: SchemeCategory;
  benefitType: string;
  /** Display string, e.g. "₹6,000/year" or "Up to 60% subsidy". */
  estimatedBenefit: string;
  /** Numeric estimate; drives the indicative total. Omit when not quantifiable. */
  benefitValueINR?: number;
  description: string;
  documents: string[];
  applicationUrl: string;
  /** ISO date (YYYY-MM-DD). */
  deadline?: string;
  /** True when name, URL and benefit were confirmed against an official source. */
  verified?: boolean;
  /** Set only on schemes that subsidise a farmer's first solar pump. */
  requiresNoSolarPump?: boolean;
  /** Set only on schemes that subsidise a farmer's first tractor. */
  requiresNoTractor?: boolean;
};

/**
 * A farmer's answers. "all" / "any" are sentinels meaning "not specified" —
 * scoreScheme treats those criteria as not applicable rather than as failures.
 */
export type FarmerProfile = {
  state: string;
  district?: string;
  landAcres: number;
  crop: string;
  irrigation: IrrigationType | "any";
  farmerCategory: FarmerCategory;
  hasElectricity: boolean;
  hasSolarPump: boolean;
  hasTractor: boolean;
};

export type MatchStatus = "eligible" | "possible" | "not-eligible";

export type MatchResult = {
  /** 0-100, integer. */
  score: number;
  status: MatchStatus;
  /** Farmer-readable pass reasons, each prefixed "✓ ". */
  matched: string[];
  /** Farmer-readable fail reasons, each prefixed "✗ ". */
  missing: string[];
};

/** A scheme paired with this farmer's match against it. */
export type ScoredScheme = {
  scheme: Scheme;
  match: MatchResult;
};
```

- [ ] **Step 2: Write the failing test (RED)**

Create `tests/eligibility.test.ts`:

```ts
import assert from "node:assert/strict";
import { getFarmerCategory } from "@/lib/eligibility";
import { done, it } from "./harness";

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

done();
```

Run: `npm test`
Expected: FAIL — esbuild reports it cannot resolve `@/lib/eligibility`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/eligibility.ts`:

```ts
/**
 * Government-scheme eligibility engine. Pure functions only — no React, no I/O.
 *
 * Land size and state are HARD GATES rather than merely weighted criteria: a
 * plain weighted sum scores a 0.5-acre farmer at ~79% against a 5-acre-minimum
 * scheme, which would render as "possible" when they are flatly ineligible. A
 * failed gate forces status "not-eligible" and caps the displayed score at 45,
 * while passing criteria still populate matched[] so the "why didn't I qualify"
 * card stays informative.
 */
import type { FarmerCategory } from "@/types/scheme";

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
```

- [ ] **Step 4: Run the test (GREEN)**

Run: `npm test`
Expected: PASS — all 5 cases ok, `2 file(s) passed, 0 failed`.

- [ ] **Step 5: Delete the throwaway harness test**

```bash
git rm tests/harness.test.ts
```

Run: `npm test`
Expected: PASS — `1 file(s) passed`.

- [ ] **Step 6: Commit**

```bash
git add src/types/scheme.ts src/lib/eligibility.ts tests/eligibility.test.ts
git commit -m "feat: add scheme types and farmer-category helper"
```

---

### Task 3: `scoreScheme` — gates and weighted criteria

**Files:**
- Modify: `src/lib/eligibility.ts`
- Modify: `tests/eligibility.test.ts`

**Interfaces:**
- Consumes: `Scheme`, `FarmerProfile`, `MatchResult`, `MatchStatus` from `@/types/scheme`; `getFarmerCategory`
- Produces: `scoreScheme(profile: FarmerProfile, scheme: Scheme): MatchResult`

**The wildcard rule** (apply uniformly, it is the source of most subtle bugs here):

| Side | Value | Effect on scoring |
|---|---|---|
| Scheme | `"all"` / `"any"` / `irrigation` includes `"any"` | Automatic **pass** — adds to both `matchedWeight` and `totalWeight` |
| Profile | `state: "all"` / `crop: "any"` / `irrigation: "any"` | **Not applicable** — adds to neither |

**Weights:** land 3, state 3, crop 3, category 2, irrigation 1, electricity 1, solarPump 1, tractor 1. `totalWeight` sums only applicable criteria, so a fully-specified scheme with electricity and solar flags totals 14 and a typical scheme totals 12.

- [ ] **Step 1: Write the failing tests (RED)**

Append to `tests/eligibility.test.ts` — insert the import of `scoreScheme` into the existing import line, and add these cases above the `done()` call:

```ts
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
```

Update the import line at the top of the file to:

```ts
import { getFarmerCategory, scoreScheme } from "@/lib/eligibility";
import type { FarmerProfile, Scheme } from "@/types/scheme";
```

Run: `npm test`
Expected: FAIL — `scoreScheme` is not exported.

- [ ] **Step 2: Implement `scoreScheme`**

Append to `src/lib/eligibility.ts` (and extend the type import at the top to
`import type { FarmerCategory, FarmerProfile, MatchResult, MatchStatus, Scheme } from "@/types/scheme";`):

```ts
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

  // --- Farmer category ---
  if (scheme.farmerCategories === "any") {
    totalWeight += WEIGHT.category;
    matchedWeight += WEIGHT.category;
    matched.push("✓ Open to every holding size class");
  } else {
    totalWeight += WEIGHT.category;
    if (scheme.farmerCategories.includes(profile.farmerCategory)) {
      matchedWeight += WEIGHT.category;
      matched.push(`✓ ${titleCase(profile.farmerCategory)} farmer category is eligible`);
    } else {
      missing.push(
        `✗ For ${scheme.farmerCategories.join(", ")} farmers — your holding is ${profile.farmerCategory}`
      );
    }
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
```

- [ ] **Step 3: Run the tests (GREEN)**

Run: `npm test`
Expected: PASS — all cases ok. If "crop mismatch" reports 79 but another value appears, re-check that `FULL_SCHEME` totals 14: land 3 + state 3 + crop 3 + category 2 + irrigation 1 + electricity 1 + solarPump 1.

- [ ] **Step 4: Strict typecheck**

Run: `npm run typecheck:strict`
Expected: exit 0, no output. This covers `src/types/scheme.ts`,
`src/lib/eligibility.ts`, `src/data/schemes.ts` and every test file under
`strict: true` — the repo-wide `tsc` would not check the tests at all.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eligibility.ts tests/eligibility.test.ts
git commit -m "feat: add scheme eligibility scoring with hard gates"
```

---

### Task 4: `summarizeMatches` and the data-source adapter

**Files:**
- Modify: `src/lib/eligibility.ts`
- Modify: `tests/eligibility.test.ts`

**Interfaces:**
- Consumes: `ScoredScheme` from `@/types/scheme`
- Produces:
  - `summarizeMatches(entries: ScoredScheme[]): MatchSummary` where `MatchSummary = { eligible: number; possible: number; notEligible: number; indicativeTotalINR: number }`
  - `getSchemes(): Promise<Scheme[]>`
  - `fetchSchemesFromApi(): Promise<Scheme[]>`

Task 5 creates `src/data/schemes.ts`. To keep this task independently testable, `getSchemes` is written here importing `SCHEMES`, so **do Task 5's Step 1 stub first if the import fails** — or simply order execution 4 → 5 as written, since Step 2 below creates the stub file.

- [ ] **Step 1: Write the failing tests (RED)**

Append to `tests/eligibility.test.ts`, above `done()`:

```ts
// --- summary ----------------------------------------------------------------

it("counts each status and totals only eligible benefits", () => {
  const entries: ScoredScheme[] = [
    { scheme: { ...OPEN_SCHEME, id: "a", benefitValueINR: 6000 }, match: { score: 100, status: "eligible", matched: [], missing: [] } },
    { scheme: { ...OPEN_SCHEME, id: "b", benefitValueINR: 45000 }, match: { score: 88, status: "eligible", matched: [], missing: [] } },
    { scheme: { ...OPEN_SCHEME, id: "c", benefitValueINR: 20000 }, match: { score: 60, status: "possible", matched: [], missing: [] } },
    { scheme: { ...OPEN_SCHEME, id: "d", benefitValueINR: 99000 }, match: { score: 20, status: "not-eligible", matched: [], missing: [] } },
  ];
  const summary = summarizeMatches(entries);
  assert.equal(summary.eligible, 2);
  assert.equal(summary.possible, 1);
  assert.equal(summary.notEligible, 1);
  assert.equal(summary.indicativeTotalINR, 51000);
});

it("treats a missing benefitValueINR as zero", () => {
  const noValue: Scheme = { ...OPEN_SCHEME, id: "e", benefitValueINR: undefined };
  const summary = summarizeMatches([
    { scheme: noValue, match: { score: 100, status: "eligible", matched: [], missing: [] } },
  ]);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.indicativeTotalINR, 0);
});

it("returns zeroes for an empty list", () => {
  const summary = summarizeMatches([]);
  assert.deepEqual(summary, { eligible: 0, possible: 0, notEligible: 0, indicativeTotalINR: 0 });
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
```

Note this asserts only `Array.isArray` — the dataset is still an empty stub at
this point. Task 6 Step 4 strengthens it to `length === 100` once the data
exists. Do not assert a non-empty array here; it would fail for the wrong reason.

Extend the imports at the top of the test file:

```ts
import { fetchSchemesFromApi, getFarmerCategory, getSchemes, scoreScheme, summarizeMatches } from "@/lib/eligibility";
import type { FarmerProfile, Scheme, ScoredScheme } from "@/types/scheme";
```

Run: `npm test`
Expected: FAIL — `summarizeMatches` / `getSchemes` / `fetchSchemesFromApi` not exported.

- [ ] **Step 2: Create the dataset stub so the adapter can import it**

Create `src/data/schemes.ts` with just enough to compile — Tasks 5 and 6 fill it:

```ts
import type { Scheme } from "@/types/scheme";

export const SCHEMES_DISCLAIMER =
  "Benefits shown are indicative estimates, not guaranteed payouts. Eligibility rules, funding limits and application windows change and vary by state and district. Always confirm on the official scheme portal before applying.";

export const SCHEMES: Scheme[] = [];
```

- [ ] **Step 3: Implement the summary and adapter**

First, at the **top** of `src/lib/eligibility.ts`, add the value import below the
existing type import, and extend the type import to include `ScoredScheme`:

```ts
import type {
  FarmerCategory, FarmerProfile, MatchResult, MatchStatus, Scheme, ScoredScheme,
} from "@/types/scheme";
import { SCHEMES } from "@/data/schemes";
```

Then append the rest to the end of the file:

```ts
export type MatchSummary = {
  eligible: number;
  possible: number;
  notEligible: number;
  /** Sum of benefitValueINR across ELIGIBLE schemes only. Always label estimated. */
  indicativeTotalINR: number;
};

/**
 * Aggregate a scored list for the summary strip — the "money you may be
 * missing" figure. Only eligible schemes contribute to the total; counting
 * possible or not-eligible schemes would overstate what the farmer can claim.
 */
export function summarizeMatches(entries: ScoredScheme[]): MatchSummary {
  let eligible = 0;
  let possible = 0;
  let notEligible = 0;
  let indicativeTotalINR = 0;

  for (const { scheme, match } of entries) {
    if (match.status === "eligible") {
      eligible += 1;
      indicativeTotalINR += scheme.benefitValueINR ?? 0;
    } else if (match.status === "possible") {
      possible += 1;
    } else {
      notEligible += 1;
    }
  }

  return { eligible, possible, notEligible, indicativeTotalINR };
}

/* ---------------------------------------------------------------------------
 * DATA SOURCE ADAPTER
 *
 * The UI only ever calls getSchemes(). It is consumed through react-query in
 * src/pages/Schemes.tsx, so loading, error and retry states already exist.
 *
 * TO SWAP THE SEED DATASET FOR A LIVE BACKEND / WEB-SEARCH ENDPOINT:
 *   1. Implement fetchSchemesFromApi() below (fetch + validate + map to Scheme).
 *   2. Change getSchemes()'s body to `return fetchSchemesFromApi();`.
 *   3. Nothing else changes — no component, page or type edits required.
 * ------------------------------------------------------------------------- */

/** Current source: the bundled seed dataset in src/data/schemes.ts. */
export async function getSchemes(): Promise<Scheme[]> {
  return SCHEMES;
}

/**
 * TODO: wire this to a real backend or web-search endpoint.
 *
 * Throws rather than returning [] on purpose: a half-finished swap must fail
 * loudly instead of silently rendering an empty schemes page.
 */
export async function fetchSchemesFromApi(): Promise<Scheme[]> {
  throw new Error(
    "fetchSchemesFromApi is not wired up yet — see the DATA SOURCE ADAPTER note in src/lib/eligibility.ts"
  );
}
```

- [ ] **Step 4: Run the tests (GREEN)**

Run: `npm test`
Expected: PASS — all cases ok across both files.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck:strict`
Expected: exit 0, no output.

```bash
git add src/lib/eligibility.ts src/data/schemes.ts tests/eligibility.test.ts
git commit -m "feat: add match summary and scheme data-source adapter"
```

---

### Task 5: Dataset — 28 web-verified anchor schemes

**Files:**
- Modify: `src/data/schemes.ts`
- Create: `tests/schemes-data.test.ts`

**Interfaces:**
- Consumes: `Scheme` from `@/types/scheme`
- Produces: `SCHEMES` containing 28 entries with `verified: true`; `SCHEMES_DISCLAIMER` (already present)

- [ ] **Step 1: Research the anchors**

Run web searches to confirm, for each scheme below: exact official name, the live application/information URL on a `.gov.in` (or official state) domain, the benefit amount, and the land/category eligibility rule.

**Central (20):** PM-KISAN · PM-KUSUM · PMFBY (Pradhan Mantri Fasal Bima Yojana) · Kisan Credit Card · Soil Health Card · SMAM (Sub-Mission on Agricultural Mechanization) · PKVY (Paramparagat Krishi Vikas Yojana) · PM-KMY (Pradhan Mantri Kisan Maandhan Yojana) · Agriculture Infrastructure Fund · e-NAM · National Food Security Mission · PMKSY Per Drop More Crop · MIDH (Mission for Integrated Development of Horticulture) · RKVY · National Livestock Mission · Crop Residue Management · FPO Formation and Promotion · Sub-Mission on Seeds and Planting Material · National Mission on Natural Farming · National Beekeeping and Honey Mission

**State (8):** AP Rythu Bharosa · Annadata Sukhibhava (AP) · Rythu Bandhu (Telangana) · Rythu Bima (Telangana) · Punjab CRM stubble-management incentive · Namo Shetkari Mahasanman Nidhi (Maharashtra) · KALIA (Odisha) · Krishak Bandhu (West Bengal)

Rules while researching:
- Record the URL you actually landed on. Do **not** compose a plausible-looking deep link.
- If a benefit figure cannot be confirmed, set `estimatedBenefit` to a qualitative string ("Subsidy as notified by the state") and **omit** `benefitValueINR`. Never invent a number.
- If a scheme has been renamed or merged, use the current name and note the change in `description`.

- [ ] **Step 2: Write the failing invariant tests (RED)**

Create `tests/schemes-data.test.ts`:

```ts
import assert from "node:assert/strict";
import { SCHEMES, SCHEMES_DISCLAIMER } from "@/data/schemes";
import { done, it } from "./harness";

it("has a disclaimer naming benefits as indicative", () => {
  assert.match(SCHEMES_DISCLAIMER, /indicative/i);
  assert.match(SCHEMES_DISCLAIMER, /not guaranteed/i);
});

it("has at least 28 verified anchor schemes", () => {
  const verified = SCHEMES.filter((s) => s.verified === true);
  assert.ok(verified.length >= 28, `expected >=28 verified, got ${verified.length}`);
});

it("includes the named anchor schemes", () => {
  const names = SCHEMES.map((s) => s.name.toLowerCase()).join(" | ");
  for (const anchor of ["pm-kisan", "pm-kusum", "fasal bima", "kisan credit card", "soil health", "rythu bandhu"]) {
    assert.ok(names.includes(anchor), `missing anchor: ${anchor}`);
  }
});

it("gives every scheme a unique id", () => {
  const ids = SCHEMES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids present");
});

it("gives every scheme a valid absolute https application URL", () => {
  for (const scheme of SCHEMES) {
    let parsed: URL;
    try {
      parsed = new URL(scheme.applicationUrl);
    } catch {
      throw new Error(`${scheme.id}: unparseable URL ${scheme.applicationUrl}`);
    }
    assert.equal(parsed.protocol, "https:", `${scheme.id}: not https`);
  }
});

it("keeps land ranges coherent", () => {
  for (const scheme of SCHEMES) {
    assert.ok(scheme.landMinAcres >= 0, `${scheme.id}: negative min`);
    assert.ok(
      scheme.landMaxAcres > scheme.landMinAcres,
      `${scheme.id}: max ${scheme.landMaxAcres} <= min ${scheme.landMinAcres}`
    );
  }
});

it("gives every scheme at least one document and a benefit string", () => {
  for (const scheme of SCHEMES) {
    assert.ok(scheme.documents.length > 0, `${scheme.id}: no documents`);
    assert.ok(scheme.estimatedBenefit.trim().length > 0, `${scheme.id}: no estimatedBenefit`);
    assert.ok(scheme.description.trim().length > 0, `${scheme.id}: no description`);
  }
});

it("uses ISO dates for deadlines", () => {
  for (const scheme of SCHEMES) {
    if (scheme.deadline !== undefined) {
      assert.match(scheme.deadline, /^\d{4}-\d{2}-\d{2}$/, `${scheme.id}: bad deadline`);
    }
  }
});

done();
```

Run: `npm test`
Expected: FAIL — `expected >=28 verified, got 0`.

- [ ] **Step 3: Write the 28 anchors**

Replace `SCHEMES` in `src/data/schemes.ts`. Follow this shape exactly (real values from Step 1 research):

```ts
export const SCHEMES: Scheme[] = [
  {
    id: "pm-kisan",
    name: "Pradhan Mantri Kisan Samman Nidhi",
    shortName: "PM-KISAN",
    authority: "central",
    states: "all",
    crops: "any",
    landMinAcres: 0,
    landMaxAcres: Infinity,
    farmerCategories: "any",
    category: "income-support",
    benefitType: "Direct income support",
    estimatedBenefit: "₹6,000/year in three instalments",
    benefitValueINR: 6000,
    description:
      "Direct income support to all landholding farmer families, paid in three ₹2,000 instalments to the Aadhaar-linked bank account.",
    documents: ["Aadhaar card", "Land ownership record", "Bank passbook"],
    applicationUrl: "https://pmkisan.gov.in/",
    verified: true,
  },
  // ...27 more
];
```

Set `verified: true` on all 28. Use `Infinity` (not a large number) for uncapped `landMaxAcres`. Give 3–5 of them a `deadline` in 2026 so Task 7's deadline chip has data — at least one within 30 days of 2026-08-08 and one already past.

- [ ] **Step 4: Run the tests (GREEN)**

Run: `npm test`
Expected: PASS — both test files green.

- [ ] **Step 5: Commit**

```bash
git add src/data/schemes.ts tests/schemes-data.test.ts
git commit -m "feat: add 28 web-verified anchor schemes"
```

---

### Task 6: Dataset — complete to exactly 100 with full land-band coverage

**Files:**
- Modify: `src/data/schemes.ts`
- Modify: `tests/schemes-data.test.ts`
- Modify: `tests/eligibility.test.ts` (restore the assertion deferred in Task 4)

**Interfaces:**
- Consumes: `Scheme`
- Produces: `SCHEMES` with exactly 100 entries; `SCHEME_STATES: string[]`; `SCHEME_CROPS: string[]`

**Required land-band distribution** — this is the feature's core requirement:

| Land range | Count | 0.5 ac | 3 ac | 7 ac | 15 ac | 40 ac |
|---|---|---|---|---|---|---|
| 0 → Infinity | 45 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 0 → 2.5 | 10 | ✓ | | | | |
| 0 → 5 | 20 | ✓ | ✓ | | | |
| 2.5 → 10 | 10 | | ✓ | ✓ | | |
| 5 → 25 | 8 | | | ✓ | ✓ | |
| 10 → Infinity | 7 | | | | ✓ | ✓ |
| **Land-eligible** | | **75** | **75** | **63** | **60** | **52** |

**Required category distribution:** income-support 8 · insurance 8 · solar 8 · machinery 12 · irrigation 12 · seed 8 · fertilizer 6 · credit 8 · livestock 8 · horticulture 8 · organic 7 · other 7 = 100

- [ ] **Step 1: Write the failing coverage tests (RED)**

First extend the **existing import block** at the top of
`tests/schemes-data.test.ts` (import declarations belong at the top of the module,
not mid-file):

```ts
import assert from "node:assert/strict";
import { SCHEME_CROPS, SCHEME_STATES, SCHEMES, SCHEMES_DISCLAIMER } from "@/data/schemes";
import { getFarmerCategory, scoreScheme } from "@/lib/eligibility";
import type { FarmerProfile } from "@/types/scheme";
import { done, it } from "./harness";
```

Then add these cases above `done()`:

```ts
it("contains exactly 100 schemes", () => {
  assert.equal(SCHEMES.length, 100);
});

it("matches the required land-band distribution", () => {
  const inBand = (min: number, max: number) =>
    SCHEMES.filter((s) => s.landMinAcres === min && s.landMaxAcres === max).length;
  assert.equal(inBand(0, Infinity), 45, "uncapped");
  assert.equal(inBand(0, 2.5), 10, "0-2.5");
  assert.equal(inBand(0, 5), 20, "0-5");
  assert.equal(inBand(2.5, 10), 10, "2.5-10");
  assert.equal(inBand(5, 25), 8, "5-25");
  assert.equal(inBand(10, Infinity), 7, "10-uncapped");
});

it("gives every farm size band a healthy eligible count", () => {
  const expected: [number, number][] = [
    [0.5, 75],
    [3, 75],
    [7, 63],
    [15, 60],
    [40, 52],
  ];
  for (const [landAcres, want] of expected) {
    const landEligible = SCHEMES.filter(
      (s) => landAcres >= s.landMinAcres && landAcres <= s.landMaxAcres
    ).length;
    assert.equal(landEligible, want, `${landAcres} acres: expected ${want}, got ${landEligible}`);
  }
});

it("returns 40+ scored-eligible schemes for a 0.5-acre all-India farmer", () => {
  const profile: FarmerProfile = {
    state: "all",
    landAcres: 0.5,
    crop: "any",
    irrigation: "any",
    farmerCategory: getFarmerCategory(0.5),
    hasElectricity: true,
    hasSolarPump: false,
    hasTractor: false,
  };
  const eligible = SCHEMES.filter((s) => scoreScheme(profile, s).status === "eligible").length;
  assert.ok(eligible >= 40, `expected >=40 eligible, got ${eligible}`);
});

it("returns 30+ scored-eligible schemes for a 40-acre all-India farmer", () => {
  const profile: FarmerProfile = {
    state: "all",
    landAcres: 40,
    crop: "any",
    irrigation: "any",
    farmerCategory: getFarmerCategory(40),
    hasElectricity: true,
    hasSolarPump: false,
    hasTractor: false,
  };
  const eligible = SCHEMES.filter((s) => scoreScheme(profile, s).status === "eligible").length;
  assert.ok(eligible >= 30, `expected >=30 eligible, got ${eligible}`);
});

it("matches the required category distribution", () => {
  const want: Record<string, number> = {
    "income-support": 8, insurance: 8, solar: 8, machinery: 12, irrigation: 12,
    seed: 8, fertilizer: 6, credit: 8, livestock: 8, horticulture: 8, organic: 7, other: 7,
  };
  for (const [category, count] of Object.entries(want)) {
    const actual = SCHEMES.filter((s) => s.category === category).length;
    assert.equal(actual, count, `${category}: expected ${count}, got ${actual}`);
  }
});

it("covers at least 18 states and exposes sorted option lists", () => {
  assert.ok(SCHEME_STATES.length >= 18, `only ${SCHEME_STATES.length} states`);
  assert.deepEqual(SCHEME_STATES, [...SCHEME_STATES].sort());
  assert.ok(SCHEME_CROPS.length >= 8, `only ${SCHEME_CROPS.length} crops`);
  assert.ok(!SCHEME_CROPS.includes("any"), "SCHEME_CROPS must not contain the wildcard");
  assert.ok(!SCHEME_STATES.includes("all"), "SCHEME_STATES must not contain the wildcard");
});

it("labels every unverified scheme so the UI can flag it", () => {
  const unverified = SCHEMES.filter((s) => s.verified !== true);
  assert.equal(unverified.length, 72, `expected 72 unverified, got ${unverified.length}`);
  for (const scheme of unverified) {
    assert.equal(scheme.verified, false, `${scheme.id}: verified must be explicitly false`);
  }
});

/**
 * Some genuinely official portals do not sit on .gov.in — West Bengal's
 * krishakbandhu.net and Punjab's agrimachinerypb.com are real government
 * portals. Rather than force a wrong-but-passing URL, list each exception
 * explicitly so it is a deliberate, reviewable decision. Add a host here ONLY
 * after visiting it and confirming it is the official portal.
 */
const NON_GOV_OFFICIAL_HOSTS: string[] = [
  // e.g. "krishakbandhu.net", "agrimachinerypb.com"
];

it("points every application URL at an official portal domain", () => {
  const govPattern = /\.(gov|nic)\.in$/;
  for (const scheme of SCHEMES) {
    const host = new URL(scheme.applicationUrl).hostname.replace(/^www\./, "");
    const ok = govPattern.test(host) || NON_GOV_OFFICIAL_HOSTS.includes(host);
    assert.ok(ok, `${scheme.id}: ${host} is neither .gov.in/.nic.in nor an allowlisted portal`);
  }
});

it("uses no placeholder or example hosts", () => {
  for (const scheme of SCHEMES) {
    const host = new URL(scheme.applicationUrl).hostname;
    assert.ok(
      !/(example|test|localhost|placeholder|todo)/i.test(host),
      `${scheme.id}: placeholder host ${host}`
    );
  }
});
```

Populate `NON_GOV_OFFICIAL_HOSTS` from Task 5's research as needed. Leaving it
empty and bending a URL to fit the pattern is the failure mode this guards
against.

Run: `npm test`
Expected: FAIL — `expected 100, got 28` plus the distribution assertions.

- [ ] **Step 2: Author the remaining 72 schemes**

Append to `SCHEMES`. Every one gets `verified: false`.

Authoring rules:
- **`applicationUrl` must resolve to a portal that exists** — the state agriculture department, `agriwelfare.gov.in`, or `myscheme.gov.in`. Never a fabricated deep link. The test above enforces the domain; you enforce the honesty.
- Realistic subject matter: machinery, micro-irrigation, seed, fertilizer, dairy/livestock, horticulture, solar, insurance, stubble management, drip subsidy, farm pond, agri-startup.
- Spread across ≥18 states, weighted toward Andhra Pradesh and Telangana (the demo geography).
- Crops drawn from: paddy, wheat, sugarcane, cotton, pulses, oilseeds, maize, millets, horticulture, and `"any"`.
- Set `requiresNoSolarPump: true` on solar-pump schemes only; `requiresNoTractor: true` on first-tractor subsidies only; `requiresElectricity: true` on grid-pump schemes only.
- Track the land-band and category counts against the two tables as you go — the tests are exact.

- [ ] **Step 3: Add the derived option lists**

Append to `src/data/schemes.ts`:

```ts
/** Every state named by at least one scheme, sorted. Excludes the "all" wildcard. */
export const SCHEME_STATES: string[] = [
  ...new Set(SCHEMES.flatMap((s) => (s.states === "all" ? [] : s.states))),
].sort();

/** Every crop named by at least one scheme, sorted. Excludes the "any" wildcard. */
export const SCHEME_CROPS: string[] = [
  ...new Set(SCHEMES.flatMap((s) => (s.crops === "any" ? [] : s.crops))),
].sort();
```

- [ ] **Step 4: Strengthen the adapter assertion deferred in Task 4**

In `tests/eligibility.test.ts`, the `getSchemes` case currently asserts only
`Array.isArray`. Now that the data exists, tighten it:

```ts
it("getSchemes resolves the full seed dataset", () => {
  assert.ok(Array.isArray(loadedSchemes));
  assert.equal(loadedSchemes.length, 100);
});
```

- [ ] **Step 5: Run everything (GREEN)**

Run: `npm test`
Expected: PASS, all files. Then:

Run: `npm run typecheck:strict`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/data/schemes.ts tests/schemes-data.test.ts tests/eligibility.test.ts
git commit -m "feat: complete 100-scheme dataset with full land-band coverage"
```

---

### Task 7: `SchemeCard`

From here the deliverables are React components. No DOM test library is installed (no jsdom, no @testing-library), and adding one would violate the no-new-dependencies constraint. Component tasks are therefore verified by `tsc` + `lint` + `build`, with the real behavioural check in Task 12's browser pass. Do not write fake tests that assert nothing.

**Files:**
- Create: `src/components/SchemeCard.tsx`

**Interfaces:**
- Consumes: `Scheme`, `MatchResult`, `SchemeCategory` from `@/types/scheme`; `Card`, `CardContent` from `@/components/ui/card`; `Badge` from `@/components/ui/badge`; `Button` from `@/components/ui/button`
- Produces: `export default function SchemeCard(props: SchemeCardProps)` where

```ts
export type SchemeCardProps = {
  scheme: Scheme;
  /** Omitted until the farmer sets a land size — card renders unscored. */
  match?: MatchResult;
};
```

- [ ] **Step 1: Build the card**

Create `src/components/SchemeCard.tsx`. Required structure and behaviour:

```tsx
/**
 * One government scheme, optionally with this farmer's match against it.
 * Renders unscored (no badge, no bar) when `match` is absent — the page shows
 * all 100 schemes before any land size is entered.
 */
import {
  Banknote, Beef, Droplets, Landmark, Leaf, ShieldCheck, Sprout,
  Sun, Tractor, Trees, Wheat, ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MatchResult, MatchStatus, Scheme, SchemeCategory } from "@/types/scheme";

const CATEGORY_ICON: Record<SchemeCategory, typeof Sun> = {
  "income-support": Banknote,
  insurance: ShieldCheck,
  solar: Sun,
  machinery: Tractor,
  irrigation: Droplets,
  seed: Sprout,
  fertilizer: Leaf,
  credit: Landmark,
  livestock: Beef,
  horticulture: Trees,
  organic: Sprout,
  other: Wheat,
};

const STATUS_LABEL: Record<MatchStatus, string> = {
  eligible: "ELIGIBLE",
  possible: "POSSIBLE",
  "not-eligible": "NOT ELIGIBLE",
};

/** Colour is paired with the label text — never the only signal. */
const STATUS_CLASS: Record<MatchStatus, string> = {
  eligible: "border-primary text-primary",
  possible: "border-accent text-accent",
  "not-eligible": "border-destructive text-destructive",
};

const BAR_CLASS: Record<MatchStatus, string> = {
  eligible: "bg-primary",
  possible: "bg-accent",
  "not-eligible": "bg-destructive",
};

const REASON_LIMIT = 4;
const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Days until an ISO deadline; negative when past. */
function daysUntil(iso: string): number {
  const then = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((then - midnight) / 86_400_000);
}
```

Then the component body, in this order:

1. **Header row** — category icon in a `w-9 h-9 rounded-sm bg-muted grid place-items-center`; scheme `name` as `font-display text-base font-semibold`; the status pill on the right as `<Badge variant="outline" className={STATUS_CLASS[match.status]}>` containing `<span className="tabular">{match.score}%</span> {STATUS_LABEL[match.status]}` — rendered only when `match` is present.
2. **Tag line** — `.mark text-[10px] text-muted-foreground`, joining `shortName` (if any), `authority.toUpperCase()`, and either `"ALL INDIA"` or the states joined with `" · "`, truncated to the first 2 states plus `+N` if longer.
3. **Progress bar** — only with `match`: a `h-1 bg-muted rounded-sm` track wrapping `<div className={BAR_CLASS[status]} style={{ width: `${match.score}%` }} />`, plus `role="progressbar"` with `aria-valuenow={match.score}` `aria-valuemin={0}` `aria-valuemax={100}` and `aria-label={`Eligibility match ${match.score} percent`}`.
4. **Deadline chip** — when `deadline` is set: `days < 0` → `<Badge variant="outline" className="mark text-muted-foreground">CLOSED</Badge>`; `0 <= days <= 30` → `<Badge variant="outline" className="mark border-accent text-accent">{days} DAYS LEFT</Badge>` (use `TODAY` when `days === 0`); otherwise no chip.
5. **Benefit row** — `benefitType` in `text-sm`, `estimatedBenefit` in `text-sm font-medium`, and when `benefitValueINR` is set, `<span className="tabular text-accent">₹{INR.format(v)} est.</span>`. The word `est.` is mandatory.
6. **Description** — `text-sm text-muted-foreground measure-tight`, clamped with `line-clamp-2`.
7. **`WHY YOU QUALIFY`** — `.mark` heading + `<ul>` of `match.matched.slice(0, REASON_LIMIT)`; if more, a final `<li className="text-muted-foreground">+{n} more</li>`. Omit the whole block when empty.
8. **`MISSING`** — same pattern over `match.missing`, heading `.mark text-destructive`. Omit when empty.
9. **Footer row** — `<span className="mark text-[10px] text-muted-foreground">{scheme.documents.length} DOCUMENTS</span>`; when `verified !== true`, a second line `<span className="text-[11px] text-muted-foreground">Confirm on the official portal</span>`; then `<Button asChild variant="outline" size="sm"><a href={scheme.applicationUrl} target="_blank" rel="noopener noreferrer">View / Apply <ExternalLink className="h-3.5 w-3.5" /></a></Button>`.

Card wrapper: `<Card className="border-border bg-card">` with `<CardContent className="p-4 flex flex-col gap-3">`. No hover translate, no shadow beyond the shadcn default.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "SchemeCard"`
Expected: no output.

- [ ] **Step 3: Lint**

Run: `npx eslint src/components/SchemeCard.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SchemeCard.tsx
git commit -m "feat: add SchemeCard with eligibility badge and reasons"
```

---

### Task 8: `SchemeSummaryStrip`

**Files:**
- Create: `src/components/SchemeSummaryStrip.tsx`

**Interfaces:**
- Consumes: `MatchSummary` from `@/lib/eligibility`
- Produces:

```ts
export type SchemeSummaryStripProps = {
  summary: MatchSummary;
  landAcres: number;
  /** "all" renders as "across India". */
  state: string;
};
```

- [ ] **Step 1: Build the strip**

Create `src/components/SchemeSummaryStrip.tsx`:

```tsx
/**
 * "Money you may be missing" strip. The ESTIMATED prefix is part of the
 * component, not a caller option, so an indicative rupee total can never
 * render unqualified.
 */
import type { MatchSummary } from "@/lib/eligibility";

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export type SchemeSummaryStripProps = {
  summary: MatchSummary;
  landAcres: number;
  state: string;
};

export default function SchemeSummaryStrip({
  summary,
  landAcres,
  state,
}: SchemeSummaryStripProps) {
  const where = state === "all" ? "across India" : `in ${state}`;
  const acres = Number(landAcres.toFixed(2));

  return (
    <section
      aria-label="Eligibility summary"
      className="border border-border bg-card rounded-sm p-4 flex flex-col gap-2"
    >
      <p className="mark text-[10px] text-muted-foreground">
        Estimated · based on <span className="tabular">{acres}</span> acres {where}
      </p>
      <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div className="flex items-baseline gap-2">
          <dt className="text-sm text-muted-foreground">Eligible</dt>
          <dd className="tabular text-xl font-semibold text-primary">{summary.eligible}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-sm text-muted-foreground">Possible</dt>
          <dd className="tabular text-xl font-semibold text-accent">{summary.possible}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-sm text-muted-foreground">Indicative total</dt>
          <dd className="tabular text-xl font-semibold text-accent">
            ₹{INR.format(summary.indicativeTotalINR)}
          </dd>
        </div>
      </dl>
      <p className="text-[11px] text-muted-foreground measure-tight">
        An estimate of benefits you may be able to claim, not a guaranteed amount.
        Confirm each scheme on its official portal.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npx tsc --noEmit 2>&1 | grep "SchemeSummaryStrip"` → no output
Run: `npx eslint src/components/SchemeSummaryStrip.tsx` → no errors

```bash
git add src/components/SchemeSummaryStrip.tsx
git commit -m "feat: add scheme summary strip with indicative total"
```

---

### Task 9: `SchemeFilterPanel`

**Files:**
- Create: `src/components/SchemeFilterPanel.tsx`

**Interfaces:**
- Consumes: `Slider`, `Select*`, `Switch`, `Label`, `Input`, `Button` from `@/components/ui/*`; `SCHEME_STATES`, `SCHEME_CROPS` from `@/data/schemes`; `getFarmerCategory` from `@/lib/eligibility`; `FarmerCategory`, `IrrigationType`, `SchemeCategory` from `@/types/scheme`
- Produces: the shared filter state type (imported by Task 10) and the panel:

```ts
export type SchemeSort = "match" | "benefit" | "name";

export type SchemeFilters = {
  /** null until the farmer sets a size — the page shows all 100 unscored. */
  landAcres: number | null;
  state: string;            // "all" = unspecified
  crop: string;             // "any" = unspecified
  farmerCategory: FarmerCategory;
  categoryOverridden: boolean;
  irrigation: IrrigationType | "any";
  categories: SchemeCategory[];   // empty = no category filter
  hasElectricity: boolean;
  hasSolarPump: boolean;
  hasTractor: boolean;
  eligibleOnly: boolean;
  sort: SchemeSort;
};

export const INITIAL_FILTERS: SchemeFilters = {
  landAcres: null,
  state: "all",
  crop: "any",
  farmerCategory: "small",
  categoryOverridden: false,
  irrigation: "any",
  categories: [],
  hasElectricity: true,
  hasSolarPump: false,
  hasTractor: false,
  eligibleOnly: false,
  sort: "name",
};

export type SchemeFilterPanelProps = {
  filters: SchemeFilters;
  onChange: (next: SchemeFilters) => void;
  onReset: () => void;
  /** Shown in the panel header, e.g. "42 of 100 schemes". */
  resultCount: number;
  totalCount: number;
};
```

- [ ] **Step 1: Build the panel**

Create `src/components/SchemeFilterPanel.tsx`. It is a **pure controlled component** — every change calls `onChange` with a new object; it holds no state of its own.

Controls, in order:

| Control | Implementation notes |
|---|---|
| Land size | `Slider` `min={0.5} max={100} step={0.5}` + `Input type="number"` kept in sync. `value={[filters.landAcres ?? 0.5]}`. Any interaction sets `landAcres` to a number — this is what flips the page into scored mode. Slider gets `aria-label="Land size in acres"`. Show the current value as `<span className="tabular">{n}</span> acres`, or `Not set` while null. |
| State | `Select` — first item `<SelectItem value="all">All states</SelectItem>`, then `SCHEME_STATES.map(...)`. |
| Crop | `Select` — first item `value="any"` labelled `Any crop`, then `SCHEME_CROPS`. |
| Farmer category | `Select` over the 5 categories. On change also set `categoryOverridden: true`. While `!categoryOverridden`, append a `text-muted-foreground` "auto" hint to the label. |
| Irrigation | `Select` — `any` / `borewell` / `canal` / `rainfed` / `drip`. |
| Benefit category | 12 toggle chips as `<Button variant="outline" size="sm" aria-pressed={on}>`; clicking toggles membership in `filters.categories`. Selected chips get `border-primary text-primary`. |
| Has electricity | `Switch` + `Label` |
| Has solar pump | `Switch` + `Label` |
| Has tractor | `Switch` + `Label` |
| Show only eligible | `Switch` + `Label`, `id="eligible-only"` |
| Sort | `Select` — `match` → "Match score", `benefit` → "Benefit value", `name` → "Name" |
| Reset | `Button variant="outline"` calling `onReset` |

Every `Switch` and `Select` must be associated with its `Label` via `htmlFor`/`id`. Group the whole panel in a `<form onSubmit={(e) => e.preventDefault()}>` so Enter never reloads the page.

Land-size handler — the auto-follow rule:

```tsx
function setLand(next: number): void {
  onChange({
    ...filters,
    landAcres: next,
    farmerCategory: filters.categoryOverridden ? filters.farmerCategory : getFarmerCategory(next),
  });
}
```

Panel wrapper: `<aside className="border border-border bg-card rounded-sm p-4 flex flex-col gap-5">` with a header showing `<span className="mark text-[10px] text-muted-foreground">Filters</span>` and `<span className="tabular text-xs">{resultCount} of {totalCount}</span>`. Task 10 supplies the sticky positioning and the mobile `Sheet` wrapper — this component is layout-agnostic.

- [ ] **Step 2: Typecheck, lint, commit**

Run: `npx tsc --noEmit 2>&1 | grep "SchemeFilterPanel"` → no output
Run: `npx eslint src/components/SchemeFilterPanel.tsx` → no errors

```bash
git add src/components/SchemeFilterPanel.tsx
git commit -m "feat: add scheme filter panel"
```

---

### Task 10: `Schemes` page and route

**Files:**
- Create: `src/pages/Schemes.tsx`
- Modify: `src/App.tsx` (lazy imports block ~line 35, routes block ~line 83)

**Interfaces:**
- Consumes: everything from Tasks 4–9
- Produces: the `/schemes` route

- [ ] **Step 1: Build the page**

Create `src/pages/Schemes.tsx`.

Header — copy the pattern from `src/pages/LivePrices.tsx:236-253` exactly (sticky bar, back arrow to `/home`, brand mark, `container mx-auto px-4`), but widen the container to `max-w-7xl` since this page is two-column.

Data and scoring. Note the local `Row` type: `ScoredScheme` requires `match`, so
the unscored first-load state needs its own shape. Do **not** cast an
`undefined` match to `ScoredScheme` — that is a type lie that will bite in the
sort comparator.

```tsx
/** A scheme in the grid. `match` is absent until the farmer sets a land size. */
type Row = { scheme: Scheme; match?: MatchResult };

const { data: schemes, isLoading, isError, refetch } = useQuery({
  queryKey: ["schemes"],
  queryFn: getSchemes,
  staleTime: Infinity,
});

const [filters, setFilters] = useState<SchemeFilters>(INITIAL_FILTERS);

const rows = useMemo<Row[]>(() => {
  if (!schemes) return [];
  if (filters.landAcres === null) return schemes.map((scheme) => ({ scheme }));
  const profile: FarmerProfile = {
    state: filters.state,
    landAcres: filters.landAcres,
    crop: filters.crop,
    irrigation: filters.irrigation,
    farmerCategory: filters.farmerCategory,
    hasElectricity: filters.hasElectricity,
    hasSolarPump: filters.hasSolarPump,
    hasTractor: filters.hasTractor,
  };
  return schemes.map((scheme) => ({ scheme, match: scoreScheme(profile, scheme) }));
}, [schemes, filters]);
```

Narrow before summarising — `summarizeMatches` takes `ScoredScheme[]`:

```tsx
const summary = useMemo(() => {
  const scored: ScoredScheme[] = rows.filter(
    (row): row is ScoredScheme => row.match !== undefined
  );
  return summarizeMatches(scored);
}, [rows]);
```

Then a third `useMemo` for visible rows: filter by `filters.categories` (empty = pass all), drop rows whose `match?.status !== "eligible"` when `eligibleOnly`, then sort —

- `sort === "name"`: central before state, then `name.localeCompare`
- `sort === "benefit"`: `(b.scheme.benefitValueINR ?? 0) - (a.scheme.benefitValueINR ?? 0)`
- `sort === "match"`: `(b.match?.score ?? 0) - (a.match?.score ?? 0)`, ties broken by name

The sort flip belongs in the page's change handler, not an effect — an effect that
sets state from state would cause an extra render pass:

```tsx
const handleFilterChange = useCallback((next: SchemeFilters) => {
  setFilters((prev) => {
    const justSetLand = prev.landAcres === null && next.landAcres !== null;
    return justSetLand && next.sort === "name" ? { ...next, sort: "match" } : next;
  });
}, []);
```

Layout:

```tsx
<div className="min-h-screen bg-background">
  {/* sticky header */}
  <div className="container mx-auto px-4 py-8 max-w-7xl flex flex-col gap-6">
    <header>
      <p className="mark text-[11px] text-muted-foreground">Government Schemes · India</p>
      <h1 className="font-display text-3xl md:text-5xl font-semibold tracking-tight">
        Find the schemes you qualify for.
      </h1>
      <p className="text-sm text-muted-foreground measure mt-2">
        100 central and state agricultural schemes, matched to your land size and profile.
      </p>
    </header>

    {/* disclaimer: border-l-2 border-accent pl-3 py-2 text-sm text-muted-foreground measure */}
    {/* SchemeSummaryStrip — only when filters.landAcres !== null */}

    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="hidden lg:block">
        <div className="sticky top-24">{/* SchemeFilterPanel */}</div>
      </div>
      {/* mobile: <Sheet> triggered by a "Filters" Button, lg:hidden */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* SchemeCard per visible row */}
      </div>
    </div>
  </div>
</div>
```

States:
- `isLoading` → 6 `<Skeleton className="h-64 rounded-sm" />` in the grid
- `isError` → bordered card, message "Could not load schemes.", `<Button onClick={() => refetch()}>Retry</Button>`
- Zero visible rows and `eligibleOnly` → "No schemes match at this profile. Turn off *Show only eligible* to see near-misses." + a button that clears the toggle
- Zero visible rows otherwise → "No schemes match these filters. Try clearing the state or crop filter." + Reset button

- [ ] **Step 2: Wire the route**

In `src/App.tsx`, add to the lazy block after line 35:

```tsx
const Schemes = lazy(() => import("./pages/Schemes"));
```

And a route above the catch-all, following the existing formatting:

```tsx
<Route path="/schemes" element={<Suspense fallback={<div className="p-8 text-center">Loading...</div>}><Schemes /></Suspense>} />
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit 2>&1 | grep -E "pages/Schemes|App.tsx"` → no output
Run: `npx eslint src/pages/Schemes.tsx src/App.tsx` → no errors
Run: `npm run build` → succeeds

- [ ] **Step 4: Commit**

```bash
git add src/pages/Schemes.tsx src/App.tsx
git commit -m "feat: add government schemes page at /schemes"
```

---

### Task 11: Nav wiring

**Files:**
- Modify: `src/pages/Home.tsx` (desktop actions ~line 221, mobile Sheet ~line 325)

The masthead already carries seven items and `DESIGN.md` warns it previously broke onto two rows at laptop widths. Use the short label **Schemes** and `variant="outline"` — the single filled action is already taken by Login.

- [ ] **Step 1: Add the desktop button**

In `src/pages/Home.tsx`, insert immediately **before** the `Live Data` `<DropdownMenu>` (currently starting line 231):

```tsx
            <Button
              variant="outline"
              className="border-2 gap-2"
              onClick={() => navigate("/schemes")}
              type="button"
            >
              <Landmark className="h-4 w-4" />
              Schemes
            </Button>
```

Add `Landmark` to the existing `lucide-react` import.

- [ ] **Step 2: Add the mobile Sheet entry**

Insert before the mobile `Live Data` `<DropdownMenu>` (currently ~line 328):

```tsx
              <Button
                variant="outline"
                className="justify-start gap-2 border-2 min-h-[48px]"
                onClick={() => navigate("/schemes")}
                type="button"
              >
                <Landmark className="h-4 w-4" /> Government Schemes
              </Button>
```

- [ ] **Step 3: Verify the masthead still holds one row**

Run: `npm run dev`
Open `http://localhost:5173/home` and check at 1280px and 1440px widths that the masthead does not wrap to two rows. If it does, that is a real regression — shorten no further; instead move the new button inside the `Live Data` dropdown and note the change.

- [ ] **Step 4: Lint and commit**

Run: `npx eslint src/pages/Home.tsx` → no new errors

```bash
git add src/pages/Home.tsx
git commit -m "feat: add Schemes entry to masthead and mobile menu"
```

---

### Task 12: Full verification pass

**Files:** none created — this task produces evidence, not code.

- [ ] **Step 1: Run the whole automated suite**

```bash
npm test
npm run typecheck:strict
npx tsc --noEmit 2>&1 | grep -vE "GlobalLanguageSelector|HeroText|WeightEstimator|useSpeechRecognition|AgroNewsLive|pages/Input|StartupInput"
npm run lint
npm run build
```

Expected: tests all pass; `typecheck:strict` exits 0; the filtered repo-wide
`tsc` output is empty (the 7 excluded files are the pre-existing failures
documented in `DESIGN.md`); lint clean for new files; build succeeds.

If `tsc` reports anything in a file this plan created or modified, fix it before
continuing. Do not widen the grep to hide a new error, and do not relax
`tsconfig.strict.json` to make `typecheck:strict` pass.

- [ ] **Step 2: Browser pass — the land-size matrix**

Run `npm run dev`, open `http://localhost:5173/schemes`, and confirm:

| Check | Expected |
|---|---|
| First load | Exactly 100 cards, no eligibility badges, no summary strip, sort = Name |
| Land 0.5 ac | Summary strip appears, ≥40 eligible, sort flips to Match score |
| Land 3 ac | ≥40 eligible |
| Land 7 ac | ≥30 eligible |
| Land 15 ac | ≥30 eligible |
| Land 40 ac | ≥30 eligible — the large-farm case must not be empty |
| State = Punjab, 3 ac | Punjab + all-India schemes only; AP-only schemes show not-eligible |
| Show only eligible ON | No amber or red cards remain |
| A not-eligible card | `MISSING` block names the actual reason, and `WHY YOU QUALIFY` still lists passes |
| Deadline chips | At least one ochre "N DAYS LEFT" and one muted "CLOSED" |
| View / Apply | Opens the official URL in a new tab |
| Reset | Returns to 100 unscored cards |

- [ ] **Step 3: Theme, responsive and console**

- Toggle to dark mode from `/home`, return to `/schemes`: every surface follows the theme, no black-on-black or invisible text
- Resize to 375px: filter panel collapses to the `Sheet` drawer, cards go single-column, nothing scrolls horizontally
- DevTools console: **zero** errors and zero React warnings (check for missing `key` props and controlled-input warnings in particular)

- [ ] **Step 4: Keyboard pass**

Tab from the page header through the entire filter panel: every control is reachable, the focus ring is visible on each, the slider responds to arrow keys, `Space` toggles switches, and `Enter` on a category chip toggles it without submitting.

- [ ] **Step 5: Commit any fixes**

```bash
git add <only the files you fixed>
git commit -m "fix: address verification findings on schemes page"
```

---

## Demo script

Three lines for the hackathon walkthrough:

1. Click **Schemes** in the masthead — all 100 central and state schemes load, unfiltered.
2. Drag the land-size slider to **0.5 acres** and pick a state — the summary strip shows eligible count and the indicative total you may be missing, and cards re-rank by match score with per-scheme reasons.
3. Drag to **40 acres** — the eligible set changes completely, proving every farm size is covered; toggle **Show only eligible** and open **View / Apply** on PM-KUSUM.
