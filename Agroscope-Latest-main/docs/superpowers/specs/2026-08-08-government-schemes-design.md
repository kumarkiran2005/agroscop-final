# Government Schemes — Design

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning
**Feature:** A `/schemes` page that helps an Indian farmer discover which government
agricultural schemes they may be eligible for, driven primarily by land size.

---

## Problem

Schemes exist; farmers don't know which ones apply to them. The gap is not
availability, it is *discovery plus eligibility*. A farmer cannot read 100 scheme
pages across a dozen state portals to learn that three of them fit 0.5 acres of
rainfed paddy.

AgroScope already knows the farmer is a farmer. This feature turns a land size and
a few profile answers into a ranked, explained list of schemes, and shows the
indicative money they may be leaving unclaimed.

## Scope

**In scope**

- 100-scheme seed dataset, typed, with land-size coverage across every farm-size band
- Types (`Scheme`, `FarmerProfile`, `FarmerCategory`, `MatchResult`)
- Pure eligibility engine with explainable matched/missing reasons
- Data-source adapter with a live-API stub so the seed can be swapped without UI changes
- `SchemesPage` at `/schemes`, lazy-loaded
- `SchemeFilterPanel` (sticky sidebar desktop / `Sheet` drawer mobile)
- `SchemeCard`, `SchemeSummaryStrip`
- Nav wiring: masthead button + mobile Sheet entry
- Deadline urgency badges for schemes closing within 30 days

**Explicitly out of scope** (from the wider brainstorm, deferred by decision)

Scheme Sahayak chatbot, voice interface, OCR document scanning, application
tracker, admin dashboard, SMS/WhatsApp alerts, district-level scheme map,
scheme comparison view, URL-synced filters, localStorage profile persistence.

## Decisions taken before design

| Question | Decision |
|---|---|
| Data sourcing | Web-verify the ~25 real anchor schemes; author the remaining ~75 realistically. Ship as a static seed file, not runtime scraping. |
| Nav placement | Own masthead button labelled **Schemes**, left of *Live Data*; also added to the mobile Sheet. |
| Extra features | Deadline urgency badges only. No URL sync, no profile persistence, no comparison view. |

---

## Architecture

Page-local filter state, data through react-query, pure scoring in a `useMemo`.

```
                       Schemes.tsx  (route /schemes, lazy)
                            │
              ┌─────────────┼──────────────────┐
              │             │                  │
       SchemeFilterPanel    │           SchemeSummaryStrip
       (controlled)         │           (eligible / possible / ₹ indicative)
              │             │
              │  filters    │  useQuery(['schemes'], getSchemes)
              ▼             ▼
        useMemo: scoreScheme(profile, scheme) for all 100
                            │  → filter → sort
                            ▼
                     SchemeCard × N
```

`QueryClientProvider` is already mounted in `src/App.tsx`, so react-query needs no
new setup. Wrapping the seed read in `useQuery` is the reason the later swap to a
real backend touches zero UI: loading, error and retry states exist from day one.

### Files

| File | Responsibility | Depends on |
|---|---|---|
| `src/types/scheme.ts` | Type definitions only, no logic | — |
| `src/data/schemes.ts` | The 100-scheme array, disclaimer text, derived state/crop option lists | types |
| `src/lib/eligibility.ts` | `getFarmerCategory`, `scoreScheme`, `summarizeMatches`, `getSchemes`, `fetchSchemesFromApi` stub | types, data |
| `src/pages/Schemes.tsx` | Page shell, filter state, memoized scoring, grid | all below |
| `src/components/SchemeFilterPanel.tsx` | All filter controls, responsive container | types |
| `src/components/SchemeCard.tsx` | One scheme + its match result | types |
| `src/components/SchemeSummaryStrip.tsx` | Aggregate counts and indicative total | types |

Components go flat in `src/components/`, matching the existing convention
(`DealCard.tsx`, `ProvisionSyncCard.tsx`, `WeightEstimator.tsx`). No new subfolder
for three files.

Each unit is independently understandable: the engine is pure and has no React
import; the three components take props and hold no data-fetching logic; the page
is the only place that knows about both.

---

## Types

`src/types/scheme.ts`, as specified in the brief, plus two additions marked below.

