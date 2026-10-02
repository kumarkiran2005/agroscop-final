/**
 * AgroGuide Autopilot — global action catalogue.
 *
 * The route list is the SAME one AgroGuide already uses to linkify replies
 * (AGROGUIDE_ROUTES in AgroGuideChat.tsx), re-exported here so autopilot can
 * navigate anywhere the chatbot can already link to, and so the two can never
 * drift apart.
 *
 * Screen-local actions are NOT declared here — screens register their own real
 * handlers via useAutopilotActions() while mounted (see registry.ts). This file
 * only owns the always-available 'global' screen.
 *
 * REFERENCE MAP
 *   Replicates: the `global.navigate` registration inside
 *   talbotiq-platform/src/features/guide/autopilot/useAutopilotRunner.ts (the
 *   reference registered navigate inline in the runner because its panel sits
 *   inside the Router). AgroScope's AgroGuideButton is likewise mounted inside
 *   <BrowserRouter>, so the same approach works; it is factored into this
 *   module so the route whitelist is declared in one place.
 */

import type { ActionDef } from "./registry";
import type { ParamSpec } from "./types";

/**
 * Every route Autopilot may navigate to. Mirrors AGROGUIDE_ROUTES.
 * Navigation is a SAFE action — it only changes what is on screen.
 */
export const AUTOPILOT_ROUTES = [
  "/home",
  "/input",
  "/startup-input",
  "/profile",
  "/farmer-inventory",
  "/startup-matches",
  "/notifications",
  "/forecast",
  "/carbon",
  "/recommendations",
  "/agro-news-live",
  "/weather-forecast",
  "/live-prices",
  "/loyalty",
  "/dashboard",
  "/results",
  "/payments",
  "/verification",
  "/wallet",
  "/wallet/transactions",
  "/wallet/withdraw",
] as const;

export type AutopilotRoute = (typeof AUTOPILOT_ROUTES)[number];

/** Human labels so the agent can reason about destinations, not just paths. */
export const ROUTE_LABELS: Record<string, string> = {
  "/home": "Home landing page",
  "/input": "Farmer Input — log crop waste and list a consignment",
  "/startup-input": "Startup Input — post demand for crop waste",
  "/profile": "Profile & Wallet",
  "/farmer-inventory": "Farmer Inventory — the farmer's own listings",
  "/startup-matches": "Startup Matches — AI-matched farmers",
  "/notifications": "Notifications",
  "/forecast": "30-Day Supply Forecast",
  "/carbon": "Carbon Simulator",
  "/recommendations": "Recommendations — products from a waste type",
  "/agro-news-live": "Agro News Live",
  "/weather-forecast": "Weather Forecast",
  "/live-prices": "Live Prices",
  "/loyalty": "Loyalty Program — company trust tiers",
  "/dashboard": "Startup Dashboard — browse and source available supplies",
  "/results": "Results",
  "/payments": "Verify Payments (admin only)",
  "/verification": "Crop Waste Verification — upload waste photos",
  "/wallet": "Wallet overview",
  "/wallet/transactions": "Transaction History",
  "/wallet/withdraw": "Withdrawal Request",
};

const ROUTE_PARAM: ParamSpec = {
  name: "path",
  type: "enum",
  enum: [...AUTOPILOT_ROUTES],
  required: true,
  description: "App route to navigate to",
};

/**
 * Build the always-available global actions. `navigate` needs the router's
 * navigate fn, which only exists inside <BrowserRouter> — hence a factory.
 */
export function buildGlobalActions(
  navigate: (path: string) => void
): Record<string, ActionDef> {
  return {
    navigate: {
      description: `Navigate to an app route. Destinations: ${Object.entries(ROUTE_LABELS)
        .map(([p, l]) => `${p} (${l})`)
        .join("; ")}`,
      sideEffect: false,
      params: [ROUTE_PARAM],
      run: ({ path }) => {
        if (typeof path === "string") navigate(path);
      },
    },
  };
}
