import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/context/TranslationContext";
import GlobalLanguageSelector from "@/components/GlobalLanguageSelector";
import {
  ArrowLeft,
  Leaf,
  TrendingUp,
  Loader2,
  MapPin,
  Wheat,
  ChevronDown,
  Check,
  BarChart3,
} from "lucide-react";
import { getForecastNext30Days } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  Line,
  ComposedChart,
  ReferenceDot,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { buildForecastSeries, DRIVER_LABEL } from "@/lib/forecastNarrative";
import type { DriverKind } from "@/lib/forecastNarrative";
import SupplyCalendar from "@/components/SupplyCalendar";
import type { CalendarCell } from "@/components/SupplyCalendar";

const AVAILABLE_CITIES = [
  { name: "Chennai", state: "Tamil Nadu", hub: "Chennai Port Cold Chain Facility" },
  { name: "Mumbai", state: "Maharashtra", hub: "Mumbai APMC Vashi Cold Hub" },
  { name: "Delhi", state: "Delhi NCR", hub: "Delhi Azadpur Cold Chain Terminal" },
  { name: "Bengaluru", state: "Karnataka", hub: "Bengaluru APMC Yeshwanthpur Cold Hub" },
  { name: "Hyderabad", state: "Telangana", hub: "Hyderabad Bowenpally Cold Chain" },
  { name: "Kolkata", state: "West Bengal", hub: "Kolkata Hooghly Cold Chain Terminal" },
  { name: "Pune", state: "Maharashtra", hub: "Pune Agri Logistics Cold Hub" },
  { name: "Ahmedabad", state: "Gujarat", hub: "Ahmedabad Sabarmati Agri Cold Chain" },
  { name: "Jaipur", state: "Rajasthan", hub: "Jaipur Muhana Mandi Cold Storage" },
  { name: "Surat", state: "Gujarat", hub: "Surat Diamond & Agri Cold Hub" },
] as const;

const CROPS = [
  { key: "paddy_husk", label: "Paddy Husk", icon: "🌾", color: "#22c55e" },
  { key: "wheat_straw", label: "Wheat Straw", icon: "🌿", color: "#d4a843" },
  { key: "corn_stalks", label: "Corn Stalks", icon: "🌽", color: "#fb923c" },
  { key: "sugarcane_bagasse", label: "Sugarcane Bagasse", icon: "🎋", color: "#86c35e" },
  { key: "coconut_shells", label: "Coconut Shells", icon: "🥥", color: "#7dd3fc" },
] as const;

type CropKey = (typeof CROPS)[number]["key"];

/** Sentinel for the combined view. Never sent to the API as a wasteType. */
const ALL_CROPS = "all_crops" as const;
type CropSelection = CropKey | typeof ALL_CROPS;

/* ── Terminal chrome ──────────────────────────────────────────────────── */

/** Movement colours. Green up / red down is the convention traders read. */
const POS = "hsl(var(--primary))";
const NEG = "hsl(var(--destructive))";

const DRIVER_TONE: Record<DriverKind, string> = {
  harvest: "hsl(var(--primary))",
  weather: "hsl(var(--chart-3))",
  logistics: "hsl(var(--accent))",
  demand: "hsl(var(--primary))",
  closure: "hsl(var(--destructive))",
};

/**
 * Headline 30-day tonnage per grade, mirroring the values
 * server/services/forecastService.js serves. Kept here so the ticker can
 * show all five grades without firing five requests; the selected grade's
 * chart still reconciles against the live response.
 */
const GRADE_TONS: Record<CropKey, number> = {
  paddy_husk: 5.5,
  wheat_straw: 4.2,
  corn_stalks: 3.8,
  sugarcane_bagasse: 8.9,
  coconut_shells: 2.6,
};

const GRADE_CODE: Record<CropKey, string> = {
  paddy_husk: "PH",
  wheat_straw: "WS",
  corn_stalks: "CS",
  sugarcane_bagasse: "SB",
  coconut_shells: "CH",
};

interface TooltipPayloadEntry {
  payload: {
    day: number;
    predicted: number;
    ma7: number | null;
    driver: string | null;
    driverKind: DriverKind | null;
    changePct: number;
  };
}

/**
 * Hover card. The point of this chart is that every move has a cause, so
 * the tooltip leads with the reading and then names the driver when the
 * day has one — this is what makes a bump interpretable rather than noise.
 */
