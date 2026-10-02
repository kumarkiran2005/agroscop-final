/**
 * AgroGuide Autopilot — engine.
 *
 * Pure and UI-agnostic: given an AgentDecision plus the actions currently
 * available, decide what to DO. No React, no fetch, no DOM — so the whole
 * control policy is unit-testable in isolation.
 *
 * CONTROL LOOP (identical to the reference)
 *   plan → execute → observe → next-step, capped at MAX_STEPS per utterance:
 *     1. POST the AgentRequest (messages + route + availableActions + state)
 *     2. Receive an AgentDecision; speak/show `say`
 *     3. planExecution() validates the named action against its ParamSpec
 *     4. sideEffect ⇒ 'confirm' (wait for an explicit yes) else 'run'
 *     5. after a successful run, if !awaitingUser → loop with fresh state
 *   Stops on: awaitingUser, a pending confirm, a refusal, the step cap, or a
 *   user pause/stop.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform/src/features/guide/autopilot/executor.ts
 *   (planExecution + ExecPlan are a direct port; MAX_STEPS = 8 as in the
 *   reference's useAutopilotRunner.)
 */

import { validateArgs, type ActionDescriptor, type AgentDecision } from "./types";

/** Cap on chained actions per user utterance — prevents runaway loops. */
export const MAX_STEPS = 8;

export type ExecPlan =
  | { kind: "ask" }
  | { kind: "refuse"; reason: string }
  | { kind: "run"; name: string; args: Record<string, unknown> }
  | { kind: "confirm"; name: string; args: Record<string, unknown>; summary: string };

/**
 * Pure: decide what to do with an AgentDecision, given the available actions.
 * - no action → 'ask' (the agent is questioning/answering; caller shows `say`)
 * - unknown action or invalid args → 'refuse' (caller re-asks with the reason)
 * - side-effect action with valid args → 'confirm' (caller shows a read-back)
 * - otherwise → 'run' (caller invokes the registered handler)
 */
export function planExecution(
  decision: AgentDecision,
  actions: ActionDescriptor[]
): ExecPlan {
  if (!decision.action) return { kind: "ask" };
  const desc = actions.find((a) => a.name === decision.action?.name);
  if (!desc) return { kind: "refuse", reason: `Unknown action "${decision.action.name}"` };
  const { ok, errors, value } = validateArgs(desc.params, decision.action.args);
  if (!ok) return { kind: "refuse", reason: errors.join("; ") };
  if (desc.sideEffect) {
    return {
      kind: "confirm",
      name: desc.name,
      args: value,
      summary: decision.say || `Run ${desc.name}?`,
    };
  }
  return { kind: "run", name: desc.name, args: value };
}
