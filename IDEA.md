# HackTX: friend-group planning agent

Product scope finalized for the hackathon on October 24, 2026. This document is the baseline for technical planning. It describes the intended product, not completed implementation or verified integrations. The agent remains unnamed. Event logistics below are retained from the earlier planning pack and have not been reverified in this revision.

The end-to-end technical design is now in [ARCHITECTURE.md](ARCHITECTURE.md), with [shared contracts](CONTRACTS.md), a [four-person implementation plan](IMPLEMENTATION_PLAN.md), and [verified source notes](SOURCES.md). Provider choices and implementation fallbacks there supersede the provisional tool choices below; the product premise remains the baseline.

## Product promise

Tell the agent what your group wants to do and who is coming. It handles finding a time, comparing options, getting agreement, splitting the cost, and booking through a supported provider.

The group may have a broad idea, like “Let's do something this weekend,” or a specific intention, like “We want to watch Avengers.” The agent uses what the group has already decided and works out the remaining details. For a movie, the alternatives are actual showtimes, theaters, and ticket prices for that movie, rather than three unrelated activities.

The first scope is the two messaging flows below for local outings. Group-size limits and a fixed planning horizon are not product priorities at this stage. Users enter their city; a home address is not required. Messaging is the main interaction: the agent explains three options, discusses them with the group, posts a poll, handles changes, and moves the plan toward split payment, booking, and calendar details. A small web app supports setup, private preferences, and detailed plan views.

## Two ways to start a plan

### 1. Add the agent to a group chat

The friends are already discussing an outing but do not want to spend time aligning schedules and planning. Someone adds the agent and gives it the request, such as “Find a time for us to watch Avengers this weekend.”

The agent identifies the intended participants and helps establish any missing organizer-to-participant connections privately. Once those friendships are established, it uses the conversation, shared calendars, city, and interests to prepare three options. Existing friends do not need to pass a separate participation-acceptance step before the agent proposes plans.

It explains the options in the chat, including time, location, price, and tradeoffs, then posts a poll. Participants can suggest ideas, raise concerns, and refine the plan through conversation. The agent can guide the discussion and ask focused questions when useful.

Adding the agent does not automatically enroll every chat member in an outing or make members friends with each other.

### 2. Text the agent privately and name the friends

A group decides in person to do something. One person texts the agent:

> Me, Mark Watney, and Mel Gibson want to watch Avengers this weekend.

The agent looks up Mark and Mel in the organizer's friend list. It asks for clarification if a name is ambiguous and confirms the movie if the title is unclear. It requests any missing friend connections. For someone it does not know, it asks the organizer for their phone number and sends an invitation explaining who invited them and what the group wants to do.

The invitee completes setup and accepts the friend connection. Once all named people are connected to the organizer, the agent prepares the options and reaches out to everyone. Ideally it creates a group chat with the participants and conducts the discussion and poll there. If the provider cannot create that chat, it texts people separately using the same plan, options, and vote state.

## Account setup and friend connections

Signup collects a verified phone number, name, city, and interests, then offers calendar connection. An address and a budget field are not part of signup. City is the starting point for local discovery; if participants are in different cities or want to meet elsewhere, the agent asks where the outing should take place.

Availability comes mainly from the group conversation and connected calendars. People can also explain their availability in a private message. Missing calendar access does not block use of the agent, and an empty calendar alone does not establish that someone has agreed to a time.

Friend requests can start in several places:

- A user texts the agent to connect them with someone, using a known contact or a phone number.
- The agent texts the invitee a request they can accept; a new user also gets the account setup flow.
- In a group chat, the agent privately offers to help the organizer connect with participants who are missing from their friend list. It sends requests when the organizer asks or confirms.
- A private web view lets users review pending requests and their existing friends.

All of these routes create the same connection request. A friendship exists only after acceptance. A display name or presence in a group chat is not proof of identity or a connection.

### Who can plan together

