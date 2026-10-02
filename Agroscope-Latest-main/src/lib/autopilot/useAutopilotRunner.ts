/**
 * AgroGuide Autopilot — background runner.
 *
 * Drives the plan → execute → observe → next-step loop in the background (an
 * async loop owned by this hook; the reference uses no Web Worker, so neither
 * do we). Registers `global.navigate` itself because the AgroGuide panel is
 * mounted inside <BrowserRouter>.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform/src/features/guide/autopilot/useAutopilotRunner.ts
 *   Ports verbatim: MAX_STEPS cap, the recent-tail message trim (the reference
 *   learned the hard way that unbounded history 400s forever), the
 *   never-push-an-empty-assistant-turn rule, the already-on-route navigate
 *   guard, the refuse→re-ask path, and the post-run React tick before
 *   re-reading state.
 *   Adds: start/pause/resume/stop + a status machine + a structured activity
 *   log, which the brief requires and the reference exposed only as strings.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestAgentDecision } from "@/services/autopilotService";
import type { AgentDecision, AutopilotLogEntry, AutopilotStatus } from "./types";
import { MAX_STEPS, planExecution, type ExecPlan } from "./engine";
import {
  autopilotRegistry,
  findAction,
  listDescriptors,
  snapshotState,
  useAutopilotActions,
} from "./registry";
import { buildAgentContext, toLogEntry } from "./context";
import { buildGlobalActions } from "./actions";

export type Msg = { role: "user" | "assistant"; content: string };

export interface PendingConfirm {
  name: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface TurnResult {
  say: string;
  awaiting: boolean;
}

export interface AutopilotRunner {
  status: AutopilotStatus;
  log: AutopilotLogEntry[];
  pendingConfirm: PendingConfirm | null;
  /** Run one user utterance to completion (or until blocked). */
  runTurn: (userText: string, history: Msg[]) => Promise<TurnResult>;
  confirm: () => Promise<void>;
  cancelConfirm: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  clearLog: () => void;
}

let logSeq = 0;
const nextLogId = (): string => `ap-${Date.now()}-${logSeq++}`;

export function useAutopilotRunner(): AutopilotRunner {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AutopilotStatus>("idle");
  const [log, setLog] = useState<AutopilotLogEntry[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Control flags read inside the loop; refs so the running loop sees changes
  // without being restarted.
  const pausedRef = useRef(false);
  const stoppedRef = useRef(false);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const pushLog = useCallback((entry: AutopilotLogEntry) => {
    setLog((l) => [...l, entry]);
  }, []);

  const pushSystem = useCallback(
    (detail: string) => {
      pushLog({
        id: nextLogId(),
        label: "system",
        detail,
        kind: "system",
        timestamp: Date.now(),
      });
    },
    [pushLog]
  );

  /* Register global.navigate — the panel lives inside <BrowserRouter>. */
  const globalActions = useMemo(
    () => buildGlobalActions((path) => navRef.current(path)),
    []
  );
  useAutopilotActions("global", globalActions);

  const runOne = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<void> => {
      // Already on that route → treat as success (prevents navigate loops).
      if (name === "global.navigate" && typeof args.path === "string") {
        if (window.location.pathname !== args.path) navRef.current(args.path);
        return;
      }
      const action = findAction(autopilotRegistry.getState(), name);
      if (action) await action.run(args);
    },
    []
  );

  const runTurn = useCallback(
    async (userText: string, history: Msg[]): Promise<TurnResult> => {
      stoppedRef.current = false;
      const messages: Msg[] = [...history, { role: "user", content: userText }];
      let lastSay = "";

      for (let i = 0; i < MAX_STEPS; i++) {
        if (stoppedRef.current) {
          setStatus("idle");
          pushSystem("stopped by user");
          return { say: lastSay || "Stopped.", awaiting: true };
        }
        // Cooperative pause: hold here until resumed or stopped.
        while (pausedRef.current && !stoppedRef.current) {
          setStatus("paused");
          await new Promise((r) => setTimeout(r, 150));
        }
        if (stoppedRef.current) {
          setStatus("idle");
          return { say: lastSay || "Stopped.", awaiting: true };
        }

        setStatus("planning");
        const reg = autopilotRegistry.getState();
        const ctx = buildAgentContext(
          window.location.pathname,
          listDescriptors(reg),
          snapshotState(reg)
        );

        // Send only the recent, non-empty tail — full history grows unbounded
        // and the server caps messages; a long chat would otherwise 400 every
        // turn from then on, permanently bricking Autopilot.
        const recent = messages.filter((m) => m.content.trim()).slice(-24);

        let decision: AgentDecision;
        try {
          decision = await requestAgentDecision({ messages: recent, context: ctx });
        } catch {
          setStatus("blocked");
          pushSystem("could not reach the Autopilot agent");
          return {
            say: "Sorry — I could not reach Autopilot. Please try again.",
            awaiting: true,
          };
        }

        lastSay = decision.say || lastSay;
        const plan: ExecPlan = planExecution(decision, ctx.availableActions);
        pushLog(toLogEntry(plan, nextLogId(), Date.now()));
        // Never push an EMPTY assistant turn — it fails validation later.
        messages.push({ role: "assistant", content: decision.say || "Done." });

        if (plan.kind === "ask") {
          setStatus("done");
          return { say: decision.say, awaiting: true };
        }

        if (plan.kind === "refuse") {
          // Tell the model why, let it re-ask next turn (avoids tight loops).
          messages.push({
            role: "user",
            content: `That action was refused: ${plan.reason}. Ask me for what you need.`,
          });
          continue;
        }

        if (plan.kind === "confirm") {
          setPendingConfirm({ name: plan.name, args: plan.args, summary: plan.summary });
          setStatus("blocked");
          return { say: decision.say, awaiting: true };
        }

        setStatus("running");
        await runOne(plan.name, plan.args);

        if (decision.awaitingUser) {
          setStatus("done");
          return { say: decision.say, awaiting: true };
        }
        // Give React a tick so the just-run setter is reflected in getState().
        await new Promise((r) => setTimeout(r, 0));
      }

      setStatus("done");
      pushSystem(`step cap (${MAX_STEPS}) reached`);
      return { say: lastSay || "Done for now.", awaiting: true };
    },
    [pushLog, pushSystem, runOne]
  );

  const confirm = useCallback(async () => {
    const pc = pendingConfirm;
    if (!pc) return;
    setPendingConfirm(null);
    pushSystem(`✓ confirmed: ${pc.name}`);
    setStatus("running");
    await runOne(pc.name, pc.args);
    setStatus("done");
  }, [pendingConfirm, pushSystem, runOne]);

  const cancelConfirm = useCallback(() => {
    if (!pendingConfirm) return;
    pushSystem("✕ cancelled");
    setPendingConfirm(null);
    setStatus("idle");
  }, [pendingConfirm, pushSystem]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setStatus("running");
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    pausedRef.current = false;
    setPendingConfirm(null);
    setStatus("idle");
  }, []);

  const clearLog = useCallback(() => setLog([]), []);

  // Stop the loop if the panel unmounts mid-run.
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  return {
    status,
    log,
    pendingConfirm,
    runTurn,
    confirm,
    cancelConfirm,
    pause,
    resume,
    stop,
    clearLog,
  };
}
