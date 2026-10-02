/**
 * AgroScope AI Price Negotiation — Gemini or DeepSeek, enriched with Tavily search.
 * GET /api/price-negotiation/market-price, POST /api/price-negotiation/chat (SSE stream).
 *
 * Provider is chosen by NEGOTIATION_AI_PROVIDER ("gemini" | "deepseek" | "auto").
 * With "auto" (the default) Gemini is used when GEMINI_API_KEY is set, otherwise
 * DeepSeek. Whichever provider runs, the wire format stays OpenAI-style SSE so
 * the existing frontend parser is unchanged.
 */
import express from 'express';
import fetch from 'node-fetch';
import { geminiStream, geminiGenerate, textPart, hasGeminiKey } from '../services/geminiClient.js';

const router = express.Router();

function deepseekKey() {
  const key = process.env.DEEPSEEK_API_KEY ? String(process.env.DEEPSEEK_API_KEY).trim() : '';
  return key.length >= 10 ? key : '';
}

/** Which AI backs the negotiation chat right now. */
function resolveProvider() {
  const configured = (process.env.NEGOTIATION_AI_PROVIDER || 'auto').trim().toLowerCase();
  if (configured === 'gemini') return hasGeminiKey() ? 'gemini' : (deepseekKey() ? 'deepseek' : null);
  if (configured === 'deepseek') return deepseekKey() ? 'deepseek' : (hasGeminiKey() ? 'gemini' : null);
  if (hasGeminiKey()) return 'gemini';
  if (deepseekKey()) return 'deepseek';
  return null;
}

/** Chat history -> Gemini `contents`. Gemini uses "model" where OpenAI uses "assistant". */
function toGeminiContents(messages) {
  const list = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && String(m.content || '').trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content).trim() }],
    }));
  // Gemini requires the conversation to start with a user turn.
  while (list.length && list[0].role === 'model') list.shift();
  return list;
}

