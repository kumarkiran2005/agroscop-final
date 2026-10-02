# AgroScope

**Crop residue is not waste. It's unpriced inventory.**

AgroScope is a two-sided marketplace that turns agricultural crop residue into a
priced, traceable, settled commodity — connecting farmers who burn it to industries
that pay for it.

---

## The problem

A farmer finishes harvest with five tonnes of paddy husk and no buyer. Clearing the
field costs money and time, so it gets burned. Two districts away, a biomass pellet
plant is buying feedstock — sometimes importing it.

Both sides lose because neither can see the other:

- **The farmer** doesn't know the residue has value, what it's worth, or who wants it.
- **The buyer** can't find reliable local supply, verify quality, or trust a stranger's
  claim about quantity.
- **Everyone else** breathes the smoke.

This isn't a supply problem or a demand problem. It's a **discovery and trust problem**.

> ⚠️ **Before pitching:** insert sourced figures for residue generated vs. burned
> annually in India, and the biomass feedstock market size. Cite the source on the
> slide — investors check.

---

## The solution

AgroScope does three things a WhatsApp group can't:

| | |
|---|---|
| **Discovers price** | Live mandi rates, a 30-day supply forecast, and an AI negotiation assistant give both sides a defensible number instead of a guess. |
| **Establishes trust** | Photo verification, AI weight estimation from a single image, quality grades and moisture readings, and two-way ratings — because the buyer purchases sight-unseen. |
| **Settles safely** | The buyer pays, an admin verifies proof, and only then is the farmer's wallet credited. Neither side has to trust the other. |

---

## How it works

**For the farmer**
1. Photograph the residue pile — AI estimates weight and identifies the crop type
2. Set a price (guided by live market rates and a supply forecast)
3. Listing goes live instantly to every buyer on the platform
4. Get paid to an in-app wallet, withdraw to a bank account or UPI

**For the buyer**
1. Browse verified supply near you — filter by crop, grade, quantity, price
2. See quantity, location, quality grade, moisture, and seller rating up front
3. Express interest and pay
4. Contact the farmer directly once payment clears

**The safety net:** funds are held until an admin verifies payment proof. A farmer
never ships against an empty promise; a buyer never pays into a void.

---

## Business model

**A 30% platform fee on every transaction**, applied transparently.

- Farmer lists at their price — say ₹5.60/kg
- Buyer sees ₹7.28/kg, inclusive of the platform fee
- On verified settlement, the farmer receives their **full asking price** × quantity

Revenue scales directly with transaction volume. No subscription, no listing fee, no
charge until value actually changes hands.

Secondary loyalty layer: **AgroCredits** earned through platform activity convert at
1,000:1 into **AgroCoins**, driving repeat engagement without touching real currency.

---

## What makes it defensible

**AI that removes real friction, not AI as decoration**

- **Weight estimation from a photo** — the single biggest barrier to listing is that
  farmers don't know how much they have. Point a camera at the pile.
- **Crop type detection** from an image
- **Price negotiation assistant** — an AI that argues the farmer's side, so a
  first-time seller isn't negotiating against a procurement professional
- **AgroGuide** — a multilingual assistant with voice input and speech output, so the
  platform works for a user who can't type comfortably in English
- **Autopilot** — tell the assistant what you want in your own language and it
  operates the platform for you, pausing for confirmation before anything that spends
  money

**Built for the actual user**

Voice-first and multilingual are not features here, they're the access mechanism. A
farmer speaks a command in their own language and the platform acts.

**Network effects**

Every listing makes the platform more valuable to buyers; every buyer makes it more
valuable to farmers. Price data compounds — the more transactions, the better the
forecast, the more defensible the pricing.

---

## What's built today

This is a working platform, not a prototype deck.

| Area | Status |
|---|---|
| Marketplace listing, browse, filter, sort | ✅ Live |
| Role-separated views (farmer / buyer / admin) | ✅ Live |
| Dual wallet — rupee balance + loyalty currency | ✅ Live |
| Payment submission + admin verification + payout | ✅ Live |
| Real-time listing sync between farmers and buyers | ✅ Live |
| AI weight estimation + crop detection from photo | ✅ Live |
| AI price negotiation | ✅ Live |
| 30-day supply forecast + live market prices | ✅ Live |
| Multilingual assistant with voice + speech | ✅ Live |
| Autopilot — the assistant operates the platform | ✅ Live |
| Carbon impact simulator | ✅ Live |
| Weather forecast + agri news feed | ✅ Live |

**Scale of the build:** 27 screens, 31 API modules, 23 domain services, 16 data models.

**Tech:** React 18 · TypeScript · Vite · Tailwind · Express · Socket.IO · MongoDB ·
Google Gemini · Tavily

---

## Traction

> ⚠️ **Fill this in before pitching.** This is the section investors read first and
> the one section the product cannot answer for you.
>
> - Farmers onboarded / listings created
> - Buyers onboarded
> - Total volume listed (tonnes) and transacted
> - Revenue to date
> - Pilot partners, LOIs, or district-level agreements
> - Letters of intent from biomass plants
>
> If pre-traction, lead with a pilot plan instead: which district, how many farmers,
> which buyer, by when.

---

## Roadmap

**Next**
- Payment gateway integration — replace manual verification with automated settlement
- Logistics layer: transport matching and cost estimation between farm and plant
- Farmer credit scoring from transaction history

**Then**
- Carbon credit issuance against verified diverted-from-burning residue
- Aggregator accounts — FPOs and cooperatives listing on behalf of member farmers
- Forward contracts: buyers pre-committing to next season's supply

---

## Why now

Three things arrived at once: enforcement pressure against field burning, industrial
demand for biomass feedstock driven by clean-energy mandates, and smartphone
penetration deep enough that a farmer can photograph a pile and receive an AI weight
estimate in seconds.

The intermediary layer that should connect them doesn't exist. That's the opening.

---

## The ask

> ⚠️ **Fill in:** amount raising, at what valuation, use of funds broken down
> (engineering / farmer acquisition / buyer BD / working capital), and the milestone
> that money buys you.

---

## Team

> ⚠️ **Fill in:** founders, relevant domain or technical background, and why this
> team specifically. Investors back operators who understand both the farm side and
> the industrial side — say which you have and how you cover the other.

---

## One line

*AgroScope turns crop residue from a disposal cost into a revenue line — and takes
30% of every transaction it makes possible.*
