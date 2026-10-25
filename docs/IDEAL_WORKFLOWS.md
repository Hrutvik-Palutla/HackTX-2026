# Ideal SideQuest workflows

This is the intended experience and a manual testing checklist, not a claim about current implementation.

1. **Signup and welcome.** Open the website → enter a phone number → receive and verify a private code → enter name, city and interests → optionally connect a calendar → finish setup → receive one private welcome text explaining how to start a group plan or invite friends. Signup does not request a home address or budget.

2. **Returning user and profile changes.** Sign in with the verified phone → see existing friends and plans → edit name, city or private interests → use the updated information for future planning. Connected calendar and private preference settings remain manageable from the website.

3. **First text from an unknown person.** Text the agent → receive a private signup link → complete setup and verification → return to the conversation as the same person. The agent never identifies someone from their display name alone.

4. **Add the agent to an existing group.** Add the agent → the first observable message establishes the group → if it contains a request, the agent answers directly; otherwise it introduces itself once → clarify what the group wants and who should participate. Existing casual conversation should not receive repeated bot replies.

5. **Start a plan in a group.** Give a broad request or name a movie/activity and date range → establish the organizer and intended participants → check the organizer's accepted connections → resolve missing connections privately → start planning for the full intended roster. Chat membership alone does not establish friendship or attendance. Participants need to be connected to the organizer, not necessarily to each other.

6. **Start privately, then move to a group.** Text “Mark, Mel and I want to watch a movie this weekend” → resolve those names against accepted friends → clarify ambiguous names → resolve missing connections → prepare options → create a group with the intended people → explain the options and conduct discussion there. If group creation is unavailable, privately deliver the same version and options to everyone and combine their votes.

7. **Connect with an existing user by text.** Ask the agent privately to connect with someone and provide their phone number → the recipient gets a private request identifying the inviter → they accept or decline by reply or website → both views reflect the same connection state. An invitation alone does not create a friendship.

8. **Invite a person without an account.** Provide the person's name and phone privately → they receive an invitation identifying who invited them and the outing context → open the link → complete signup → accept the connection → join the held participant slot → automatically resume the waiting plan once everyone required is connected.

9. **Connect through the website or from a group.** Send a website friend request, or have the agent privately ask the organizer about a missing group connection → organizer confirms the invitation → recipient accepts privately → the same friend list and waiting plan update. The group never receives private phone numbers or the contents of the request exchange.

10. **Declined or unanswered invitation.** Recipient declines → organizer privately hears that the person is not connecting and is asked whether to continue without them or stop → organizer chooses → the agent removes that participant and resumes the rest, or closes the plan. No automatic removal. An unanswered request remains pending; any reminder should be limited and private.

11. **Discover a broad outing.** Ask for “something fun Friday night” → use city, interests, conversation and known availability → search real sources → explain up to three distinct options with time, location, price and useful tradeoffs → label unknowns and estimates. Ask one focused question if there is insufficient context.

12. **Discover a specific movie or activity.** Keep the requested activity fixed → find real dated showtimes or event times → verify them against source pages when structured results are missing → provide sourced options. If real times remain unavailable, offer up to three real theater pages with “time unknown” and “Check showtimes” links → ask for a theater and date/time window. Never invent a screening to fill three slots.

13. **Availability, preferences and private constraints.** Use calendar free/busy and chat context → privately clarify personal scheduling details when needed → record a person's own availability, preferences or optional spending limit → re-evaluate the group plan → explain the resulting choices without identifying the private constraint or its owner. Missing calendar access stays unknown rather than being treated as free time.

14. **Discussion, polls and selection.** Explain the choices → post a poll for acceptable options and a favorite, including “none” → accept suggestions and objections → rank acceptable votes and favorites → use an explicit group instruction to establish the winner and named attendees. A clear decision can proceed despite silent holdouts; unclear attendance, ties or objections prompt a question. Silence never authorizes a charge.

15. **Change the movie, activity, time or roster.** Someone proposes a material change → confirm the updated activity and relevant context → update the stored request → search again → publish a new version → make affected votes and decisions stale. A private participant can update their own constraints; changing the shared activity privately requires the organizer. Roster changes and plan closure require the organizer.

16. **Nominate a buyer and arrange seats.** Select the option and attendees → ask who will pay for the group → the buyer volunteers or personally confirms → ask about seats if needed, otherwise prefer adjacent seats near the center → obtain a current quote including tickets/items, fees, discounts, seats and expiry. Organizer status and winning a poll do not grant spending authority.

17. **Approve and attempt a direct booking.** Show the quote → privately connect the buyer's wallet if necessary → privately request approval for that exact purchase → verify provider approval → recheck the current option, attendees, price and inventory → attempt the supported booking once → report the actual outcome. Changed terms need fresh approval; a request or approval link alone is not a booking.

18. **Merchant checkout handoff.** Direct checkout is unsupported or the buyer prefers to buy directly → state clearly that nothing is booked → privately send the buyer the real merchant link → buyer completes checkout → reports the charged total and order reference → record a buyer-reported booking, distinct from a merchant-verified confirmation → create the appropriate shares.

19. **Abandon an unpurchased handoff.** Group wants a change while checkout is pending → ask the buyer whether anything was purchased → buyer explicitly confirms no purchase → clear the handoff → return the plan to selection → replan using the new request. An uncertain charge requires status reconciliation; a completed purchase uses the post-booking change flow.

20. **Split and repay.** After a successful or buyer-reported booking, calculate each attendee's item cost plus a fair allocation of shared fees/discounts → conserve the exact total in cents → send each nonbuyer a private request for their own share → show the buyer the ledger → payer can report sending money → buyer confirms receipt. Distinguish provider-verified payment from manual reports; a request being sent does not mean it was paid.

21. **Calendar details.** After a concrete selection or confirmed booking, offer the named attendees calendar details → write only to each consenting attendee's own calendar → provide an ICS alternative → distinguish an agreed outing from a purchased reservation → update details after a confirmed change. Do not create events for unknown showtimes or excluded attendees.

22. **Failure, uncertainty and changes after booking.** A quote expires, seats disappear or checkout fails → explain the actual issue and offer refreshed choices or handoff. If the outcome is uncertain, check status before retrying. After a completed purchase, route changes/cancellation through the buyer and supported provider process → explain costs → obtain approval → report the confirmed result → adjust calendar/repayment information when appropriate. Never assume a refund.

23. **Multiple plans and conversation continuity.** Receive a private follow-up → use an explicitly linked plan, or ask which open plan the sender means → apply the answer to that plan only. A clearly new request starts a separate plan. Web and chat must show the same roster, options, versions, votes, buyer and booking status.

24. **Optional interests, Common Ground and quests.** Submit a note, photo or voice input → review extracted interests privately → explicitly confirm and choose what to share → find common interests using only shared evidence → use that to start a real plan. Once an outing is selected, optionally generate a cooperative quest → share progress and a recap with the group.

25. **Team Studio.** Authorized teammates inspect redacted runs and costs → edit a bounded, versioned agent recipe → future runs use the saved recipe → failures remain diagnosable without exposing private schedules, phone numbers, budgets, wallet credentials or invitation tokens.
