/**
 * AgroGuide Autopilot — live context provider.
 *
 * ONE source of truth shared by the autopilot loop and the chatbot: the current
 * route, the mounted screens' state snapshot, the full list of callable
 * actions, and what autopilot just did. The engine sends it to /api/autopilot/agent;
 * the chatbot folds the same object into its page context on EVERY message, so
 * the assistant always knows where the user is and what autopilot has done.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform/src/features/guide/autopilot/context.ts
 *   (buildAgentContext + logLine are direct ports). Extended with
 *   describeContextForChat() + useAutopilotContext(), which the reference did
 *   not need because its guide and agent were separate endpoints — the brief
 *   here explicitly requires the chatbot to share autopilot's context.
 */

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { ActionDescriptor, AgentContext, AutopilotLogEntry } from "./types";
import type { ExecPlan } from "./engine";
import {
  listDescriptors,
  snapshotState,
  useAutopilotRegistry,
} from "./registry";

/** Pure: assemble the per-turn context sent to the agent endpoint. */
export function buildAgentContext(
  route: string,
  descriptors: ActionDescriptor[],
  state: Record<string, unknown>
): AgentContext {
  return { route, availableActions: descriptors, state };
}

/** Pure: a short human line for the on-screen activity timeline. */
export function logLine(plan: ExecPlan): string {
  switch (plan.kind) {
    case "run":
      return `✓ ${plan.name}${argsSuffix(plan.args)}`;
    case "confirm":
      return `⏸ awaiting confirm: ${plan.summary}`;
    case "refuse":
      return `✕ refused: ${plan.reason}`;
    case "ask":
      return "… asked the user";
  }
}

function argsSuffix(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  return keys.length
    ? ` (${keys.map((k) => `${k}=${String(args[k])}`).join(", ")})`
    : "";
}

/** Pure: map an ExecPlan to a structured timeline entry. */
export function toLogEntry(plan: ExecPlan, id: string, timestamp: number): AutopilotLogEntry {
  const label =
    plan.kind === "run" || plan.kind === "confirm" ? plan.name : plan.kind;
  return { id, label, detail: logLine(plan), kind: plan.kind, timestamp };
}

/**
 * Pure: render the live context as a compact text block for the chatbot's
 * system prompt. Kept terse — it is prepended to every chat turn.
 */
export function describeContextForChat(
  ctx: AgentContext,
  recentLog: AutopilotLogEntry[]
): string {
  const lines: string[] = [
    `AUTOPILOT LIVE CONTEXT — current route: ${ctx.route}.`,
  ];

  const stateKeys = Object.keys(ctx.state);
  if (stateKeys.length) {
    lines.push(`Visible screen state: ${JSON.stringify(ctx.state)}.`);
  }

  if (ctx.availableActions.length) {
    const byScreen = ctx.availableActions.reduce<Record<string, string[]>>(
      (acc, a) => {
        (acc[a.screen] ??= []).push(
          `${a.name}${a.sideEffect ? " [needs confirmation]" : ""}`
        );
        return acc;
      },
      {}
    );
    const summary = Object.entries(byScreen)
      .map(([screen, names]) => `${screen}: ${names.join(", ")}`)
      .join(" | ");
    lines.push(
      `Actions autopilot can perform right now — ${summary}. ` +
        `If the user asks you to DO one of these, tell them to turn on Autopilot and say the goal.`
    );
  }

  if (recentLog.length) {
    const recent = recentLog
      .slice(-6)
      .map((e) => e.detail)
      .join(" | ");
    lines.push(`What autopilot just did (most recent last): ${recent}.`);
  }

  return lines.join(" ");
}

/**
 * Live context hook. Rebuilds only when the route, the registered actions, or
 * the mounted screens' state actually change.
 */
export function useAutopilotContext(): AgentContext {
  const { pathname } = useLocation();
  const registry = useAutopilotRegistry();
  return useMemo(
    () =>
      buildAgentContext(
        pathname,
        listDescriptors(registry),
        snapshotState(registry)
      ),
    [pathname, registry]
  );
}
