/**
 * Live market price: Tavily web search -> Gemini extraction -> structured price.
 *
 * Gemini is the primary extractor (DeepSeek is used only if it is configured and
 * Gemini is not). The extractor is given the actual page snippets and their URLs
 * and must cite which source a number came from, so a price is only treated as
 * "live" when it is genuinely backed by a search result.
 */
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { geminiGenerate, textPart, hasGeminiKey } from './geminiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_TTL_MS = Math.max(1, Number(process.env.LIVE_PRICE_CACHE_HOURS) || 6) * 60 * 60 * 1000;
const cache = new Map();

const WASTE_LABELS = {
  paddy_husk: 'Paddy Husk',
  rice_straw: 'Rice Straw',
  rice_husk: 'Rice Husk',
  wheat_straw: 'Wheat Straw',
  corn_stalks: 'Corn Stalks',
  sugarcane_bagasse: 'Sugarcane Bagasse',
  coconut_shells: 'Coconut Shells',
  groundnut_shell: 'Groundnut Shell',
  maize_cob: 'Maize Cob',
  oilseed_waste: 'Oilseed Waste',
  brewery_spent_grains: 'Brewery Spent Grains',
  fruit_waste: 'Fruit Waste',
  vegetable_waste: 'Vegetable Waste',
  other_agro_waste: 'Other Agricultural Waste',
};

/** Normalize to a stable key for cache/lookups. Preserves underscore keys (e.g. rice_straw). */
function toWasteKey(wasteType) {
  const s = String(wasteType || '').trim();
  const keyForm = s.toLowerCase().replace(/\s+/g, '_');
  if (WASTE_LABELS[keyForm]) return keyForm;
  const entry = Object.entries(WASTE_LABELS).find(([, label]) => label.toLowerCase() === s.toLowerCase());
  if (entry) return entry[0];
  return keyForm || 'paddy_husk';
}

const FALLBACK_RANGES = {
  paddy_husk: { min: 1.2, max: 2.8 },
  rice_straw: { min: 1.0, max: 2.5 },
  rice_husk: { min: 1.3, max: 3.0 },
  wheat_straw: { min: 0.8, max: 2.2 },
  corn_stalks: { min: 0.6, max: 1.8 },
  sugarcane_bagasse: { min: 1.5, max: 3.5 },
  coconut_shells: { min: 2.0, max: 4.5 },
  groundnut_shell: { min: 1.8, max: 4.2 },
  maize_cob: { min: 1.1, max: 2.8 },
  oilseed_waste: { min: 1.2, max: 3.0 },
  brewery_spent_grains: { min: 1.8, max: 3.8 },
  fruit_waste: { min: 0.5, max: 1.6 },
  vegetable_waste: { min: 0.5, max: 1.5 },
  other_agro_waste: { min: 1.0, max: 3.0 },
};

