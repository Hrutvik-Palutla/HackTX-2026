# SideQuest

Plans that make it out of the group chat.

SideQuest helps friends turn “we should hang out” into real plans. Find something everyone likes, work out a time, and choose an outing together—all through chat, with a website to keep everything organized.

## What you can do

- Plan through chat: Ask SideQuest for ideas in iMessage through Claw Messenger or use the website’s chat.
- Find common interests: Add notes, links, photos, or voice recordings. Review suggested interests and choose what friends can see.
- Discover real outings: Get suggestions backed by source links, with available timing and price details.
- Coordinate availability: Connect Google Calendar or enter availability manually. Keep personal constraints and spending limits private.
- Vote together: Compare options, mark favorites, and revise the plan when something changes.
- Keep the details handy: Review the chosen outing, add it to your calendar, or download an ICS file.
- Make it an adventure: Generate optional photo challenges, riddles, and an illustrated quest card, then track shared progress.
- Catch up on chat: Request an optional Snowflake Cortex recap of selected group messages, with supporting quotes.
- Inspect the AI: Team members can edit versioned agent settings and review runs, tool calls, and usage in Studio.

Booking and payment support depends on the configured provider. Unsupported checkouts hand off to the buyer, with cost splitting and repayment tracking available around the purchase flow.

## Try the demo

Open /try to explore a fictional group adventure without an account. Compare options on an illustrative map, vote, refine your plan, complete challenges, explore badges, and create downloadable photo share cards.

The demo runs entirely in your browser. Reservations are simulated, photos stay on your device, and its badges and sharing flow are not yet connected to live plans.

## Built with

Next.js, TypeScript, Meta Muse, SerpApi, Tiger Postgres, Claw Messenger, Google Calendar, and Vultr. Optional conversation recaps use Snowflake Cortex; live verification is still pending network configuration.

## Run locally

Use Node 24.22.1 and pnpm 10.34.8. Copy .env.example to .env and configure the required services.

pnpm install --frozen-lockfile
pnpm dev

Start the background worker in another terminal:

pnpm worker

Open http://localhost:3000. The public demo needs no sign-in; private plans require a verified account. See README setup references (docs/DEPLOYMENT.md) for deployment configuration and STATUS.md (STATUS.md) for implementation and verification details.