```ts
export type FarmerCategory = 'marginal' | 'small' | 'semi-medium' | 'medium' | 'large';

export type SchemeCategory =
  | 'income-support' | 'insurance' | 'solar' | 'machinery' | 'irrigation'
  | 'seed' | 'fertilizer' | 'credit' | 'livestock' | 'horticulture'
  | 'organic' | 'other';

export type IrrigationType = 'borewell' | 'canal' | 'rainfed' | 'drip';

export type Scheme = {
  id: string;
  name: string;
  shortName?: string;
  authority: 'central' | 'state';
  states: string[] | 'all';
  crops: string[] | 'any';
  landMinAcres: number;
  landMaxAcres: number;            // Infinity when uncapped
  farmerCategories: FarmerCategory[] | 'any';
  irrigation?: (IrrigationType | 'any')[];
  requiresElectricity?: boolean;
  category: SchemeCategory;
  benefitType: string;
  estimatedBenefit: string;        // display string, e.g. "₹6,000/year"
  benefitValueINR?: number;        // numeric estimate, drives the indicative total
  description: string;
  documents: string[];
  applicationUrl: string;
  deadline?: string;               // ISO date
  verified?: boolean;              // ADDITION — see "Honesty about authored data"
  requiresNoSolarPump?: boolean;   // ADDITION — see "Scoring criteria"
  requiresNoTractor?: boolean;     // ADDITION — see "Scoring criteria"
};

export type FarmerProfile = {
  state: string;                   // 'all' means unspecified
  district?: string;
  landAcres: number;
  crop: string;                    // 'any' means unspecified
  irrigation: IrrigationType | 'any';
  farmerCategory: FarmerCategory;
  hasElectricity: boolean;
  hasSolarPump: boolean;
  hasTractor: boolean;
};

export type MatchStatus = 'eligible' | 'possible' | 'not-eligible';

export type MatchResult = {
  score: number;                   // 0-100, integer
  status: MatchStatus;
  matched: string[];               // human-readable pass reasons
  missing: string[];               // human-readable fail reasons
};
```

**Three deliberate additions to the brief's type:**

1. `verified?: boolean` — distinguishes the web-verified anchor schemes from the
   authored illustrative ones. Needed for honest UI labelling (below).
2. `requiresNoSolarPump?: boolean` — the brief's profile carries `hasSolarPump`,
   but nothing in `Scheme` expressed the rule that a solar-pump subsidy is for
   farmers who *don't* already have one. Without it, `hasSolarPump` is an unused
   field. This makes the PM-KUSUM demo case work.
3. `requiresNoTractor?: boolean` — the same gap for `hasTractor`. This must be a
   per-scheme opt-in flag rather than an inference from
   `category === 'machinery'`: a mechanization scheme covers rotavators, seed
   drills, balers and harvesters, so penalising every tractor-owning farmer
   across all 12 machinery schemes would be wrong. The flag is set only on the
   schemes that actually subsidise a first tractor.

### Sentinel values

`state: 'all'`, `crop: 'any'` and `irrigation: 'any'` mean *the user has not
specified this*. The engine treats an unspecified criterion as **not applicable**:
it is excluded from both the numerator and the denominator, so unanswered
questions never drag a score down. This is documented in the engine's JSDoc.

Booleans cannot carry a sentinel, so they take demo-sensible defaults —
`hasElectricity: true`, `hasSolarPump: false`, `hasTractor: false` — and are
exposed as switches in the filter panel. They are never scored before the user
sets a land size, so the defaults cannot mislead.

---

## Eligibility engine

`src/lib/eligibility.ts`. Pure functions, no React, brief JSDoc on each export.

### `getFarmerCategory(landAcres: number): FarmerCategory`

Indian official bands:

| Category | Land |
|---|---|
| `marginal` | < 2.5 acres |
| `small` | 2.5 – 5 |
| `semi-medium` | 5 – 10 |
| `medium` | 10 – 25 |
| `large` | > 25 |

### `scoreScheme(profile: FarmerProfile, scheme: Scheme): MatchResult`

**Hard gates.** Land size and state are disqualifying, not merely weighted. A
0.5-acre farmer facing a 5-acre minimum would score ~79% under a plain weighted
sum and render as *"possible"* — which is wrong, that farmer is flatly
ineligible. So:

- If `landAcres < landMinAcres` or `landAcres > landMaxAcres` → gate fails
- If `scheme.states !== 'all'` and the profile state is specified and not in the
  list → gate fails
- On any gate failure: `status = 'not-eligible'` and `score = min(score, 45)`

The passing criteria still populate `matched[]`, so the "why didn't I qualify"
card stays informative rather than a bare ✗.

**Weighted criteria.** `totalWeight` sums only the criteria that apply to this
scheme/profile pair.