The organizer must be connected to every participant. Other participants do not need to be friends with one another. For example, someone can invite their roommate and a coworker to the same movie without requiring those two people to connect first.

All named participants must have completed setup and accepted the organizer's friend connection before group proposals are generated. When everyone is already connected, the agent starts planning immediately from the request and available context. The organizer can start a request while connections are pending; the agent resolves those first. A declined connection prompts a discussion about revising the roster or stopping the request.

A friend connection lets the agent include someone in initial proposals. Calendar sharing, attendance, and payment remain distinct. The plan keeps a visible participant list and tracks known attendance, objections, and unanswered questions without automatically treating every named person as a confirmed attendee.

## Conversation, preferences, and availability

The agent actively interacts with participants in the group chat. People can suggest a theater, prefer a different time, or ask for another kind of outing. It responds when addressed and when a message directly affects the active plan, such as a new time constraint, a suggested venue, or a request to book. It proactively posts options, asks focused questions, and reports meaningful progress. It stays quiet during unrelated conversation.

Private messages support questions or constraints that should stay out of the group. For example, if someone has mentioned an appointment but its end time is unclear, the agent can privately ask when they will be free. It uses the answer to plan without disclosing the appointment or the private exchange. Calendar access uses the information the person has chosen to share.

Budgets and preferences are always private unless the person chooses to share them. Public explanations describe the options and their tradeoffs without attributing a private constraint to someone. A participant can privately ask for lower-cost choices after planning begins.

Budget is not a central onboarding or planning workflow. The three choices should offer useful differences in price and experience where real options allow: perhaps a cheaper option, a balanced option, and a premium option. These are not rigid tiers, and timing, location, or other differences may matter more. An explicit private spending limit is respected when supplied; offering a range of prices does not override it.

The organizer starts the request, supplies missing contacts, and anchors the required friend connections. They can update the participant list before booking and close an unbooked plan; the agent announces those changes to the group. Participants can suggest changes, vote, raise concerns, and leave. Being the organizer does not let someone override another person's stated constraints or authorize that person's payment. Ownership transfer and more elaborate roles are outside the hackathon scope.

## From a request to an outing

1. Establish the request and named participants. Preserve decisions the group has already made, including a specific activity, movie, date range, or location. Resolve missing friend connections before generating proposals; existing friends need no additional enrollment step.
2. Use signup information, conversation context, and shared calendars to work out the outing. Ask the group for shared decisions and ask individuals privately about personal details. If availability is uncertain, label the proposed time accordingly and clarify it through discussion.
3. Search real sources. For movies, find showtimes, theaters, runtime, ticket prices where available, and booking links. Account for travel time and the full activity duration.
4. Explain three options in the conversation. Include price, experience, timing, location, and other useful tradeoffs. Fit known constraints and state uncertainties. If fewer than three work, show the actual choices or discuss what to change.
5. Post a poll that lets people mark acceptable options and a favorite, with a way to say “none of these.” In a group chat, keep the discussion and poll there; private-message fallback collects votes against the same options.
6. Use votes and conversation together to choose a plan. Rank options by acceptable votes, then favorites, while respecting known hard constraints. A clear frontrunner and a group message to proceed can move the plan forward while some people remain silent. There is no mandatory unanimous final-confirmation step. If the winner, attendance, or an objection is unclear, ask one focused question before booking. State the selected option and named attendees; silence alone never authorizes a charge. See the hackathon defaults below for tie and holdout behavior.
7. Arrange seats and payment, then attempt the booking through a supported integration. Ask about seating preferences when needed, show the purchase details, and obtain payment authorization from whoever is paying. Send private payment requests for the calculated shares where supported.
8. Share actual booking confirmations and calendar details. Keep handling changes after selection and booking. A material change makes affected votes and agreements stale; explain what changed and use discussion, a new poll, or a focused question to resolve it, rather than requiring every person to reconfirm every update.

## Payment, booking, and changes afterward