function getFallbackRange(key) {
  if (FALLBACK_RANGES[key]) return FALLBACK_RANGES[key];

  if (/(shell|husk|cob)/.test(key)) return { min: 1.6, max: 4.2 };
  if (/(pomace|bagasse|brewery)/.test(key)) return { min: 1.6, max: 3.8 };
  if (/(fruit|vegetable|banana|mango|tomato|citrus|cassava|potato)/.test(key)) return { min: 0.5, max: 1.9 };
  if (/(straw|stalk|vine|efb)/.test(key)) return { min: 0.8, max: 2.7 };
  if (/(tea|coffee|tobacco|hemp|jute|olive|cocoa|sesame|castor|almond|cashew|pea|gram|lentil|bean|cowpea|tur|rapeseed|sorghum|millet|rye)/.test(key)) {
    return { min: 1.0, max: 3.2 };
  }
  return { min: 1.0, max: 3.0 };
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTrend(value) {
  return ['rising', 'falling', 'stable'].includes(value) ? value : 'stable';
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low';
}

/**
 * Normalize model output and reject generic/outlier values
 * so one bad extraction does not show same price for all crops.
 */
function sanitizeExtracted(extracted, wasteType) {
  if (!extracted || typeof extracted !== 'object') return null;
  const key = toWasteKey(wasteType);
  const fallback = getFallbackRange(key);

  const confidence = normalizeConfidence(extracted.confidence);
  const trend = normalizeTrend(extracted.trend);
  const rawPrice = toNumberOrNull(extracted.pricePerKg);

  let min = toNumberOrNull(extracted?.priceRange?.min);
  let max = toNumberOrNull(extracted?.priceRange?.max);
  if (min == null || max == null || min <= 0 || max <= 0 || min > max) {
    min = fallback.min;
    max = fallback.max;
  }

  // A price actually cited from a search result is allowed to sit further outside
  // the reference band — real markets move, and clamping every sourced quote back
  // to the band is what made every crop show the same static number.
  // A high-confidence bulk quote gets the most room; a "medium" one is often a
  // retail marketplace listing (see extraction rule 8) and is held closer in, so
  // small-pack prices several times the real trade rate do not reach the UI.
  const sourced = extracted.foundRealPrice === true && confidence !== 'low';
  const lowGuard = sourced ? 0.35 : 0.6;
  const highGuard = confidence === 'high' ? 2.5 : sourced ? 2.0 : 1.8;

  const generic15 = rawPrice != null && Math.abs(rawPrice - 15) < 0.01 && confidence !== 'high';
  const tooLow = rawPrice != null && rawPrice < fallback.min * lowGuard;
  const tooHigh = rawPrice != null && rawPrice > fallback.max * highGuard;

  let price = rawPrice;
  // Track whether we discarded the scraped number. If we did, the result is no
  // longer "live" and must not keep citing a source that says something else.
  let overridden = false;
  if (price == null || price <= 0 || generic15 || tooLow || tooHigh) {
    price = (fallback.min + fallback.max) / 2;
    min = fallback.min;
    max = fallback.max;
    overridden = true;
  } else if (confidence === 'low' && (price < fallback.min * 0.8 || price > fallback.max * 1.4)) {
    price = (fallback.min + fallback.max) / 2;
    min = fallback.min;
    max = fallback.max;
    overridden = true;
  }

  // Keep the band consistent with the chosen price.
  if (price < min) min = Number((price * 0.85).toFixed(2));
  if (price > max) max = Number((price * 1.15).toFixed(2));

  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  // When the scraped price was rejected, stop attributing the number to that
  // source — otherwise the UI shows a quote that contradicts the price.
  // The usual reason for an override is a retail marketplace listing (small pack
  // or sample) running several times the bulk trade rate. Say that plainly rather
  // than reporting it as a failure — the band is the better answer for bulk.
  const source = overridden
    ? `Bulk reference rate · retail listing excluded · ${dateStr}`
    : (extracted.source && String(extracted.source).trim()
      ? String(extracted.source).trim()
      : `Tavily · ${dateStr}`);
  const lastUpdated = extracted.lastUpdated
    ? String(extracted.lastUpdated)
    : new Date().toISOString().slice(0, 10);

  return {
    overridden,
    pricePerKg: Number(price.toFixed(2)),
    priceRange: {
      min: Number(Math.max(0.1, min).toFixed(2)),
      max: Number(Math.max(min + 0.1, max).toFixed(2)),
    },
    trend,
    confidence,
    source,
    lastUpdated,
  };
}

function cacheKey(wasteType, city) {
  return `${String(wasteType || '').trim().toLowerCase()}:${String(city || '').trim()}`;
}

/* ── Disk-backed cache ──────────────────────────────────────────────────────
 * Prices are written to disk so a server restart does not throw away work that
 * cost dozens of web searches. Two ages matter:
 *   FRESH  — served as-is, no network at all.
 *   STALE  — still served instantly, but a background refresh is queued.
 * Nothing ever blocks a request on the network once a price has been seen once.
 */
const CACHE_FILE = path.join(__dirname, '..', 'data', 'live-prices-cache.json');
const FRESH_MS = CACHE_TTL_MS;
const STALE_MS = 30 * 24 * 60 * 60 * 1000; // keep serving for a month while refreshing

let diskWriteTimer = null;
let cacheLoaded = false;

function loadCacheFromDisk() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    let count = 0;
    for (const [key, entry] of Object.entries(parsed || {})) {
      if (entry && entry.data && typeof entry.cachedAt === 'number') {
        cache.set(key, entry);
        count++;
      }
    }
    if (count) console.log(`Live prices: restored ${count} cached prices from disk`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Live prices: could not read cache file:', err.message);
  }
}