/** Wrap a text chunk in the OpenAI streaming shape the frontend already parses. */
function sseChunk(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

const WASTE_LABELS = {
  paddy_husk: 'Paddy Husk',
  wheat_straw: 'Wheat Straw',
  corn_stalks: 'Corn Stalks',
  sugarcane_bagasse: 'Sugarcane Bagasse',
  coconut_shells: 'Coconut Shells',
};

function getLanguageExample(code) {
  const examples = {
    hi: 'आपके पास 2.5 टन पैडी भूसी है। आज का बाजार मूल्य ₹2.47/किग्रा है।',
    ta: 'உங்களிடம் 2.5 டன் நெல் தவிடு உள்ளது. இன்றைய சந்தை விலை ₹2.47/கிலோ.',
    te: 'మీకు 2.5 టన్నుల వరి పొట్టు ఉంది. నేటి మార్కెట్ ధర ₹2.47/కిలో.',
    kn: 'ನಿಮ್ಮಲ್ಲಿ 2.5 ಟನ್ ಭತ್ತದ ಹೊಟ್ಟು ಇದೆ. ಇಂದಿನ ಮಾರುಕಟ್ಟೆ ಬೆಲೆ ₹2.47/ಕಿಲೋ.',
    ml: 'നിങ്ങളുടെ പക്കൽ 2.5 ടൺ നെൽത്തൊലി ഉണ്ട്. ഇന്നത്തെ വിപണി വില ₹2.47/കിലോ.',
    mr: 'तुमच्याकडे 2.5 टन भाताची भुसी आहे. आजचा बाजारभाव ₹2.47/किलो आहे.',
    bn: 'আপনার কাছে 2.5 টন ধানের তুষ আছে। আজকের বাজার মূল্য ₹2.47/কেজি।',
    gu: 'તમારી પાસે 2.5 ટન ડાંગરની ભૂસી છે. આજનો બજાર ભાવ ₹2.47/કિલો છે.',
    pa: 'ਤੁਹਾਡੇ ਕੋਲ 2.5 ਟਨ ਝੋਨੇ ਦੀ ਭੁੱਸ ਹੈ। ਅੱਜ ਦਾ ਬਾਜ਼ਾਰ ਭਾਅ ₹2.47/ਕਿਲੋ ਹੈ।',
    ur: 'آپ کے پاس 2.5 ٹن چاول کی بھوسی ہے۔ آج کی مارکیٹ قیمت ₹2.47/کلو ہے۔',
  };
  return examples[code] || 'Respond naturally in the selected language.';
}

function getSystemPrompt(enriched) {
  const {
    wasteType,
    quantityTons,
    city,
    date,
    tavilySearchResults,
    selectedLanguage,
  } = enriched;
  const wasteLabel = WASTE_LABELS[wasteType] || wasteType;

  const langInstruction =
    selectedLanguage && selectedLanguage.code !== 'en'
      ? `
CRITICAL LANGUAGE INSTRUCTION:
You MUST respond ENTIRELY in ${selectedLanguage.name} (${selectedLanguage.native} script).
Do NOT use English anywhere in your response.
Do NOT mix languages.
All numbers, prices, units must still use standard numerals (1,2,3).
Currency: ₹ symbol is fine in all languages.
If the user writes in any language, always respond in ${selectedLanguage.native} only.

Example of correct response in ${selectedLanguage.name}:
${getLanguageExample(selectedLanguage.code)}

`
      : '';

  return `${langInstruction}You are AgroBot, an expert AI crop price negotiator for AgroScope — India's crop waste marketplace. You receive real-time market data from Tavily web search injected into your context.

YOUR ROLE:
- Help Indian farmers get the BEST possible price for their crop waste
- Be their fierce advocate — emotionally intelligent, data-driven, protective of their interests
- Analyze whether a price is ABOVE / BELOW / AT market with exact percentages
- Give negotiation tactics with specific numbers and clear justification
- Be concise: 2–4 sentences max unless the farmer asks for more detail

INPUT CONTEXT (auto-injected per session):
- Crop type: ${wasteLabel}
- Quantity: ${quantityTons} tons
- Location: ${city}
- Current date: ${date}
- Live Tavily market data: ${tavilySearchResults}

PRICE INTELLIGENCE RULES:
1. Always state ABOVE / BELOW / AT market with exact percentage difference
2. Give a specific recommended price with data-backed justification
3. If a buyer lowballs, give the exact counter-offer citing market evidence
4. Factor in: seasonal demand curve, quantity bulk premium/discount, carbon credit bonus
5. When negotiation reaches agreement, end your message with EXACTLY this JSON block (no other JSON):
\`\`\`json
{"agreedPrice": 2.05, "marketPosition": "above", "marketPct": 11, "totalValue": 5125}
\`\`\`

PRICE REFERENCE (use only as fallback if Tavily data is unavailable):
- Paddy Husk:        ₹1.20–2.80/kg  (peak demand: Jan–Mar)
- Wheat Straw:       ₹0.80–2.20/kg  (peak: May–Jul)
- Corn Stalks:       ₹0.60–1.80/kg  (peak: Sep–Nov)
- Sugarcane Bagasse: ₹1.50–3.50/kg  (peak: Feb–Apr)
- Coconut Shells:    ₹2.00–4.50/kg  (year-round, stable demand)

CARBON CREDIT RULE:
Always mention: selling instead of burning earns ₹0.28–₹0.42/kg in carbon value.
Always add this to the total deal value calculation.

EMOTIONAL INTELLIGENCE:
- Remember this farmer's livelihood depends on this sale
- Celebrate good deals: "That is 18% above market — excellent deal!"
- Warn firmly against exploitation: "That offer is below fair value. Do not accept."
- Use respectful Hindi phrases naturally: "Namaste", "bilkul sahi" (absolutely right), "bahut accha" (very good)`;
}

// ─── GET /api/price-negotiation/agro-guide-status ───────────────────────────
router.get('/agro-guide-status', (_req, res) => {
  const provider = resolveProvider();
  res.json({
    ok: true,
    configured: Boolean(provider),
    provider,
    message: provider
      ? `AgroGuide is ready (${provider})`
      : 'Add GEMINI_API_KEY (or DEEPSEEK_API_KEY) to server/.env and restart the server',
  });
});

// ─── GET /api/price-negotiation/market-price ────────────────────────────────
router.get('/market-price', async (req, res) => {
  const { wasteType, city } = req.query;
  const key = (wasteType && String(wasteType).trim()) || 'paddy_husk';
  const location = (city && String(city).trim()) || 'Chennai';

  try {
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
      // No web search configured — ask Gemini for a grounded estimate instead of
      // returning the static table, so the quoted price still reflects the crop
      // and the city rather than a single hardcoded number.
      const geminiPrice = await estimatePriceWithGemini(key, location);
      return res.json(geminiPrice || getFallbackPrice(key));
    }
    const query = `${(key || '').replace(/_/g, ' ')} crop waste price per kg ${location} India ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} APMC market rate`;
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tavilyKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    });
    const tavilyData = await tavilyRes.json().catch(() => ({}));
    const priceData = parsePriceFromTavily(tavilyData, key);
    res.json(priceData);
  } catch (err) {
    console.error('Tavily market-price error:', err.message);
    res.json(getFallbackPrice(key));
  }
});