| Criterion | Weight | Applies when |
|---|---|---|
| Land size within range | 3 | always |
| State match | 3 | `states !== 'all'` and profile state specified |
| Crop match | 3 | `crops !== 'any'` and profile crop specified |
| Farmer category | 2 | `farmerCategories !== 'any'` |
| Irrigation | 1 | `scheme.irrigation` present and does not contain `'any'`, and profile irrigation specified |
| Electricity | 1 | `requiresElectricity === true` |
| No existing solar pump | 1 | `requiresNoSolarPump === true` |
| No existing tractor | 1 | `requiresNoTractor === true` |

`score = round(matchedWeight / totalWeight * 100)`. `totalWeight` is at most 15
and typically 11–14, since the last three criteria are opt-in per scheme.

**Status thresholds:** `>= 80` eligible · `50–79` possible · `< 50` not-eligible.
Gate failure overrides to not-eligible regardless of score.

**Worked check** (against a fully-specified scheme, `totalWeight = 14`). Crop
mismatch alone on a paddy-only scheme = 11/14 = 79% → *possible*, correctly
hedged. Irrigation mismatch alone = 13/14 = 93% → *eligible* with a note. Land
gate failure = capped 45 → *not-eligible*. These three cases are the design
intent and are verified by hand during implementation.

**Reason strings** are farmer-readable and quote the actual numbers:

- `✓ 0.5 acres is within the 0–2.5 acre limit`
- `✓ Andhra Pradesh is an eligible state`
- `✗ Requires minimum 5 acres — you have 3.2 acres`
- `✗ Scheme is for farmers without an existing solar pump`

### `summarizeMatches(results): { eligible, possible, notEligible, indicativeTotalINR }`

`indicativeTotalINR` sums `benefitValueINR` over **eligible schemes only**. This
powers the "money you may be missing" strip. Always rendered under an
`ESTIMATED` label.

### Data adapter

```ts
/** Current source: the bundled seed dataset. */
export async function getSchemes(): Promise<Scheme[]>

/**
 * TODO: point this at a real backend / web-search endpoint.
 * Swap the body of getSchemes() to call this and nothing in the UI changes —
 * the page already consumes it through react-query with loading/error states.
 */
export async function fetchSchemesFromApi(): Promise<Scheme[]>
```

The stub throws a clear `Error('fetchSchemesFromApi is not wired up yet')` rather
than returning `[]`, so a half-finished swap fails loudly instead of silently
rendering an empty page. A comment block in `eligibility.ts` documents the
three-line swap procedure.

---

## Dataset

`src/data/schemes.ts` — exactly 100 entries.

### Land-size coverage

The critical requirement: a 0.5-acre farmer and a 40-acre farmer must each see
many eligible schemes.

| Land range | Count | 0.5 ac | 3 ac | 7 ac | 15 ac | 40 ac |
|---|---|---|---|---|---|---|
| 0 → ∞ (uncapped) | 45 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 0 → 2.5 | 10 | ✓ | | | | |
| 0 → 5 | 20 | ✓ | ✓ | | | |
| 2.5 → 10 | 10 | | ✓ | ✓ | | |
| 5 → 25 | 8 | | | ✓ | ✓ | |
| 10 → ∞ | 7 | | | | ✓ | ✓ |
| **Total** | **100** | | | | | |
| **Land-eligible count** | | **75** | **75** | **63** | **60** | **52** |

Every band clears 50 schemes on land alone. State and crop filters narrow from
there, which is the intended interaction.

### Category distribution

income-support 8 · insurance 8 · solar 8 · machinery 12 · irrigation 12 ·
seed 8 · fertilizer 6 · credit 8 · livestock 8 · horticulture 8 · organic 7 ·
other 7 = **100**

Authority split: ~40 central, ~60 state. States covered: at least 18, weighted
toward Andhra Pradesh and Telangana since that is the demo geography. Crops
covered: paddy, wheat, sugarcane, cotton, pulses, oilseeds, maize, millets,
horticulture, and `'any'`.

### Anchor schemes (web-verified, `verified: true`)

The 28 real schemes below have their names, intent, official application URL and
benefit figures confirmed by web search during implementation:

**Central** — PM-KISAN, PM-KUSUM, PMFBY (crop insurance), Kisan Credit Card,
Soil Health Card, SMAM (agricultural mechanization), PKVY (organic), PM-KMY
(pension), Agriculture Infrastructure Fund, e-NAM, National Food Security
Mission, PMKSY Per Drop More Crop (micro-irrigation), MIDH (horticulture),
RKVY, National Livestock Mission, Crop Residue Management, FPO formation,
Sub-Mission on Seeds and Planting Material, National Mission on Natural Farming,
National Beekeeping & Honey Mission.

