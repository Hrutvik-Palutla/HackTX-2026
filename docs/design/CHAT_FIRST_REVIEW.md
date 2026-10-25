# SideQuest: product and design review

October 25, 2026. Draft branch: `design/chat-first-preview`, based on upstream `eae4bac`. Nothing on this branch has been deployed. The visual theme is an image proposal awaiting approval.

## What the app does

Sid helps an existing group of friends choose an outing. Friends can ask in their Messages group, compare places on the website, agree on a time and vote. Claw Messenger is the transport for Sid's Messages conversations. The website and agent use the same plan records; they should not feel like separate products.

The old “recorded demo” was saved output from a test journey with fictional friends and real provider responses. It was useful integration evidence, but a poor first experience: visitors read about actions instead of trying them. Phone sign-in then hid the actual product.

## Walkthrough

1. **Home:** one sentence explaining the product. Primary action: **Try an example**. Sign-in is secondary.
2. **Example:** use fictional Alex, Mel and Mark. Pick an option, switch friend views, vote, confirm and change the time. Changing the time clears votes; choosing a conflicting time prevents confirmation. Try the photo challenges and riddles after confirming. Example chat accepts a few labeled commands; it is not a live model or messaging service.
3. **Use with my friends:** verify identity once. Phone identity matches the account to Messages and existing friends. Exploring the example does not require it; private groups still do.
4. **Start a plan:** ask Sid in the existing Messages group, or create a plan on the website. An active linked group is needed for cross-channel posting. Upstream has automatic group/notification behavior during planning; review the rollout caveat below before testing a real web-created plan.
5. **Plan board:** compare sourced options, availability and votes first. Read the plan's group conversation alongside them. Unknown prices, opening hours and booking status stay explicit.
6. **Reply:** website-only is the default. Select **Linked Messages group** to send a message there; the button names the destination. The server selects the linked group, checks membership and queues an attributed message. “Queued” is not “delivered.”
7. **Private details:** use **Tell Sid privately** for constraints. Private messages are not rendered in the group panel. A calendar connection is each person's choice; manual availability and calendar downloads remain available.
8. **After choosing:** optional photo challenges and riddles sit below the planning controls. Checkout, real calendar writes and reservations remain separate explicit actions. An agreed plan is not a venue booking.

The branch does not offer anonymous access to private groups or an unrestricted public AI endpoint.

## Navigation and language

| Area | Purpose / wording |
|---|---|
| `/` | “Make plans. Keep the group chat.” Short explanation and two clear next steps. |
| `/try` | One interactive example; fictional data and browser-only changes labeled clearly. |
| `/demo`, old `?preview=1` links | Redirect to `/try`, removing competing sample experiences. |
| `/plans` | Your actual groups and plan status in readable language. |
| `/plans/:id` | Places, time, votes and group conversation. Activities are optional. |
| `/plans/:id/private` | Tell Sid privately; your own constraints and notes. |
| `/friends` | Connect people you already know. Interest notes are owner-reviewed. |
| `/settings` | Profile and optional personal Calendar connection. |
| `/plans/:id/payment` | Explicit buyer/own-share and checkout details; no invented booking success. |
| `/studio` | Authorized team operators edit agent instructions, tools and limits. Not a consumer navigation item. |

Consumer labels change from “Drops” to **Your interests**, “Find our thing” to **Find ideas**, and generic “Quest” promotion to **Photo challenges and riddles**. Technical recipe IDs and provider terminology remain where operators need them. New agent runs receive a shared plain-language voice instruction; this does not rewrite old stored model output or promise perfect wording.

## Visual proposal — image only

See [the full concept](sidequest-concept-v1.png) and [prompt/provenance](CONCEPT_PROMPT.md).

- **Palette:** midnight pine `#132922`, warm ivory `#F4EFE4`, copper `#CB693E`, muted sage `#9BAC95`.
- **Scene:** original generated Austin riverside at blue hour, friends and food trucks, with a dark foreground supporting readable type. The reference informs scale and atmosphere; its wildfire theme, brand and logo are not reused.
- **Typography:** large condensed display lettering for the short home headline; a clear sans serif for controls and the plan board. Final font selection/licensing belongs to implementation after approval.
- **Composition:** immersive opening scene, restrained navigation and one primary action. A real application workspace follows: places and time in the main column, conversation beside them, clear voting state and compact optional activities.
- **Avoid:** repeated slogans, sponsor-logo walls, fabricated statistics, decorative status badges and long explanatory feature cards. A real interface and specific examples show the product.
- **Mobile implementation after approval:** stack places before chat, keep voting and destination controls easy to reach, preserve strong text contrast, visible focus and reduced-motion behavior. The image is not an accessibility or responsive-layout verification.

No proposed colors, display font, hero artwork or new theme have been applied to the application. The branch includes only small structural chat-list CSS changes using the existing theme. The PNG is a design artifact, not an imported application asset.

