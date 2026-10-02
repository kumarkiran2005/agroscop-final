/**
 * Government Schemes — discover which Indian agricultural schemes a farmer may
 * be eligible for, based on land size and profile.
 *
 * The full directory renders before any input is given; setting a land size
 * switches the page into scored mode. Scheme data comes from `getSchemes()`, the
 * single seam that can later point at a live API (see src/data/schemes.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info, Landmark, Leaf, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import SchemeCard from "@/components/schemes/SchemeCard";
import SchemeFilterPanel from "@/components/schemes/SchemeFilterPanel";
import SchemeSummaryStrip from "@/components/schemes/SchemeSummaryStrip";
import { getSchemes, summarizeMatches } from "@/lib/eligibility";
import { DEFAULT_SCHEME_FILTERS, isProfileActive, selectSchemes } from "@/lib/schemeFilters";
import type { SchemeFilters } from "@/lib/schemeFilters";
import { formatAcres } from "@/lib/schemeFormat";
import type { Scheme, ScoredScheme } from "@/types/scheme";

export default function Schemes() {
  const navigate = useNavigate();
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SchemeFilters>(DEFAULT_SCHEME_FILTERS);

  useEffect(() => {
    let active = true;
    getSchemes()
      .then((loaded) => {
        if (active) {
          setSchemes(loaded);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Scoring 100 schemes on every keystroke of the slider is why this is memoised.
  const visible = useMemo(() => selectSchemes(schemes, filters), [schemes, filters]);

  const profileActive = isProfileActive(filters);

  // The summary counts across the whole catalogue, not the filtered view, so the
  // headline does not shrink when a farmer narrows by benefit type.
  const summary = useMemo(() => {
    if (!profileActive) return null;
    const scored = selectSchemes(schemes, {
      ...filters,
      categories: [],
      eligibleOnly: false,
    }).filter((entry): entry is ScoredScheme => entry.match !== null);
    return summarizeMatches(scored, {
      stateSpecified: filters.state !== "all",
      cropSpecified: filters.crop !== "any",
    });
  }, [schemes, filters, profileActive]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="sticky top-0 z-50 border-b bg-card/60 backdrop-blur-sm">
        <div className="container mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/home")}
              aria-label="Back to home"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <button
              onClick={() => navigate("/home")}
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
              type="button"
            >
              <span className="rounded-full bg-primary p-2 shadow-sm">
                <Leaf className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
              </span>
              <span className="font-semibold">AgroScope</span>
            </button>
          </div>
          {/* Mobile filter drawer trigger. */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="min-h-[44px] gap-2 border-2 lg:hidden">
                <SlidersHorizontal className="h-4 w-4" />
                Filters
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[min(100vw-2rem,360px)] overflow-y-auto safe-area-inset-top"
            >
              {/* Radix requires a title and description inside the dialog for
                  screen readers; without them it logs an accessibility error. */}
              <SheetTitle className="mt-2 text-lg">Filter schemes</SheetTitle>
              <SheetDescription className="mb-6">
                Set your land size and profile to score each scheme against your farm.
              </SheetDescription>
              <SchemeFilterPanel
                filters={filters}
                onChange={setFilters}
                resultCount={visible.length}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
        {/* Hero */}
        <div className="measure">
          <p className="mark flex items-center gap-2 text-muted-foreground">
            <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
            Government schemes · India
          </p>
          <h1 className="mt-4 text-4xl leading-[0.95] sm:text-5xl md:text-6xl">
            Find the support
            <br />
            you already qualify for.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            A hundred central and state agricultural schemes in one place. Set your land size and
            AgroScope scores each one against your holding, so you can see what you are eligible
            for instead of reading through dozens of portals.
          </p>
        </div>

        {/* Indicative-benefit disclaimer. */}
        <div
          role="note"
          className="mt-8 flex gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 p-4 dark:border-amber-400/30"
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-800 dark:text-amber-300"
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Benefit figures are indicative, not guaranteed.</span>{" "}
            Eligibility rules, amounts and application windows change by state, district and
            funding cycle. Treat every score here as a starting point and confirm on the official
            portal linked from each scheme before applying.
          </p>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[280px_1fr]">
          {/* Desktop sidebar. */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
              <SchemeFilterPanel
                filters={filters}
                onChange={setFilters}
                resultCount={visible.length}
              />
            </div>
          </aside>

          <div className="min-w-0">
            {summary !== null && filters.landAcres !== null && (
              <div className="mb-6">
                <SchemeSummaryStrip
                  summary={summary}
                  landLabel={`${formatAcres(filters.landAcres)} acres`}
                />
              </div>
            )}

            {loading ? (
              <p className="py-16 text-center text-muted-foreground">Loading schemes…</p>
            ) : visible.length === 0 ? (
              <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
                <h2 className="text-lg">No schemes match these filters</h2>
                <p className="measure-tight mx-auto mt-2 text-sm text-muted-foreground">
                  Try widening the benefit type, turning off “only schemes I’m eligible for”, or
                  clearing the state filter.
                </p>
                <Button
                  variant="outline"
                  className="mt-6 border-2"
                  onClick={() => setFilters(DEFAULT_SCHEME_FILTERS)}
                >
                  Reset filters
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Showing <span className="tabular font-medium text-foreground">{visible.length}</span>{" "}
                    {visible.length === 1 ? "scheme" : "schemes"}
                    {profileActive ? ", best match first" : ", central schemes first"}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
                  {visible.map((entry) => (
                    <SchemeCard key={entry.scheme.id} scheme={entry.scheme} match={entry.match} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
