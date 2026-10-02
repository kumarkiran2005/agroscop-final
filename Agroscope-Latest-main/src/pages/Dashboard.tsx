import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAutopilotActions, useStableGetState } from "@/lib/autopilot/registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Leaf, Home, MapPin, Package, TrendingDown, Clock, Loader2, RefreshCw, Search } from "lucide-react";
import FarmerNotifications from "@/components/FarmerNotifications";
import UPIPaymentFlowModal from "@/components/UPIPaymentFlowModal";
import { WalletDropdown } from "@/components/WalletDropdown";

const API_BASE = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? "";

/** Platform fee: 30% on top of farmer's listing price when showing to startups */
const PLATFORM_FEE_MULTIPLIER = 1.30;

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Per-kg price shown to a startup, already including the 30% platform fee.
 * The backend stores `display_price = farmer_price * 1.30` and, for startup
 * callers, overwrites `price` with that same value — so the fee must not be
 * applied a second time here. Legacy rows with no `display_price` fall back to
 * marking up the raw price.
 */
function displayPricePerKg(p: ProvisionItem): number {
  const withFee = Number(p.display_price ?? 0);
  if (Number.isFinite(withFee) && withFee > 0) return withFee;
  const raw = Number(p.price ?? 0);
  return Number.isFinite(raw) ? raw * PLATFORM_FEE_MULTIPLIER : 0;
}

