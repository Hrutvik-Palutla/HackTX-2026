# SideQuest

Plans that make it out of the group chat.

SideQuest helps friends turn “we should hang out” into real plans. Find something everyone likes, work out a time, and choose an outing together—all through chat, with a website to keep everything organized.

## What you can do

- Plan through chat: Ask SideQuest for ideas in iMessage through Claw Messenger or use the website’s chat.
- Find common interests: Add notes, links, photos, or voice recordings. Review suggested interests and choose what friends can see.
- Discover real outings: Get suggestions backed by source links, with available timing and price details.
- Coordinate availability: Connect Google Calendar so Sid reads only free and busy times, or add times yourself one day at a time. Keep personal constraints and spending limits private.
- Vote together: Compare options, mark favorites, and revise the plan when something changes.
- Keep the details handy: Review the chosen outing, add it to your calendar, or download an ICS file.
- Make it an adventure: Generate optional photo challenges, riddles, and an illustrated quest card, then track shared progress.
- Earn badges: Each account earns badges from its own friends and plans (first friend, five friends, three plans started, an agreed plan, a plan with four or more people, plans with five different people, a first saved memory). New badges pop out once with a soft chime.
- Keep memories: After a plan is agreed, add photos from a phone or laptop or record a voice memo on the spot, then save a photo and open Instagram or Facebook to post it. Memories are saved on the device; SideQuest never posts for you.
- Catch up on chat: Request an optional Snowflake Cortex recap of selected group messages, with supporting quotes.
- Inspect the AI: Team members can edit versioned agent settings and review runs, tool calls, and usage in Studio.

Booking and payment support depends on the configured provider. Unsupported checkouts hand off to the buyer, with cost splitting and repayment tracking available around the purchase flow.

## Try the demo

Open [/try](https://getsidequest.tech/try) to walk through a fictional group adventure without an account. A step rail sets up each stage, so nothing has to be typed:

1. A quest for you: Sid proposes an outing; “Not our thing” opens optional interests.
2. Check everyone’s time: connect a calendar (simulated) to see the shared free window, or answer three yes/no questions.
3. Agree on an outing: three options on an illustrative map, one-tap votes, refine by cheaper, later or different.
4. Lock it in: one review, with a clearly simulated reservation.
5. Tonight’s quest, We went, Earlier outings: optional challenges, self-confirmed attendance and outing badges.
6. Memories and What next: photos and voice memos, then suggestions based on the outings so far.

The demo runs entirely in the browser: fictional friends, no API calls, no real bookings or posts. Reset replays it from the start.

## Design

- Theme: paper `#fbfbfa`, ink `#17171a` and one antique-gold accent `#a3834f`; Cormorant Garamond for display type, Inter for body text; hairline controls.
- Illustrations: four Anatomy-kit dioramas (canoe, record player, movie camera, dinner table) with turned-wood figurines: paddlers mid-stroke, friends talking over dinner, turning film reels, drifting record notes. Sources and build scripts live in `apps/web/illustrations`; run `node apps/web/illustrations/<name>/build.mjs` to regenerate an SVG.
- Home: the sign-in sits in the middle of a day out (9:00 Paddle, 1:30 Records, 7:15 Late show, 9:30 Dinner).
- Plans: a stage strip and one next action, option cards with time, cost, unknowns and sources, votes as seat bars, and the group chat beside the plan on desktop (below it on phones). Agreed plans show the itinerary, calendar add/download and memories.
- Badges: one registry of medallion SVGs in `apps/web/components/badges.tsx`, earned in ink and gold, unfinished in muted outline with progress in words.
- Motion is short and finite, and everything respects reduced-motion settings.

## Built with

Next.js, TypeScript, Meta Muse, SerpApi, Tiger Postgres, Claw Messenger, Google Calendar, and Vultr. Optional conversation recaps use Snowflake Cortex; live verification is still pending network configuration.

## Run locally

Use Node 24.22.1 and pnpm 10.34.8. Copy .env.example to .env and configure the required services.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Start the background worker in another terminal:

```sh
pnpm worker
```

Open http://localhost:3000. The public demo needs no sign-in; private plans require a verified account. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deployment and [STATUS.md](STATUS.md) for implementation and verification details. Pushes to `main` run the full test suite and deploy to getsidequest.tech.