## Website / Messages convergence

Previously the web message endpoint read its own web threads, while the main Messages agent maintained provider threads. Simply exposing a provider's entire history would mix plans and potentially different memberships.

This branch adds nullable `messages.plan_id` and an index through migration `0001_simple_shooting_star.sql`. Every visible message must match the current plan, including web history: an agent can move a conversation to another plan. Unscoped historical messages are not backfilled; provider replays and replies derived from replay are withheld from plan history. The shared panel shows group messages, human names, source and actual outbox state. Private threads remain separate.

`GET /api/plans/:id/chat` returns messages and whether exactly one active Messages group is linked. Existing `GET /messages` keeps its array response. `POST /messages` adds `destination: website | linked_chat`, defaulting to website. Linked sends require group scope, membership and an active server-selected link. Queue dispatch rejects a group that moved to another plan. Sender identity comes from the verified session, never a submitted user ID.

The migration has **not** been applied to production. The readiness endpoint now checks its column. Merge/deployment needs coordinated migration, web/worker rollout and a real consenting group test. No live application message, Meta/SerpApi call, calendar write or production data change was performed during this review.

## MLH tools: Snowflake and SpaceXSI

Source review found no Snowflake/Cortex client or request path in the application. The original overnight plan explicitly cut Snowflake. Do not present it as used.

**Best fit if there is time: group memory after an outing.** Friends explicitly choose feedback they want to share, such as “too loud” or “liked eating outside.” Cortex could turn those comments into structured group preferences, with comment IDs as evidence. The next Muse plan can use approved preferences alongside fresh SerpApi results. This adds a learning loop to repeated outings rather than another scheduling database.

That requires an actual Snowflake account, permitted model/role, authenticated REST call, verified response and an end-to-end acceptance check. Keep Tiger as the operational database. Do not export private calendars, phone numbers, tokens, budgets or unshared notes. Validate cited feedback IDs and support revocation/deletion before reuse. A schema or badge alone is not an integration. None of this Snowflake feature is implemented on this branch.

MLH describes Snowflake's offer as a 120-day trial with Cortex AI Studio and REST APIs: [MLH Snowflake partner page](https://www.mlh.com/partners/snowflake). The [official Cortex REST documentation](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api) describes authenticated model calls and structured output. Confirm event-specific submission rules with organizers; these sources explain capability, not eligibility for this team's submission.

**SpaceXSI is a development-tool opportunity.** MLH's [SpaceXSI partner page](https://www.mlh.com/partners/spacexsi) describes Cursor and Grok Bot, including background workflows. It is not a satellite-data API for SideQuest. A concrete use would be having a teammate use those tools for a bounded UI/accessibility/regression review with synthetic data, inspect the changes and document the actual workflow. Existing Codex work does not establish Cursor/Grok use. No such use was verified or claimed here, and no extra application service was added.

## Review and rollout

**Existing upstream behavior to review before live rollout:** the planner calls `ensurePlanGroup` after publishing options and can create a Messages group when configured. The agent's selection tool also enqueues calendar sync. This branch has not redesigned those consent paths. Its website-only message destination controls that particular post; it does not disable the pre-existing planner's notifications or make generating a real plan a silent operation. Confirm explicit user permission for group creation, notifications and calendar writes before live acceptance. No such action was executed during this review.

- Review the picture first; visual approval is separate from merging or deployment.
- Review the code, especially message scope, private-thread exclusion and linked-message routing. `CONTRACTS.md` records the interface change.
- Apply the included additive migration before the new web/worker version. Retain verified TLS and the existing encryption key.
- Use a consenting test group to verify inbound Messages → correct plan board, website-only post, explicit linked post → correct group, truthful delivery state, private note exclusion and group switching. Unit/browser mocks cannot replace this acceptance check.
- Each person still verifies their phone and grants their own Google consent. The prior OTP receipt and owner-reported Google setup are evidence of setup, not completed sign-in/Calendar acceptance.
- Keep the visual theme, Snowflake and SpaceXSI usage proposals separate from verified implemented behavior. No public feature or sponsor claim should get ahead of actual use.

[Full Linux CI passed on code revision `b17019e`](https://github.com/Hrutvik-Palutla/HackTX-2026/actions/runs/40177165839): backend/worker TypeScript, production build, 65 backend tests, 37 messaging/calendar tests, accounts, all 75 discovery/fulfillment tests, runtime-installer checks, the real Postgres account journey and all 36 desktop/mobile browser checks. The account journey uses complete shared migrations in a disposable schema and captures OTP delivery locally; UI journeys use controlled API responses. These checks do not establish real Claw delivery or Google consent. No production credentials were used, and the deployment job was skipped. Final handoff edits are documentation only. See `STATUS.md` for remaining acceptance work.
