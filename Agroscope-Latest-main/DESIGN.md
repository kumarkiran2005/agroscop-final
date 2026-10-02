# DESIGN.md — AgroScope

Recorded from the built world, not from intention. Product truth lives in
[PRODUCT.md](./PRODUCT.md); this file owns durable visual decisions.

**Direction contract:** seed `8479fa27`, form 7 of 7, mode *persuade*. The full
contract ships as an HTML comment at the top of `<body>` in
[index.html](./index.html) and survives the production build (verified in
`dist/index.html`).

---

## The world

**AgroScope is a commodity house, not an app.** Crop residue is a graded,
weighed, lot-numbered good with a counterparty on the other side. The visual
language is the identity program of a global grain trader — stencilled shipping
marks, weighbridge tickets, ruled ledgers, struck numerals.

What it refuses: the agri-SaaS arrangement the product previously shipped as —
saturated green gradients, rounded feature cards, glow halos, floating glass
panels, and a display serif on every button.

## Color

Strategy: **restrained** — a working neutral ground, one structural ink, one
measurement accent. Chosen because the primary surfaces are Operate: people come
here to read weights and complete tasks, not to be impressed by a color field.

| Role | Light | Dark | Use |
|---|---|---|---|
| `--background` | `45 14% 95%` | `158 20% 7%` | Working paper. Warm-neutral with a green cast, deliberately not cream |
| `--foreground` | `158 22% 10%` | `45 18% 92%` | Ink, green-black |
| `--card` | `42 22% 98%` | `158 17% 10%` | Raised stock |
| `--primary` | `158 44% 21%` | `158 38% 46%` | Cargo green. Structure and primary action |
| `--accent` | `32 66% 42%` | `36 70% 55%` | Ochre. **Measurement only** — gauges, capacities, confidence. Never decorative |
| `--destructive` | `6 58% 42%` | `6 56% 50%` | Brick, not alarm-red |
| `--border` | `45 12% 84%` | `158 12% 19%` | Hairline. Borders carry the structure here; shadows carry almost none |

Dark mode is lifted, not inverted: `--primary` moves from 21% to 46% lightness
so it clears 4.5:1 on the dark ground.

**Light is the default**, and that is a scene decision. Farmers use this outdoors
in Indian daylight on a phone, where a near-black surface is unreadable. Dark
remains first-class for desk use via the toggle.

## Type

Three faces, one job each. Previously one display serif (Playfair Display) was
force-applied to *every* element — `h1`–`h6`, `p`, `span`, `a`, `button`,
`input`, `label`, `li`, `textarea`, `select`.

| Token | Face | Job |
|---|---|---|
| `--font-display` | **Archivo** | Headings. The width axis (`font-stretch: 112–118%`) carries the stencilled marking character |
| `--font-sans` | **Public Sans** | Interface and body. Institutional workhorse; holds at 12px and under machine translation |
| `--font-mono` | **JetBrains Mono** | **Counted figures only** — weights, prices, lot numbers, dates. Never a costume for "technical" |

Loaded font families went from ~20 (Syne, DM Sans, DM Mono, Bebas Neue, Playfair,
JetBrains Mono, 14× Noto) to 3 plus the Noto set that machine translation
genuinely needs.

Utilities: `.mark` (uppercase, `0.16em` tracking — the only place tracking goes
positive), `.tabular` / `.num` (tabular + slashed-zero figures), `.measure`
(68ch) and `.measure-tight` (54ch).

## Shape and depth

- `--radius: 0.25rem` (was `0.5rem`; the legacy `--r-xl` was 28px). A ledger has
  corners.
- Elevation is `--shadow-xs/sm/md/lg`: real vertical offset plus soft blur,
  tinted with the ink hue. The four `--glow-*` tokens are retired — a
  zero-offset colored halo is decoration, not depth — but the names survive as
  aliases onto the real shadows so no component broke.

## Motion

One rule: things decelerate, nothing rebounds. Exponential ease-out
(`cubic-bezier(0.22, 1, 0.36, 1)`), no overshoot curves, no bounce keyframes.
Buttons and cards do not lift on hover. A global
`prefers-reduced-motion` block is in the base layer.

## Components

- **Buttons.** A bare `button` element selector previously gave every button an
  8px radius, a drop shadow, a `-1px` hover lift, a `0.97` press scale, and a
  **blue** focus ring in a green product. The element selector now carries only
  cursor and font inheritance; treatment is opt-in via `.btn` or the shadcn
  variants.
- **Focus.** One ring, `:focus-visible`, `2px solid hsl(var(--ring))` with a 2px
  offset, drawn outside so it never shifts layout. Keyboard focus was previously
  invisible across the app.
- **Navigation.** The bar is quiet by default; exactly one action may be filled,
  marked `data-primary`. Previously every nav action was a filled primary button.
- **Ledger** (`.hero-ledger`). The reference data component: hairline rules,
  left-aligned labels, right-aligned mono figures, ochre measurement bars.

## Legacy alias layer

A second palette of ~40 hardcoded dark-mode hex values (`--bg-void`,
`--green-mid`, `--glow-green-lg`, …) competed with the shadcn tokens; components
picked from whichever they reached for. Those names are consumed in ~130 places,
so they are **remapped, not removed** — each now derives from a semantic token,
which makes them theme-aware and gives them the new palette without editing a
single component. New work should use the semantic tokens directly.

## Known gaps

Honest list; none of these are blocking, all are follow-on work.

1. **~26 files still carry hardcoded hex colors** (heaviest: `WeatherForecast.tsx`,
   `PriceNegotiationModal.tsx`, `StartupInput.tsx`, `Input.tsx`). They render
   acceptably but do not follow the theme.
2. **Emoji still stand in for icons in ~33 files** (339 occurrences). `CropBadge`
   was fixed — it rendered *both* a Lucide icon and an emoji for the same label.
   Page-level emoji (🌾 in the Forecast selector, 📊 on section headings, 🟢🟡🔴
   status dots) remain. Flag emoji in `lib/languages.ts` are a legitimate use.
3. **Colored `border-left` bars** on wallet transaction rows (5 sites).
4. `og-cover.png` is referenced but not yet drawn — `index.html` carries a
   `REPLACE:` marker. The previous tags advertised a third-party template vendor.
5. Pre-existing TypeScript errors in 7 files (`GlobalLanguageSelector`,
   `HeroText`, `WeightEstimator`, `useSpeechRecognition`, `AgroNewsLive`,
   `Input`, `StartupInput`). Not introduced by this work and not build-blocking —
   `npm run build` does not typecheck.
