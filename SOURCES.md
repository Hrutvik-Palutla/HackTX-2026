# Technical Source Register

Checked October 24, 2026. Primary documentation only. Architecture, contracts, limits, and task assignments are our design choices unless explicitly described as provider capabilities. Public documentation establishes what a service offers, not that this team's account has access. Supplied SerpApi access and Muse credits are user-reported; their live quota/entitlements were not tested here.

## Event evidence

| Source | What it establishes | Limit |
|---|---|---|
| [HackTX opening ceremony](</Users/hrutvik/Downloads/HackTX 26 Opening Ceremony.pdf>) | Pages 34, 47, and 51 show the Meta social-AI challenge, Northmark reusable-agent-platform challenge, and open SerpApi challenge. Relevant slides were rendered and visually inspected. | Local original; no exact team credit grants established. Northmark is a challenge sponsor, not an assumed agent API. |
| [MLH HackTX prize hub](https://www.mlh.com/events/hacktx-26/prizes) | Tiger Data, Vultr, Gemini, Snowflake, .TECH, and other listed categories. | Category availability is not account redemption, credit size, or selection eligibility. |
| [Vultr MLH partnership](https://discover.vultr.com/mlh) | Event cloud-credit program. | Public page does not state this team's grant; redeem/check the account. |

The referenced Devpost home page was inaccessible to the web reader during this research. The opening slides and official MLH hub support sponsor mapping; older event rules in IDEA.md were not independently revalidated for this technical design. No Hacker Handbook copy was located in the inspected workspace/Downloads/Desktop paths.

## Inference and discovery

| Source | Capability used |
|---|---|
| [Meta quickstart](https://dev.meta.ai/docs/quickstart) | Compatible client setup and Meta base URL/model configuration. |
| [Meta tool calling](https://dev.meta.ai/docs/tool-calling) | Developer-defined tools; application executes the effects. |
| [Meta tool cookbook](https://dev.meta.ai/docs/cookbook/tool-function-calling) | Bounded tool-loop pattern and `tool_choice: auto` limitation. |
| [Meta structured output](https://dev.meta.ai/docs/structured-output) | JSON-schema-constrained extraction/drafts. |
| [Meta Responses protocol](https://dev.meta.ai/docs/protocols/responses) | Stateless replay with encrypted reasoning; application state stays in our database. |
| [Meta pricing and modes](https://dev.meta.ai/docs/pricing-rate-limits) | Spark Standard $1.25/M input, $4.25/M output; Contributor-mode data use differs; grounding costs extra. Credits/balances still need account verification. |
| [Meta computer-use recipe](https://dev.meta.ai/docs/cookbook/computer-use) | Model-driven tool/browser pattern; it does not supply us a managed booking service. |
| [SerpApi showtimes](https://serpapi.com/showtimes-results) | Conditional showtimes structure in Google Search results. It is discovery, not seats or ticket purchase. |
| [SerpApi Maps](https://serpapi.com/google-maps-api) | Place discovery. |
| [SerpApi Events](https://serpapi.com/google-events-api) | Event discovery. |
| [SerpApi Extract](https://serpapi.com/extract-api) | Public-page content extraction using `engine=extract`. Not checkout automation. |
| [SerpApi Account API](https://serpapi.com/account-api) | Integration-time balance/quota inspection. No sponsor allowance assumed. |

## Messaging and identity

| Source | Capability/access finding |
|---|---|
| [Linq pricing](https://linqapp.com/s/pricing) | Hobby is free with a contact limit; group messaging is listed under Pro starting at $260/month. Seven-day Pro trial advertised, with no card required to sign up. Trial/group entitlement untested. |
| [Linq group chats](https://docs.linqapp.com/channel/imessage/guides/chats/group-chats/) | Group creation, participant operations, initial no-link constraint, stable chat identity behavior. |
| [Linq polls](https://docs.linqapp.com/channel/imessage/guides/messaging/polls/) | Native per-option voting and poll events; options cannot be edited/removed. |
| [Linq webhooks](https://docs.linqapp.com/channel/imessage/guides/webhooks/) | Signature verification, versioning, and duplicate-delivery handling. |
| [Telegram introduction](https://core.telegram.org/bots) | Free bot platform; users must initiate contact before private conversations. |
| [Telegram FAQ](https://core.telegram.org/bots/faq) | Group message visibility/privacy-mode behavior. |
| [Telegram Bot API](https://core.telegram.org/bots/api) | Polls, contact-sharing controls, webhook secret mechanism; no general create-group method in the documented bot surface. |
| [Photon pricing](https://photon.codes/pricing) | Full managed group access listed at Business $250/line/month; a free DM tier does not establish affordable group support. |
| [Sendblue group access](https://docs.sendblue.com/getting-started/groups) | Group creation/access depends on plan; not a verified free equivalent. |
| [Better Auth phone plugin](https://better-auth.com/docs/plugins/phone-number) | Phone OTP/login/signup with custom delivery, including phone-first signup using an internal generated email field. |

## Purchase, repayment, and Calendar

| Source | Capability/access finding |
|---|---|
| [Link Agent Wallet overview](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet) | Agent access to consumer spending with approved payment credentials. |
| [Link spending guide](https://docs.stripe.com/agentic-commerce/agents/link-agent-wallet/use-link-wallet-pay-online) | Purchase-specific spend requests, approval URL, and credentials for checkout. Available-account region and eligibility must match the actual team buyer. |
| [Official Stripe Link CLI](https://github.com/stripe/link-cli) | Official executable/SDK, separate auth files, safe credential-output options, and explicit test mode. Pin a release and use its help/schema during the spike; docs/code may differ in defaults. |
| [Linq Agentcard versus Stripe](https://docs.linqapp.com/channel/imessage/guides/agentcard/agentcard-vs-stripe/) | Spending on a user's behalf differs from collecting money into a merchant account. Neither establishes personal reimbursement support for Link. |
| [PayPal.Me FAQ](https://www.paypal.com/us/cshelp/article/paypalme-frequently-asked-questions-help432) | Links can request a specified amount/currency from the recipient; payment-status automation is not established by this link mechanism. |
| [AMC API access request](https://developers.amctheatres.com/GettingStarted/NewVendorRequest) | Catalog access requires approval; ecommerce/seating require separate approval and contracts and are not accepting site requests. |
| [Calendar free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) | Scopes and busy-interval response for authorized calendars. |
| [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) | User grants, state, code exchange, and offline token handling. |
| [OAuth testing audience](https://support.google.com/cloud/answer/15549945) | Test users and seven-day test authorizations for relevant scopes. |
| [Calendar event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) | Own-event write scopes and event shape. |
| [Calendar quotas/pricing](https://developers.google.com/workspace/calendar/api/guides/quota) | Standard small-volume usage has no additional API cost; quotas still apply. |

No public Link source inspected here established a personal friend-to-friend reimbursement API. We therefore use Link for the nominated buyer's purchase and separate private repayment links for the other attendees. Automatic repayment settlement would require additional verified provider support; it is not implied by automatically calculating shares or sending requests.

## Hosting, tooling, student offers, and optional extras

| Source | Capability/access finding |
|---|---|
| [Tiger pricing](https://www.tigerdata.com/pricing) | Advertised 30-day trial, hourly billing, paid compute from $30/month; trial availability remains account-specific. Several older Tiger documentation URLs did not load in the reader. |
| [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting) | Deployment on our own Node/Docker host. |
| [Next installation](https://nextjs.org/docs/app/getting-started/installation) | Current 16.x documentation/runtime setup. Exact versions belong in the scaffold's lockfile. |
| [Postgres SELECT](https://www.postgresql.org/docs/current/sql-select.html) | Row-locking/`SKIP LOCKED` pattern for durable work claims. |
| [Playwright Docker](https://playwright.dev/docs/docker) | Container/browser deployment support; image/package versions must match. |
| [Browserbase pricing](https://www.browserbase.com/pricing) | Free one-hour browser allocation with session limit, optional $20 Developer plan; account activation not tested. |
| [Current GitHub Student Pack](https://education.github.com/pack) | Azure credit, Clerk Pro, Appwrite Education, Stripe fee credits, and domains appear in the checked listing. Benefits require eligibility/redemption and are not ticket-purchase money. |
| [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Optional limited free-model access, with free-tier data use to consider; only sanitized public/synthetic input in this plan. |
| [Snowflake Cortex REST](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api) | A possible later inference/analytics integration; not needed for the chosen critical path. |

Vultr's public pricing page returned a 403 to the reader; no precise VM price is asserted. The budget reserves a capped amount if event credit is unavailable. None of the advertised trials/student offers is treated as activated cash credit merely because a teammate is a student.