**State** — YSR/AP Rythu Bharosa, Annadata Sukhibhava (AP), Rythu Bandhu and
Rythu Bima (Telangana), Punjab CRM stubble-management incentive, Maharashtra
Namo Shetkari Mahasanman Nidhi, Odisha KALIA, West Bengal Krishak Bandhu.

If a search cannot confirm a figure, the entry keeps the scheme but states the
benefit qualitatively (e.g. "Subsidy as notified by the state") rather than
inventing a number.

### Honesty about authored data

The ~75 authored schemes are realistic but not individually verified. Two rules
keep this from misleading a farmer:

1. **No invented deep links.** Every `applicationUrl` resolves to a real portal
   that exists — the relevant state agriculture department, `agriwelfare.gov.in`,
   or `myscheme.gov.in`. Never a plausible-looking fabricated URL.
2. **`verified: false` is visible.** Unverified cards carry a quiet
   "Confirm on the official portal" line rather than presenting authored detail
   as confirmed fact.

Plus the page-level disclaimer, exported as `SCHEMES_DISCLAIMER`:

> Benefits shown are **indicative estimates**, not guaranteed payouts. Eligibility
> rules, funding limits and application windows change and vary by state and
> district. Always confirm on the official scheme portal before applying.

---

## UI

### Page — `src/pages/Schemes.tsx`

Follows the established page pattern (see `LivePrices.tsx`): own sticky header
with a back arrow and the AgroScope brand mark, then
`container mx-auto px-4 py-8`.

1. **Hero** — `.mark` eyebrow `GOVERNMENT SCHEMES · INDIA`, display heading, a
   one-sentence intro in `.measure`
2. **Disclaimer banner** — bordered, `--accent` left rule, always visible
3. **Summary strip** — only once a land size is set
4. **Two-column body** — filter panel (sticky, `lg:` and up) + scheme grid

### Progressive disclosure

Land size is `number | null`. While `null`:

- All 100 schemes render, sorted by authority then name
- No eligibility badges, no progress bars, no summary strip
- Sort defaults to Name

The moment land size is set, badges, bars, the summary strip and match-score
sorting all switch on. This satisfies "on first load show ALL 100 schemes, no
profile required" while keeping the scored view a deliberate step.

### `SchemeFilterPanel`

Sticky sidebar at `lg:` and above; a `Sheet` drawer behind a "Filters" button
below that — `sheet.tsx` and the mobile pattern already exist in `Home.tsx`.

| Control | Component | Values |
|---|---|---|
| Land size | `slider` + numeric `input`, kept in sync | 0.5 – 100 acres, step 0.5 |
| State | `select` | All states + "All states" |
| Crop | `select` | Crop list + "Any crop" |
| Farmer category | `select` | Auto-derived from land size, user-overridable |
| Irrigation | `select` | borewell / canal / rainfed / drip / any |
| Benefit category | Toggle chip group | 12 categories, multi-select |
| Has electricity | `switch` | default on |
| Has solar pump | `switch` | default off |
| Has tractor | `switch` | default off |
| Eligible only | `switch` | default off |
| Sort | `select` | Match score / Benefit value / Name |
| Reset | `button` | clears to initial state |

Farmer category auto-follows the land slider via `getFarmerCategory` until the
user overrides it, after which it stays put — the derived value is a default, not
a lock. Mechanism: a `categoryOverridden: boolean` flag alongside the filter
state, set `true` when the select changes and back to `false` by Reset. The
select shows a quiet "auto" hint while `false`.

Every control is a shadcn primitive, so keyboard access and focus rings come from
the existing `:focus-visible` treatment. Labels are bound with `label.tsx`;
the slider gets `aria-label` and `aria-valuetext` in acres.

### `SchemeCard`

```
┌────────────────────────────────────────────────┐
│ ☀  PM-KUSUM                      ⟨ 92% ELIGIBLE⟩│
│    PMKUSUM · CENTRAL · ALL INDIA               │
│    ████████████████████░░                      │
│                                                │
│    Solar pump subsidy                          │
│    Up to 60% subsidy          ₹45,000 est.     │
│                                                │
│    WHY YOU QUALIFY                             │
│    ✓ 4 acres is within the limit               │
│    ✓ Andhra Pradesh is an eligible state       │
│    ✓ No existing solar pump                    │
│                                                │
│    MISSING                                     │
│    ✗ Electricity connection not confirmed      │
│                                                │
│    4 documents            [ View / Apply ↗ ]   │
└────────────────────────────────────────────────┘
```

- Category icon from `lucide-react` (`Sun`, `Tractor`, `Droplets`, `Sprout`,
  `ShieldCheck`, `Landmark`, `Banknote`, `Beef`, `Trees`, `Leaf`, `Wheat`)
