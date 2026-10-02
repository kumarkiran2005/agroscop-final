/**
 * Filter state and selection logic for the schemes page.
 *
 * Kept out of the components so the behaviour that decides what a farmer sees is
 * testable without a DOM. The panel edits this state; the page renders whatever
 * `selectSchemes` returns.
 */
import { getFarmerCategory, scoreScheme } from "@/lib/eligibility";
import type {
  FarmerCategory,
  FarmerProfile,
  IrrigationType,
  MatchResult,
  Scheme,
  SchemeCategory,
} from "@/types/scheme";

export type SchemeSort = "match" | "benefit" | "name";

export type SchemeFilters = {
  /** Null until the farmer sets a size — the whole directory shows unscored. */
  landAcres: number | null;
  /** "all" means unspecified, which never counts against a scheme. */
  state: string;
  /** "any" means unspecified. */
  crop: string;
  /** "auto" derives the band from landAcres. */
  farmerCategory: FarmerCategory | "auto";
  irrigation: IrrigationType | "any";
  /** Empty means no category restriction. */
  categories: SchemeCategory[];
  eligibleOnly: boolean;
  sort: SchemeSort;
  hasElectricity: boolean;
  hasSolarPump: boolean;
  hasTractor: boolean;
};

export const DEFAULT_SCHEME_FILTERS: SchemeFilters = {
  landAcres: null,
  state: "all",
  crop: "any",
  farmerCategory: "auto",
  irrigation: "any",
  categories: [],
  eligibleOnly: false,
  sort: "match",
  hasElectricity: true,
  hasSolarPump: false,
  hasTractor: false,
};

/** A scheme with its verdict, or null when nothing has been scored yet. */
export type SelectedScheme = {
  scheme: Scheme;
  match: MatchResult | null;
};

/** Scoring only begins once the farmer tells us their land size. */
export function isProfileActive(filters: SchemeFilters): boolean {
  return filters.landAcres !== null;
}

/** Build the engine's profile from filter state. Only valid when land is set. */
export function buildProfile(filters: SchemeFilters, landAcres: number): FarmerProfile {
  return {
    state: filters.state,
    landAcres,
    crop: filters.crop,
    irrigation: filters.irrigation,
    farmerCategory:
      filters.farmerCategory === "auto" ? getFarmerCategory(landAcres) : filters.farmerCategory,
    hasElectricity: filters.hasElectricity,
    hasSolarPump: filters.hasSolarPump,
    hasTractor: filters.hasTractor,
  };
}

/**
 * Apply filters, score against the profile, and sort.
 *
 * Note which criteria are hard filters and which are not. Benefit category and
 * the eligible-only toggle remove rows. State, crop and irrigation do NOT — a
 * mismatched scheme stays visible carrying its reason, because "not eligible,
 * and here is why" is more useful to a farmer than a silently shorter list.
 */
export function selectSchemes(schemes: Scheme[], filters: SchemeFilters): SelectedScheme[] {
  const landAcres = filters.landAcres;
  const profile = landAcres === null ? null : buildProfile(filters, landAcres);

  let entries: SelectedScheme[] = schemes
    .filter(
      (scheme) => filters.categories.length === 0 || filters.categories.includes(scheme.category)
    )
    .map((scheme) => ({
      scheme,
      match: profile === null ? null : scoreScheme(profile, scheme),
    }));

  if (filters.eligibleOnly && profile !== null) {
    entries = entries.filter((entry) => entry.match?.status === "eligible");
  }

  return sortEntries(entries, filters.sort, profile !== null);
}

function sortEntries(
  entries: SelectedScheme[],
  sort: SchemeSort,
  scored: boolean
): SelectedScheme[] {
  const byName = (a: SelectedScheme, b: SelectedScheme): number =>
    a.scheme.name.localeCompare(b.scheme.name);

  if (sort === "name") {
    return [...entries].sort(byName);
  }
  if (sort === "benefit") {
    return [...entries].sort(
      (a, b) => (b.scheme.benefitValueINR ?? 0) - (a.scheme.benefitValueINR ?? 0) || byName(a, b)
    );
  }
  // "match" — with no profile there is nothing to rank on, so fall back to the
  // directory order: central schemes first, then alphabetical.
  if (!scored) {
    return [...entries].sort((a, b) => {
      if (a.scheme.authority !== b.scheme.authority) {
        return a.scheme.authority === "central" ? -1 : 1;
      }
      return byName(a, b);
    });
  }
  return [...entries].sort(
    (a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0) || byName(a, b)
  );
}