The goal is for the agent to complete the booking itself through a supported provider. For a movie, it asks the group about seat preferences where necessary and tries to secure the agreed seats together. It rechecks inventory and price before purchase and returns to the conversation if the agreed arrangement is no longer available.

Splitting the cost is the preferred payment experience. For the hackathon, one nominated buyer funds the group purchase, and the agent sends the other attendees private requests to reimburse their shares after the booking succeeds. The agent asks who will pay and can suggest the organizer; it never assigns the bill automatically. This keeps seats in one purchase and avoids building a pooled-funds system.

Each person pays their own ticket/item cost. Shared fees and group discounts are allocated proportionally to item costs, or equally when item costs are equal. Round to cents and distribute any remainder so the shares sum exactly to the charged total. The group can request a different split before payment requests are sent. A private request shows the recipient's own share without exposing someone else's private budget or payment details. The buyer can see reimbursement totals and status.

The reference experience is the user's description of Instinct-style “Link” wallet requests. The actual payment provider is a technical selection, not a product decision to revisit. Technical planning must verify support for buyer authorization, agent-assisted purchase, private reimbursement requests, and status confirmation. A request being sent does not mean it has been paid.

A poll outcome or agreement to proceed does not by itself authorize charging a participant. Payment requests and booking headcount need to reflect the agreed attendees and an authorized buyer. Track plan selection, buyer payment, booking confirmation, reimbursement requests/payments, and calendar creation separately. A checkout handoff is a fallback if direct booking cannot be supported, and must be described as such.

After booking, the agent continues navigating changes through conversation. It checks the provider's available change/cancellation options, explains costs and consequences, gets the buyer's approval for a financial change, and performs the supported action. If the provider requires manual action, it gives the buyer the exact next step and link. It updates the group and affected payment requests after a confirmed outcome. Refunds follow the provider's actual result; a full refund is never assumed. A general cancellation/refund automation system is outside the hackathon scope.

## Hackathon defaults

These are the working product rules. Ordinary ambiguities are resolved in conversation; they do not need separate settings or complex workflows.

| Situation | Default behavior |
|---|---|
| A broad request | Use city, interests, conversation, and shared availability to propose three distinct local outings. |
| A specific request | Keep the named movie/activity fixed and vary useful details such as theater, time, price, and experience. |
| An ambiguous name, city, title, or date | Ask the smallest question needed to continue. Use the outing city's local time and state actual dates/times in options. |
| Incomplete availability | Propose from known context, flag uncertain timing, and ask privately if personal details are needed. Resolve known conflicts before booking. |
| A clear poll leader | Announce the winner and named attendees. Proceed when the conversation clearly says to go ahead and a buyer authorizes the purchase. A separate response from every participant is unnecessary. |
| Silent holdouts | Use prior conversation and an explicit group instruction such as “Go ahead for all four.” If attendance is unclear, ask who to include; never silently drop someone or charge them because they did not answer. |
| A tie or no workable option | Present the tradeoff and ask the group to choose or relax one constraint. The organizer can break a preference tie when the group asks them to; hard constraints still apply. |
| A stalled poll | Send one gentle reminder after 30 minutes, then wait for a response or an organizer nudge. Silence does not trigger automatic booking. |
| Seat selection | Try adjacent seats near the center in a standard screening, honoring stated preferences. Ask if that arrangement is unavailable or changes the agreed price. |
| Changing price or inventory | Refresh before purchase. Ask the buyer/group about a changed total or materially different seats rather than buying a different arrangement silently. |
| A failed or uncertain booking | Check status before retrying so a delayed response does not produce duplicate purchases. Report the actual outcome and offer another option or provider checkout. |
| A change after booking | Navigate the provider's supported process with the buyer; use a clear manual handoff where necessary. |

Price, travel time, or other details unavailable from the source remain labeled estimates or unknowns. The agent does not invent facts to fill three options. Group discussion, private follow-ups, and polls all update the same plan version.

## Build priorities

