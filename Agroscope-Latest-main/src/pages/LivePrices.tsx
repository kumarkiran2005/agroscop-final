/**
 * Live Prices — fetch and display the live market price for every crop waste type.
 * Prices are scraped via Tavily and extracted by Gemini on the server.
 * Uses device location for city; lists all ~30 crop waste types from CROP_WASTE_CONFIG.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Leaf, Loader2, TrendingUp, RefreshCw, MapPin } from "lucide-react";
import { CROP_WASTE_CONFIG } from "@/lib/cropIcons";
import type { CropWasteKey } from "@/lib/cropIcons";
import SatelliteDetectModal from "@/components/SatelliteDetectModal";
import type { SatelliteResult } from "@/components/SatelliteDetectModal";
import { DEFAULT_CITY, getCityFromDevice } from "@/lib/geolocation";

const API_BASE = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? "";
const LIVE_PRICES_CACHE_KEY = "agro-live-prices-cache-v1";

const WASTE_TYPES: { key: CropWasteKey; label: string; icon: string }[] = Object.entries(
  CROP_WASTE_CONFIG
).map(([key, config]) => ({
  key: key as CropWasteKey,
  label: config.label,
  icon: config.emoji,
}));

interface LivePriceRow {
  key: string;
  label: string;
  icon: string;
  pricePerKg: number | null;
  trend: "rising" | "falling" | "stable" | null;
  source: string | null;
  loading: boolean;
  error: string | null;
}

interface BulkPrice {
  wasteType: string;
  pricePerKg: number;
  priceRange?: { min: number; max: number };
  trend?: string;
  source?: string;
  pending?: boolean;
}

/**
 * Every crop in a single request. The server answers from its cache immediately
 * and flags anything it is still fetching as `pending`, so the grid paints at
 * once and fills in as the background queue works through the misses.
 */