- Status pill and progress bar: `--primary` eligible, `--accent` possible,
  `--destructive` not-eligible. Colour is never the only signal — the pill
  carries the word and the score.
- `matched[]` and `missing[]` capped at 4 items each with a "+2 more" affordance,
  so a card cannot grow unbounded
- Document count as a chip, full list on the card body
- `View / Apply` opens `applicationUrl` with
  `target="_blank" rel="noopener noreferrer"`
- Deadline within 30 days → ochre `.mark` chip, e.g. `7 DAYS LEFT`. Past
  deadlines render as a muted `CLOSED` chip.
- `verified: false` → quiet "Confirm on the official portal" line

### `SchemeSummaryStrip`

```
ESTIMATED · BASED ON 4 ACRES IN ANDHRA PRADESH
Eligible 18   ·   Possible 24   ·   Indicative total ₹2,14,000
```

Figures use `.tabular`. Rupee amounts use Indian digit grouping via
`Intl.NumberFormat('en-IN')`. The `ESTIMATED` prefix is part of the component,
not optional, so the number can never appear unqualified.

### Design-system fit

Per `DESIGN.md`: `.mark` for uppercase eyebrows and card labels, `.tabular` for
acres/₹/percentages, hairline `border-border` with `--radius: 0.25rem`, no hover
lift and no glow, `--accent` reserved for measurement (progress bars, deadline
chips, indicative totals) and never decorative. Light and dark both work because
every colour is a semantic token — no hardcoded hex, avoiding the known gap
DESIGN.md lists for 26 other files.

Copy stays in English; `TranslateOnNavigate` machine-translates on route change
like every other page.

### States

| State | Treatment |
|---|---|
| Loading | Skeleton cards via `skeleton.tsx` |
| Query error | Bordered card, plain message, Retry button calling react-query `refetch` |
| No matches after filters | "No schemes match these filters." + the two most likely culprits named (state, crop) + Reset button |
| Eligible-only on, zero eligible | Explains the toggle is on and offers to turn it off |
| Land size unset | Not an empty state — all 100 render |

---

## Performance

Scoring 100 schemes × ≤7 comparisons on every filter change is microseconds; no
debounce, no virtualization, no memo on individual cards needed. The `useMemo`
exists to avoid recomputing during unrelated re-renders, not because the work is
expensive. The page is lazy-loaded, so the ~100-entry dataset does not enter the
initial bundle.

## Wiring

- `src/App.tsx` — `const Schemes = lazy(() => import("./pages/Schemes"))` and
  `<Route path="/schemes" ...>` inside the existing `Suspense` pattern, above the
  `*` catch-all
- `src/pages/Home.tsx` — masthead `Button variant="outline"` labelled **Schemes**
  with a `Landmark` icon, placed left of the *Live Data* dropdown; plus a
  matching entry in the mobile `Sheet`. Stays `variant="outline"` — DESIGN.md
  allows exactly one filled action in the bar and *Login* already holds it.

## Verification

No test runner exists in this repo (no vitest/jest, and `npm run build` does not
typecheck). Verification is therefore explicit:

1. `npx tsc --noEmit` — must introduce **zero** new errors. DESIGN.md documents 7
   pre-existing failing files (`GlobalLanguageSelector`, `HeroText`,
   `WeightEstimator`, `useSpeechRecognition`, `AgroNewsLive`, `Input`,
   `StartupInput`); output is filtered to the new paths.
2. `npm run lint` — clean for new files.
3. `npm run build` — succeeds.
4. **Dataset assertions** via a throwaway script in the scratchpad: exactly 100
   entries, all ids unique, every band's land-eligible count matches the table
   above, every `applicationUrl` is a syntactically valid absolute URL, category
   counts sum to 100.
5. **Manual pass** at 0.5, 3, 7, 15 and 40 acres confirming each shows a healthy
   eligible count; light and dark mode; mobile drawer at 375px width; keyboard
   traversal of the whole filter panel; browser console clean.

## Risks

| Risk | Mitigation |
|---|---|
| Authored schemes read as authoritative | `verified` flag surfaced in UI, real portal URLs only, permanent disclaimer |
| Benefit figures go stale | Labelled indicative everywhere; `estimatedBenefit` is a string so it can be qualitative |
| Gate-plus-cap scoring looks arbitrary | Documented in JSDoc and in this spec; the capped score always ships with the failing reason in `missing[]` |
| `Home.tsx` masthead wraps to two rows | Label shortened to "Schemes"; checked at 1280px and 1440px, the widths DESIGN.md calls out as previously broken |
