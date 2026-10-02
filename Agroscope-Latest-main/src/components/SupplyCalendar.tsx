import { DRIVER_LABEL } from "@/lib/forecastNarrative";
import type { DriverKind } from "@/lib/forecastNarrative";

/**
 * Month view of the 30-day supply window.
 *
 * Two modes:
 *  - "single"  one grade, cell intensity scaled to that grade's own peak.
 *  - "leader"  all grades compared; each cell names the grade with the
 *              highest supply that day and colours by that grade.
 *
 * Days are laid out against real weekdays rather than a flat 1–30 strip,
 * because the recurring causes in this data are weekly — a mandi closure
 * lands on the same weekday every week, and that pattern is only legible
 * on a calendar.
 */

export interface CalendarCell {
  day: number;
  date: Date;
  kg: number;
  /** Leader mode: which grade topped the day. */
  code?: string;
  label?: string;
  color?: string;
  /**
   * Leader mode: every grade's supply that day, highest first. The hover
   * card shows the full ranking — "why is PH leading" is only answerable
   * if you can see what the others did.
   */
  breakdown?: { code: string; label: string; color: string; kg: number }[];
  driver: string | null;
  driverKind: DriverKind | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k`;
  return String(kg);
}

export default function SupplyCalendar({
  cells,
  mode,
  accent,
}: {
  cells: CalendarCell[];
  mode: "single" | "leader";
  accent: string;
}) {
  if (!cells.length) return null;

  const maxKg = Math.max(...cells.map((c) => c.kg), 1);
  // Blank cells so day 1 sits under its real weekday.
  const leadingBlanks = cells[0].date.getDay();

  const monthLabel = (() => {
    const first = cells[0].date;
    const last = cells[cells.length - 1].date;
    const f = first.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    const l = last.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    return f === l ? f : `${first.toLocaleDateString("en-IN", { month: "short" })} – ${l}`;
  })();

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="mark text-muted-foreground">{monthLabel}</span>
        <span className="mark text-muted-foreground">
          {mode === "leader" ? "Leading grade per day" : "Daily supply"}
        </span>
      </div>

      {/* No overflow-hidden on this wrapper: it clipped the hover cards on
          the bottom two rows, so days late in the window appeared to have
          no hover at all. Corners are rounded on the header and the grid
          instead. */}
      <div className="rounded-[var(--radius)] border border-border">
        {/* Weekday header */}
        <div className="grid grid-cols-7 overflow-hidden rounded-t-[calc(var(--radius)-1px)] border-b border-border bg-secondary/50">
          {WEEKDAYS.map((w) => (
            <div key={w} className="mark px-2 py-2 text-center text-muted-foreground">
              {w}
            </div>
          ))}
        </div>

        {/* Day grid. gap-px over a border-coloured ground draws the rules. */}
        <div className="grid grid-cols-7 gap-px rounded-b-[calc(var(--radius)-1px)] bg-border">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} className="min-h-[74px] bg-card" />
          ))}

          {cells.map((c, i) => {
            // Intensity carries volume; the strongest day reads fullest.
            const intensity = 0.06 + (c.kg / maxKg) * 0.26;
            const tone = mode === "leader" ? c.color ?? accent : accent;

            const slot = leadingBlanks + i;
            const row = Math.floor(slot / 7);
            const col = slot % 7;
            const totalRows = Math.ceil((leadingBlanks + cells.length) / 7);

            /**
             * Placement. The card is tall in leader mode (a five-grade
             * ranking), so on the last rows it cannot simply flip above the
             * cell — it would slide under the sticky page header. Those rows
             * get side placement anchored to the cell's bottom instead, which
             * keeps the card beside the cursor and clear of the masthead.
             */
            const sideways = row >= totalRows - 2;
            const placement = sideways
              ? col <= 3
                ? "left-full ml-1 bottom-0"
                : "right-full mr-1 bottom-0"
              : `top-full mt-1 ${
                  col <= 1 ? "left-0" : col >= 5 ? "right-0" : "left-1/2 -translate-x-1/2"
                }`;

            return (
              <div
                key={c.day}
                tabIndex={0}
                className="group relative min-h-[74px] bg-card px-2 py-1.5 outline-none transition-colors focus-visible:z-40"
                style={{ backgroundColor: `color-mix(in srgb, ${tone} ${(intensity * 100).toFixed(0)}%, hsl(var(--card)))` }}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {c.date.getDate()}
                  </span>
                  {c.driver && (
                    <span
                      aria-hidden="true"
                      className="mt-[3px] h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ backgroundColor: "hsl(var(--accent))" }}
                    />
                  )}
                </div>

                {mode === "leader" && c.code && (
                  <div className="mt-1 flex items-center gap-1">
                    <span
                      className="h-[7px] w-[7px] shrink-0 rounded-[2px]"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="font-mono text-[10px] font-semibold tracking-[0.06em] text-foreground">
                      {c.code}
                    </span>
                  </div>
                )}

                <div className="mt-1 font-mono text-[12px] font-medium tabular-nums leading-none text-foreground">
                  {formatKg(c.kg)}
                  <span className="ml-0.5 text-[9px] text-muted-foreground">kg</span>
                </div>

                {/* Hover card. Rendered for EVERY day, not only driver days —
                    a cell that does nothing on hover reads as broken, and a
                    quiet day is itself information worth stating. */}
                <div
                  role="tooltip"
                  className={`pointer-events-none absolute z-30 hidden w-[236px] rounded-[var(--radius)] border border-border bg-popover text-left shadow-md group-hover:block group-focus-visible:block ${placement}`}
                >
                  <div className="flex items-baseline justify-between gap-2 border-b border-border px-2.5 py-1.5">
                    <span className="mark text-muted-foreground">
                      {c.date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                    </span>
                    <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
                      {c.kg.toLocaleString("en-IN")}
                      <span className="ml-0.5 text-[9px] text-muted-foreground">kg</span>
                    </span>
                  </div>

                  {/* Leader mode: the full ranking for the day, so the leader
                      is a comparison rather than an assertion. */}
                  {mode === "leader" && c.breakdown?.length ? (
                    <div className="px-2.5 py-1.5">
                      {c.breakdown.map((b, bi) => (
                        <div key={b.code} className="flex items-center justify-between gap-2 py-[3px]">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="h-[7px] w-[7px] shrink-0 rounded-[2px]"
                              style={{ backgroundColor: b.color }}
                            />
                            <span
                              className={`truncate text-[11px] ${bi === 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                            >
                              {b.label}
                            </span>
                          </span>
                          <span
                            className={`font-mono text-[11px] tabular-nums ${bi === 0 ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {(b.kg / 1000).toFixed(1)}k
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {c.driver && c.driverKind ? (
                    <div className="border-t border-border px-2.5 py-1.5">
                      <span
                        className="mark mb-1 inline-block rounded-[3px] border px-1.5 py-0.5"
                        style={{ borderColor: "hsl(var(--accent))", color: "hsl(var(--accent))" }}
                      >
                        {DRIVER_LABEL[c.driverKind]}
                        {mode === "leader" && c.label ? ` · ${c.label}` : ""}
                      </span>
                      <p className="text-[12px] leading-snug text-foreground">{c.driver}</p>
                    </div>
                  ) : (
                    <div className="border-t border-border px-2.5 py-1.5">
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Routine day — no closure, weather or demand event on record.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