async function fetchLivePricesBulk(
  wasteTypes: string[],
  city: string,
  forceRefresh = false
): Promise<{ prices: BulkPrice[]; pendingCount: number }> {
  const params = new URLSearchParams({
    wasteTypes: wasteTypes.join(","),
    city,
    quantityTons: "1",
  });
  if (forceRefresh) params.set("refresh", "1");
  const url = `${API_BASE.replace(/\/$/, "")}/api/market-price/live-bulk?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return {
    prices: Array.isArray(json?.prices) ? json.prices : [],
    pendingCount: typeof json?.pendingCount === "number" ? json.pendingCount : 0,
  };
}

export default function LivePrices() {
  const navigate = useNavigate();
  const [city, setCity] = useState<string>(DEFAULT_CITY);
  const [locationStatus, setLocationStatus] = useState<"idle" | "getting" | "done" | "error">("idle");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [rows, setRows] = useState<LivePriceRow[]>(
    WASTE_TYPES.map((w) => ({
      ...w,
      pricePerKg: null,
      trend: null,
      source: null,
      loading: false,
      error: null,
    }))
  );
  const [refreshing, setRefreshing] = useState(false);
  /* "Use my location" opens the satellite picker — the same modal the
     "Detect Now" control opens on /input and /startup-input. */
  const [showSatellite, setShowSatellite] = useState(false);

  /**
   * Applied when the user confirms a point on the satellite map.
   * The modal reverse-geocodes the pin, so `location` is the place name;
   * `nearestHub` is whichever of the ten supported hub cities is closest,
   * used as a fallback when reverse geocoding returns nothing useful.
   *
   * loadAll() is keyed on `city`, so setting it re-fetches prices — no
   * explicit reload call is needed here.
   */
  const handleSatelliteApply = useCallback((result: SatelliteResult) => {
    const resolved = (result.location || "").trim() || result.nearestHub || DEFAULT_CITY;
    setCity(resolved);
    setLocationStatus("done");
    setLocationError(null);
    setShowSatellite(false);
  }, []);

  const applyLocation = useCallback(async () => {
    setLocationStatus("getting");
    setLocationError(null);
    const { city: resolved, error } = await getCityFromDevice();
    setCity(resolved);
    setLocationError(error);
    setLocationStatus(error ? "error" : "done");
  }, []);

  /* Poll timer for crops the server is still fetching, and a token that lets a
     newer load (city change, refresh) invalidate an older polling loop. */
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTokenRef = useRef(0);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      const cityToUse = city || DEFAULT_CITY;
      const token = ++loadTokenRef.current;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      // Only rows with no price yet show a spinner; known prices stay on screen.
      setRows((prev) => prev.map((r) => ({ ...r, loading: r.pricePerKg == null, error: null })));

      const keys = WASTE_TYPES.map((w) => w.key);
      let attempt = 0;
      const MAX_ATTEMPTS = 40; // ~3 min of polling at 5s, then stop

      const runOnce = async () => {
        if (token !== loadTokenRef.current) return; // superseded by a newer load
        let result: { prices: BulkPrice[]; pendingCount: number };
        try {
          // Only the first call of an explicit refresh re-queues; the polls
          // that follow just read back what the background queue produced.
          result = await fetchLivePricesBulk(keys, cityToUse, isRefresh && attempt === 0);
        } catch (err) {
          if (token !== loadTokenRef.current) return;
          setRows((prev) =>
            prev.map((r) => ({
              ...r,
              loading: false,
              error: r.pricePerKg == null ? (err as Error)?.message ?? "Failed to load" : null,
            }))
          );
          setRefreshing(false);
          return;
        }
        if (token !== loadTokenRef.current) return;

        const byKey = new Map(result.prices.map((p) => [p.wasteType, p]));
        const nextRows: LivePriceRow[] = [];
        setRows((prev) =>
          prev.map((r) => {
            const p = byKey.get(r.key);
            const updated: LivePriceRow = p
              ? {
                  ...r,
                  // A pending crop keeps spinning rather than flashing the
                  // reference band as if it were a real quote.
                  loading: Boolean(p.pending),
                  pricePerKg: p.pending ? r.pricePerKg : p.pricePerKg,
                  trend: p.pending ? r.trend : ((p.trend as LivePriceRow["trend"]) ?? "stable"),
                  source: p.pending ? r.source : (p.source ?? null),
                  error: null,
                }
              : { ...r, loading: false };
            nextRows.push(updated);
            return updated;
          })
        );

        // Persist only settled rows so a reload paints real prices instantly.
        try {
          localStorage.setItem(
            LIVE_PRICES_CACHE_KEY,
            JSON.stringify({
              city: cityToUse,
              rows: nextRows.map((r) => ({ ...r, loading: false })),
              savedAt: Date.now(),
            })
          );
        } catch {
          // ignore cache errors
        }

        attempt++;
        if (result.pendingCount > 0 && attempt < MAX_ATTEMPTS) {
          pollTimerRef.current = setTimeout(runOnce, 5000);
        } else {
          if (result.pendingCount > 0) {
            // Gave up waiting: stop the spinners so rows are not stuck.
            setRows((prev) => prev.map((r) => ({ ...r, loading: false })));
          }
          setRefreshing(false);
        }
      };

      await runOnce();
    },
    [city]
  );

  useEffect(
    () => () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    },
    []
  );

  useEffect(() => {
    // Hydrate from cache for instant display, if available
    try {
      const raw = localStorage.getItem(LIVE_PRICES_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { city?: string; rows?: LivePriceRow[] };
        if (parsed.city) setCity(parsed.city);
        if (Array.isArray(parsed.rows) && parsed.rows.length === WASTE_TYPES.length) {
          setRows(parsed.rows.map((r, idx) => ({ ...WASTE_TYPES[idx], ...r, loading: false, error: null })));
        }
      }
    } catch {
      // ignore cache errors
    }
  }, []);

  useEffect(() => {
    if (locationStatus === "idle") applyLocation();
  }, [locationStatus, applyLocation]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="border-b bg-card/60 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4 max-w-4xl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <button
              onClick={() => navigate("/home")}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <div className="bg-primary rounded-full p-2 shadow-sm">
                <Leaf className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-semibold tracking-wide">AgroScope</span>
            </button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
              <TrendingUp className="h-8 w-8 text-emerald-500" />
              Live Prices
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live market price per kg for all crop waste types
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{city}</span>
              {locationStatus === "getting" && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={applyLocation}
              disabled={locationStatus === "getting"}
              className="gap-1.5"
            >
              <MapPin className="h-3.5 w-3.5" />
              {locationStatus === "getting" ? "Locating…" : "Use my location"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSatellite(true)}
              className="gap-1.5"
            >
              🛰️ Pick on map
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadAll(true)}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh prices
            </Button>
          </div>
        </div>

        {locationError && (
          <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">{locationError}</p>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Prices by waste type ({rows.length})</CardTitle>
            <CardDescription>
              Prices are cached for 24 hours. Use Refresh to fetch the latest.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg shrink-0" aria-hidden>
                      {row.icon}
                    </span>
                    <span className="font-medium text-foreground truncate text-sm">{row.label}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {row.loading && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {row.error && !row.loading && (
                      <span className="text-xs text-destructive">{row.error}</span>
                    )}
                    {!row.loading && !row.error && row.pricePerKg != null && (
                      <>
                        <span className="text-base font-semibold text-foreground">
                          ₹{row.pricePerKg.toFixed(2)}/kg
                        </span>
                        {row.trend && (
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded ${
                              row.trend === "rising"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : row.trend === "falling"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {row.trend}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {showSatellite && (
        <SatelliteDetectModal
          onApply={handleSatelliteApply}
          onClose={() => setShowSatellite(false)}
          subtitle="Click the map or use your current location to price a region"
          applyLabel="✅ Use this location"
          applyHint="Sets the region used for the prices below"
        />
      )}
    </div>
  );
}