/** Debounced so a burst of refreshes results in one write. */
function scheduleDiskWrite() {
  if (diskWriteTimer) return;
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      const out = {};
      for (const [key, entry] of cache.entries()) out[key] = entry;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(out), 'utf8');
    } catch (err) {
      console.warn('Live prices: could not write cache file:', err.message);
    }
  }, 2000);
  if (diskWriteTimer.unref) diskWriteTimer.unref();
}

/** Returns { data, age: 'fresh' | 'stale' } or null when nothing usable is cached. */
function getCached(key) {
  loadCacheFromDisk();
  const entry = cache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.cachedAt;
  if (age > STALE_MS) return null;
  return { data: entry.data, age: age > FRESH_MS ? 'stale' : 'fresh' };
}

function setCache(key, data) {
  cache.set(key, { data, cachedAt: Date.now() });
  scheduleDiskWrite();
}

/**
 * Search the web for a real quoted price.
 *
 * Two queries run in parallel — one city-specific, one national — because many
 * crop residues have no city-level listing at all, and a national trade price is
 * far better evidence than falling straight back to the reference band.
 */
/* Tavily answers 432 when the plan's search allowance is spent. Every remaining
 * crop would fail the same way, so the first 432 opens this breaker and the rest
 * of the run skips the network entirely and serves reference bands instead of
 * spending minutes discovering the same dead end 48 more times. */
let tavilyBlockedUntil = 0;
let tavilyBlockReason = '';

export function getTavilyStatus() {
  return tavilyBlockedUntil > Date.now()
    ? { ok: false, reason: tavilyBlockReason, retryAt: new Date(tavilyBlockedUntil).toISOString() }
    : { ok: true };
}

async function tavilySearch(wasteType, city) {
  const apiKey = (process.env.TAVILY_API_KEY || '').trim();
  if (!apiKey) return null;
  if (tavilyBlockedUntil > Date.now()) return null;
  const label = WASTE_LABELS[wasteType] || String(wasteType).replace(/_/g, ' ');
  const monthYear = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Indian B2B marketplaces carry actual per-kg quotes for crop residue, but
  // restricting every query to them yields only retail listings. The third query
  // runs unrestricted so mandi reports, biomass trade news and government rate
  // pages can supply the bulk prices the extractor is told to prefer.
  const TRADE_DOMAINS = [
    'indiamart.com', 'tradeindia.com', 'exportersindia.com', 'agmarknet.gov.in',
    'commodityonline.com', 'krishijagran.com', 'business-standard.com',
    'thehindubusinessline.com', 'economictimes.indiatimes.com', 'biofuelcircle.com',
  ];

  // Tavily credits are finite, so spend at most two searches per crop: one aimed
  // at the B2B trade sites, one unrestricted for mandi/news/government rates.
  // LIVE_PRICE_SEARCHES=1 halves the spend on a tight plan.
  const searchCount = Math.min(2, Math.max(1, Number(process.env.LIVE_PRICE_SEARCHES) || 2));
  const allQueries = [
    { q: `${label} price per kg ${city} India ${monthYear} rate supplier wholesale`, restrict: true },
    { q: `${label} bulk biomass trade price per tonne India ${monthYear} mandi wholesale rate`, restrict: false },
  ];
  const queries = allQueries.slice(0, searchCount);

  const runOne = async ({ q, restrict }) => {
    const body = {
      query: q,
      search_depth: 'advanced',
      max_results: 6,
      include_answer: true,
    };
    if (restrict) body.include_domains = TRADE_DOMAINS;
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // 432 = plan allowance spent, 429 = rate limited. Both mean "stop asking".
      if (res.status === 432 || res.status === 429) {
        const detail = await res.json().catch(() => ({}));
        const msg = detail?.detail?.error || detail?.error || `Tavily ${res.status}`;
        if (tavilyBlockedUntil <= Date.now()) {
          console.error(
            `❌ Tavily unavailable (HTTP ${res.status}): ${msg}\n` +
            '   Live prices will fall back to bulk reference rates until the quota resets ' +
            'or TAVILY_API_KEY is replaced.'
          );
        }
        tavilyBlockedUntil = Date.now() + 30 * 60 * 1000; // re-probe in 30 min
        tavilyBlockReason = msg;
        const err = new Error(msg);
        err.quotaExceeded = true;
        throw err;
      }
      throw new Error(`Tavily ${res.status}`);
    }
    return res.json();
  };

  const settled = await Promise.allSettled(queries.map(runOne));
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!ok.length) return null;

  // Merge both result sets, de-duplicated by URL.
  const seen = new Set();
  const results = [];
  for (const set of ok) {
    for (const r of (set.results || [])) {
      const url = r.url || '';
      if (url && seen.has(url)) continue;
      if (url) seen.add(url);
      results.push(r);
    }
  }
  const answer = ok.map((s) => s.answer).filter(Boolean).join('\n\n');
  // No evidence at all is a failed search, not a search proving no price exists.
  // Returning null keeps the caller from caching a reference band that would then
  // be served for the whole TTL even after search starts working again.
  if (!results.length && !answer) return null;
  return { answer, results };
}