export interface ProvisionItem {
  _id: string;
  userId?: string;
  farmerName?: string;
  farmerUpiId?: string | null;
  wasteType: string;
  quantityTons: number;
  location?: string;
  price?: number | null;
  display_price?: number | null;
  wasteQualityGrade?: string | null;
  createdAt?: string;
  status?: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const userRole = useMemo(() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) return null;
      const user = JSON.parse(raw);
      return user?.role === "startup" ? "startup" : user?.role === "farmer" ? "farmer" : user?.role === "admin" ? "admin" : null;
    } catch {
      return null;
    }
  }, []);
  const [provisions, setProvisions] = useState<ProvisionItem[]>([]);
  const [provisionsLoading, setProvisionsLoading] = useState(true);
  const [payingProvision, setPayingProvision] = useState<{
    _id?: string;
    id?: string;
    wasteType: string;
    quantityTons: number;
    pricePerKg: number;
    leastPrice?: number;
    farmerName: string;
    farmerUpiId: string;
  } | null>(null);

  const fetchProvisions = useCallback(async () => {
    setProvisionsLoading(true);
    try {
      const res = await fetch(API_BASE + "/api/provisions", { headers: getAuthHeaders() });
      const data = await res.json();
      setProvisions(Array.isArray(data?.provisions) ? data.provisions : []);
    } catch {
      setProvisions([]);
    } finally {
      setProvisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProvisions();
  }, [fetchProvisions]);

  // Browse controls
  const [query, setQuery] = useState("");
  const [cropFilter, setCropFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const cropTypes = useMemo(() => {
    const set = new Set(
      provisions.map((p) => String(p.wasteType || "").trim()).filter(Boolean)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [provisions]);

  const visibleProvisions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = provisions.filter((p) => {
      if (cropFilter !== "all" && p.wasteType !== cropFilter) return false;
      if (gradeFilter !== "all" && (p.wasteQualityGrade || "") !== gradeFilter) return false;
      if (!q) return true;
      return (
        String(p.wasteType || "").toLowerCase().includes(q) ||
        String(p.location || "").toLowerCase().includes(q) ||
        String(p.farmerName || "").toLowerCase().includes(q)
      );
    });

    const totalFor = (p: ProvisionItem) =>
      Number(p.quantityTons || 0) * 1000 * displayPricePerKg(p);

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "price-low":
          return totalFor(a) - totalFor(b);
        case "price-high":
          return totalFor(b) - totalFor(a);
        case "qty-high":
          return Number(b.quantityTons || 0) - Number(a.quantityTons || 0);
        case "qty-low":
          return Number(a.quantityTons || 0) - Number(b.quantityTons || 0);
        default:
          return (
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
          );
      }
    });
  }, [provisions, query, cropFilter, gradeFilter, sortBy]);

  const filtersActive = query.trim() !== "" || cropFilter !== "all" || gradeFilter !== "all";

  /* ── Autopilot: expose this screen's real handlers while mounted ──────────
     Browsing/filtering/sorting are SAFE (they only change what is displayed).
     Expressing interest spends money, so it is marked sideEffect and the
     runner gates it behind an explicit read-back confirmation. */
  const autopilotActions = useMemo(
    () => ({
      search: {
        description: "Search available supplies by crop, location or farmer name",
        params: [{ name: "query", type: "string" as const, required: true }],
        run: ({ query: q }: Record<string, unknown>) => setQuery(String(q ?? "")),
      },
      filterByCrop: {
        description: `Filter supplies by crop type. Available: ${cropTypes.join(", ") || "none loaded yet"}`,
        params: [{ name: "cropType", type: "string" as const, required: true }],
        run: ({ cropType }: Record<string, unknown>) => {
          const wanted = String(cropType ?? "").toLowerCase();
          const match = cropTypes.find((c) => c.toLowerCase() === wanted);
          setCropFilter(match ?? String(cropType ?? "all"));
        },
      },
      filterByGrade: {
        description: "Filter supplies by quality grade",
        params: [
          { name: "grade", type: "enum" as const, enum: ["all", "A", "B", "C"], required: true },
        ],
        run: ({ grade }: Record<string, unknown>) => setGradeFilter(String(grade ?? "all")),
      },
      sortBy: {
        description: "Sort the supply list",
        params: [
          {
            name: "order",
            type: "enum" as const,
            enum: ["newest", "price-low", "price-high", "qty-high"],
            required: true,
          },
        ],
        run: ({ order }: Record<string, unknown>) => setSortBy(String(order ?? "newest")),
      },
      clearFilters: {
        description: "Clear all supply filters and the search box",
        params: [],
        run: () => {
          setQuery("");
          setCropFilter("all");
          setGradeFilter("all");
          setSortBy("newest");
        },
      },
      expressInterest: {
        description:
          "Express interest in a supply and open the payment step. Identify it by its position in the currently visible list (1 = first).",
        sideEffect: true,
        params: [{ name: "index", type: "number" as const, required: true }],
        run: ({ index }: Record<string, unknown>) => {
          const i = Number(index) - 1;
          const p = visibleProvisions[i];
          if (!p) return;
          const perKg = displayPricePerKg(p);
          const total = Number(p.quantityTons) * 1000 * perKg;
          setPayingProvision({
            _id: p._id,
            id: p._id,
            wasteType: p.wasteType,
            quantityTons: Number(p.quantityTons),
            pricePerKg: perKg,
            leastPrice: total > 0 ? Math.round(total) : undefined,
            farmerName: p.farmerName || "Farmer",
            farmerUpiId: p.farmerUpiId || "77998026466@ybl",
          });
        },
      },
    }),
    [cropTypes, visibleProvisions]
  );

  const autopilotGetState = useStableGetState(() => ({
    screen: "Startup Dashboard — available supplies",
    totalSupplies: provisions.length,
    visibleSupplies: visibleProvisions.length,
    searchQuery: query,
    cropFilter,
    gradeFilter,
    sortBy,
    availableCropTypes: cropTypes,
    visibleList: visibleProvisions.slice(0, 10).map((p, i) => ({
      index: i + 1,
      wasteType: p.wasteType,
      quantityTons: p.quantityTons,
      location: p.location,
      grade: p.wasteQualityGrade,
      pricePerKgInclFee: displayPricePerKg(p),
    })),
  }));

  useAutopilotActions("dashboard", autopilotActions, { getState: autopilotGetState });

  // Only startups buy. Farmers get their own listings instead of the sourcing
  // marketplace. Declared after every hook so hook order stays unconditional.
  const isStartup = userRole === "startup";
  if (userRole === "farmer") {
    return <Navigate to="/farmer-inventory" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <button 
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <div className="bg-primary rounded-full p-2">
              <Leaf className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold text-foreground">AgroScope</span>
          </button>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/home')}>
              <Home className="w-4 h-4 mr-2" />
              Home
            </Button>
            <FarmerNotifications />
            <Button variant="ghost" size="sm" onClick={() => navigate('/notifications')}>Notifications</Button>
            <WalletDropdown role={userRole} />
            <Button variant="ghost" size="sm" onClick={() => navigate('/profile')}>Profile</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/payments')}>
              💳 Payments
            </Button>
          </div>
        </div>
      </header>

      {/* Dashboard Content */}
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header Section */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">
            The Repurposer's Hub
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            Access verified, localized agricultural feedstock from farmers in your area
          </p>

          {/* Value Proposition Banner */}
          <Card className="border bg-gradient-to-r from-primary/5 to-accent/5">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-primary" />
                    <span>Reduce logistics costs by 40%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-primary" />
                    <span>Verified quality &amp; quantity</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5 text-primary" />
                    <span>Direct from source pricing</span>
                  </div>
                </div>
                <Badge className="bg-primary text-primary-foreground text-xs px-3 py-1 whitespace-nowrap">
                  {provisionsLoading ? "..." : `${provisions.length} leads available`}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Available Supplies — real farmer provisions */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-foreground">
              Available Supplies Near You
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchProvisions()}
              disabled={provisionsLoading}
              type="button"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${provisionsLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Browse controls */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search crop, location or farmer..."
                className="pl-9 h-9"
                aria-label="Search supplies"
              />
            </div>
            <Select value={cropFilter} onValueChange={setCropFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[190px]" aria-label="Filter by crop type">
                <SelectValue placeholder="All crop types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All crop types</SelectItem>
                {cropTypes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[140px]" aria-label="Filter by grade">
                <SelectValue placeholder="All grades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All grades</SelectItem>
                <SelectItem value="A">Premium (A)</SelectItem>
                <SelectItem value="B">Grade B</SelectItem>
                <SelectItem value="C">Grade C</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-9 w-full sm:w-[170px]" aria-label="Sort supplies">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="price-low">Price: low to high</SelectItem>
                <SelectItem value="price-high">Price: high to low</SelectItem>
                <SelectItem value="qty-high">Quantity: high to low</SelectItem>
                <SelectItem value="qty-low">Quantity: low to high</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!provisionsLoading && provisions.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                Showing {visibleProvisions.length} of {provisions.length} supplies
              </span>
              {filtersActive && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => {
                    setQuery("");
                    setCropFilter("all");
                    setGradeFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {provisionsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            </div>
          ) : provisions.length === 0 ? (
            <Card className="border-2 border-dashed bg-muted/30">
              <CardContent className="p-10 text-center">
                <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="text-lg font-semibold text-foreground mb-1">No supplies yet</h3>
                <p className="text-sm text-muted-foreground">
                  When farmers list their crop waste, new supplies will appear here for you to buy.
                </p>
              </CardContent>
            </Card>
          ) : visibleProvisions.length === 0 ? (
            <Card className="border-2 border-dashed bg-muted/30">
              <CardContent className="p-10 text-center">
                <Search className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="text-lg font-semibold text-foreground mb-1">No matching supplies</h3>
                <p className="text-sm text-muted-foreground">
                  Try a different crop type, grade, or search term.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleProvisions.map((provision) => {
                const perKg = displayPricePerKg(provision);
                const totalDisplay = Number(provision.quantityTons) * 1000 * perKg;
                const qualityLabel =
                  provision.wasteQualityGrade === "A"
                    ? "Premium"
                    : provision.wasteQualityGrade
                      ? `Grade ${provision.wasteQualityGrade}`
                      : "Standard";
                return (
                  <Card
                    key={provision._id}
                    className="border hover:shadow-card transition-all duration-200 hover:border-primary flex flex-col"
                  >
                    <CardContent className="p-4 flex flex-col gap-3 h-full">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                            <Package className="w-4 h-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <h3
                              className="font-semibold text-base leading-tight truncate"
                              title={provision.wasteType}
                            >
                              {provision.wasteType}
                            </h3>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {provision.createdAt ? timeAgo(provision.createdAt) : "Recently"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[11px] px-2 py-0.5 ${
                            provision.wasteQualityGrade === "A" ? "border-primary text-primary" : ""
                          }`}
                        >
                          {qualityLabel}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-primary" />
                        <span className="truncate" title={provision.location || "Not specified"}>
                          {provision.location || "Not specified"}
                        </span>
                      </div>

                      <div className="flex items-end justify-between gap-2 border-t pt-3 mt-auto">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Quantity
                          </div>
                          <div className="text-lg font-bold text-foreground leading-tight">
                            {Number(provision.quantityTons)} T
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Total incl. fee
                          </div>
                          <div className="text-lg font-bold text-primary leading-tight">
                            {totalDisplay > 0
                              ? `₹${Math.round(totalDisplay).toLocaleString("en-IN")}`
                              : "—"}
                          </div>
                          {perKg > 0 && (
                            <div className="text-[11px] text-muted-foreground">
                              ₹{perKg.toFixed(2)}/kg
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        className="text-xs text-muted-foreground truncate"
                        title={provision.farmerName || "Farmer"}
                      >
                        Seller: {provision.farmerName || "Farmer"}
                      </div>

                      <div className="flex gap-2">
                        {isStartup && (
                          <Button
                            variant="cta"
                            size="sm"
                            className="flex-1 text-xs px-2"
                            onClick={() =>
                              setPayingProvision({
                                _id: provision._id,
                                id: provision._id,
                                wasteType: provision.wasteType,
                                quantityTons: Number(provision.quantityTons),
                                pricePerKg: perKg,
                                leastPrice:
                                  totalDisplay > 0 ? Math.round(totalDisplay) : undefined,
                                farmerName: provision.farmerName || "Farmer",
                                farmerUpiId: provision.farmerUpiId || "77998026466@ybl",
                              })
                            }
                          >
                            🤝 Express Interest
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className={isStartup ? "text-xs px-3" : "flex-1 text-xs"}
                        >
                          Details
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom alert prompt */}
        <div className="mt-6">
          <Card className="border border-dashed bg-muted/30">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Package className="w-5 h-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">
                    Looking for something specific?
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Set up custom alerts for specific materials, quantities, or locations
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="shrink-0">
                Create Custom Alert
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {payingProvision && (
        <UPIPaymentFlowModal
          provision={payingProvision}
          buyerName={
            (() => {
              try {
                const u = localStorage.getItem("user");
                if (u) {
                  const parsed = JSON.parse(u);
                  return parsed.name ?? parsed.email ?? "Startup";
                }
              } catch {
                // ignore
              }
              return "Startup";
            })()
          }
          buyerId={
            (() => {
              try {
                const u = localStorage.getItem("user");
                if (u) {
                  const parsed = JSON.parse(u);
                  return String(parsed.id ?? parsed._id ?? "anon");
                }
              } catch {
                // ignore
              }
              return "anon";
            })()
          }
          onClose={() => setPayingProvision(null)}
        />
      )}
    </div>
  );
};

export default Dashboard;
