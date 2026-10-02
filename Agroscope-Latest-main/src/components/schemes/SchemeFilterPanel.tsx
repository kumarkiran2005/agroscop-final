/**
 * Filter controls for the schemes page. Purely presentational: it renders
 * `filters` and reports edits through `onChange`. All selection logic lives in
 * src/lib/schemeFilters.ts.
 */
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SCHEME_CROPS, SCHEME_STATES } from "@/data/schemes";
import { getFarmerCategory } from "@/lib/eligibility";
import { DEFAULT_SCHEME_FILTERS } from "@/lib/schemeFilters";
import type { SchemeFilters, SchemeSort } from "@/lib/schemeFilters";
import type { FarmerCategory, IrrigationType, SchemeCategory } from "@/types/scheme";

const LAND_MIN = 0.5;
const LAND_MAX = 100;
const LAND_STEP = 0.5;

const CATEGORY_OPTIONS: { value: SchemeCategory; label: string }[] = [
  { value: "income-support", label: "Income support" },
  { value: "insurance", label: "Insurance" },
  { value: "solar", label: "Solar" },
  { value: "machinery", label: "Machinery" },
  { value: "irrigation", label: "Irrigation" },
  { value: "seed", label: "Seed" },
  { value: "fertilizer", label: "Fertiliser" },
  { value: "credit", label: "Credit" },
  { value: "livestock", label: "Livestock" },
  { value: "horticulture", label: "Horticulture" },
  { value: "organic", label: "Organic" },
  { value: "other", label: "Other" },
];

const CATEGORY_BAND_OPTIONS: { value: FarmerCategory | "auto"; label: string }[] = [
  { value: "auto", label: "Match my land size" },
  { value: "marginal", label: "Marginal (under 2.5 ac)" },
  { value: "small", label: "Small (2.5–5 ac)" },
  { value: "semi-medium", label: "Semi-medium (5–10 ac)" },
  { value: "medium", label: "Medium (10–25 ac)" },
  { value: "large", label: "Large (over 25 ac)" },
];

const IRRIGATION_OPTIONS: { value: IrrigationType | "any"; label: string }[] = [
  { value: "any", label: "Any / not sure" },
  { value: "borewell", label: "Borewell" },
  { value: "canal", label: "Canal" },
  { value: "rainfed", label: "Rainfed" },
  { value: "drip", label: "Drip" },
];

const SORT_OPTIONS: { value: SchemeSort; label: string }[] = [
  { value: "match", label: "Match score" },
  { value: "benefit", label: "Benefit value" },
  { value: "name", label: "Name (A–Z)" },
];

type SchemeFilterPanelProps = {
  filters: SchemeFilters;
  onChange: (next: SchemeFilters) => void;
  /** Count of currently visible schemes, shown so the effect of a change is legible. */
  resultCount: number;
};