/** Compact the search hits into a numbered, citable evidence block. */
function buildEvidence(searchResults) {
  const lines = [];
  if (searchResults?.answer) {
    lines.push(`SEARCH SUMMARY:\n${String(searchResults.answer).slice(0, 1200)}`);
  }
  const results = Array.isArray(searchResults?.results) ? searchResults.results.slice(0, 8) : [];
  results.forEach((r, i) => {
    const content = String(r.content || '').replace(/\s+/g, ' ').slice(0, 600);
    lines.push(`[${i + 1}] ${r.title || 'Untitled'}\n    URL: ${r.url || 'n/a'}\n    ${content}`);
  });
  return lines.join('\n\n') || 'No search results available.';
}

const PRICE_EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    foundRealPrice: {
      type: 'BOOLEAN',
      description: 'True ONLY if a search result states an actual price for this material',
    },
    pricePerKg: { type: 'NUMBER' },
    priceRange: {
      type: 'OBJECT',
      properties: { min: { type: 'NUMBER' }, max: { type: 'NUMBER' } },
      required: ['min', 'max'],
    },
    trend: { type: 'STRING', enum: ['rising', 'falling', 'stable'] },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    citedSourceIndex: { type: 'NUMBER', description: 'The [n] evidence item the price came from, or 0' },
    sourceName: { type: 'STRING', description: 'Short publisher/site name, e.g. "IndiaMART"' },
    evidenceQuote: { type: 'STRING', description: 'The exact phrase containing the price' },
    isCitySpecific: { type: 'BOOLEAN' },
  },
  required: ['foundRealPrice', 'pricePerKg', 'priceRange', 'trend', 'confidence',
             'citedSourceIndex', 'sourceName', 'evidenceQuote', 'isCitySpecific'],
};