function DriverTooltip({
  active,
  payload,
  accent,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  accent: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const up = p.changePct >= 0;

  return (
    <div className="max-w-[280px] rounded-[var(--radius)] border border-border bg-popover shadow-md">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-3 py-2">
        <span className="mark text-muted-foreground">Day {String(p.day).padStart(2, "0")}</span>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: up ? POS : NEG }}>
          {up ? "▲" : "▼"}
          {Math.abs(p.changePct).toFixed(1)}%
          <span className="ml-1 text-muted-foreground">vs trend</span>
        </span>
      </div>

      <div className="px-3 py-2">
        <p className="font-mono text-[17px] font-medium tabular-nums leading-none" style={{ color: accent }}>
          {p.predicted.toLocaleString("en-IN")}
          <span className="ml-1 text-[11px] text-muted-foreground">kg</span>
        </p>
        {p.ma7 != null && (
          <p className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
            7-day avg {p.ma7.toLocaleString("en-IN")} kg
          </p>
        )}
      </div>

      {p.driver && p.driverKind && (
        <div className="border-t border-border px-3 py-2">
          <span
            className="mark mb-1 inline-block rounded-[3px] border px-1.5 py-0.5"
            style={{ borderColor: DRIVER_TONE[p.driverKind], color: DRIVER_TONE[p.driverKind] }}
          >
            {DRIVER_LABEL[p.driverKind]}
          </span>
          <p className="text-[12px] leading-snug text-foreground">{p.driver}</p>
        </div>
      )}
    </div>
  );
}