1. Verify one messaging provider's support for direct messages, group participation, group creation, private invitations, and polls or equivalent voting controls. Build one adapter against a shared backend; keep private-message fallback if group creation is unavailable.
2. Signup with phone verification, name, city, and interests; accepted friend connections and a visible plan roster; deploy the supporting web flow.
3. Conversation-based availability and private follow-ups, with optional real calendar free/busy access for consenting test accounts.
4. Real movie/showtime and venue discovery, source links, fetched times, and unknown-field handling. Verify access to usable showtime data early.
5. Meta-powered structured planning, deterministic feasibility checks, three explained options, and voting in the conversation.
6. Context-aware plan selection and repair, seat preferences, one authorized group buyer, automatic share calculation, private reimbursement requests after booking, and calendar export/confirmed event creation. Verify payment and booking access early; label any checkout fallback accurately.
7. Northmark agent-template configuration and actual run history using the same backend.
8. Additional sponsor integrations or entertainment mode only after the core succeeds.

Hardware, the original generated multiplayer game, overnight travel, native mobile apps, and multiple messaging providers are deferred. Purchases use an authorized payer and agreed purchase details.

## What makes this more than an itinerary chatbot

- Known hard constraints are enforced in code: availability, activity duration, explicitly supplied private spending limits where reliable prices exist, and supported dietary/accessibility requirements. Unknown availability or suitability stays uncertain until clarified. Budget collection is not a required workflow.
- Plans explain the tradeoffs and how each person is considered without exposing private budgets, calendar titles, or personal notes.
- The agent knows which friends the organizer means, handles missing connections, and starts planning for established friends without a separate participation gate.
- Requests can be broad or specific. A named movie stays the target unless the group agrees to change it.
- Conversation, options, votes, and follow-through share one plan state across group and private messages.
- Polls and conversation guide the decision; a clear group decision can proceed despite silent holdouts. Known objections and payment authorization are handled explicitly.
- Each plan version has its own votes and recorded group decisions. A material change prompts the discussion or renewed voting needed for that change.
- The agent helps with seating, fair cost splitting, private payment requests, booking, and changes afterward.
- New constraints repair a plan rather than restarting a conversation.
- If no option works, discuss alternatives with the group. Keep changes to the participant list and booking headcount visible.
- Success means a group decision that leads to a real outing with as little organizer effort as possible.

## Tool allocation

| Tool | Useful job | Priority / proof |
|---|---|---|
| Muse Spark | Interpret requests, propose and repair structured plans | Core; actual calls and tool trace |
| Messaging provider — TBD | Direct requests, group-chat agent, private invitations, ideally group creation, discussion, and voting | Core; prove supported conversations and identity linking early |
| Phone verification provider — TBD | Verify ownership of the account phone number | Core; distinguish account identity from a chat display name |
| SerpApi Maps / Events / Search | Find venues, activities, sources, and booking links | Core; live results with fetched time and URLs; movie showtime coverage must be verified |
| Showtime / ticket provider — TBD | Movie inventory, prices, seat selection, booking execution, and confirmation | Core goal; actual access must be proven; checkout handoff is a fallback |
| Wallet / payment provider — TBD | One authorized buyer and private reimbursement requests for calculated shares after booking | Core goal; verify payment requests, status, and purchase support; “Link” is a user-supplied reference, not a selected integration |
| Google Calendar | Per-user free/busy; confirmed event creation | Core; two real consenting accounts first |
| Tiger Data | Accounts, friendships, invitations, participants, private preferences, plans, votes, group decisions, payment/booking status, runs | Core if access works; actual queries |
| Vultr | Web/backend deployment and persistent worker | Core if access works; public demo |
| Gemini | Independent structured plan critic / alternative generation | Next; a visible useful critique; code still enforces hard constraints |
| Northmark challenge | Reusable planner template with tools, model, limits, monitoring | Next; Dinner and Day Out reuse the same runner |
| Muse Voice Transcribe | Voice request converted into editable constraints | Stretch |
| Muse Image | A shared outing invitation / reveal card | Stretch; never fabricated venue photography |
| Muse connector | Expose draft_plan and get_plan through a supported authenticated connector | Stretch; verify event access first |
| Facebook Graph API | Permissioned enrichment if useful and available | Defer; entered interests are sufficient |
| Snowflake Cortex API | Optional post-outing reflection that informs next plan | Stretch; separate useful function, not duplicate primary storage |
| .TECH | Memorable working deployment domain | Low effort after deployment; availability unknown |
| Cursor + Grok Bot | Core development + bounded background workflow | Document both and raffle opt-in if pursuing SpaceXSI |
| Solana | Optional verifiable shared-plan receipt | Weakest fit; defer unless organizers' rules and a real user need justify it |
| DEV Writing Challenge | Explain what was actually built and learned | Save notes now; check deadline and write later |

