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