// ─── POST /api/price-negotiation/chat ────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { messages, wasteType, quantityTons, city, currentPrice, livePricePerKg, liveTrend, selectedLanguage, mode, systemPrompt: agroGuideSystemPrompt, pageContext, userContext } = req.body || {};

  // AgroGuide: navigation chatbot (same route, no new route; non-streaming JSON response)
  if (mode === 'agro_guide') {
    const fallbackReply = "I'm having trouble connecting. Please try again. 🙏";
    try {
      const provider = resolveProvider();
      if (!provider) {
        const msg = 'AgroGuide is not configured. Add GEMINI_API_KEY to server/.env and restart the server.';
        console.warn('AgroGuide: no GEMINI_API_KEY or DEEPSEEK_API_KEY in server/.env');
        return res.status(502).json({ error: 'AI service not configured', reply: msg });
      }
      const lang = selectedLanguage && selectedLanguage.code
        ? { code: String(selectedLanguage.code), name: String(selectedLanguage.name || ''), native: String(selectedLanguage.native || '') }
        : null;
      const langInstruction = lang && lang.code !== 'en'
        ? `CRITICAL: Respond ONLY in ${lang.name} using ${lang.native} script. Never mix English unless the user wrote in English.`
        : '';
      const userBlock = (userContext && String(userContext).trim())
        ? `REAL-TIME USER DATA (already fetched from the website — use it): When the user asks about wallet, balance, AgroCoins, AgroCredits, AgroPoints, or provisions, you MUST use the exact numbers below. Do NOT say you cannot see their balance or ask them to provide data or visit /profile. State the numbers from below:\n${String(userContext).trim()}`
        : '';
      const systemContent = [
        String(agroGuideSystemPrompt || 'You are AgroGuide for AgroScope.'),
        langInstruction,
        `CURRENT PAGE CONTEXT:\n${String(pageContext || 'User is on AgroScope.')}`,
        userBlock,
        `Today: ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
      ].filter(Boolean).join('\n\n');
      const chatMessages = Array.isArray(messages) ? messages.slice(-12) : [];
      // Ensure at least one user message (required by both providers)
      const apiMessages = [
        { role: 'system', content: systemContent },
        ...chatMessages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: (m.content != null && String(m.content).trim()) ? String(m.content).trim() : ' ',
        })),
      ];
      const hasUser = apiMessages.some((m) => m.role === 'user');
      if (!hasUser) {
        return res.status(400).json({ error: 'No user message', reply: 'Please send a message to get a response.' });
      }

      if (provider === 'gemini') {
        const out = await geminiGenerate({
          contents: toGeminiContents(chatMessages),
          systemInstruction: systemContent,
          temperature: 0.5,
          maxOutputTokens: 2048,
          timeoutMs: 60000,
        });
        if (!out.ok) {
          console.error('AgroGuide Gemini error:', out.error);
          const userMsg = /quota|RESOURCE_EXHAUSTED|429/i.test(out.error || '')
            ? 'Too many requests. Please try again in a moment.'
            : (/API key|UNAUTHENTICATED|API_KEY_INVALID/i.test(out.error || '')
              ? 'Invalid API key. Check GEMINI_API_KEY in server/.env.'
              : fallbackReply);
          return res.status(502).json({ error: 'AI unavailable', reply: userMsg });
        }
        return res.json({ reply: out.text, provider: 'gemini', model: out.model });
      }

      const dsKey = deepseekKey();
      const apiBody = {
        model: 'deepseek-chat',
        messages: apiMessages,
        stream: false,
        max_tokens: 800,
        temperature: 0.5,
      };
      const deepseekRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dsKey}` },
        body: JSON.stringify(apiBody),
      });
      const bodyText = await deepseekRes.text();
      if (!deepseekRes.ok) {
        let userMsg = fallbackReply;
        try {
          const errJson = JSON.parse(bodyText);
          const code = errJson?.error?.code || errJson?.code;
          const msg = errJson?.error?.message || errJson?.message || bodyText?.slice?.(0, 200);
          if (deepseekRes.status === 401 || code === 'invalid_api_key') userMsg = "Invalid API key. Check DEEPSEEK_API_KEY in server/.env.";
          else if (deepseekRes.status === 429 || code === 'rate_limit_exceeded') userMsg = "Too many requests. Please try again in a moment.";
          else if (msg) userMsg = String(msg);
        } catch (_) { /* use fallback */ }
        console.error('AgroGuide DeepSeek error:', deepseekRes.status, bodyText?.slice(0, 500));
        return res.status(502).json({ error: 'AI unavailable', reply: userMsg });
      }
      let data;
      try {
        data = JSON.parse(bodyText);
      } catch (_) {
        console.error('AgroGuide DeepSeek invalid JSON:', bodyText?.slice(0, 200));
        return res.status(502).json({ error: 'Invalid response', reply: fallbackReply });
      }
      const rawContent = data?.choices?.[0]?.message?.content;
      const reply = (rawContent != null && String(rawContent).trim()) ? String(rawContent).trim() : "The assistant didn't return text. Please try again.";
      return res.json({ reply });
    } catch (err) {
      console.error('AgroGuide route error:', err?.message || err);
      return res.status(500).json({ error: 'AgroGuide error', reply: fallbackReply });
    }
  }

  const wType = (wasteType && String(wasteType).trim()) || 'paddy_husk';
  const qty = Number(quantityTons) || 1;
  const cityName = (city && String(city).trim()) || 'Chennai';
  const livePrice = typeof livePricePerKg === 'number' && livePricePerKg > 0 ? livePricePerKg : null;
  const trend = (liveTrend && ['rising', 'falling', 'stable'].includes(String(liveTrend).toLowerCase())) ? String(liveTrend).toLowerCase() : 'stable';
  const lang =
    selectedLanguage && selectedLanguage.code
      ? { code: String(selectedLanguage.code), name: String(selectedLanguage.name || ''), native: String(selectedLanguage.native || '') }
      : null;

  try {
    let liveMarketContext = livePrice
      ? `Today's live market price for ${wType.replace(/_/g, ' ')} in ${cityName}: ₹${livePrice.toFixed(2)}/kg. Trend: ${trend}.`
      : 'Market data temporarily unavailable. Use historical price estimates.';
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const tavilyRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tavilyKey}`,
          },
          body: JSON.stringify({
            query: `${wType.replace(/_/g, ' ')} price per kg ${cityName} India today market 2024 2025`,
            search_depth: 'advanced',
            max_results: 5,
            include_answer: true,
          }),
        });
        const tavilyData = await tavilyRes.json().catch(() => ({}));
        liveMarketContext =
          tavilyData.answer ||
          (Array.isArray(tavilyData.results) && tavilyData.results.length
            ? tavilyData.results.slice(0, 3).map((r) => r.content || '').join('\n')
            : '') ||
          liveMarketContext;
      } catch (tavilyErr) {
        console.warn('Tavily search failed, using fallback context:', tavilyErr.message);
      }
    }

    const enrichedSystem = getSystemPrompt({
      wasteType: wType,
      quantityTons: String(qty),
      city: cityName,
      date: new Date().toLocaleDateString('en-IN'),
      tavilySearchResults: liveMarketContext,
      selectedLanguage: lang,
    });

    const provider = resolveProvider();
    if (!provider) {
      return res.status(502).json({
        error: 'AI service not configured',
        details: 'Set GEMINI_API_KEY (or DEEPSEEK_API_KEY) in server/.env and restart the server',
      });
    }

    const chatMessages = Array.isArray(messages) ? messages : [];

    // ── Gemini streaming path ───────────────────────────────────────────────
    // Emitted in the OpenAI SSE shape so the existing frontend parser (which
    // reads choices[0].delta.content and "[DONE]") needs no changes.
    if (provider === 'gemini') {
      const contents = toGeminiContents(chatMessages);
      if (!contents.length) {
        return res.status(400).json({ error: 'No user message' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (res.flushHeaders) res.flushHeaders();

      let wroteAnything = false;
      const out = await geminiStream({
        contents,
        systemInstruction: enrichedSystem,
        temperature: 0.7,
        maxOutputTokens: 2048,
        timeoutMs: 120000,
        onToken: (piece) => {
          wroteAnything = true;
          try {
            res.write(sseChunk(piece));
            if (typeof res.flush === 'function') res.flush();
          } catch (e) {
            console.warn('SSE write error:', e?.message);
          }
        },
      });

      if (!out.ok && !wroteAnything) {
        console.error('Gemini negotiation error:', out.error);
        const friendly = /quota|RESOURCE_EXHAUSTED|429/i.test(out.error || '')
          ? 'The AI is busy right now. Please try again in a moment.'
          : 'The AI negotiator is unavailable right now. Please try again.';
        res.write(sseChunk(friendly));
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // ── DeepSeek streaming path ─────────────────────────────────────────────
    const dsKey = deepseekKey();
    const apiBody = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: enrichedSystem },
        ...chatMessages.map((m) => ({ role: m.role, content: m.content || '' })),
      ],
      stream: true,
      max_tokens: 600,
      temperature: 0.7,
    };

    const deepseekRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dsKey}`,
      },
      body: JSON.stringify(apiBody),
    });

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text();
      console.error('DeepSeek error:', errText);
      return res.status(502).json({ error: 'AI service unavailable', details: errText });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    const body = deepseekRes.body;
    if (body && typeof body.on === 'function') {
      body.on('data', (chunk) => {
        try {
          res.write(chunk);
          if (typeof res.flush === 'function') res.flush();
        } catch (e) {
          console.warn('Stream write error:', e?.message);
        }
      });
      body.on('end', () => {
        try { res.end(); } catch (_) {}
      });
      body.on('error', (err) => {
        console.error('DeepSeek stream error:', err?.message);
        try { res.end(); } catch (_) {}
      });
    } else {
      const reader = deepseekRes.body?.getReader?.();
      if (reader) {
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.length) res.write(Buffer.from(value));
              if (typeof res.flush === 'function') res.flush();
            }
            res.end();
          } catch (e) {
            if (e?.code !== 'ERR_STREAM_DESTROYED') console.error('Stream pump error:', e?.message);
            try { res.end(); } catch (_) {}
          }
        };
        pump();
      } else {
        res.end();
      }
    }
  } catch (error) {
    console.error('Price negotiation route error:', error?.message || error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Negotiation service error. Please retry.' });
    }
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const PRICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    current: { type: 'NUMBER', description: 'Most likely current price in INR per kg' },
    min: { type: 'NUMBER' },
    max: { type: 'NUMBER' },
    trend: { type: 'STRING', enum: ['rising', 'falling', 'stable'] },
    rationale: { type: 'STRING' },
  },
  required: ['current', 'min', 'max', 'trend', 'rationale'],
};

