/**
 * AgroGuide Autopilot — server agent.
 *
 * Maps conversation → ONE next action. The server NEVER runs handlers; the
 * registry (descriptors + handlers) is client-authoritative and the client
 * passes the currently-available descriptors on every turn, because
 * availability depends on which screen is mounted.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform/server/services/autopilotAgent.ts
 *   Ports verbatim: the structured-JSON contract { say, actionName, argsJson,
 *   awaitingUser }, normalizeDecision()'s unknown-action → awaitingUser
 *   fallback, the leading-model-turn trim, the empty-contents guard, and
 *   isAuthError(). The system prompt keeps the reference's RULES (one action at
 *   a time, never invent actions, never re-navigate to the current route, ask
 *   don't guess, guided pacing, immediate filtering, side-effect read-back,
 *   one-shot extraction) with AgroScope's flows substituted for TalbotIQ's.
 *   Differences: uses AgroScope's geminiGenerateJson (model fallback + tolerant
 *   JSON parsing) instead of @google/genai, and adds a DeepSeek fallback
 *   because AgroScope's assistant supports either provider.
 */

import fetch from 'node-fetch';
import { geminiGenerateJson, hasGeminiKey, parseJsonLoose } from './geminiClient.js';

const OFFLINE =
  'Autopilot needs an AI model configured (GEMINI_API_KEY or DEEPSEEK_API_KEY in server/.env) to drive tasks. You can still use me as a guide.';

function deepseekKey() {
  return process.env.DEEPSEEK_API_KEY ? String(process.env.DEEPSEEK_API_KEY).trim() : '';
}

/** True when any provider is configured. */
export function autopilotEnabled() {
  return hasGeminiKey() || deepseekKey().length > 10;
}

/** Pure: the Autopilot system instruction for the current screen/context. */
export function buildAutopilotPrompt(ctx) {
  const actions = (ctx.availableActions || [])
    .map((a) => {
      const params = (a.params || [])
        .map(
          (p) =>
            `${p.name}:${p.type}${p.enum ? `(${p.enum.join('|')})` : ''}${p.required ? '*' : ''}`
        )
        .join(', ');
      return `- ${a.name}${a.sideEffect ? ' [sideEffect]' : ''}: ${a.description}${
        params ? ` — params: ${params}` : ''
      }`;
    })
    .join('\n');

  return [
    'You are Autopilot, an agent that OPERATES the AgroScope platform for the user by choosing ONE next action at a time. AgroScope connects farmers selling crop residue to startups/companies buying biomass.',
    'STRICT SCOPE: only AgroScope. If asked anything unrelated, set awaitingUser=true and put a brief polite redirect in "say". Never break character.',
    'You may ONLY use an action from AVAILABLE ACTIONS below (exact name). Never invent actions or call APIs. If an action you need is not available here, first use a navigation action if present (navigating mounts the screen that owns the action), otherwise ask the user (awaitingUser=true).',
    'Never navigate to the route you are ALREADY on (compare with CURRENT ROUTE) — it does nothing; act on this screen instead.',
    'Drive the real flow one field at a time. If a required param is missing or ambiguous, ASK for it (say=the question, actionName="", awaitingUser=true) — do NOT guess. Never invent a quantity, price, location or crop type the user did not give you.',
    'GUIDED PACING (multi-step forms such as listing crop waste) — one step at a time, ONE CHECK-IN PER STEP: when you land on a step, ASK the user for that step\'s input (awaitingUser=true) unless their message ALREADY provided it. Never fill a step silently and NEVER advance past a step whose question the user has not answered, even if a default is pre-filled — present the default and get an answer first. Do not ask permission to advance ("shall I continue?") — once the user has answered, advance automatically. Set awaitingUser=false only while performing actions for input the user already gave; awaitingUser=true whenever you ask a check-in question. If your "say" mentions moving on, actionName MUST be that advance action in this SAME response — never narrate a move without performing it.',
    'FARMER FLOW (listing crop residue, at /input): ask the waste/crop type, then the quantity in tons, then the location, then the quality grade and moisture, then the price. Saving/listing the consignment is a [sideEffect] — propose it and let the app read it back for confirmation.',
    'STARTUP FLOW (sourcing, at /dashboard): browsing, searching, filtering and sorting supplies are NOT side effects — perform them IMMEDIATELY, no permission and no step check. Expressing interest in a supply / paying is a [sideEffect] and needs read-back confirmation. If the user asks for several filters at once ("Grade A wheat straw under 5 rupees"), apply them across turns with awaitingUser=false until all are set, then awaitingUser=true. Never ask "shall I filter?".',
    'FILTER / QUERY / READ SCREENS (forecast, live prices, news, wallet, loyalty, inventory): filtering, searching, navigating and reading data are NOT side effects — just do them.',
    'ANSWERING QUESTIONS: you may answer questions about what is on the CURRENT SCREEN using CURRENT SCREEN STATE (counts, listings, filters, balances) — set actionName="" and put the answer in "say". Act when the user asks you to DO something; answer when they ask a question. Only state numbers actually present in state; if a number is not in state, say which screen or filter would reveal it rather than inventing a value.',
    'One-shot: if the user already gave several fields in one message ("list 5 tons of paddy husk from Chittoor, grade B"), extract them ALL — take the next action for the first now, keep awaitingUser=false, and on each following turn act on the next already-provided field (advancing steps as needed); only ask for fields the user did NOT provide.',
    'For an action marked [sideEffect] (listing a consignment, expressing interest, paying, withdrawing, submitting): you may PROPOSE it (actionName set), but the app will read it back and require the user to confirm — so in "say", summarize exactly what will happen, including amounts and quantities.',
    'Always fill "say" with a short spoken sentence describing what you are doing or asking. Keep it natural and brief (it is read aloud).',
    `CURRENT ROUTE: ${ctx.route}`,
    `CURRENT SCREEN STATE (already-filled fields): ${JSON.stringify(ctx.state || {})}`,
    `AVAILABLE ACTIONS:\n${actions || '(none on this screen)'}`,
    'Respond ONLY as the required JSON: { say, actionName, argsJson, awaitingUser }. argsJson is a JSON string of the chosen action\'s params (or "{}"). actionName is "" when you are only asking/answering.',
  ].join('\n\n');
}