export default function Forecast() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { earn } = useWallet();
  const [searchParams] = useSearchParams();
  const cityParam = searchParams.get("city") || "Chennai";
  const wasteTypeParam = searchParams.get("wasteType") || "paddy_husk";

  const [selectedCity, setSelectedCity] = useState<typeof AVAILABLE_CITIES[number]>(() => {
    const found = AVAILABLE_CITIES.find((c) => c.name === cityParam);
    return found ?? AVAILABLE_CITIES[0];
  });
  const [selectedCrop, setSelectedCrop] = useState<CropSelection>(() => {
    if (wasteTypeParam === ALL_CROPS) return ALL_CROPS;
    const valid = CROPS.some((c) => c.key === wasteTypeParam);
    return (valid ? wasteTypeParam : "paddy_husk") as CropKey;
  });
  const [viewMode, setViewMode] = useState<"chart" | "calendar">("chart");
  /**
   * Headline 30-day totals per grade, only fetched for the combined view.
   * The API's kg figure is not simply tons × 1000, so the combined view
   * asks the API for every grade rather than deriving totals locally —
   * otherwise the combined numbers would silently disagree with what the
   * single-grade view shows for the same city.
   */
  const [gradeTotals, setGradeTotals] = useState<Partial<Record<CropKey, { kg: number; conf: number }>>>({});
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cropDropdownOpen, setCropDropdownOpen] = useState(false);
  const cityDropdownRef = useRef<HTMLDivElement | null>(null);
  const cropDropdownRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof getForecastNext30Days>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialParamsSynced = useRef(false);

  const city = selectedCity.name;
  const isAllCrops = selectedCrop === ALL_CROPS;
  /**
   * The chart plots a single grade, so the combined view is calendar-only.
   * Derived rather than pushed into state via an effect: arriving on
   * ?wasteType=all_crops left viewMode at its "chart" default while the
   * Chart tab was disabled, so neither view rendered and the panel came up
   * blank. Deriving it makes that state unrepresentable.
   */
  const effectiveView = isAllCrops ? "calendar" : viewMode;
  // Never send the sentinel to the API.
  const wasteType = isAllCrops ? "paddy_husk" : selectedCrop;

  useEffect(() => {
    if (!initialParamsSynced.current) {
      initialParamsSynced.current = true;
      const c = AVAILABLE_CITIES.find((x) => x.name === cityParam);
      if (c) setSelectedCity(c);
      if (wasteTypeParam === ALL_CROPS) setSelectedCrop(ALL_CROPS);
      else if (CROPS.some((x) => x.key === wasteTypeParam)) setSelectedCrop(wasteTypeParam as CropKey);
    }
  }, [cityParam, wasteTypeParam]);

  /**
   * Combined view: fetch every grade's headline total for this city so the
   * leader-per-day comparison uses the same figures the single-grade view
   * would show. Runs only while the combined view is selected.
   */
  useEffect(() => {
    if (!isAllCrops) return;
    let cancelled = false;
    Promise.all(
      CROPS.map((c) =>
        getForecastNext30Days({ city, wasteType: c.key })
          .then(
            (r) =>
              [c.key, { kg: r.predictedQuantityKg ?? 0, conf: r.confidenceLevel ?? 0 }] as const
          )
          .catch(() => [c.key, { kg: 0, conf: 0 }] as const)
      )
    ).then((pairs) => {
      if (!cancelled) setGradeTotals(Object.fromEntries(pairs) as Record<CropKey, { kg: number; conf: number }>);
    });
    return () => {
      cancelled = true;
    };
  }, [isAllCrops, city]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getForecastNext30Days({ city, wasteType })
      .then((res) => {
        setData(res);
        const today = new Date().toDateString();
        if (sessionStorage.getItem("forecast_earned_today") !== today) {
          earn("FORECAST_VIEW").then(() => sessionStorage.setItem("forecast_earned_today", today)).catch(() => {});
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load forecast");
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [city, wasteType]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(e.target as Node)) setCityDropdownOpen(false);
      if (cropDropdownRef.current && !cropDropdownRef.current.contains(e.target as Node)) setCropDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedCropMeta = isAllCrops
    ? { key: ALL_CROPS, label: "All crops combined", icon: "▦", color: "#1F5140" }
    : CROPS.find((c) => c.key === selectedCrop) ?? CROPS[0];
  const trendUpper = (data?.trend ?? "stable").toUpperCase();
  const trendColor =
    trendUpper === "RISING" ? "#22c55e" : trendUpper === "FALLING" ? "#f97373" : trendUpper === "VOLATILE" ? "#f59e0b" : "#93c5fd";
  const cropAccentColor = selectedCropMeta.color;

  /**
   * The endpoint returns a headline 30-day total but no daily detail and no
   * explanation of movement. buildForecastSeries models the daily curve from
   * that total — deterministically, so it never reshuffles between renders —
   * and attaches the physical cause behind each move. Labelled as modelled
   * wherever it is rendered.
   */
  const series = useMemo(() => {
    // Reconcile against predictedQuantityKg — the same field the headline
    // stat renders — so the daily curve always sums to the number shown
    // directly above it and the two can never disagree.
    // Never build a single-grade series for the combined view: the sentinel
    // would be used as the seed and the KPI row would report a curve that
    // belongs to no actual grade.
    if (isAllCrops) return null;
    const totalKg = data?.predictedQuantityKg ?? 0;
    if (totalKg <= 0) return null;
    return buildForecastSeries(selectedCrop, selectedCity.name, totalKg);
  }, [data?.predictedQuantityKg, selectedCrop, selectedCity.name, isAllCrops]);

  /**
   * All five grades for the ticker. Each is built from the same deterministic
   * model as the main chart, so the percentage a grade shows here is the same
   * one you'd see after selecting it — the ticker cannot disagree with the
   * chart it links to.
   */
  const tickerRows = useMemo(
    () =>
      CROPS.map((c) => {
        const tons = GRADE_TONS[c.key];
        const s = buildForecastSeries(c.key, selectedCity.name, tons * 1000);
        // Week-over-week momentum, not the last day's change: day 30 often
        // lands on a mandi closure, which would report every grade as
        // collapsing when it is simply a weekly holiday.
        return { key: c.key, code: GRADE_CODE[c.key], label: c.label, tons, delta: s.momentumPct };
      }),
    [selectedCity.name]
  );

  /** One series per grade, for the combined view. */
  const allGradeSeries = useMemo(() => {
    if (!isAllCrops) return null;
    const built = CROPS.map((c) => {
      const total = gradeTotals[c.key]?.kg ?? 0;
      return total > 0 ? { crop: c, series: buildForecastSeries(c.key, selectedCity.name, total) } : null;
    }).filter((x): x is { crop: (typeof CROPS)[number]; series: ReturnType<typeof buildForecastSeries> } => x !== null);
    return built.length ? built : null;
  }, [isAllCrops, gradeTotals, selectedCity.name]);

  /**
   * Day 1 is today, so the calendar aligns to real weekdays. Computed once
   * per mount — reading new Date() during render would let the grid shift
   * mid-session if it straddled midnight.
   */
  const startDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const dateForDay = (day: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + (day - 1));
    return d;
  };

  /**
   * Calendar cells. Single-grade mode shows that grade's own daily supply;
   * combined mode shows whichever grade led that day, which is the whole
   * point of the combined view — where demand concentrates, by date.
   */
  const calendarCells: CalendarCell[] = useMemo(() => {
    if (isAllCrops) {
      if (!allGradeSeries) return [];
      return Array.from({ length: 30 }, (_, i) => {
        // Rank every grade for the day, so the hover card can show the
        // comparison the leader is drawn from rather than just the winner.
        const ranked = allGradeSeries
          .map((g) => ({
            code: GRADE_CODE[g.crop.key],
            label: g.crop.label,
            color: g.crop.color,
            kg: g.series.days[i].predictedKg,
            driver: g.series.days[i].driver,
            driverKind: g.series.days[i].driverKind,
          }))
          .sort((a, b) => b.kg - a.kg);
        const top = ranked[0];
        return {
          day: i + 1,
          date: dateForDay(i + 1),
          kg: top.kg,
          code: top.code,
          label: top.label,
          color: top.color,
          breakdown: ranked.map(({ code, label, color, kg }) => ({ code, label, color, kg })),
          driver: top.driver,
          driverKind: top.driverKind,
        };
      });
    }
    if (!series) return [];
    return series.days.map((d) => ({
      day: d.day,
      date: dateForDay(d.day),
      kg: d.predictedKg,
      driver: d.driver,
      driverKind: d.driverKind,
    }));
    // dateForDay is derived from startDate, which is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllCrops, allGradeSeries, series, startDate]);

  /** Combined 30-day total across all grades, for the headline card. */
  const combinedTotalKg = useMemo(
    () => CROPS.reduce((sum, c) => sum + (gradeTotals[c.key]?.kg ?? 0), 0),
    [gradeTotals]
  );

  /**
   * Supply-weighted mean confidence. A plain average would let a tiny grade
   * with a shaky forecast drag down a number that mostly describes the big
   * ones, so each grade counts in proportion to the volume it contributes.
   */
  const combinedConfidencePercent = useMemo(() => {
    const totalKg = combinedTotalKg;
    if (!totalKg) return 0;
    const weighted = CROPS.reduce((sum, c) => {
      const g = gradeTotals[c.key];
      return g ? sum + g.conf * g.kg : sum;
    }, 0);
    return Math.round((weighted / totalKg) * 100);
  }, [gradeTotals, combinedTotalKg]);

  /** Days each grade led, for the combined view's summary table. */
  const leaderTally = useMemo(() => {
    if (!isAllCrops || !calendarCells.length) return [];
    const counts = new Map<string, { label: string; color: string; days: number; kg: number }>();
    for (const c of calendarCells) {
      if (!c.code) continue;
      const e = counts.get(c.code) ?? { label: c.label ?? c.code, color: c.color ?? "#888", days: 0, kg: 0 };
      e.days += 1;
      e.kg += c.kg;
      counts.set(c.code, e);
    }
    return [...counts.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.days - a.days);
  }, [isAllCrops, calendarCells]);

  const chartData = (series?.days ?? []).map((d) => ({
    day: d.day,
    date: `Day ${d.day}`,
    predicted: d.predictedKg,
    ma7: d.ma7,
    driver: d.driver,
    driverKind: d.driverKind,
    changePct: d.changePct,
  }));

  const confidencePercent =
    data?.confidenceLevel != null
      ? typeof data.confidenceLevel === "number" && data.confidenceLevel <= 1
        ? Math.round(data.confidenceLevel * 100)
        : Math.round(Number(data.confidenceLevel) || 0)
      : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="border-b bg-card/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4 max-w-5xl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <button onClick={() => navigate("/home")} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="bg-primary rounded-full p-2 shadow-sm">
                <Leaf className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-semibold tracking-wide">AgroScope</span>
            </button>
          </div>
          <GlobalLanguageSelector />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1 text-[10px] font-medium text-emerald-700 shadow-sm">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="tracking-[0.18em] uppercase">Forecast engine · Active</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
            {t("forecast_title")}
          </h1>
          <p className="text-sm md:text-[15px] text-muted-foreground max-w-xl">
            {t("forecast_subtitle")}
          </p>
        </div>

        {/* City + Crop selectors */}
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-emerald-800">
              <MapPin className="h-4 w-4 text-emerald-500" />
              Forecast city
            </p>
            <div ref={cityDropdownRef} className="relative">
              <div
                onClick={() => setCityDropdownOpen((prev) => !prev)}
                className="cursor-pointer select-none rounded-xl border border-emerald-100 bg-card px-4 py-3 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[18px] font-semibold text-foreground">{selectedCity.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{selectedCity.hub}</div>
                  </div>
                  <ChevronDown size={16} className={`text-emerald-600 transition-transform duration-200 ${cityDropdownOpen ? "rotate-180" : ""}`} />
                </div>
              </div>
              <AnimatePresence>
                {cityDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="absolute top-full left-0 right-0 mt-2 z-50 overflow-hidden rounded-xl border border-emerald-100 bg-card shadow-lg"
                  >
                    {AVAILABLE_CITIES.map((c) => (
                      <div
                        key={c.name}
                        onClick={() => {
                          setSelectedCity(c);
                          setCityDropdownOpen(false);
                        }}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer border-l-4 transition-colors ${
                          selectedCity.name === c.name ? "bg-emerald-500/10 dark:bg-emerald-500/20" : "bg-card hover:bg-muted/50"
                        }`}
                        style={{
                          borderColor: selectedCity.name === c.name ? "#22c55e" : "transparent",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {selectedCity.name === c.name ? <Check size={14} className="text-emerald-500" /> : <span className="w-[14px]" />}
                          <span className="text-sm font-medium text-foreground">{c.name}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{c.state}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-emerald-800">
              <Wheat className="h-4 w-4 text-emerald-500" />
              Crop residue
            </p>
            <div ref={cropDropdownRef} className="relative">
              <div
                onClick={() => setCropDropdownOpen((prev) => !prev)}
                className="cursor-pointer select-none rounded-xl border border-emerald-100 bg-card px-4 py-3 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[18px] font-semibold text-foreground flex items-center gap-1.5">
                      <span>{selectedCropMeta.icon}</span>
                      <span>{selectedCropMeta.label}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {/* Was showing data.wasteTypeLabel unconditionally, which
                          read "Paddy Husk" under "All crops combined" because
                          the combined view falls back to that key for the API
                          call it does not otherwise use. */}
                      {isAllCrops ? `${CROPS.length} grades · leader per day` : data?.wasteTypeLabel ?? selectedCropMeta.label}
                    </div>
                  </div>
                  <ChevronDown size={16} className={`text-emerald-600 transition-transform duration-200 ${cropDropdownOpen ? "rotate-180" : ""}`} />
                </div>
              </div>
              <AnimatePresence>
                {cropDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="absolute top-full left-0 right-0 mt-2 z-50 overflow-hidden rounded-xl border border-emerald-100 bg-card shadow-lg"
                  >
                    {/* Combined view. Sits above the individual grades and is
                        ruled off, because it answers a different question:
                        not "how much of this grade", but "which grade leads,
                        and when". */}
                    <div
                      onClick={() => {
                        setSelectedCrop(ALL_CROPS);
                        setViewMode("calendar");
                        setCropDropdownOpen(false);
                      }}
                      className={`flex items-center justify-between border-b border-border px-4 py-2.5 cursor-pointer transition-colors ${
                        isAllCrops ? "bg-emerald-500/10 dark:bg-emerald-500/20" : "bg-card hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isAllCrops ? <Check size={14} className="text-emerald-500" /> : <span className="w-[14px]" />}
                        <span className="text-base leading-none">▦</span>
                        <span className="text-sm font-medium text-foreground">All crops combined</span>
                      </div>
                      <span className="mark text-muted-foreground">Leader / day</span>
                    </div>

                    {CROPS.map((crop) => (
                      <div
                        key={crop.key}
                        onClick={() => {
                          setSelectedCrop(crop.key);
                          setCropDropdownOpen(false);
                        }}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer border-l-4 transition-colors ${
                          selectedCrop === crop.key ? "bg-emerald-500/10 dark:bg-emerald-500/20" : "bg-card hover:bg-muted/50"
                        }`}
                        style={{
                          borderColor: selectedCrop === crop.key ? "#22c55e" : "transparent",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {selectedCrop === crop.key ? <Check size={14} className="text-emerald-500" /> : <span className="w-[14px]" />}
                          <span className="text-base">{crop.icon}</span>
                          <span className="text-sm font-medium text-foreground">{crop.label}</span>
                        </div>
                        <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: crop.color }} />
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="my-6 h-px bg-gradient-to-r from-transparent via-emerald-200 to-transparent" />

        {loading && (
          <Card className="p-8 md:p-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
              <p className="text-sm text-muted-foreground">Loading forecast…</p>
            </div>
          </Card>
        )}

        {error && !loading && (
          <Card className="p-6 border-destructive bg-red-50/80">
            <p className="text-destructive">{error}</p>
            <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </Card>
        )}

        {!loading && !error && data && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-4 md:grid-cols-3 mb-8"
            >
              <Card className="border border-emerald-100/70 bg-card shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[11px] tracking-[0.16em] uppercase text-emerald-700">
                    Predicted (30 days)
                  </CardDescription>
                  <CardTitle className="mt-1 text-[26px] font-semibold text-emerald-700">
                    {(isAllCrops ? combinedTotalKg : data.predictedQuantityKg ?? 0).toLocaleString("en-IN")}{" "}
                    <span className="text-sm text-muted-foreground font-normal">kg</span>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="border border-amber-100 bg-card shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[11px] tracking-[0.16em] uppercase text-amber-700">
                    {isAllCrops ? "Confidence · weighted" : "Confidence"}
                  </CardDescription>
                  <CardTitle className="mt-1 text-[26px] font-semibold text-amber-700">
                    {isAllCrops ? combinedConfidencePercent : confidencePercent}
                    <span className="text-sm text-muted-foreground font-normal ml-1">%</span>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="border border-slate-200 bg-card shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[11px] tracking-[0.16em] uppercase text-slate-600">
                    {/* A single trend direction is meaningless across five
                        grades moving independently, so the combined view
                        reports which grade leads most days instead. */}
                    {isAllCrops ? "Leads most days" : "Trend"}
                  </CardDescription>
                  {isAllCrops ? (
                    <CardTitle className="mt-1 flex items-center gap-2 text-[22px] font-semibold text-foreground">
                      {leaderTally[0] && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: leaderTally[0].color }}
                        />
                      )}
                      <span className="truncate">{leaderTally[0]?.label ?? "—"}</span>
                      {leaderTally[0] && (
                        <span className="font-mono text-sm font-normal text-muted-foreground">
                          {leaderTally[0].days}d
                        </span>
                      )}
                    </CardTitle>
                  ) : (
                    <CardTitle className="mt-1 flex items-center gap-2 text-[22px] font-semibold" style={{ color: trendColor }}>
                      <TrendingUp className="h-5 w-5" />
                      {trendUpper}
                    </CardTitle>
                  )}
                </CardHeader>
              </Card>
            </motion.div>

            {((series && chartData.length > 0) || (isAllCrops && calendarCells.length > 0)) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                <Card className="overflow-hidden border-border shadow-sm">
                  {/* ── Terminal header ─────────────────────────────── */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-secondary/50 px-4 py-3">
                    <div className="flex items-baseline gap-3">
                      <h2 className="font-display text-[15px] font-bold tracking-tight text-foreground">
                        Supply terminal
                      </h2>
                      <span className="mark text-muted-foreground">
                        {selectedCropMeta.label} · 30-day window
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="mark hidden text-muted-foreground sm:inline">{selectedCity.hub}</span>
                      {/* Chart / Calendar toggle. Segmented rather than a
                          dropdown: two options, both always available, and
                          the current one should be readable at a glance. */}
                      <div
                        role="tablist"
                        aria-label="Supply view"
                        className="flex overflow-hidden rounded-[var(--radius)] border border-border"
                      >
                        {(["chart", "calendar"] as const).map((m) => {
                          const active = effectiveView === m;
                          // The chart plots one grade; the combined view has
                          // five, so it is calendar-only.
                          const disabled = m === "chart" && isAllCrops;
                          return (
                            <button
                              key={m}
                              role="tab"
                              aria-selected={active}
                              disabled={disabled}
                              title={disabled ? "Select a single grade to see the chart" : undefined}
                              onClick={() => setViewMode(m)}
                              className={`mark px-2.5 py-1.5 transition-colors ${
                                active
                                  ? "bg-primary text-primary-foreground"
                                  : disabled
                                  ? "cursor-not-allowed bg-card text-muted-foreground/40"
                                  : "bg-card text-muted-foreground hover:bg-secondary"
                              }`}
                            >
                              {m === "chart" ? "Chart" : "Calendar"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── Ticker: every grade at a glance ──────────────── */}
                  <div className="flex gap-x-6 gap-y-1 overflow-x-auto border-b border-border px-4 py-2.5">
                    {tickerRows.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setSelectedCrop(t.key)}
                        title={`Show ${t.label}`}
                        className={`flex shrink-0 items-baseline gap-1.5 font-mono text-[11px] tracking-[0.08em] transition-opacity hover:opacity-100 ${
                          t.key === selectedCrop ? "opacity-100" : "opacity-55"
                        }`}
                      >
                        <span className="font-semibold uppercase text-muted-foreground">{t.code}</span>
                        <span className="tabular-nums font-medium text-foreground">{t.tons.toFixed(2)}t</span>
                        <span
                          className="tabular-nums"
                          style={{ color: t.delta >= 0 ? POS : NEG }}
                        >
                          {t.delta >= 0 ? "▲" : "▼"}
                          {Math.abs(t.delta).toFixed(1)}%
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* ── KPI row. Single-grade only: peak, mean and
                         volatility describe one series, and averaging them
                         across five grades would report a number that is
                         true of none of them. ─────────────────────────── */}
                  {series && (
                  <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
                    {[
                      {
                        label: "Peak day",
                        value: `${(series.peak.predictedKg / 1000).toFixed(1)}k`,
                        unit: "kg",
                        sub: `Day ${series.peak.day}`,
                      },
                      {
                        label: "Daily mean",
                        value: `${(series.meanKg / 1000).toFixed(1)}k`,
                        unit: "kg",
                        sub: "per day",
                      },
                      {
                        label: "30-day range",
                        value: `${(series.trough.predictedKg / 1000).toFixed(1)}–${(series.peak.predictedKg / 1000).toFixed(1)}k`,
                        unit: "",
                        sub: "low – high",
                      },
                      {
                        label: "Volatility",
                        value: series.volatilityLabel,
                        unit: "",
                        sub: `σ ${series.volatilityPct.toFixed(1)}%`,
                        tone:
                          series.volatilityLabel === "High"
                            ? "hsl(var(--accent))"
                            : series.volatilityLabel === "Moderate"
                            ? "hsl(var(--foreground))"
                            : "hsl(var(--primary))",
                      },
                    ].map((kpi) => (
                      <div key={kpi.label} className="bg-card px-4 py-3">
                        <p className="mark text-muted-foreground">{kpi.label}</p>
                        <p
                          className="mt-1.5 font-mono text-[19px] font-medium tabular-nums leading-none"
                          style={{ color: kpi.tone ?? "hsl(var(--foreground))" }}
                        >
                          {kpi.value}
                          {kpi.unit && (
                            <span className="ml-0.5 text-[11px] text-muted-foreground">{kpi.unit}</span>
                          )}
                        </p>
                        <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
                          {kpi.sub}
                        </p>
                      </div>
                    ))}
                  </div>
                  )}

                  <CardContent className="pt-4">
                    {effectiveView === "calendar" && (
                      <>
                        <SupplyCalendar
                          cells={calendarCells}
                          mode={isAllCrops ? "leader" : "single"}
                          accent={cropAccentColor}
                        />

                        {/* Combined view: who led, and for how many days. */}
                        {isAllCrops && leaderTally.length > 0 && (
                          <div className="mt-5">
                            <p className="mark mb-2 text-muted-foreground">Days led · 30-day window</p>
                            <div className="overflow-hidden rounded-[var(--radius)] border border-border">
                              <table className="w-full border-collapse">
                                <thead>
                                  <tr className="border-b border-border bg-secondary/50">
                                    <th className="mark px-3 py-2 text-left font-medium text-muted-foreground">Grade</th>
                                    <th className="mark px-3 py-2 text-right font-medium text-muted-foreground">Days led</th>
                                    <th className="mark px-3 py-2 text-right font-medium text-muted-foreground">
                                      Supply on those days
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {leaderTally.map((l) => (
                                    <tr key={l.code} className="border-b border-border/70 last:border-0">
                                      <td className="px-3 py-2">
                                        <span className="flex items-center gap-2">
                                          <span
                                            className="h-[9px] w-[9px] shrink-0 rounded-[2px]"
                                            style={{ backgroundColor: l.color }}
                                          />
                                          <span className="text-[13px] text-foreground">{l.label}</span>
                                          <span className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground">
                                            {l.code}
                                          </span>
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-foreground">
                                        {l.days}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                                        {(l.kg / 1000).toFixed(1)}k kg
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        <p className="mark mt-3 text-muted-foreground">
                          {isAllCrops
                            ? "Modelled daily distribution · each cell names the grade with the highest supply that day"
                            : "Modelled daily distribution · reconciles to the 30-day total above"}{" "}
                          · not a firm offer
                        </p>
                      </>
                    )}

                    {effectiveView === "chart" && series && (
                      <>
                    {/* ── Legend ────────────────────────────────────── */}
                    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                      <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span className="h-[2px] w-5" style={{ background: cropAccentColor }} />
                        Daily supply (kg)
                      </span>
                      <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span
                          className="h-0 w-5 border-t border-dashed"
                          style={{ borderColor: "hsl(var(--muted-foreground))" }}
                        />
                        7-day moving average
                      </span>
                      <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span
                          className="h-[7px] w-[7px] rounded-full ring-2 ring-background"
                          style={{ background: "hsl(var(--accent))" }}
                        />
                        Driver — hover for cause
                      </span>
                    </div>

                    <div className="h-[320px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="supplyFillF" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={cropAccentColor} stopOpacity={0.16} />
                              <stop offset="100%" stopColor={cropAccentColor} stopOpacity={0} />
                            </linearGradient>
                          </defs>

                          <CartesianGrid
                            strokeDasharray="2 4"
                            stroke="hsl(var(--border))"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="day"
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "JetBrains Mono" }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border))" }}
                            interval={2}
                            tickFormatter={(v: number) => String(v).padStart(2, "0")}
                            padding={{ left: 6, right: 6 }}
                          />
                          <YAxis
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "JetBrains Mono" }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                            width={42}
                          />
                          <Tooltip
                            content={<DriverTooltip accent={cropAccentColor} />}
                            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "3 3" }}
                          />

                          {/* Soft tint reads volume without competing with the line. */}
                          <Area
                            type="linear"
                            dataKey="predicted"
                            stroke="none"
                            fill="url(#supplyFillF)"
                            isAnimationActive={false}
                          />
                          {/* Linear, not monotone: a supply series moves in
                              straight segments between observations. Curve
                              smoothing invents readings that were never taken. */}
                          <Line
                            type="linear"
                            dataKey="predicted"
                            stroke={cropAccentColor}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: cropAccentColor, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                          <Line
                            type="linear"
                            dataKey="ma7"
                            stroke="hsl(var(--muted-foreground))"
                            strokeWidth={1.25}
                            strokeDasharray="4 4"
                            dot={false}
                            activeDot={false}
                            connectNulls
                            isAnimationActive={false}
                          />

                          {/* One marker per driver day — the hover targets. */}
                          {series.days
                            .filter((d) => d.driver)
                            .map((d) => (
                              <ReferenceDot
                                key={d.day}
                                x={d.day}
                                y={d.predictedKg}
                                r={4}
                                fill="hsl(var(--accent))"
                                stroke="hsl(var(--background))"
                                strokeWidth={2}
                                isFront
                              />
                            ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    {/* ── Driver log ────────────────────────────────── */}
                    <div className="mt-5">
                      <p className="mark mb-2 text-muted-foreground">
                        What moved supply · {series.events.length} events
                      </p>
                      <div className="overflow-hidden rounded-[var(--radius)] border border-border">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="border-b border-border bg-secondary/50">
                              <th className="mark px-3 py-2 text-left font-medium text-muted-foreground">Day</th>
                              <th className="mark px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                              <th className="mark px-3 py-2 text-left font-medium text-muted-foreground">Cause</th>
                              <th className="mark px-3 py-2 text-right font-medium text-muted-foreground">
                                vs trend
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {series.events.slice(0, 8).map((d) => (
                              <tr key={d.day} className="border-b border-border/70 last:border-0">
                                <td className="px-3 py-2 font-mono text-[12px] tabular-nums text-muted-foreground">
                                  {String(d.day).padStart(2, "0")}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className="mark inline-block rounded-[3px] border px-1.5 py-0.5"
                                    style={{
                                      borderColor: DRIVER_TONE[d.driverKind!],
                                      color: DRIVER_TONE[d.driverKind!],
                                    }}
                                  >
                                    {DRIVER_LABEL[d.driverKind!]}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-[13px] leading-snug text-foreground">{d.driver}</td>
                                <td
                                  className="px-3 py-2 text-right font-mono text-[12px] tabular-nums"
                                  style={{ color: d.changePct >= 0 ? POS : NEG }}
                                >
                                  {d.changePct >= 0 ? "▲" : "▼"}
                                  {Math.abs(d.changePct).toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <p className="mark mt-3 text-muted-foreground">
                      Modelled daily distribution · reconciles to the 30-day total above · not a firm offer
                    </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {(!data.dailyBreakdown || data.dailyBreakdown.length === 0) && (
              <Card className="p-6 mt-4">
                <p className="text-muted-foreground">
                  {data.message ?? "Insufficient data for chart. Add provisions and orders to see trends."}
                </p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