/** Gemini extraction — the primary path. */
async function geminiExtract(wasteType, city, searchResults) {
  if (!hasGeminiKey()) return null;
  const label = WASTE_LABELS[wasteType] || String(wasteType).replace(/_/g, ' ');
  const today = new Date().toLocaleDateString('en-IN');
  const range = getFallbackRange(toWasteKey(wasteType));

  const prompt = `You extract commodity prices for Indian agricultural markets.

TASK: find the current market price of "${label}" (crop residue / agricultural waste) in ${city}, India.
Today is ${today}.

EVIDENCE FROM WEB SEARCH:
${buildEvidence(searchResults)}

RULES
1. Set foundRealPrice to true ONLY when one of the numbered results above states an actual
   price for this material. If the results are irrelevant, off-topic, or discuss a different
   commodity, set foundRealPrice to false.
2. When foundRealPrice is true: set citedSourceIndex to that [n], sourceName to the site name,
   and evidenceQuote to the exact phrase containing the price.
3. Convert every price to INR per KILOGRAM before reporting. Watch the units carefully —
   sources often quote per tonne, per quintal (100 kg), per bag or per piece.
   per tonne -> divide by 1000. per quintal -> divide by 100.
4. Set isCitySpecific true only if the price is explicitly for ${city} or its state.
5. confidence: "high" = an explicit recent per-kg price for this exact material;
   "medium" = a price needing unit conversion or from a nearby region/related grade;
   "low" = inferred or no usable price found.
6. If foundRealPrice is false, set citedSourceIndex to 0, pricePerKg to the midpoint of the
   reference band ₹${range.min}-₹${range.max}/kg, and confidence to "low".
7. Realistic Indian crop-residue prices are ₹0.30-₹15/kg. A number far outside that almost
   always means you missed a unit conversion — recheck rule 3 before answering.
8. Prefer BULK / WHOLESALE / farm-gate / mandi trade prices — this is a tonne-scale residue
   trade. Marketplace listings (IndiaMART, Alibaba and similar) often quote retail per-kg
   rates for small packs or samples, which run several times the real bulk rate. If the only
   price you can find is such a retail or small-quantity listing, still report it but set
   confidence to "medium" at most, and prefer a bulk quote whenever the evidence has one.
9. Prefer the most recent price. If several credible bulk prices disagree, report the median
   of them rather than the highest.`;

  const out = await geminiGenerate({
    parts: [textPart(prompt)],
    schema: PRICE_EXTRACT_SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 3072,
    timeoutMs: 45000,
    maxRetries: 1,
  });
  if (!out.ok) {
    console.warn('liveMarketPrice: Gemini extract failed:', out.error);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(out.text);
  } catch {
    return null;
  }

  // Build a human-readable attribution string for the UI.
  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  let source;
  if (parsed.foundRealPrice && parsed.sourceName) {
    const scope = parsed.isCitySpecific ? city : 'India';
    source = `${parsed.sourceName} via Tavily · ${scope} · ${dateStr}`;
  } else {
    source = `Reference band (no live quote found) · ${dateStr}`;
  }

  return {
    pricePerKg: parsed.pricePerKg,
    priceRange: parsed.priceRange,
    trend: parsed.trend,
    // Never let an unsourced number claim high confidence.
    confidence: parsed.foundRealPrice ? parsed.confidence : 'low',
    source,
    lastUpdated: new Date().toISOString().slice(0, 10),
    foundRealPrice: Boolean(parsed.foundRealPrice),
    evidenceQuote: String(parsed.evidenceQuote || '').slice(0, 300),
    isCitySpecific: Boolean(parsed.isCitySpecific),
  };
}

async function deepSeekExtract(wasteType, city, searchResults) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const label = WASTE_LABELS[wasteType] || String(wasteType).replace(/_/g, ' ');
  const today = new Date().toLocaleDateString('en-IN');
  const context = searchResults?.answer || (Array.isArray(searchResults?.results)
    ? searchResults.results.map((r) => r.content || '').join('\n')
    : 'No results');
  const fallbackRange = getFallbackRange(wasteType);

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: 'You are a commodity price extraction expert for Indian agricultural markets. Extract structured price data from search results. Return ONLY valid JSON, no markdown, no code block.',
        },
        {
          role: 'user',
          content: `From these search results, extract the current market price for ${label} in ${city}, India. Today is ${today}.\n\nSearch results:\n${context.slice(0, 3000)}\n\nReturn exactly this JSON (no other text):\n{"pricePerKg": number, "confidence": "high"|"medium"|"low", "source": "string", "priceRange": {"min": number, "max": number}, "trend": "rising"|"falling"|"stable", "lastUpdated": "string"}\n\nIf no real price found, set confidence to "low" and use this fallback range for ${label}: INR ${fallbackRange.min}-${fallbackRange.max} per kg. Avoid generic placeholder values (like 10 or 15) across all crops.`,
        },
      ],
      max_tokens: 400,
      temperature: 0.2,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const content = data?.choices?.[0]?.message?.content?.trim() || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function buildResponse(extracted, wasteType, quantityTons = 1) {
  const key = toWasteKey(wasteType);
  const range = getFallbackRange(key);
  const normalized = extracted || null;

  const pricePerKg = normalized?.pricePerKg ?? Number((((range.min + range.max) / 2)).toFixed(2));
  const priceRange = normalized?.priceRange ?? { min: range.min, max: range.max };
  const trend = normalized?.trend ?? 'stable';
  const confidence = normalized?.confidence ?? 'low';
  const source = normalized?.source ?? 'Estimated (configure API keys for live rates)';
  const lastUpdated = normalized?.lastUpdated ?? new Date().toISOString().slice(0, 10);
  const carbonPerKg = 0.34;
  const carbonValuePerTon = carbonPerKg * 1000;
  const totalLotValue = pricePerKg * quantityTons * 1000;

  return {
    pricePerKg,
    priceRange,
    trend,
    confidence,
    source,
    lastUpdated,
    carbonValuePerTon,
    totalLotValue: Math.round(totalLotValue),
    // Provenance: lets the UI distinguish a real scraped quote from the
    // reference-band estimate instead of labelling everything the same way.
    isLive: Boolean(normalized?.foundRealPrice),
    evidenceQuote: normalized?.evidenceQuote ?? null,
    isCitySpecific: Boolean(normalized?.isCitySpecific),
    city: normalized?.city ?? null,
  };
}

