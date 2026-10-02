# PRODUCT.md — AgroScope

> Product truth only. No visual decisions live here (those belong in DESIGN.md).
> Sourced from README.md, AGROSCOPE_PROJECT_BRIEF.md, FEATURES_AND_TECH_SUMMARY.md,
> and the running application. Not invented.

## What it is

AgroScope is a two-sided marketplace for agricultural crop residue. Farmers list
crop waste (type, quantity, location); industrial buyers and startups search that
supply by type, quantity and location, see matched farmers, and request provisions.

**The mechanism this product owns:** it turns crop residue — a thing farmers
currently burn or dump — into a *weighed, priced, tradable commodity* with a
verified quantity, a market price, and a named counterparty.

## Audience and scene

Two roles, exactly these strings, everywhere (`farmer`, `startup`):

- **`farmer`** — sells. Creates provisions, sees own inventory, gets waste
  valuation, tracks wallet earnings. Scene: outdoors or in a farm office, often
  on a phone, in bright ambient daylight, frequently not reading English as a
  first language.
- **`startup`** — buys. Searches for matches ("Find the Nearest Farmer"), sees
  startup matches, requests provisions from farmers. Scene: a desk, a
  procurement or sustainability role at an industrial buyer, comparing supply
  against a requirement.

Geography is India: ten supported cities — Chennai, Mumbai, Delhi, Bengaluru,
Hyderabad, Kolkata, Pune, Ahmedabad, Jaipur, Surat.

## Fixed product facts

**Five crop waste types. These labels are load-bearing** (APIs, forecast, price,
recommendations, cold storage, provisions all key off them):

Paddy Husk · Wheat Straw · Corn Stalks · Sugarcane Bagasse · Coconut Shells

**Carbon formulas (published in README, keep exact):**
- Weight: `W = A × Y × RPR`
- CO₂ saved: `CO₂ = W × 1.5` (IPCC)
- Trees: `Trees = (CO₂ × 1000) / 20` (FAO)
- Credits: `Credits = CO₂ × 0.1` (Verra VCS)
- AgroCoins: `1000 AgroCredits = 1 Agro Coin`

**Dual wallet:** AgroCredits (earned per action) and AgroCoins (converted at
1000:1). Both are shown to farmers.

## Surfaces

| Surface | Mode | Job |
|---|---|---|
| `/home` landing | **Persuade** | A farmer or buyer decides this is real and signs up |
| `/dashboard`, `/wallet`, `/forecast`, `/live-prices`, inventory, payments | **Operate** | A logged-in user completes a task and reads state |
| `/agro-news`, `/recommendations` | **Read** | User understands market conditions |

## Constraints that bind the design

- **Demo posture is intentional.** The app runs without MongoDB by design and
  uses display-only values so no screen is ever empty. Forecast numbers
  (Paddy Husk 5.50t / 85%, etc.) are *display values, not predictions*.
- **Therefore: invent no commercial claims.** No prices, customers, benchmarks,
  volumes, logos, testimonials, or capability claims that the product does not
  already make. Existing copy and numbers are preserved as-is.
- **50-language translation via Google Translate** rewrites text nodes at
  runtime. Type must survive Devanagari, Tamil, Telugu, Kannada, Malayalam,
  Bengali, Gujarati, Gurmukhi, Arabic, Hebrew, CJK — and RTL.
- **Layout must survive text expansion**, since translated strings are longer
  than the English source.
- Tech constraints: React 18 + TS + Vite 5 + Tailwind + Radix/shadcn + Recharts
  + Framer Motion. React Three Fiber is already used on the intro and Forecast.
- Roles, routes, API shapes, and behavior are **not** in scope to change.

## What success looks like

A farmer or a procurement buyer landing on this cold reads it as an institution
that handles real money and real weights — not a hackathon demo. Trust is the
conversion mechanism.
