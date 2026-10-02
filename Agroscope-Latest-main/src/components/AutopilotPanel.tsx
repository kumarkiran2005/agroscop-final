/**
 * AgroGuide Autopilot — panel UI.
 *
 * Presentational + controls only: the loop itself lives in useAutopilotRunner.
 * Styled to match AgroGuideChat (emerald/white, rounded, inline accents) so it
 * reads as part of the same assistant rather than a bolted-on widget.
 *
 * REFERENCE MAP
 *   Replicates: the Autopilot UX described in
 *   talbotiq-platform/docs/superpowers/specs/2026-07-23-mimic-guide-autopilot-design.md
 *   ("UX (in the existing Mimic Guide panel)") — toggle, step tracker, action
 *   log, read-back confirm card, take-over. Status pill + pause/resume are the
 *   brief's additions.
 */

import { Pause, Play, Square, Zap } from "lucide-react";
import type { AutopilotLogEntry, AutopilotStatus } from "@/lib/autopilot/types";
import type { PendingConfirm } from "@/lib/autopilot/useAutopilotRunner";

const STATUS_STYLES: Record<AutopilotStatus, { label: string; bg: string; fg: string }> = {
  idle: { label: "Idle", bg: "rgba(107,114,128,0.12)", fg: "#374151" },
  planning: { label: "Planning", bg: "rgba(59,130,246,0.12)", fg: "#1d4ed8" },
  running: { label: "Running", bg: "rgba(34,197,94,0.15)", fg: "#15803d" },
  paused: { label: "Paused", bg: "rgba(234,179,8,0.15)", fg: "#a16207" },
  blocked: { label: "Blocked", bg: "rgba(239,68,68,0.12)", fg: "#b91c1c" },
  done: { label: "Done", bg: "rgba(34,197,94,0.12)", fg: "#166534" },
};

const KIND_ICON: Record<AutopilotLogEntry["kind"], string> = {
  run: "✓",
  confirm: "⏸",
  refuse: "✕",
  ask: "…",
  system: "•",
};

export interface AutopilotPanelProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  status: AutopilotStatus;
  log: AutopilotLogEntry[];
  pendingConfirm: PendingConfirm | null;
  busy: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onClearLog: () => void;
}

export default function AutopilotPanel({
  enabled,
  onToggle,
  status,
  log,
  pendingConfirm,
  busy,
  onConfirm,
  onCancelConfirm,
  onPause,
  onResume,
  onStop,
  onClearLog,
}: AutopilotPanelProps) {
  const pill = STATUS_STYLES[status];

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white">
      {/* Toggle row */}
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-emerald-600" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Autopilot
          </span>
          {enabled && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: pill.bg, color: pill.fg }}
            >
              {pill.label}
            </span>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle Autopilot"
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            enabled ? "bg-emerald-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-2 border-t border-gray-100 px-4 py-3">
          {/* No goal box here on purpose: the chat composer below is the single
              input for both modes, exactly as in the reference. */}
          <p className="text-[11px] leading-snug text-gray-500">
            {busy
              ? "Working on it…"
              : "Type or speak below and I'll do it — anything that spends or submits pauses for your confirmation."}
          </p>

          {/* Transport controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {status === "paused" ? (
              <ControlButton onClick={onResume} icon={<Play className="h-3 w-3" />} label="Resume" />
            ) : (
              <ControlButton
                onClick={onPause}
                icon={<Pause className="h-3 w-3" />}
                label="Pause"
                disabled={status === "idle" || status === "done"}
              />
            )}
            <ControlButton
              onClick={onStop}
              icon={<Square className="h-3 w-3" />}
              label="Stop"
              disabled={status === "idle"}
            />
            <ControlButton
              onClick={() => {
                onStop();
                onToggle(false);
              }}
              label="Take over"
            />
            {log.length > 0 && <ControlButton onClick={onClearLog} label="Clear" />}
          </div>

          {/* Read-back confirm card — the guardrail before any side effect */}
          {pendingConfirm && (
            <div
              className="rounded-lg border p-2.5 text-xs"
              style={{
                background: "rgba(234,179,8,0.08)",
                borderColor: "rgba(234,179,8,0.35)",
              }}
            >
              <div className="font-semibold text-yellow-800">Confirm before I continue</div>
              <p className="mt-1 text-gray-800">{pendingConfirm.summary}</p>
              <p className="mt-1 font-mono text-[10px] text-gray-600">
                {pendingConfirm.name}
                {Object.keys(pendingConfirm.args).length > 0 &&
                  ` (${Object.entries(pendingConfirm.args)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(", ")})`}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onConfirm}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={onCancelConfirm}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Live activity timeline */}
          {log.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
              <ul className="space-y-1">
                {log.map((entry) => (
                  <li key={entry.id} className="flex gap-1.5 text-[11px] leading-snug text-gray-700">
                    <span className="shrink-0 text-emerald-600">{KIND_ICON[entry.kind]}</span>
                    <span className="min-w-0 flex-1 break-words">{entry.detail}</span>
                    <span className="shrink-0 font-mono text-[10px] text-gray-400">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ControlButton({
  onClick,
  icon,
  label,
  disabled,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}