const ESTIMATE_BATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    prices: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          wasteType: { type: 'STRING' },
          pricePerKg: { type: 'NUMBER' },
          min: { type: 'NUMBER' },
          max: { type: 'NUMBER' },
          trend: { type: 'STRING', enum: ['rising', 'falling', 'stable'] },
        },
        required: ['wasteType', 'pricePerKg', 'min', 'max', 'trend'],
      },
    },
  },
  required: ['prices'],
};

/**
 * Price many crops in one Gemini call, with no web search.
 *
 * This is the path used when Tavily has nothing to give — no key, or the plan's
 * search allowance is spent. Gemini's own knowledge of Indian residue trade is a
 * far better answer than one static band per crop, and one batched call fills the
 * whole grid in seconds instead of 49 separate round trips.
 *
 * Results are marked confidence "low" and sourced as an estimate — they are not
 * presented as live quotes.
 */
async function geminiEstimateBatch(wasteKeys, city) {
  if (!hasGeminiKey() || !wasteKeys.length) return new Map();
  const monthYear = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const lines = wasteKeys
    .map((k) => {
      const band = getFallbackRange(k);
      return `- ${k} ("${WASTE_LABELS[k] || k.replace(/_/g, ' ')}") reference ₹${band.min}-₹${band.max}/kg`;
    })
    .join('\n');

  const prompt = `You are a commodity analyst for the Indian agricultural residue trade.

Give your best estimate of the current BULK / farm-gate / mandi price in INR per kilogram
for each crop residue below, for ${city}, India, as of ${monthYear}.

CROPS (use the exact wasteType id in your answer):
${lines}

RULES
1. Price the BULK tonne-scale trade, not retail marketplace listings. Retail listings for
   these materials often run several times the real bulk rate — do not anchor on them.
2. Prices must be crop-specific and reflect real differences between materials. Do NOT
   return the same number for many crops.
3. The reference band shown is a rough prior. Stay near it unless you have good reason,
   and keep every number within ₹0.30-₹15/kg.
4. min and max bound a realistic local trading range around your price.
5. Adjust for ${city}'s region where a material is locally abundant or scarce.
6. Return one entry for every wasteType listed above.`;

  const out = await geminiGenerate({
    parts: [textPart(prompt)],
    schema: ESTIMATE_BATCH_SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 8192,
    timeoutMs: 90000,
    maxRetries: 1,
  });
  if (!out.ok) {
    console.warn('liveMarketPrice: batch estimate failed:', out.error);
    return new Map();
  }
  let parsed;
  try {
    parsed = JSON.parse(out.text);
  } catch {
    return new Map();
  }

  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const map = new Map();
  for (const row of parsed?.prices || []) {
    const key = toWasteKey(row?.wasteType);
    if (!key || !wasteKeys.includes(key)) continue;
    // Reuse the shared guards so an estimate is bounded exactly like a scraped price.
    const sanitized = sanitizeExtracted(
      {
        foundRealPrice: false,
        pricePerKg: row.pricePerKg,
        priceRange: { min: row.min, max: row.max },
        trend: row.trend,
        confidence: 'low',
      },
      key
    );
    if (!sanitized) continue;
    sanitized.source = `Gemini estimate · bulk rate · ${dateStr}`;
    sanitized.foundRealPrice = false;
    sanitized.isCitySpecific = false;
    sanitized.city = city;
    map.set(key, sanitized);
  }
  return map;
}