/**
 * Gemini price estimate, used when Tavily search is not configured.
 *
 * The model is anchored to the same reference band the negotiator prompt uses,
 * and the result is clamped to it. Without that the quoted "live" price can
 * drift well outside the band the AI negotiator then argues from, so the header
 * price and the chat advice contradict each other.
 */
async function estimatePriceWithGemini(wasteType, city) {
  if (!hasGeminiKey()) return null;
  const label = WASTE_LABELS[wasteType] || String(wasteType).replace(/_/g, ' ');
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const reference = getFallbackPrice(wasteType);

  const out = await geminiGenerate({
    parts: [textPart(
      `Estimate the current farm-gate market price of ${label} (agricultural crop waste) `
      + `in ${city}, India, as of ${today}.\n\n`
      + `AgroScope's reference trading band for this crop is ₹${reference.min}-₹${reference.max}/kg, `
      + `with ₹${reference.current}/kg as the typical mid-market rate. Treat that band as your anchor: `
      + 'stay within it unless there is a strong seasonal or regional reason to sit at one edge, and '
      + 'never move more than 25% outside it.\n\n'
      + 'Give INR per kilogram. Account for the seasonal demand cycle, regional variation, and '
      + 'industrial demand (biomass fuel, board and briquette manufacturing). min and max should '
      + 'bracket the normal trading range and current is your single best estimate. '
      + 'In rationale, state the main price driver in one sentence.',
    )],
    schema: PRICE_SCHEMA,
    temperature: 0.2,
    maxOutputTokens: 2048,
    timeoutMs: 30000,
    maxRetries: 1,
  });

  if (!out.ok) {
    console.warn('Gemini market-price estimate failed:', out.error);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(out.text);
  } catch {
    return null;
  }

  let current = Number(parsed.current);
  if (!Number.isFinite(current) || current <= 0) return null;

  // Clamp to 25% outside the reference band so the quoted price stays coherent
  // with the negotiator's own price table.
  const floor = Math.max(0.3, reference.min * 0.75);
  const ceiling = Math.min(15, reference.max * 1.25);
  const clamped = Math.min(ceiling, Math.max(floor, current));
  const wasClamped = Math.abs(clamped - current) > 0.001;
  current = clamped;

  const min = Number(parsed.min);
  const max = Number(parsed.max);
  return {
    current: Math.round(current * 100) / 100,
    min: Number.isFinite(min) && min >= floor && min <= current
      ? Math.round(min * 100) / 100
      : reference.min,
    max: Number.isFinite(max) && max <= ceiling && max >= current
      ? Math.round(max * 100) / 100
      : reference.max,
    trend: ['rising', 'falling', 'stable'].includes(parsed.trend) ? parsed.trend : 'stable',
    source: 'gemini',
    rationale: String(parsed.rationale || '').slice(0, 300),
    ...(wasClamped ? { adjustedToBand: true } : {}),
  };
}

function parsePriceFromTavily(tavilyData, wasteType) {
  const fallback = getFallbackPrice(wasteType);
  const answer = tavilyData?.answer || '';
  const match = answer.match(/(?:₹|rs\.?\s*)(\d+\.?\d*)\s*(?:per|\/)\s*kg/i);
  if (match) {
    const parsed = parseFloat(match[1]);
    if (parsed >= 0.3 && parsed <= 15) {
      return { ...fallback, current: parsed, source: 'live' };
    }
  }
  return fallback;
}

function getFallbackPrice(wasteType) {
  const PRICES = {
    paddy_husk: { min: 1.2, current: 1.85, max: 2.8, trend: 'rising', source: 'historical' },
    wheat_straw: { min: 0.8, current: 1.65, max: 2.2, trend: 'stable', source: 'historical' },
    corn_stalks: { min: 0.6, current: 1.25, max: 1.8, trend: 'falling', source: 'historical' },
    sugarcane_bagasse: { min: 1.5, current: 2.4, max: 3.5, trend: 'rising', source: 'historical' },
    coconut_shells: { min: 2.0, current: 3.2, max: 4.5, trend: 'stable', source: 'historical' },
  };
  return PRICES[wasteType] || PRICES.paddy_husk;
}

export default router;
