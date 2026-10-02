/** Display helpers shared by the schemes components. Formatting only — no logic. */
import type { MatchStatus } from "@/types/scheme";

/** 51000 → "₹51,000" in Indian digit grouping. */
export function formatINR(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** 4 → "4", 0.5 → "0.5". Drops a trailing zero decimal. */
export function formatAcres(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** "2026-09-30" → "30 Sep 2026". Returns the raw string if unparseable. */
export function formatDeadline(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Whole days from today until `iso`. Negative once the date has passed. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const target = new Date(`${iso}T00:00:00`).getTime();
  if (Number.isNaN(target)) return Number.POSITIVE_INFINITY;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - startOfToday) / 86_400_000);
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  eligible: "Likely eligible",
  possible: "Possibly eligible",
  "not-eligible": "Not eligible",
};

/**
 * Status colours. Both themes are spelled out because these are semantic
 * traffic-light colours, not palette tokens — `text-emerald-700` is unreadable
 * on the dark surface and `text-emerald-300` is unreadable on the light one.
 */
export const STATUS_PILL_CLASS: Record<MatchStatus, string> = {
  eligible:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/30 dark:text-emerald-300",
  possible:
    "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:text-amber-300",
  "not-eligible":
    "border-rose-600/30 bg-rose-500/10 text-rose-800 dark:border-rose-400/30 dark:text-rose-300",
};

export const STATUS_BAR_CLASS: Record<MatchStatus, string> = {
  eligible: "bg-emerald-600 dark:bg-emerald-400",
  possible: "bg-amber-600 dark:bg-amber-400",
  "not-eligible": "bg-rose-600 dark:bg-rose-400",
};
