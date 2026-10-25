# Standout implementation and release

The original internal proposal remains outside version control. This checklist describes what is implemented and verified in the application.

| Item | Implementation and evidence |
|---|---|
| Drops | Private note/link extraction, exact evidence quotes, editable suggestions, owner confirmation and per-chip sharing. Photo understanding and voice transcription populate a private draft; they do not auto-share. Links are attached, not crawled. |
| Common Ground | Accepted friends' confirmed shared chips feed Muse. Code checks cited chip IDs and joins names/quotes. Current sharing and group membership are rechecked before attaching a draft. Its specific query reaches real SerpApi discovery. |
| Cooperative quest | Three photo challenges and two riddles for the current selected outing; persistent shared progress, completion ownership, hints and recap. Plan changes invalidate old quests. Muse-generated art is optional. |
| Studio | Authorized teammates edit saved recipe instructions, model-callable tools and runtime caps. New saves create versions; real runs load the saved recipe and retain their execution version. Redacted steps, tokens, limits and Spark cost estimates are inspectable. Voice/image costs are labeled unknown. |
| Existing planning backbone | Sourced options, code-enforced known constraints, private repair, same-version votes and all-member approval, web chat, explicit merchant handoff, manual availability and calendar export. Calendar event creation does not reserve a venue. |
| Meta | Muse Spark structured reasoning and vision, Muse Voice Transcribe and Muse Image all passed actual endpoint checks. A spoken synthetic sentence was transcribed correctly. Optional media is bounded per account and text remains available. |
| SerpApi | A live Tiger/Muse/SerpApi journey returned three real sourced choices driven by confirmed shared interests. Unknown prices and opening hours remain explicit. |
| Northmark | Multiple recipes use the same runner, stored versions, tool permissions, bounded execution and redacted monitoring. Desktop/mobile tests saved a new recipe version and changed its limits. |
| Tiger / Vultr / .TECH | The new 41-table Tiger baseline uses verified TLS. Web and durable worker are deployed at https://getsidequest.tech. Runtime secrets are installed over verified SSH; live/database readiness endpoints expose the exact deployed revision. |
| Phone sign-in | Production worker sent the authorized OTP on its first attempt, Claw accepted it, and the tester confirmed receipt. The tester has not yet completed browser code verification. |
| Google Calendar | Owner confirmed API enabled, production callback saved and teammate test users added. Each user still grants their own Calendar consent. A real consent/event-write journey has not been performed. |
| Public demo | https://getsidequest.tech/demo is a read-only recorded journey using synthetic phone-less friends and real provider results. Completion is explicitly simulated. Private groups require verified sign-in. |

Linux CI passed typechecks, production build, 35 backend tests, 28 messaging/calendar tests, 8 account tests, all 75 discovery/fulfillment tests, integration checks, runtime-installer tests, and 28 desktop/mobile browser tests. Private image reads reject signed-out users, outsiders and stale versions. The public fixture refuses real phones or email addresses.

Deliberate cuts remain: Facebook Graph import, connector publication, arbitrary generated multiplayer code, hardware, Solana, Snowflake, vector search and automatic venue purchases. They were not part of the accepted overnight implementation. No purchase, external invitation or real calendar write was performed during release verification.

Teammates privately copy the supplied `.env.team` to the repo's `.env`, then run `pnpm dev` and `pnpm worker` in separate terminals. Web and worker load root environment files automatically. Keep real credentials out of Git. See [README](../README.md), [contracts](../CONTRACTS.md), [status](../STATUS.md) and [deployment](DEPLOYMENT.md).
