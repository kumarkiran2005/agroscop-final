/**
 * AgroGuide Autopilot — agent route.
 *
 * REFERENCE MAP
 *   Replicates: the `POST /agent` added to talbotiq-platform/server/routes/help.ts.
 *   Difference: AgroScope's assistant endpoints are unauthenticated (the guide
 *   works logged-out), so this route does not require a bearer token. Autopilot
 *   gains no privilege from that: the server only NAMES an action, and every
 *   handler runs client-side inside the user's own session against the same
 *   auth-gated APIs they could call by hand.
 */

import express from 'express';
import { runAutopilotAgent, autopilotEnabled } from '../services/autopilotAgent.js';

const router = express.Router();

/** Cap on how much conversation the client may send per turn. */
const MAX_MESSAGES = 40;
const MAX_ACTIONS = 120;

// ─── GET /api/autopilot/status ──────────────────────────────────────────────
router.get('/status', (_req, res) => {
  const configured = autopilotEnabled();
  res.json({
    configured,
    message: configured
      ? 'Autopilot ready'
      : 'Add GEMINI_API_KEY (or DEEPSEEK_API_KEY) to server/.env and restart the server',
  });
});

// ─── POST /api/autopilot/agent ──────────────────────────────────────────────
router.post('/agent', async (req, res) => {
  try {
    const { messages, context } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages must be an array' });
    }
    if (!context || typeof context !== 'object') {
      return res.status(400).json({ error: 'context is required' });
    }

    const safeMessages = messages
      .filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_MESSAGES)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content).slice(0, 4000),
      }));

    const safeContext = {
      route: typeof context.route === 'string' ? context.route : '/',
      availableActions: Array.isArray(context.availableActions)
        ? context.availableActions.slice(0, MAX_ACTIONS)
        : [],
      state: context.state && typeof context.state === 'object' ? context.state : {},
    };

    const decision = await runAutopilotAgent({ messages: safeMessages, context: safeContext });
    return res.json(decision);
  } catch (err) {
    console.error('[autopilot] route error', err);
    return res.status(500).json({
      say: 'Sorry — Autopilot hit a server problem. Please try again.',
      awaitingUser: true,
      error: 'Autopilot agent failed',
    });
  }
});

export default router;
