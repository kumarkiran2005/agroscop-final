/**
 * One government scheme as a card. Renders standalone (no profile set) or with
 * an eligibility verdict attached, in which case it also shows the score bar and
 * the "why you qualify" / "why not" reasons.
 */
import {
  BadgeCheck,
  Banknote,
  ChevronDown,
  Cog,
  Droplets,
  ExternalLink,
  FileText,
  HandCoins,
  Leaf,
  MilkOff,
  Shield,
  Sprout,
  Sun,
  Tractor,
  TreePine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  STATUS_BAR_CLASS,
  STATUS_LABEL,
  STATUS_PILL_CLASS,
  daysUntil,
  formatDeadline,
} from "@/lib/schemeFormat";
import type { MatchResult, Scheme, SchemeCategory } from "@/types/scheme";

const CATEGORY_ICON: Record<SchemeCategory, LucideIcon> = {
  "income-support": HandCoins,
  insurance: Shield,
  solar: Sun,
  machinery: Tractor,
  irrigation: Droplets,
  seed: Sprout,
  fertilizer: Leaf,
  credit: Banknote,
  livestock: MilkOff,
  horticulture: TreePine,
  organic: Leaf,
  other: Cog,
};

const CATEGORY_LABEL: Record<SchemeCategory, string> = {
  "income-support": "Income support",
  insurance: "Insurance",
  solar: "Solar",
  machinery: "Machinery",
  irrigation: "Irrigation",
  seed: "Seed",
  fertilizer: "Fertiliser",
  credit: "Credit",
  livestock: "Livestock",
  horticulture: "Horticulture",
  organic: "Organic",
  other: "Other",
};

/** Deadlines inside this window get the urgent treatment. */
const DEADLINE_WARN_DAYS = 45;

type SchemeCardProps = {
  scheme: Scheme;
  /** Null when no profile filter is active — the card then reads as a directory entry. */
  match: MatchResult | null;
};

export default function SchemeCard({ scheme, match }: SchemeCardProps) {
  const Icon = CATEGORY_ICON[scheme.category];
  const regionLabel =
    scheme.authority === "central"
      ? "Central · All India"
      : scheme.states === "all"
        ? "State"
        : scheme.states.join(" · ");
  const daysLeft = scheme.deadline === undefined ? null : daysUntil(scheme.deadline);
  const deadlineUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= DEADLINE_WARN_DAYS;

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base leading-tight">{scheme.name}</h3>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {scheme.shortName !== undefined && (
                <span className="mark text-foreground/70">{scheme.shortName}</span>
              )}
              <span className="mark text-muted-foreground">{regionLabel}</span>
              {scheme.verified === true && (
                <span
                  className="inline-flex items-center gap-1 text-primary"
                  title="Real named scheme with an official portal"
                >
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Verified scheme</span>
                </span>
              )}
            </p>
          </div>
        </div>
        {match !== null && (
          <span
            className={`mark shrink-0 rounded-full border px-2.5 py-1 ${STATUS_PILL_CLASS[match.status]}`}
          >
            {match.score}%
          </span>
        )}
      </header>

      {match !== null && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {STATUS_LABEL[match.status]}
            </span>
            <span className="mark text-muted-foreground">
              {CATEGORY_LABEL[scheme.category]}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={match.score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Eligibility match for ${scheme.name}`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${STATUS_BAR_CLASS[match.status]}`}
              style={{ width: `${match.score}%` }}
            />
          </div>
        </div>
      )}

      <div className="rounded-lg bg-muted/60 px-3 py-2.5">
        <p className="mark text-muted-foreground">Indicative benefit</p>
        <p className="mt-1 text-sm font-semibold">{scheme.estimatedBenefit}</p>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{scheme.description}</p>

      {match !== null && (match.matched.length > 0 || match.missing.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {match.matched.length > 0 && (
            <div>
              <p className="mark text-emerald-800 dark:text-emerald-300">Why you qualify</p>
              <ul className="mt-1.5 space-y-1">
                {match.matched.slice(0, 4).map((reason) => (
                  <li key={reason} className="text-xs leading-snug text-muted-foreground">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {match.missing.length > 0 && (
            <div>
              <p className="mark text-rose-800 dark:text-rose-300">What does not match</p>
              <ul className="mt-1.5 space-y-1">
                {match.missing.slice(0, 4).map((reason) => (
                  <li key={reason} className="text-xs leading-snug text-muted-foreground">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            This was a static badge printing only the count, so the document
            names — which the data has all along — were unreachable. Knowing
            you need four papers is useless without knowing which four.

            A native <details> keeps it keyboard-operable and needs no state.
          */}
          <details className="group/docs">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&::-webkit-details-marker]:hidden">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {scheme.documents.length} document{scheme.documents.length === 1 ? "" : "s"}
              <ChevronDown
                className="h-3 w-3 transition-transform group-open/docs:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ul className="mt-2 w-full space-y-1 rounded-md border border-border bg-muted/40 p-2.5">
              {scheme.documents.map((doc) => (
                <li
                  key={doc}
                  className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground"
                >
                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  {doc}
                </li>
              ))}
            </ul>
          </details>
          {scheme.deadline !== undefined && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                deadlineUrgent
                  ? "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/40 dark:text-amber-300"
                  : "border-border text-muted-foreground"
              }`}
            >
              Closes {formatDeadline(scheme.deadline)}
              {deadlineUrgent && daysLeft !== null && ` · ${daysLeft}d left`}
            </span>
          )}
        </div>
        <a
          href={scheme.applicationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border-2 border-primary bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          View / Apply
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens the official portal in a new tab)</span>
        </a>
      </footer>
    </article>
  );
}