export default function SchemeFilterPanel({
  filters,
  onChange,
  resultCount,
}: SchemeFilterPanelProps) {
  const set = <K extends keyof SchemeFilters>(key: K, value: SchemeFilters[K]): void => {
    onChange({ ...filters, [key]: value });
  };

  const landValue = filters.landAcres ?? LAND_MIN;
  const profileActive = filters.landAcres !== null;
  const derivedBand = getFarmerCategory(landValue);

  const toggleCategory = (value: SchemeCategory): void => {
    const next = filters.categories.includes(value)
      ? filters.categories.filter((c) => c !== value)
      : [...filters.categories, value];
    set("categories", next);
  };

  /** Empty or unparseable input clears the profile rather than snapping to 0.5. */
  const handleLandInput = (raw: string): void => {
    if (raw.trim() === "") {
      set("landAcres", null);
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    set("landAcres", Math.min(LAND_MAX, Math.max(LAND_MIN, parsed)));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="mark text-muted-foreground">
          {resultCount} scheme{resultCount === 1 ? "" : "s"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onChange(DEFAULT_SCHEME_FILTERS)}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </Button>
      </div>

      {/* Land size — the primary control. */}
      <fieldset className="space-y-3">
        <legend className="mark mb-2 text-foreground">Land size</legend>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            inputMode="decimal"
            min={LAND_MIN}
            max={LAND_MAX}
            step={LAND_STEP}
            value={filters.landAcres ?? ""}
            placeholder="All"
            aria-label="Land size in acres"
            className="tabular h-10 w-24"
            onChange={(event) => handleLandInput(event.target.value)}
          />
          <span className="text-sm text-muted-foreground">acres</span>
        </div>
        <Slider
          value={[landValue]}
          min={LAND_MIN}
          max={LAND_MAX}
          step={LAND_STEP}
          aria-label="Land size in acres"
          onValueChange={(value) => {
            const next = value[0];
            if (next !== undefined) set("landAcres", next);
          }}
        />
        <p className="text-xs text-muted-foreground">
          {profileActive ? (
            <>
              Scoring against <span className="tabular">{landValue}</span> acres ·{" "}
              {derivedBand.replace("-", " ")} holding
            </>
          ) : (
            "Set a size to see your eligibility score"
          )}
        </p>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="scheme-state">State</Label>
        <Select value={filters.state} onValueChange={(value) => set("state", value)}>
          <SelectTrigger id="scheme-state" className="h-10">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">All states</SelectItem>
            {SCHEME_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheme-crop">Main crop</Label>
        <Select value={filters.crop} onValueChange={(value) => set("crop", value)}>
          <SelectTrigger id="scheme-crop" className="h-10">
            <SelectValue placeholder="Any crop" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="any">Any crop</SelectItem>
            {SCHEME_CROPS.map((crop) => (
              <SelectItem key={crop} value={crop}>
                {crop.charAt(0).toUpperCase() + crop.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheme-band">Farmer category</Label>
        <Select
          value={filters.farmerCategory}
          onValueChange={(value) => set("farmerCategory", value as FarmerCategory | "auto")}
        >
          <SelectTrigger id="scheme-band" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_BAND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheme-irrigation">Irrigation</Label>
        <Select
          value={filters.irrigation}
          onValueChange={(value) => set("irrigation", value as IrrigationType | "any")}
        >
          <SelectTrigger id="scheme-irrigation" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IRRIGATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset>
        <legend className="mark mb-2 text-foreground">Benefit type</legend>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_OPTIONS.map((option) => {
            const active = filters.categories.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleCategory(option.value)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mark mb-2 text-foreground">My farm</legend>
        <ToggleRow
          id="scheme-electricity"
          label="Electricity connection"
          checked={filters.hasElectricity}
          onCheckedChange={(checked) => set("hasElectricity", checked)}
        />
        <ToggleRow
          id="scheme-solar"
          label="Already have a solar pump"
          checked={filters.hasSolarPump}
          onCheckedChange={(checked) => set("hasSolarPump", checked)}
        />
        <ToggleRow
          id="scheme-tractor"
          label="Already have a tractor"
          checked={filters.hasTractor}
          onCheckedChange={(checked) => set("hasTractor", checked)}
        />
      </fieldset>

      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
        <ToggleRow
          id="scheme-eligible-only"
          label="Only schemes I'm eligible for"
          checked={filters.eligibleOnly}
          disabled={!profileActive}
          onCheckedChange={(checked) => set("eligibleOnly", checked)}
        />
        {!profileActive && (
          <p className="text-xs text-muted-foreground">Set a land size to use this filter.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheme-sort">Sort by</Label>
        <Select value={filters.sort} onValueChange={(value) => set("sort", value as SchemeSort)}>
          <SelectTrigger id="scheme-sort" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

type ToggleRowProps = {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function ToggleRow({ id, label, checked, disabled = false, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className={`text-sm font-normal ${disabled ? "opacity-60" : ""}`}>
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