SerpApi discovery does not complete a reservation. Booking links must say “Check availability / reserve with provider.” Only show “Reserved” after a real supported booking confirmation. Calendar events and reservations are separate states.

## Messaging decision

Messaging is core. The agent must support a group request and a private request naming friends, with the same underlying planner. The provider is not yet chosen. iMessage, SMS/MMS, WhatsApp, Telegram, and Discord have different capabilities; phone-based accounts do not establish that a provider can message any phone number or join an existing group chat.

Start with a bounded provider spike. Prove that the agent can receive a private request, participate in a group, invite a participant privately, explain options, discuss changes, and collect votes. Check group creation separately: the ideal direct-request flow creates a chat for the named friends, with individual messages as fallback. Check whether the recipient must initiate a conversation before the agent can contact them. Use an invitation link to begin that conversation when required, and describe the actual experience accurately.

Telegram or Discord may be practical demo adapters if access works, but neither is a confirmed implementation choice. Ask Meta at the workshop about supported messaging access. Securely link messaging identities to verified accounts. Follow the conversation and reminder defaults above. Do not post private constraints to the chat.

Keep a mobile-friendly web flow for setup, invitations, preferences, plan details, and testing. If provider access blocks the intended messaging experience, use the web flow as an explicit prototype fallback and narrow the demo claim. A pasted link alone does not demonstrate an agent joining a chat.

## Frontend direction

Mobile-first, warm, social, readable. Choose one accent color, off-white surfaces, strong text contrast, compact cards, and friend avatars. Light animation for state changes; no elaborate scene or mascot dependency.

The main experience is the conversation: requests, brief explanations of options, polls, progress, and confirmed details. Supporting web surfaces:

1. Account and friends: verified phone number, name, city, interests, optional calendar connection, pending friend requests, and friend list.
2. Connection request and plan context: organizer, intended activity, participant list, and friend-request accept/decline controls. Existing friends can receive proposals directly.
3. Private details: profile preferences, shared calendar settings, and answers to personal follow-ups. Budget is not a required form; an optional private constraint can be added through conversation.
4. Compare: the same three options shown in chat, with price/experience differences, timing and uncertainty, sources, acceptable choices, favorite, and concerns. Mobile remains usable without a map SDK.
5. Selected plan: group decision and intended attendees, seat details, each person's private payment request/status, actual booking status, tickets or confirmation when available, calendar action, and “Something changed.”

Show actual progress (“Checking availability”, “Finding places”, “Checking constraints”). Advanced model/tool information belongs in an expandable run inspector and Agent Studio.

## Team ownership

| Selectable part — owner unassigned | Owns | First handoff |
|---|---|---|
| Part 1 — App & Accounts | Web screens, Better Auth, profiles, friend connections and their handlers, pitch presentation | Scaffold and signup/friends/plan views against typed contracts |
| Part 2 — Agent & Backend | Shared schema/contracts, durable worker, Muse, plan lifecycle, votes, availability checks, repair, templates/run records | Shared types/DB/queue helpers and a working structured Muse call |
| Part 3 — Messaging, Calendar & Deployment | Hobby-first Linq spike, transport/polls/OTP delivery, Google Calendar, deployment, integration recording | Actual phone messages/votes, public shell, and Google OAuth spike |
| Part 4 — Discovery, Booking & Payments | SerpApi candidates, quotes/seats, Link, booking worker, exact shares, private repayment services | Real normalized candidates first; then buyer/booking path |

