/**
 * Summary of a farmer's match results, including the indicative total benefit
 * they may be leaving unclaimed. Every figure here is an estimate and the copy
 * says so — this strip is the most likely thing to be screenshotted, so it must
 * not read as a promise of money.
 */
import { CircleHelp, CircleCheck, Wallet } from "lucide-react";
import { formatINR } from "@/lib/schemeFormat";
import type { MatchSummary } from "@/lib/eligibility";

type SchemeSummaryStripProps = {
  summary: MatchSummary;
  /** Farm size the summary was computed for, already formatted. */
  landLabel: string;
};

export default function SchemeSummaryStrip({ summary, landLabel }: SchemeSummaryStripProps) {
  return (
    <section
      aria-label="Your eligibility summary"
      className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          aria-hidden="true"
        >
          <CircleCheck className="h-[18px] w-[18px]" />
        </span>
        <div>
          <p className="mark text-muted-foreground">Likely eligible</p>
          <p className="tabular mt-0.5 text-2xl font-semibold leading-none">{summary.eligible}</p>
          <p className="mt-1 text-xs text-muted-foreground">at {landLabel}</p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"
          aria-hidden="true"
        >
          <CircleHelp className="h-[18px] w-[18px]" />
        </span>
        <div>
          <p className="mark text-muted-foreground">Possibly eligible</p>
          <p className="tabular mt-0.5 text-2xl font-semibold leading-none">{summary.possible}</p>
          <p className="mt-1 text-xs text-muted-foreground">worth checking</p>
        </div>
      </div>

      <div className="flex items-start gap-3 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Wallet className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="mark text-muted-foreground">Estimated value</p>
          <p className="tabular mt-0.5 text-2xl font-semibold leading-none text-primary">
            {formatINR(summary.annualINR)}
            <span className="text-sm font-normal text-muted-foreground">/year</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            plus <span className="tabular">{formatINR(summary.oneTimeINR)}</span> one-time capital
            support
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ceiling across all matches — not an amount you will receive.
          </p>
          {summary.excludedVagueSchemes > 0 && (
            <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
              Set your state and crop to include {summary.excludedVagueSchemes} more scheme
              {summary.excludedVagueSchemes === 1 ? "" : "s"} in this total.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