/** Pure: coerce the model's raw JSON into a safe AgentDecision. */
export function normalizeDecision(raw, availableNames) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const say = typeof src.say === 'string' ? src.say : '';
  const awaitingUser = src.awaitingUser === true || src.awaitingUser === 'true';
  const name = typeof src.actionName === 'string' ? src.actionName.trim() : '';

  // When no registered action survives (empty OR unknown name), force
  // awaitingUser so the client waits for the user instead of stalling with
  // nothing to run.
  if (!name || !availableNames.includes(name)) return { say, awaitingUser: true };

  let args = {};
  try {
    const parsed = JSON.parse(
      typeof src.argsJson === 'string' && src.argsJson ? src.argsJson : '{}'
    );
    if (parsed && typeof parsed === 'object') args = parsed;
  } catch {
    /* keep {} */
  }
  return { say, action: { name, args }, awaitingUser };
}

const DECISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    say: { type: 'STRING' },
    actionName: { type: 'STRING' },
    argsJson: { type: 'STRING' },
    awaitingUser: { type: 'BOOLEAN' },
  },
  required: ['say', 'actionName', 'argsJson', 'awaitingUser'],
};

/** DeepSeek fallback when no Gemini key is configured. */
async function runViaDeepSeek(systemInstruction, messages) {
  const key = deepseekKey();
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: systemInstruction }, ...messages],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 800,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return parseJsonLoose(data?.choices?.[0]?.message?.content || '{}');
}

/**
 * Map a conversation + screen context to a single next action.
 * @param {{messages: {role:string,content:string}[], context: object}} req
 * @returns {Promise<{say:string, action?:{name:string,args:object}, awaitingUser:boolean}>}
 */
export async function runAutopilotAgent(req) {
  if (!autopilotEnabled()) return { say: OFFLINE, awaitingUser: true };

  const ctx = req?.context || { route: '/', availableActions: [], state: {} };
  const names = (ctx.availableActions || []).map((a) => a.name);
  const systemInstruction = buildAutopilotPrompt(ctx);

  const clean = (req?.messages || []).filter((m) => m?.content && String(m.content).trim());

  // Gemini `contents` want role 'model' for assistant turns, and must not start
  // with one.
  const contents = clean.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content) }],
  }));
  while (contents.length && contents[0].role === 'model') contents.shift();

  // No user turn to act on — don't call the model with empty contents.
  if (!contents.length) {
    return { say: 'What would you like to do in AgroScope?', awaitingUser: true };
  }

  try {
    if (hasGeminiKey()) {
      const out = await geminiGenerateJson({
        contents,
        systemInstruction,
        schema: DECISION_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 1024,
        timeoutMs: 45000,
        maxRetries: 1,
      });
      if (out.ok) return normalizeDecision(out.json, names);
      if (!deepseekKey()) throw new Error(out.error || 'Gemini returned no decision');
    }

    const dsMessages = clean.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content),
    }));
    const json = await runViaDeepSeek(systemInstruction, dsMessages);
    return normalizeDecision(json, names);
  } catch (err) {
    console.error('[autopilot] agent error', err);
    if (isAuthError(err)) {
      return {
        say: "I can't reach the AI model — the API key looks invalid, expired, or missing. Set a valid GEMINI_API_KEY (or DEEPSEEK_API_KEY) in server/.env and restart the server, then try again.",
        awaitingUser: true,
      };
    }
    return {
      say: 'Sorry — I hit a problem working that out. Could you say that again?',
      awaitingUser: true,
    };
  }
}

/** True when an error is an auth/credential failure (bad or missing API key). */
export function isAuthError(err) {
  const status = err?.status;
  const msg = String(err?.message ?? err ?? '');
  return (
    status === 401 ||
    status === 403 ||
    /UNAUTHENTICATED|invalid authentication|API[_ ]?key|API key not valid|PERMISSION_DENIED/i.test(msg)
  );
}
