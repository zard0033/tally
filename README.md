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
- It logs gym sessions too: start from a routine, tick off sets prefilled with what I last did, rest on a timer, and record cardio. A session can be logged with no signal and syncs the next time the app is open with a connection.
- Analysis screens show estimated 1RM progress per exercise (sets of 10 reps or fewer) and an estimate of which muscle groups are still recovering. Body weight has its own trend charts.

## How the decisions were made

This is a solo project: I wrote the spec, built the design system, and directed the build. These are the calls that shaped it.

### I threw away the first version the day after it shipped

The original spec said no framework, no build step, no third-party code. I wrote that at kickoff and never justified it. It was a default that had slipped in looking like a decision, and checking it turned up two things. Hand-rolling OAuth and the data layer cost more than the dependency it avoided. And `react-native-web`, the route to a real phone app later, doesn't support CSS scroll-snap, which was exactly what my swipe-to-delete gesture was built on. A rule I set to keep things simple was quietly guaranteeing a rewrite of the core interaction. I rebuilt on Vite, React, and TypeScript the next day.

### The math never touches the screen

Everything computational lives in `src/lib` and is not allowed to touch the DOM: the BMR → TDEE → target chain, date handling, rounding, database access. The screens live in `src/screens`.

That boundary buys nothing today. The app runs in exactly one place, a browser, and the rule costs me a little friction on every feature. I pay it because the App Store is an option I want to keep open, not a promise I've made. If Tally becomes a React Native app, that layer moves across unchanged and only the UI gets rewritten. It's cheap now and it only gets more expensive: separating it later means pulling it out of however much UI code exists by then.

### A shared component needs a reason, and looking alike isn't one

The bar for sharing UI between screens is that the same set of fields or the same interaction appears on two or more of them and the two should never disagree. The first shared component came out only after the two copies had already drifted apart twice. Extracting on resemblance makes a promise you didn't mean to make: that these two things will always change together.

### 397 end-to-end tests, and when they all run

The suite is 397 browser tests across 20 files, plus 902 unit tests covering the formulas, dates, rounding, image sizing, the offline write queue, and the label-reading and weight-sync Edge Functions.

Any UI change used to run the entire browser suite, which took under two minutes at around 100 tests. A full run now takes about 12 minutes, so a script picks the specs from the changed files, using a hand-maintained table, and that subset has to pass before a push. When a change touches too much to tell, a small core-path set runs instead. "The relevant tests passed" is the most common way a regression gets shipped, so the full suite stays, but it now runs right after the push. Pushing to main deploys straight away, so a failure it catches may already be live. With one user I accept that, since I skipped the 12-minute gate on several rounds anyway, and the [run log](.omc/wiki/e2e-reference.md) says which. Changes to the service worker or the offline write queue are hard to undo, so those still run the full suite first.

Every new test also gets checked by breaking the thing it covers on purpose and confirming it goes red. A test that has never failed hasn't been shown to test anything.

### I cut exercise tracking, then built it anyway

Exercise was on the original not-building list. In October 2026 I tried a gym app called Gymwork and hit two problems. The gym's network is unreliable and the app doesn't work offline, so the day's exercises and their images wouldn't load. The analysis I wanted (1RM, recovery status, week-over-week comparison) was behind its PRO tier. Neither had been part of the earlier decision, so I reversed it. The price is that workouts logged in Tally don't appear in Apple Health, because a web app can't write to HealthKit.

### What I decided not to build

Barcode scanning (the places I eat from don't put barcodes on anything), recipes (I log per item, not per ingredient), progress photos, water, a community food database. MyFitnessPal has all of them. I considered each one and cut it.

The first design draft had a progress ring, and it died in review. A ring says that filling it up is winning, which is the opposite of what's true for calories.

## Design

Every color, type size, and spacing value is a token defined in [DESIGN.md](DESIGN.md), and nothing in the code hard-codes one. Contrast ratios are computed and written down beside each token instead of eyeballed.

A few decisions that took longer than they look:

- Shipping one light theme and no dark mode was a choice, recorded as such in DESIGN.md, rather than something left undone.
- No state is signaled by color alone. Go over a macro target and the bar doubles in height first; the color change is the second layer. A red/green colorblind reader gets the primary signal from the geometry.
- A half-built accessibility pattern was rejected as worse than none. Turning the meal selector into a full ARIA tablist would have promised screen-reader users arrow-key navigation that the implementation didn't have. It uses simpler semantics that keep the promise they make.

DESIGN.md carries a version log. Each entry says what changed and why, including the ideas that got rejected.

## Built with

Vite · React 19 · TypeScript · Tailwind 4 · shadcn/ui (Base UI) · Motion · dnd-kit · Recharts · vite-plugin-pwa · supabase-js

The backend is Supabase: Postgres plus Google OAuth. Hosting is GitHub Pages, built and deployed by GitHub Actions. Nothing loads from a CDN, and every dependency is bundled and self-hosted.

The repository is public, so the browser only ever holds the anonymous API key and every table sits behind row-level security. Signed out, every query comes back empty. Service keys, database passwords, and OAuth secrets are not in the repository and never will be.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:5500
```

```bash
npx vitest run     # unit tests: formulas, dates, rounding, image sizing, edge function
npm run e2e        # browser tests (WebKit, 393x745)
npm run build      # tsc -b + vite build
npm run lint
```

The e2e suite builds the app and runs against the static preview with every network call stubbed, so it needs no account and touches no real data.

## Repository

| Path | What's in it |
| --- | --- |
| [spec.md](spec.md) | Requirements and release phases (in Chinese) |
| [DESIGN.md](DESIGN.md) | Design system and every visual decision with its reasoning (in Chinese) |
| [.omc/notepad.md](.omc/notepad.md) · [.omc/wiki/](.omc/wiki/) | Current state and next step (OMC notepad), open questions (MANUAL), verified facts and decisions (wiki) (in Chinese) |
| [src/lib/](src/lib/) | Calculation, dates, data access, with no DOM |
| [src/screens/](src/screens/) | One file per screen |
| [e2e/](e2e/) | Playwright regression suite |

Development started 27 July 2026. The interface is in Traditional Chinese.