Each person picks one part; no person is assigned in advance. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) defines the exact scope, file ownership, handoffs, and completion checks. Part 1 owns root scaffold/lockfile changes, Part 2 owns CONTRACTS.md and migrations, and Part 3 coordinates deployment. Review cross-part changes together. Assign optional integrations only when an owner's core handoff is complete. References to the integration/frontend/planner/discovery roles in the retained schedule map to Parts 3/1/2/4 respectively.

## Schedule — Austin time, October 24–25

Times are the target plan, not recorded completion. Assume the team starts around 2:15 p.m. Saturday. Lunch is available until 3 p.m.; get it now if needed. Each person gets 90 minutes of sleep, staggered.

| Time | Work / event | Exit condition |
|---|---|---|
| Sat 2:15–2:45 p.m. | Lunch if needed; assign names; agree contracts; check messaging and discovery access | Owners assigned; account/invitation flow starts; messaging and calendar spikes underway |
| 2:45–3:00 | Deploy skeleton; queue bounded AI work; move to Meta | Public shell and scoped coding tasks |
| 3:00–4:00 | Meta workshop, GDC 2.216; send you + planner owner if useful | Working access/credits or a concrete fallback; other two build UI + search |
| 4:00–5:00 | Discovery/platform owner attends Northmark, GDC 2.216 | Reusable-platform criteria understood; other three continue core. Send another to SpaceXSI GDC 6.302 only if it won't block integration |
| 5:00–6:00 | Integrate request → friend connections → context/calendars → search → proposal | A real deployed proposal; supported messaging path demonstrated or fallback explicit; calendar spike resolved |
| 6:00–7:00 | Add conversational voting, plan repair, validation, and recorded group decisions | One changed constraint produces revised options; affected votes and decisions become stale |
| 7:00–7:40 | Dinner, GDC Atrium | Review full journey; agents run fixed checks / assets / contained fixes |
| 7:40–9:00 | Test both journeys, private follow-ups, and silent holdouts; verify payment/booking path | Observed feedback; friend connections, contextual decisions, and calendar actions work; payment/booking capability accurately described |
| 9:00–10:00 | Northmark studio if core is ready; strengthen the single messaging adapter | Actual template reuse/run evidence; shared backend; no second provider |
| 10:00–11:00 | Integration, first recording, Devpost draft | Public repo, accurate toolkit list, draft story; early video backup |
| 11:00–11:30 | Submit soft submission | Verify actual submitted state before 11:30 |
| 11:30 p.m.–12:15 a.m. | Backup; midnight snack | Working checkpoint; handbook requires proof of soft submission for snack |
| Sun 12:15–1:30 a.m. | Only proven extras: Gemini, voice, image, connector, etc. | Each addition has real proof and a product benefit |
| 1:30–3:00 | Reliability, polish, demo rehearsal | Reconnect/retry/reset; identity, connection, vote, payment, and booking integrity; end-to-end recording |
| 3:00–4:30 | You + planner owner sleep; frontend + discovery awake | Bounded UI/search checks; no large shared schema edits |
| 4:30–6:00 | Frontend + discovery sleep; you + planner awake | Integration and calendar checks; no large UI rewrites |
| 6:00–7:30 | Full-team feature cutoff and tests | Final working scope and track shortlist |
| 7:30–8:00 | Record final flow and failure/replan moment | Usable demo video |
| 8:00–8:35 | Breakfast, GDC Atrium | Upload/render while eating; review story |
| 8:35–9:30 | Observed fixes and public-link checks | Correct demo/repo/video URLs; guest-device test |
| 9:30–10:15 | Rehearse judging + one-minute pitch | Product demo plus tailored sponsor explanation |
| 10:15–11:00 | Final Devpost submission | Team, video, public code, selections, AI tool disclosure verified |
| 11:00–11:30 | Submission buffer | Resolve form/upload issues only |
| 11:30 a.m. | Hacking ends | Stop development agents; preserve submitted state |
| 12:00–12:40 p.m. | Lunch | Devices charged; demo ready |
| 1:00–2:00 | Pitch workshop GDC 5.302 / judging instructions | Split attendance; confirm any judging workshop in Discord |
| 2:00–5:00 | Judging, Welch | Whole team available; repeatable demo |
| 5:00–5:25 | Pitch warmup / move | Signup/order verified; front two rows |
| 5:30–6:00 | Pitch competition, WEL 2.224 | 1 minute; no slides or demos |

