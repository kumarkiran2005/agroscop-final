/**
 * Shared Google Gemini client for AgroScope.
 *
 * One place for: key resolution, model fallback, retries, JSON parsing and SSE
 * streaming. Used by crop detection, weight estimation and price negotiation.
 *
 * Auth note: the key is sent as an `x-goog-api-key` header rather than a `?key=`
 * query param. Both work, but the header keeps the secret out of URLs, proxy
 * logs and error messages. Newer AI Studio keys (the `AQ.` prefix) work with both.
 */

import fetch from 'node-fetch';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Models verified to serve generateContent on current AI Studio keys (Aug 2026).
 * Several models that ListModels still advertises are in fact retired and return
 * 404 — gemini-2.5-pro, gemini-3-pro-preview, gemini-2.5-flash-lite,
 * gemini-2.0-flash and every gemini-1.5-*. Keep them out of this list.
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

/** Models that reject `thinkingConfig.thinkingBudget` with 400 INVALID_ARGUMENT. */
const NO_THINKING_CONFIG_MODELS = new Set([
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-pro-latest',
]);

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function getGeminiApiKey() {
  return (
    (process.env.GEMINI_API_KEY || '').trim() ||
    (process.env.GOOGLE_GEMINI_API_KEY || '').trim() ||
    (process.env.GOOGLE_AI_API_KEY || '').trim()
  );
}

export function hasGeminiKey() {
  return getGeminiApiKey().length > 10;
}

/** Primary model then de-duplicated fallbacks. */
export function getModelChain(primary) {
  const first = (primary || process.env.GEMINI_MODEL || GEMINI_FALLBACK_MODELS[0]).trim();
  return [first, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== first)];
}

function thinkingBudgetFromEnv() {
  const raw = (process.env.GEMINI_THINKING_BUDGET || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Build an image part from a Buffer or base64 string. */
export function imagePart(data, mimeType = 'image/jpeg') {
  const base64 = Buffer.isBuffer(data) ? data.toString('base64') : String(data);
  return { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } };
}

export function textPart(text) {
  return { text: String(text) };
}

function buildGenerationConfig({ temperature, maxOutputTokens, schema, thinkingBudget, model }) {
  const cfg = {
    temperature: typeof temperature === 'number' ? temperature : 0.3,
    maxOutputTokens: maxOutputTokens || 4096,
  };
  if (schema) {
    cfg.responseMimeType = 'application/json';
    cfg.responseSchema = schema;
  }
  const budget = thinkingBudget !== undefined ? thinkingBudget : thinkingBudgetFromEnv();
  if (budget !== null && budget !== undefined && !NO_THINKING_CONFIG_MODELS.has(model)) {
    cfg.thinkingConfig = { thinkingBudget: budget };
  }
  return cfg;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => (p?.text || '')).join('').trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call Gemini once against a specific model.
 * Returns { ok, text, data, status, error, truncated }.
 */
async function callModel({ model, parts, contents, systemInstruction, generationConfig, timeoutMs, apiKey }) {
  const body = {
    contents: contents && contents.length ? contents : [{ role: 'user', parts }],
    generationConfig,
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: String(systemInstruction) }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e?.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? `Timed out after ${timeoutMs}ms` : (e?.message || 'Network error'), retryable: true };
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || res.statusText || `HTTP ${res.status}`;
    return {
      ok: false,
      status: res.status,
      error: message,
      retryable: RETRYABLE_STATUS.has(res.status),
      modelGone: res.status === 404,
    };
  }

  const finishReason = data?.candidates?.[0]?.finishReason || '';
  const text = extractText(data);
  if (!text) {
    const blocked = data?.promptFeedback?.blockReason || finishReason || 'empty response';
    return { ok: false, status: res.status, error: `No text returned (${blocked})`, retryable: finishReason === 'MAX_TOKENS' };
  }
  return { ok: true, text, data, status: res.status, truncated: finishReason === 'MAX_TOKENS' };
}

/**
 * Generate content with automatic model fallback and retry.
 *
 * @returns {Promise<{ok:boolean,text?:string,model?:string,error?:string,truncated?:boolean}>}
 */