/**
 * Fill every uncached crop for a city in one batched Gemini call and persist the
 * result, so the grid always has a number to show instead of spinning forever.
 */
async function estimateAndCacheMissing(wasteKeys, city) {
  const missing = wasteKeys.filter((k) => !getCached(cacheKey(k, city)));
  if (!missing.length) return 0;
  const estimates = await geminiEstimateBatch(missing, city);
  let n = 0;
  for (const [key, data] of estimates.entries()) {
    setCache(cacheKey(key, city), data);
    n++;
  }
  if (n) console.log(`Live prices: cached ${n} estimated prices for ${city}`);
  return n;
}

/**
 * Do the actual network work for one crop+city: search, then extract.
 * Returns the sanitized record (also written to cache) or null.
 */
async function fetchFreshPrice(w, c) {
  let searchResults = null;
  try {
    searchResults = await tavilySearch(w, c);
  } catch (err) {
    console.warn('liveMarketPrice: Tavily error', err.message);
  }

  // Gemini first; DeepSeek only if Gemini is unavailable but DeepSeek is configured.
  let extracted = null;
  if (searchResults) {
    try {
      extracted = await geminiExtract(w, c, searchResults);
    } catch (err) {
      console.warn('liveMarketPrice: Gemini error', err.message);
    }
    if (!extracted && process.env.DEEPSEEK_API_KEY) {
      try {
        extracted = await deepSeekExtract(w, c, searchResults);
      } catch (err) {
        console.warn('liveMarketPrice: DeepSeek error', err.message);
      }
    }
  }

  const sanitized = sanitizeExtracted(extracted, w);
  // sanitizeExtracted only understands the shared fields; carry the provenance
  // through so the UI can show where a live number actually came from.
  if (sanitized && extracted) {
    // A price we had to override is not a live quote, whatever the extractor said.
    const stillLive = Boolean(extracted.foundRealPrice) && !sanitized.overridden;
    sanitized.foundRealPrice = stillLive;
    sanitized.evidenceQuote = stillLive ? (extracted.evidenceQuote || null) : null;
    sanitized.isCitySpecific = stillLive && Boolean(extracted.isCitySpecific);
    sanitized.city = c;
  }
  if (sanitized) setCache(cacheKey(w, c), sanitized);
  return sanitized;
}

/* ── Background refresh queue ───────────────────────────────────────────────
 * Requests never wait on the network when anything is cached. Misses and stale
 * entries are queued here and worked off a few at a time, so asking for 49
 * crops at once does not open 49 simultaneous Tavily + Gemini conversations.
 */
const REFRESH_CONCURRENCY = Math.max(1, Number(process.env.LIVE_PRICE_CONCURRENCY) || 4);
const refreshQueue = [];
const queued = new Set();
const inflight = new Map();
let activeWorkers = 0;