Cutoffs: no complete plan by 6 p.m. means stop optional integrations. No plan repair by 9 p.m. means reduce scope. Timebox the initial messaging/access spike to 60–90 minutes; if blocked, choose a supported adapter or explicitly scope the demo as a web prototype. All new features stop by 6 a.m. and coding stops at 11:30 a.m.

## AI coding workflow

Use README.md for stable product decisions, AGENTS.md for shared coding instructions, STATUS.md for current work/handoffs, and CONTRACTS.md for the proposed shared interface. Do not maintain a separate competing README for every coding agent.

Each task: owner, allowed files, expected input/output, acceptance check, deadline, and dependencies. Before each new task, reload status and contracts. Before a break, checkpoint working code and assign bounded work. On return, review changes before merge/deployment. Development jobs must stop at the hacking deadline.

## Pitch and demo

Working hook: “Your group chat has 80 messages and still no plan.”

The signature demo: someone texts “Me, Mark, and Mel want to watch [a currently showing movie] this weekend.” One friend is already connected; the other receives an invitation, completes signup with phone number, name, city, and interests, and accepts the connection. The agent starts planning without a separate participation gate. Ideally it creates a group chat; otherwise it sends the options privately.

Conversation context, shared availability, and actual showtimes produce three explained options with useful differences in price and experience. The agent privately asks one friend when an appointment ends, uses the answer without exposing it, and collects acceptable choices plus a favorite. Someone changes their availability; the agent repairs the options and refreshes the poll. Show how a clear group decision can proceed with a silent holdout, using a clarifying question when needed. Then show seat preferences, a nominated buyer authorizing the group purchase, the supported booking flow, calculated shares, private reimbursement requests, and calendar details. Label any provider limitation or checkout fallback accurately.

Also show the group-chat entry point using the same backend: add the agent, confirm the participants, and receive options plus a poll in the conversation. Use a currently showing movie with verified data; Avengers is an example request, not a claim of local availability. Include one deliberate calendar conflict. Keep private calendar details out of the demo and label any test checkout clearly.

Stage pitch draft (use only claims that ship; rehearse to 50–55 seconds):

> Your group chat has 80 messages and still no plan. You already know you want to watch a movie together, but someone has to compare schedules, find showtimes, and get everyone to agree. We're building an agent that handles that work. Add it to your group chat, or text it who you're going with and what you want to do. It connects the friends, uses the conversation and shared calendars, and explains three real options with a poll. It discusses changes with the group and handles personal questions privately. Once the group chooses, it helps arrange seats, split the cost, book, and get it onto the calendar. The goal is simple: make hanging out happen.

Potential entertaining stretch: “Mystery Night” — choose budget/time/preferences, approve constraints, reveal a sourced themed outing. Keep safety, cost, and required suitability information visible before commitment. It must add a fun interaction, not just funny AI text. Generated multiplayer game remains deferred.