export async function geminiGenerate({
  parts,
  contents = null,
  model,
  systemInstruction = null,
  schema = null,
  temperature,
  maxOutputTokens,
  thinkingBudget,
  timeoutMs = 90000,
  maxRetries = 2,
} = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY is not set in server/.env', noKey: true };
  }

  const chain = getModelChain(model);
  let lastError = 'Gemini request failed';

  for (const candidate of chain) {
    const generationConfig = buildGenerationConfig({
      temperature, maxOutputTokens, schema, thinkingBudget, model: candidate,
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const out = await callModel({
        model: candidate, parts, contents, systemInstruction, generationConfig, timeoutMs, apiKey,
      });
      if (out.ok) return { ok: true, text: out.text, data: out.data, model: candidate, truncated: out.truncated };

      lastError = `${candidate}: ${out.error}`;

      // A retired model never recovers — move to the next one immediately.
      if (out.modelGone) break;
      // thinkingConfig unsupported on this model: retry once without it.
      if (out.status === 400 && generationConfig.thinkingConfig) {
        delete generationConfig.thinkingConfig;
        continue;
      }
      if (!out.retryable || attempt === maxRetries) break;
      await sleep(700 * (attempt + 1) + Math.floor(Math.random() * 300));
    }
  }
  return { ok: false, error: lastError };
}

/** Tolerant JSON extraction — handles bare JSON, ```json fences and surrounding prose. */
export function parseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const attempt = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      try {
        // Tolerate trailing commas and // comments.
        return JSON.parse(s.replace(/\/\/[^\n]*/g, '').replace(/,(\s*[}\]])/g, '$1'));
      } catch {
        return null;
      }
    }
  };

  const direct = attempt(cleaned);
  if (direct && typeof direct === 'object') return direct;

  // Scan for the first balanced {...} block.
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const parsed = attempt(cleaned.slice(i, j + 1));
          if (parsed && typeof parsed === 'object') return parsed;
          break;
        }
      }
    }
  }
  return null;
}

/** geminiGenerate + JSON parse. Returns { ok, json, model, error }. */
export async function geminiGenerateJson(options) {
  const out = await geminiGenerate(options);
  if (!out.ok) return { ok: false, error: out.error, noKey: out.noKey };
  const json = parseJsonLoose(out.text);
  if (!json) {
    return {
      ok: false,
      model: out.model,
      error: out.truncated
        ? 'Response truncated before valid JSON (raise maxOutputTokens or lower thinkingBudget)'
        : 'Model did not return valid JSON',
      rawText: out.text.slice(0, 500),
    };
  }
  return { ok: true, json, model: out.model, truncated: out.truncated };
}

/**
 * Streaming generation. Invokes onToken(textChunk) as tokens arrive.
 * Returns { ok, model, fullText, error }.
 */
export async function geminiStream({
  parts,
  contents = null,
  model,
  systemInstruction = null,
  temperature = 0.7,
  maxOutputTokens = 2048,
  thinkingBudget,
  timeoutMs = 120000,
  onToken,
} = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY is not set in server/.env', noKey: true };

  const chain = getModelChain(model);
  let lastError = 'Gemini stream failed';

  for (const candidate of chain) {
    const generationConfig = buildGenerationConfig({
      temperature, maxOutputTokens, schema: null, thinkingBudget, model: candidate,
    });
    const body = {
      contents: contents && contents.length ? contents : [{ role: 'user', parts }],
      generationConfig,
    };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: String(systemInstruction) }] };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${GEMINI_API_BASE}/${candidate}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastError = `${candidate}: ${e?.name === 'AbortError' ? 'timed out' : (e?.message || 'network error')}`;
      continue;
    }

    if (!res.ok) {
      clearTimeout(timer);
      const errJson = await res.json().catch(() => ({}));
      lastError = `${candidate}: ${errJson?.error?.message || res.statusText}`;
      if (res.status === 404) continue;      // retired model — try next
      if (RETRYABLE_STATUS.has(res.status)) continue;
      return { ok: false, error: lastError, status: res.status };
    }

    // Gemini SSE frames look like: `data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}`
    let full = '';
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += chunk.toString('utf8');
        const frames = buffer.split('\n');
        buffer = frames.pop() || '';
        for (const line of frames) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const piece = (parsed?.candidates?.[0]?.content?.parts || [])
            .map((p) => p?.text || '')
            .join('');
          if (piece) {
            full += piece;
            if (onToken) onToken(piece);
          }
        }
      }
      clearTimeout(timer);
      return { ok: true, model: candidate, fullText: full };
    } catch (e) {
      clearTimeout(timer);
      if (full) return { ok: true, model: candidate, fullText: full, partial: true };
      lastError = `${candidate}: ${e?.message || 'stream error'}`;
    }
  }
  return { ok: false, error: lastError };
}

/** Lightweight connectivity check used by /api/vision/gemini-status. */
export async function testGeminiConnection() {
  if (!getGeminiApiKey()) {
    return { ok: false, error: 'No API key set. Add GEMINI_API_KEY to server/.env and restart.' };
  }
  const out = await geminiGenerate({
    parts: [textPart('Reply with OK')],
    maxOutputTokens: 512,
    temperature: 0,
    timeoutMs: 30000,
    maxRetries: 1,
  });
  return out.ok ? { ok: true, model: out.model } : { ok: false, error: out.error };
}
