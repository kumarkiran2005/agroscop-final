/**
 * AgroGuide Autopilot — client transport.
 *
 * Same API-base + auth-header conventions as agroGuideService.ts.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform helpApi.agent() → POST /api/help/agent.
 *   AgroScope mounts the equivalent at POST /api/autopilot/agent.
 */

import type { AgentDecision, AgentRequest } from "@/lib/autopilot/types";

const API_BASE = (import.meta.env.VITE_API_URL as string) ?? "";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Ask the server agent for the next single action. Throws on transport failure. */
export async function requestAgentDecision(req: AgentRequest): Promise<AgentDecision> {
  const res = await fetch(`${API_BASE}/api/autopilot/agent`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(req),
  });

  const data = (await res.json().catch(() => ({}))) as Partial<AgentDecision> & {
    error?: string;
  };

  if (!res.ok) {
    if (typeof data.say === "string" && data.say.trim()) {
      return { say: data.say, awaitingUser: true };
    }
    throw new Error(data.error || `Autopilot agent error (${res.status})`);
  }

  return {
    say: typeof data.say === "string" ? data.say : "",
    action: data.action,
    awaitingUser: data.awaitingUser === true,
  };
}

/** Whether the server has a model key configured for Autopilot. */
export async function getAutopilotStatus(): Promise<{ configured: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/autopilot/status`, { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as {
      configured?: boolean;
      message?: string;
    };
    return {
      configured: !!data.configured,
      message: data.message ?? (res.ok ? "OK" : "Server error"),
    };
  } catch {
    return {
      configured: false,
      message: "Cannot reach server. Is the backend running on port 5000?",
    };
  }
}