Measure actual time from request to connected friends and from connected friends to a group decision, invitation completion, manual organizer interventions, successful repair, and whether testers would use it again. Track private reimbursement requests, actual repayments, checkout handoffs, and confirmed bookings separately. Do not invent retention or friendship outcomes. Longer-term possibilities: broader booking-provider coverage, recurring friend rituals, day trips, and opt-in learning from actual outing feedback.

## Technical planning handoff

The product scope and defaults above are settled for the hackathon. Keep the agent unnamed during implementation. Use ordinary conversation to handle uncommon situations; do not add a policy engine, pooled wallet, custom refund system, or elaborate organizer roles.

Technical planning should now produce an architecture, shared contracts, and bounded implementation tasks in this order:

1. Prove the external capabilities that determine the architecture: messaging in existing groups and privately, optional group creation, phone verification, real discovery/showtimes, authorized booking, and private reimbursement requests. Select one provider per job from actual access and supported behavior. Record a concrete fallback for any unavailable capability.
2. Define the shared data and API contract: accounts and messaging identities, accepted friendships, plan participants, private facts, three structured options, votes, versioned group decisions, buyer authorization, booking status, and per-person reimbursement status. Both entry flows use this contract.
3. Define the agent's tools and deterministic responsibilities. The model interprets conversation, asks questions, explains options, and selects tool actions. Code enforces identity/access, known hard constraints, vote/version handling, exact share arithmetic, and payment/booking state. Keep private and group messages separated by recipient permissions.
4. Build one vertical slice: signup → connect friends → request → real options → conversation/poll → group selection → buyer authorization → supported booking → private reimbursement requests → calendar details. Exercise both entry points against the same backend, with a changed-availability repair in the demo.
5. Add the supporting web views, deploy early, and assign integration/frontend/planner/discovery tasks against the agreed contract. Add sponsor extras only after the complete journey works.

The acceptance target is a repeatable demonstration of those two flows, grounded in real discovery results, with accurate provider outcomes. Test payments or booking handoffs are acceptable fallbacks when clearly identified; they must not be presented as completed live purchases. New edge cases should not delay this build unless they break the demonstrated journey, expose private information, or risk an incorrect charge or duplicate booking.

## Event rules and open questions

- Three track selections maximum excluding Best Overall/Novice per slides; MLH/pitch exemptions remain unconfirmed. Hardware is no longer a target.
- Sponsor-first shortlist: Meta, Northmark, SerpApi. Most Entertaining stays optional pending rules and a strong feature.
- Best Overall is automatic. Best Pitch signup is first 20 teams, separate event; watch Discord, and confirm whether it consumes a selection.
- Soft submission Sat 11:30 p.m.; final submission and coding cutoff Sun 11:30 a.m.
- Public repository, demo video by deadline, 1–4 people, and disclosure of AI coding tools.
- Live website lists Meta Sat 3–4 p.m., unlike the handbook; live website/pitch document place pitching at WEL 2.224.

## Sources

- [HackTX live schedule](https://hacktx.com/#schedule)
- [Devpost requirements and tracks](https://hacktx26.devpost.com/)
- [Competition rules](https://hacktx26.devpost.com/rules)
- [Pitch rules](https://docs.google.com/document/d/1m3ewNiTlSFFRQ5XUPYzv0ZcUNILFbTMInVQCHsWT6S0/edit)
- [MLH event prize hub](https://www.mlh.com/events/hacktx-26/prizes)
- Local originals: Hacker Handbook.pdf, HackTX 26 Opening Ceremony.pdf
- [Calendar free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Calendar event creation](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [OAuth test users](https://support.google.com/cloud/answer/15549945)
- [Telegram bot features](https://core.telegram.org/bots/features)
- [SerpApi Maps](https://serpapi.com/google-maps-api) / [Events](https://serpapi.com/google-events-api)
- [Meta Model API](https://dev.meta.ai/products/meta-model-api) / [Connectors](https://dev.meta.ai/products/connectors)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Tiger Cloud](https://www.tigerdata.com/docs/get-started/quickstart/create-service)
- [Snowflake Cortex REST](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api)
