# Tally

**English** · [繁體中文](README.zh-TW.md)

[Open the app →](https://zard0033.github.io/tally/) (Google sign-in required, since the only data in there is mine)

Tally is a nutrition tracker for my phone. I'm its only user and I use it every day: log what I just ate, check how much of today's calorie and protein budget is left, close it. Each visit takes a few seconds.

## The problem it solves

I logged every meal in Notion for months. Notion could hold the rows but it couldn't do the arithmetic. A view can't total a column, cross-row math needs relation fields, and the automations kept breaking. I opened that page to see one number, how much can I still eat today, and that was the number Notion wouldn't give me.

MyFitnessPal would have saved me the build. It would also have put my history inside someone else's app, and that was the part I wasn't willing to trade: I want an AI assistant to read a week of intake against my weight trend and work out what I actually burn in a day. Off-the-shelf trackers don't let anything in. So I wrote the app and kept the data.

## What it does

- Logging a meal takes a few taps: pick the meal, pick the food from my own library, set the portion. A food that isn't in the library yet gets added once and stays.
- The screen leads with how much budget is left today. A horizontal calorie gauge sits above three macro bars (protein, fat, carbs), readable at a glance.
- Targets recalculate from current weight, so they move with me instead of going stale.
- I can also back-fill a past day, record weight, edit an entry in place, manage the food library, and adjust body stats in settings.

## How the decisions were made

This is a solo project: I wrote the spec, built the design system, and directed the build. These are the calls that shaped it.

### I threw away the first version the day after it shipped

The original spec said no framework, no build step, no third-party code. I wrote that at kickoff and never justified it. It was a default that had slipped in looking like a decision, and checking it turned up two things. Hand-rolling OAuth and the data layer cost more than the dependency it avoided. And `react-native-web`, the route to a real phone app later, doesn't support CSS scroll-snap, which was exactly what my swipe-to-delete gesture was built on. A rule I set to keep things simple was quietly guaranteeing a rewrite of the core interaction. I rebuilt on Vite, React, and TypeScript the next day.

### The math never touches the screen

Everything computational lives in `src/lib` and is not allowed to touch the DOM: the BMR → TDEE → target chain, date handling, rounding, database access. The screens live in `src/screens`.

That boundary buys nothing today. The app runs in exactly one place, a browser, and the rule costs me a little friction on every feature. I pay it because the App Store is an option I want to keep open, not a promise I've made. If Tally becomes a React Native app, that layer moves across unchanged and only the UI gets rewritten. It's cheap now and it only gets more expensive: separating it later means pulling it out of however much UI code exists by then.

### A shared component needs a reason, and looking alike isn't one

The bar for lifting UI into `src/components` is that the same set of fields appears on two or more screens and the two should never disagree. There is exactly one shared component so far, and it came out only after the two copies had already drifted apart twice. Extracting on resemblance makes a promise you didn't mean to make: that these two things will always change together.

### 76 end-to-end tests, and a UI change runs all of them

76 browser tests across 10 files, plus 97 unit tests covering the formulas, dates, rounding, image sizing, and the label-reading Edge Function. Any UI change runs the entire browser suite, not the file that looks related. The whole thing finishes in under two minutes, and "the relevant tests passed" is the most common way a regression gets shipped.

Every new test also gets checked by breaking the thing it covers on purpose and confirming it goes red. A test that has never failed hasn't been shown to test anything.

### What I decided not to build

Barcode scanning (the places I eat from don't put barcodes on anything), recipes (I log per item, not per ingredient), progress photos, exercise, water, a community food database. MyFitnessPal has all of them. I considered each one and cut it.

The first design draft had a progress ring, and it died in review. A ring says that filling it up is winning, which is the opposite of what's true for calories.

## Design

Every color, type size, and spacing value is a token defined in [DESIGN.md](DESIGN.md), and nothing in the code hard-codes one. Contrast ratios are computed and written down beside each token instead of eyeballed.

A few decisions that took longer than they look:

- Shipping one light theme and no dark mode was a choice, recorded as such in DESIGN.md, rather than something left undone.
- No state is signaled by color alone. Go over a macro target and the bar doubles in height first; the color change is the second layer. A red/green colorblind reader gets the primary signal from the geometry.
- A half-built accessibility pattern was rejected as worse than none. Turning the meal selector into a full ARIA tablist would have promised screen-reader users arrow-key navigation that the implementation didn't have. It uses simpler semantics that keep the promise they make.

DESIGN.md carries a version log. Each entry says what changed and why, including the ideas that got rejected.

## Built with

Vite · React 19 · TypeScript · Tailwind 4 · shadcn/ui (Base UI) · vaul · Motion · supabase-js

The backend is Supabase: Postgres plus Google OAuth. Hosting is GitHub Pages, built and deployed by GitHub Actions. Nothing loads from a CDN, and every dependency is bundled and self-hosted.

The repository is public, so the browser only ever holds the anonymous API key and every table sits behind row-level security. Signed out, every query comes back empty. Service keys, database passwords, and OAuth secrets are not in the repository and never will be.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:5500
```

```bash
npx vitest run     # 97 unit tests: formulas, dates, rounding, image sizing, edge function
npm run e2e        # 76 browser tests, 10 files (WebKit, 393x745)
npm run build      # tsc -b + vite build
npm run lint
```

The e2e suite builds the app and runs against the static preview with every network call stubbed, so it needs no account and touches no real data.

## Repository

| Path | What's in it |
| --- | --- |
| [spec.md](spec.md) | Requirements and release phases (in Chinese) |
| [DESIGN.md](DESIGN.md) | Design system and every visual decision with its reasoning (in Chinese) |
| [session-state/active.md](session-state/active.md) | Current state, open questions, decisions in flight (in Chinese) |
| [src/lib/](src/lib/) | Calculation, dates, data access, with no DOM |
| [src/screens/](src/screens/) | One file per screen |
| [e2e/](e2e/) | Playwright regression suite |

Development started 27 July 2026. The interface is in Traditional Chinese.