/** Coalesces duplicate work: the same crop+city in flight is awaited, not repeated. */
function refreshOnce(w, c) {
  const key = cacheKey(w, c);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchFreshPrice(w, c)
    .catch((err) => {
      console.warn(`liveMarketPrice: refresh failed for ${key}:`, err.message);
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function pumpQueue() {
  while (activeWorkers < REFRESH_CONCURRENCY && refreshQueue.length) {
    const { w, c, key } = refreshQueue.shift();
    queued.delete(key);
    activeWorkers++;
    refreshOnce(w, c).finally(() => {
      activeWorkers--;
      pumpQueue();
    });
  }
}

function queueRefresh(w, c) {
  const key = cacheKey(w, c);
  if (queued.has(key) || inflight.has(key)) return;
  queued.add(key);
  refreshQueue.push({ w, c, key });
  pumpQueue();
}

/**
 * Get live market price for wasteType + city.
 *
 * Never blocks on the network if a usable cached price exists — a stale price is
 * returned immediately and refreshed in the background. `waitForFresh` forces the
 * blocking path for the rare caller that genuinely needs a fresh number inline.
 *
 * @param {string} wasteType - e.g. paddy_husk
 * @param {string} city - e.g. Chennai
 * @param {number} [quantityTons] - for totalLotValue
 * @param {{ waitForFresh?: boolean }} [opts]
 */
export async function getLiveMarketPrice(wasteType, city, quantityTons = 1, opts = {}) {
  const w = toWasteKey(wasteType);
  const c = (city && String(city).trim()) || 'Chennai';
  const key = cacheKey(w, c);
  const cached = getCached(key);

  if (cached) {
    if (cached.age === 'stale') queueRefresh(w, c);
    return { ...buildResponse(cached.data, w, quantityTons), cached: true, stale: cached.age === 'stale' };
  }

  // Nothing cached. Blocking callers wait; everyone else gets the reference band
  // now and the live number on a later request.
  if (opts.waitForFresh) {
    const fresh = await refreshOnce(w, c);
    return { ...buildResponse(fresh, w, quantityTons), cached: false, stale: false };
  }

  queueRefresh(w, c);
  return { ...buildResponse(null, w, quantityTons), cached: false, pending: true };
}

/**
 * Prices for many crops in one call, for the Live Prices grid.
 *
 * Returns instantly: cached crops carry their real price, uncached ones come back
 * with `pending: true` and the reference band, and get filled in by the background
 * queue. The client re-requests until nothing is pending.
 */
export async function getLiveMarketPricesBulk(wasteTypes, city, quantityTons = 1, opts = {}) {
  const c = (city && String(city).trim()) || 'Chennai';
  const list = Array.isArray(wasteTypes) ? wasteTypes : [];
  const prices = list.map((wt) => {
    const w = toWasteKey(wt);
    const cached = getCached(cacheKey(w, c));
    if (cached) {
      // On an explicit refresh, re-queue even fresh entries — the user asked for
      // new numbers — but still answer from cache so the grid never blanks out.
      if (cached.age === 'stale' || opts.forceRefresh) queueRefresh(w, c);
      return {
        wasteType: w,
        ...buildResponse(cached.data, w, quantityTons),
        cached: true,
        pending: false,
        stale: cached.age === 'stale',
      };
    }
    queueRefresh(w, c);
    return { wasteType: w, ...buildResponse(null, w, quantityTons), cached: false, pending: true };
  });

  // Anything still uncached gets a batched estimate so the grid always resolves,
  // even when web search is unavailable. Fire-and-forget: this request already has
  // its answer, and the next poll picks the estimates up from cache.
  const pending = prices.filter((p) => p.pending).map((p) => p.wasteType);
  if (pending.length) startEstimateFill(pending, c);

  return {
    city: c,
    prices,
    pendingCount: pending.length,
    searchAvailable: getTavilyStatus().ok,
  };
}

/* One batched estimate per city at a time — a grid that polls every 5s must not
 * start a new fill on every poll. */
const estimateInflight = new Map();

function startEstimateFill(wasteKeys, city) {
  if (estimateInflight.has(city)) return estimateInflight.get(city);
  const p = estimateAndCacheMissing(wasteKeys, city)
    .catch((err) => {
      console.warn('liveMarketPrice: estimate fill failed:', err.message);
      return 0;
    })
    .finally(() => estimateInflight.delete(city));
  estimateInflight.set(city, p);
  return p;
}

/** Warm the cache for a city in the background so the first visit is already fast. */
export function warmCache(wasteTypes, city) {
  const c = (city && String(city).trim()) || 'Chennai';
  const keys = (wasteTypes || []).map(toWasteKey);
  const missing = keys.filter((w) => !getCached(cacheKey(w, c)));
  if (!missing.length) return;

  for (const w of missing) queueRefresh(w, c);

  // The search queue above only fills crops that have a findable quote. Follow it
  // with a batched estimate so every remaining crop still ends up cached — the
  // grid should never open on a screen of spinners.
  startEstimateFill(missing, c);
}

/** Fallback when API fails � always returns valid shape so UI never sees 404. */
export function getLiveMarketPriceFallback(wasteType, city, quantityTons = 1) {
  const w = toWasteKey(wasteType);
  const c = (city && String(city).trim()) || 'Chennai';
  return buildResponse(null, w, quantityTons);
}
