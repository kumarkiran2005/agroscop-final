/**
 * AgroGuide Autopilot — shared contract between the client registry/engine and
 * the server agent. Pure + dependency-free so both the Vite client and the
 * Express server can import the same shapes. The LLM only ever NAMES a
 * registered action; args are validated here against the action's ParamSpec
 * before anything runs.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform/shared/autopilot.ts
 *   Differences: AgroScope has no `shared/` alias, so the types live under
 *   src/lib/autopilot and the server keeps a JS mirror in
 *   server/services/autopilotAgent.js (validated identically).
 */

export type ParamType = "string" | "number" | "boolean" | "enum";

export interface ParamSpec {
  name: string;
  type: ParamType;
  enum?: string[];
  required?: boolean;
  description?: string;
}

/** Serializable action descriptor the LLM sees. Handlers live only client-side. */
export interface ActionDescriptor {
  /** Unique, screen-prefixed, e.g. 'global.navigate' or 'dashboard.filterByCrop'. */
  name: string;
  description: string;
  /** 'global' | 'dashboard' | 'input' | … */
  screen: string;
  /** true ⇒ read-back confirm required before running. */
  sideEffect: boolean;
  params: ParamSpec[];
}

export interface AgentContext {
  route: string;
  availableActions: ActionDescriptor[];
  state: Record<string, unknown>;
}

export interface AgentRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  context: AgentContext;
}

export interface AgentDecision {
  /** Spoken/shown to the user. */
  say: string;
  action?: { name: string; args: Record<string, unknown> };
  /** true ⇒ stop looping and wait for the user. */
  awaitingUser: boolean;
}

/** Lifecycle states surfaced by the status pill. */
export type AutopilotStatus =
  | "idle"
  | "planning"
  | "running"
  | "paused"
  | "blocked"
  | "done";

/** One entry in the live activity timeline. */
export interface AutopilotLogEntry {
  id: string;
  /** Action name, or a pseudo-name like 'ask' / 'refuse'. */
  label: string;
  detail: string;
  kind: "run" | "confirm" | "refuse" | "ask" | "system";
  timestamp: number;
}

/**
 * Validate + coerce args against a ParamSpec list. Pure. Unknown keys are
 * dropped so the LLM can never smuggle extra fields into a handler.
 */
export function validateArgs(
  params: ParamSpec[],
  args: Record<string, unknown> | undefined
): { ok: boolean; errors: string[]; value: Record<string, unknown> } {
  const errors: string[] = [];
  const value: Record<string, unknown> = {};
  const src = args ?? {};
  for (const p of params) {
    const raw = src[p.name];
    const missing = raw === undefined || raw === null || raw === "";
    if (missing) {
      if (p.required) errors.push(`Missing required "${p.name}"`);
      continue;
    }
    switch (p.type) {
      case "string":
        if (typeof raw !== "string") errors.push(`"${p.name}" must be text`);
        else value[p.name] = raw;
        break;
      case "number": {
        const n = Number(raw);
        if (Number.isNaN(n)) errors.push(`"${p.name}" must be a number`);
        else value[p.name] = n;
        break;
      }
      case "boolean":
        value[p.name] = raw === true || raw === "true";
        break;
      case "enum":
        if (!p.enum?.includes(String(raw))) {
          errors.push(`"${p.name}" must be one of: ${(p.enum ?? []).join(", ")}`);
        } else {
          value[p.name] = String(raw);
        }
        break;
    }
  }
  return { ok: errors.length === 0, errors, value };
}
