// plan / repair job: request -> sourced candidates -> code feasibility -> Muse picks & explains -> code validates
// -> CAS publish -> recipient-scoped messages. The model never decides availability, price, or which venues exist.
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { candidates, conversations, plans, planParticipants, planConversations, sources, user, type Db } from '@hacktx/db';
import type { CalendarPort, Candidate, City, DiscoveryPort, Interval, PlanOption, ResearchPort, ResearchPageEvidence, ResearchSearchEvidence, Source } from '@hacktx/contracts';
import {
  AppError, WEB, checkSlot, enqueue, enqueueMessage, postToConversation, tally, loadFactsForFeasibility, loadMemberAvailability, publishVersion, setStatus,
  type OptionDraft, type SlotFit,
} from '@hacktx/core';
import { loadTemplate, PRODUCT_VOICE } from '@hacktx/templates';
import { planGround } from './standout';
import type { Muse } from './muse';
import { LimitError, RunRecorder } from './recorder';
import { candidateFromMoviePage, movieTimesOnPage } from './movie-showtimes';
import { runResearch } from './research';
import { localTime, tidyTitle } from './format';
export { localTime, tidyTitle };

import { refreshPlanAvailability, ensurePlanGroup } from '@hacktx/core';

/** `calendar` (Part 3's Google free/busy) refreshes snapshots before feasibility; without it only stored snapshots and chat statements count. */
export type PlannerDeps = {
  db: Db;
  muse: Muse;
  discovery: DiscoveryPort;
  research?: ResearchPort;
  calendar?: CalendarPort;
  /** Test seam retained for deterministic planner checks. */
  refreshAvailability?: (planId: string, window: Interval) => Promise<unknown>;
  now?: () => Date;
};

const MAX_CANDIDATES = 15;
const DEFAULT_DURATION_MIN = 120;
const ARRIVAL_BUFFER_MIN = 15;
const POLL_REMINDER_MS = 30 * 60_000;

const Intent = z.object({
  kind: z.enum(['movie', 'outing']),
  movieTitle: z.string().nullable(),
  movieTitles: z.array(z.string()).default([]),
  searchQuery: z.string(),
  scheduledEvent: z.boolean().default(false),
  durationMinutes: z.number().int().nullable(),
});

const Picks = z.object({
  options: z.array(z.object({
    candidateId: z.string(),
    startAt: z.string().nullable(),
    publicExplanation: z.string(),
  })), // no max: code keeps the first 3 valid picks, so extra or invalid picks don't fail the run
});

type Feasible = { c: Candidate; slot: Interval | null; fit: SlotFit | null; notes: string[] };

const addMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
const money = (c: Candidate) => (c.price ? `$${(c.price.amountMinor / 100).toFixed(2)} (${c.priceKind})` : c.rawPriceText ?? 'unknown');

export async function runPlanJob(deps: PlannerDeps, job: { planId: string; inputRevision: number; reason?: string }) {
  const { db } = deps;
  let { muse } = deps;
  const [plan] = await db.select().from(plans).where(eq(plans.id, job.planId));
  if (!plan || plan.inputRevision !== job.inputRevision || plan.status !== 'planning') return { status: 'stale' as const };

  const template = await loadTemplate(db, plan.templateId);
  let rec: RunRecorder;
  try {
    rec = await RunRecorder.start(db, { planId: plan.id, task: job.reason ? 'repair' : 'plan', template, model: muse.model, inputRevision: plan.inputRevision });
  } catch (error) {
    if (!(error instanceof AppError && error.code === 'BUDGET_LIMIT')) throw error;
    await setStatus(db, plan.id, plan.inputRevision, 'clarifying');
    await notifyPlan(db, plan.id, `rev${plan.inputRevision}:budget`, 'I’ve reached my planning service budget and can’t search for options right now. Please try again once the service budget is restored.');
    return { status: 'budget_limit' as const };
  }
  muse = rec.bindMuse(muse);
  deps.discovery.setAbortSignal?.(rec.signal);
  try {
    const now = deps.now?.() ?? new Date();
    const window: Interval = plan.windowStart && plan.windowEnd
      ? { startAt: plan.windowStart.toISOString(), endAt: plan.windowEnd.toISOString() }
      : { startAt: now.toISOString(), endAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() };
    const city = plan.city as City;
    const ground = await planGround(db, plan.id);
    if (deps.refreshAvailability) await deps.refreshAvailability(plan.id, window);

    // 1. Interpret the request (public request text only).
    rec.charge('turn');
    const participantProfiles = await db.select({ name: user.name, interests: user.interests }).from(planParticipants)
      .innerJoin(user, eq(user.id, planParticipants.userId)).where(eq(planParticipants.planId, plan.id));
    const pendingNames = (await db.select({ name: planParticipants.requestedName }).from(planParticipants)
      .where(and(eq(planParticipants.planId, plan.id), isNull(planParticipants.userId)))).map(p => p.name).filter((name): name is string => !!name);
    const researchRedactions = [...participantProfiles.map(profile => profile.name), ...pendingNames];
    const interestCounts = new Map<string, number>();
    for (const profile of participantProfiles) for (const interest of new Set((profile.interests ?? []).map((s) => s.trim()).filter(Boolean))) {
      const key = interest.toLocaleLowerCase(); interestCounts.set(key, (interestCounts.get(key) ?? 0) + 1);
    }
    const sharedInterests = [...interestCounts].filter(([, count]) => count > 1).map(([interest]) => interest).slice(0, 12);
    const { value: intent } = await rec.step('model', 'extract_intent', () => muse.structured({
      name: 'intent',
      schema: Intent,
      messages: [
        { role: 'system', content: `${template.systemInstruction}\nExtract the search intent. For movie requests, include up to three distinct movie titles the user is considering in movieTitles; movieTitle is the primary title or null. Set scheduledEvent=true when the request depends on a dated event or performance with a source-confirmed start time. Set false for an unscheduled venue or activity visit. durationMinutes only if the request states it.` },
        { role: 'user', content: JSON.stringify({ request: plan.request, city: city.label, template: template.id, groupInterests: sharedInterests }) },
      ],
    }), (r) => ({ summary: `kind=${r.value.kind}`, usage: r.usage }));
    const movieTitles = [...new Set([...(intent.movieTitles ?? []), ...(intent.movieTitle ? [intent.movieTitle] : [])].map(t => t.trim()).filter(Boolean))].slice(0, 3);

    // 2. Real candidates from Part 4's DiscoveryPort (SerpApi).
    rec.charge('search');
    let movieFallbackSources: import('@hacktx/contracts').Source[] = [];
    let found = await rec.step('tool', 'discover_candidates', async () =>
      intent.kind === 'movie' && movieTitles.length
        ? (await Promise.all(movieTitles.map(async (title, index) => {
          if (index) rec.charge('search');
          return deps.discovery.searchMovie({ title, city, window });
        }))).flat()
        : deps.discovery.searchOutings({ query: ground?.searchQuery ?? intent.searchQuery, city, window }),
    (r) => ({ summary: `${r.length} candidates`, sourceIds: [...new Set(r.flatMap((c) => c.sourceIds))] }));
    if (intent.kind === 'movie' && intent.movieTitle && !found.some(candidate => !!candidate.startAt)) {
      const adapter = deps.discovery as DiscoveryPort & {
        searchMovieEvidence?: (input: { title: string; city: City; window: Interval }) => Promise<{ candidates: Candidate[]; sources: import('@hacktx/contracts').Source[] }>;
        getSources?: () => import('@hacktx/contracts').Source[];
      };
      if (adapter.searchMovieEvidence) {
        try {
          // The adapter caches this exact query, so this retrieves this call's organic source list without another billable request.
          const evidence = await adapter.searchMovieEvidence({ title: intent.movieTitle, city, window });
          movieFallbackSources = evidence.sources;
        } catch {
          movieFallbackSources = [];
        }
      }
      if (!adapter.searchMovieEvidence) {
        const allSources = adapter.getSources?.() ?? [];
        const expectedSearchTitle = `Google showtimes for ${intent.movieTitle}`.toLocaleLowerCase();
        const currentSearch = allSources.find(source => source.provider === 'serpapi_google' && source.title.toLocaleLowerCase() === expectedSearchTitle);
        movieFallbackSources = currentSearch
          ? allSources.filter(source => source.id === currentSearch.id || source.providerSearchId === currentSearch.providerSearchId)
          : [];
      }
      const pages = movieFallbackSources.filter(source => {
        if (source.provider !== 'serpapi_google') return false;
        try { return !/^(?:www\.)?google\.com$/i.test(new URL(source.url).hostname) || !new URL(source.url).pathname.startsWith('/search'); }
        catch { return false; }
      }).slice(0, 3);
      const recovered: Candidate[] = [];
      const uncertain: Candidate[] = [];
      const extractedSources: import('@hacktx/contracts').Source[] = [];
      for (const source of pages) {
        // Keep a source-backed theater option available even if this page cannot be extracted (JS-only or request cap).
        uncertain.push(candidateFromMoviePage({ title: intent.movieTitle, city, page: { source, facts: null }, time: null }));
        try {
          rec.charge('search');
        } catch (error) {
          if (error instanceof LimitError) break;
          throw error;
        }
        try {
          const page = await deps.discovery.extractPublicPage(source.url);
          extractedSources.push(page.source);
          const times = movieTimesOnPage(intent.movieTitle, page.facts);
          for (const time of times) {
            const candidate = candidateFromMoviePage({ title: intent.movieTitle, city, page, time });
            if (candidate.startAt && candidate.startAt >= window.startAt && candidate.startAt < window.endAt) recovered.push(candidate);
          }
          uncertain[uncertain.length - 1] = candidateFromMoviePage({ title: intent.movieTitle, city, page, time: null });
        } catch (error) {
          if (error instanceof Error && /request limit reached/i.test(error.message)) break;
          // The organic source URL and title remain useful as a theater page to check manually.
        }
      }
      found = recovered.length ? recovered.slice(0, MAX_CANDIDATES) : uncertain.slice(0, 3);
      movieFallbackSources = [...movieFallbackSources, ...extractedSources];
    }
    let researchSources: (ResearchPageEvidence | ResearchSearchEvidence)[] = [];
    if (deps.research && (found.length < 3 || (intent.kind === 'movie' && found.some(candidate => !candidate.startAt)) || (intent.scheduledEvent && found.filter(candidate => !!candidate.startAt).length < 3))) {
      try {
        const researched = await runResearch({ muse, research: deps.research, recorder: rec, maxSteps: 6,
          redactions: researchRedactions,
          question: `Find up to three distinct source-confirmed ${intent.kind === 'movie' ? `movie screenings for ${movieTitles.join(', ')}` : 'dated activities'} matching this public activity query: ${intent.searchQuery}. City: ${city.label} (${city.timeZone}). Date window: ${window.startAt} through ${window.endAt}. Prior candidates: ${found.map(c => c.title).join('; ') || 'none'}. Seek source-confirmed date, start time, title, venue, and public price where available; return alternatives.` });
        researchSources = researched.evidence;
        const extracted = await extractResearchCandidates({ muse, sources: researchSources, kind: intent.kind, city, window, movieTitles, recorder: rec });
        const have = new Set(found.map(c => `${c.title.toLocaleLowerCase()}|${c.startAt ?? ''}`));
        for (const c of extracted) if (!have.has(`${c.title.toLocaleLowerCase()}|${c.startAt ?? ''}`)) found.push(c);
        found = found.slice(0, MAX_CANDIDATES);
      } catch (error) {
        if (error instanceof LimitError) { /* keep already-grounded DiscoveryPort options */ }
        // Research is an optional enrichment path; retain structured DiscoveryPort results on provider failure.
      }
    }
    await persistDiscovery(db, deps.discovery, found);
    if (researchSources.length) await persistResearchSources(db, researchSources);
    if (movieFallbackSources.length) await persistSourceList(db, movieFallbackSources);

    // 3. Deterministic feasibility: availability, window, explicit spending limits.
    const participants = (await db.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, plan.id)))
      .map((p) => p.userId).filter((u): u is string => !!u);
    const feasible = await rec.step('validation', 'feasibility', async () => {
      // Failed/disconnected calendars are stored as such (unknown, not free); a calendar outage never fails the run.
      if (deps.calendar) await refreshPlanAvailability(db, deps.calendar, plan.id, window).catch((e) => console.warn(`[planner] calendar refresh failed: ${e instanceof Error ? e.message : e}`));
      const members = await loadMemberAvailability(db, plan.id, participants, window);
      const facts = await loadFactsForFeasibility(db, plan.id);
      const limits = facts.flatMap((f) => (f.kind === 'spending_limit' ? [f.value.maximumShare.amountMinor] : []));
      const limit = limits.length ? Math.min(...limits) : null;
      const out: Feasible[] = [];
      for (const c of found.slice(0, MAX_CANDIDATES)) {
        const notes: string[] = [];
        if (limit !== null && c.price && c.priceKind !== 'estimated' && c.priceKind !== 'unknown' && c.price.amountMinor > limit) continue;
        if (limit !== null && (!c.price || c.priceKind === 'unknown' || c.priceKind === 'estimated')) notes.push('Price not confirmed yet');
        if (!c.startAt) {
          if (intent.kind === 'movie' || intent.scheduledEvent || c.kind === 'event') out.push({ c, slot: null, fit: { fit: 'needs_clarification', unknown: [], conflicts: [] }, notes: [...notes, `${intent.kind === 'movie' ? 'Showtime' : 'Event time'} not confirmed; check source page`] });
          else out.push({ c, slot: null, fit: null, notes });
          continue;
        } // non-movie time may be chosen by Muse, checked below
        const duration = c.durationMinutes ?? intent.durationMinutes;
        if (!duration) notes.push(`Runtime not listed; assumed about ${DEFAULT_DURATION_MIN / 60} hours`);
        const slot = { startAt: c.startAt, endAt: addMin(c.startAt, duration ?? DEFAULT_DURATION_MIN) };
        if (Date.parse(slot.startAt) < Date.parse(window.startAt) || Date.parse(slot.endAt) > Date.parse(window.endAt)) continue;
        const fit = checkSlot({ startAt: addMin(slot.startAt, -ARRIVAL_BUFFER_MIN), endAt: slot.endAt }, members);
        if (fit.fit === 'conflict') continue;
        if (!duration && fit.fit === 'fits_known_constraints') fit.fit = 'needs_clarification';
        out.push({ c, slot, fit, notes });
      }
      return { list: out, members };
    }, (r) => ({ summary: `${r.list.length}/${found.length} feasible` }));

    if (!feasible.list.length) {
      // Say which problem it is: no listings at all (e.g. Google returned no structured showtimes) vs. nothing fits.
      const what = intent.kind === 'movie' && intent.movieTitle ? `listed showtimes for ${intent.movieTitle}` : 'listed options';
      const text = found.length
        ? "I couldn't find an option that fits everyone's known schedule and limits in that window. Want to try a different day or time range, or a different kind of activity?"
        : intent.kind === 'movie' && intent.movieTitle
          ? `I couldn't find ${what} near ${city.label} in that window from my sources. Want to try another day or theater?`
          : `I couldn't find ${what} near ${city.label} in that window from my sources, and I won't guess times or prices. Want to try different days, a different activity, or tell me a specific showing you've seen?`;
      await setStatus(db, plan.id, plan.inputRevision, 'clarifying');
      await notifyPlan(db, plan.id, `rev${plan.inputRevision}:none`, text);
      await rec.finish('waiting');
      return { status: 'no_options' as const };
    }

    // 4. Muse chooses up to three distinct options and writes group-safe explanations.
    // It sees public candidate facts and aggregate fit only; no names attached to constraints.
    rec.charge('turn');
    const tz = plan.timeZone;
    const { value: picks } = await rec.step('model', 'propose_options', () => muse.structured({
      name: 'options',
      schema: Picks,
      messages: [
        { role: 'system', content: `${template.systemInstruction}\n${PRODUCT_VOICE}
Pick up to 3 useful, distinct options from the candidates by id. For a candidate with startLocal=null, set startAt to an
ISO 8601 UTC time inside the window that suits the activity; otherwise set startAt null. Explanation: one short sentence on the real difference versus the other options (format, time of day, listed price,
location), using ONLY facts present in the candidate data; do not invent atmosphere, amenities or reviews. For movie candidates with no source-confirmed time, leave startAt null. Title, time,
price and warnings are shown separately, so do not repeat them. Do not mention any individual's constraints.` },
        { role: 'user', content: JSON.stringify({
          request: plan.request,
          city: city.label,
          timeZone: tz,
          windowLocal: [localTime(window.startAt, tz), localTime(window.endAt, tz)],
          windowUtc: window,
          repairReason: job.reason ?? null,
          candidates: feasible.list.map(({ c, fit, notes }) => ({
            id: c.id, kind: c.kind, title: c.title, venue: c.venueName, address: c.address,
            startLocal: c.startAt ? localTime(c.startAt, tz) : null, durationMinutes: c.durationMinutes,
            format: c.format, price: money(c),
            availability: !fit ? 'time not chosen yet' : fit.fit === 'fits_known_constraints' ? 'works for everyone known' : 'some people have not confirmed availability',
            notes,
          })),
        }) },
      ],
    }), (r) => ({ summary: `${r.value.options.length} picks`, usage: r.usage }));

    // 5. Validate picks in code; fall back to deterministic picks if Muse returned nothing usable.
    const options = await rec.step('validation', 'validate_options', async () => {
      const byId = new Map(feasible.list.map((f) => [f.c.id, f]));
      const drafts: OptionDraft[] = [];
      const used = new Set<string>();
      // Title comes from the source (keeps the movie name and any FIXTURE label); the model only writes the explanation.
      const build = (f: Feasible, slot: Interval | null, fit: SlotFit, explanation: string, extra: string[]) => {
        used.add(f.c.id);
        drafts.push({
          label: (['A', 'B', 'C'] as const)[drafts.length]!,
          title: (f.c.venueName && !f.c.title.includes(f.c.venueName) ? `${f.c.title} at ${f.c.venueName}` : f.c.title).slice(0, 160),
          candidateIds: [f.c.id],
          startAt: slot?.startAt ?? null,
          endAt: slot?.endAt ?? null,
          timeZone: tz,
          timeline: slot ? [{ title: f.c.title, startAt: slot.startAt, endAt: slot.endAt, candidateId: f.c.id }] : [],
          estimatedPerPerson: f.c.price, // copied from the source, never from the model
          priceKind: f.c.priceKind,
          fit: fit.fit === 'fits_known_constraints' ? 'fits_known_constraints' : 'needs_clarification',
          uncertainties: [...new Set([...f.notes, ...extra, ...(fit.unknown.length ? [`${fit.unknown.length} people haven't confirmed availability`] : [])])],
          publicExplanation: explanation.slice(0, 600),
          sourceIds: f.c.sourceIds,
        });
      };
      for (const p of picks.options) {
        const f = byId.get(p.candidateId);
        if (!f || used.has(f.c.id) || drafts.length >= 3) continue;
        let slot = f.slot;
        let fit = f.fit;
        if (!slot) {
          if (intent.kind === 'movie' || intent.scheduledEvent || f.c.kind === 'event') {
            build(f, null, fit ?? { fit: 'needs_clarification', unknown: [], conflicts: [] }, p.publicExplanation || (intent.kind === 'movie' ? 'The source page lists this theater, but its showtime needs confirmation.' : 'The listing needs a source-confirmed start time.'), [`${intent.kind === 'movie' ? 'Showtime' : 'Event time'} not confirmed; check source page`]);
            continue;
          }
          if (!p.startAt || Number.isNaN(Date.parse(p.startAt))) continue;
          const startAt = new Date(p.startAt).toISOString();
          slot = { startAt, endAt: addMin(startAt, f.c.durationMinutes ?? intent.durationMinutes ?? DEFAULT_DURATION_MIN) };
          if (Date.parse(slot.startAt) < Date.parse(window.startAt) || Date.parse(slot.endAt) > Date.parse(window.endAt)) continue;
          fit = checkSlot({ startAt: addMin(slot.startAt, -ARRIVAL_BUFFER_MIN), endAt: slot.endAt }, feasible.members);
          if (fit.fit === 'conflict') continue;
          f.notes.push('Opening hours not verified for this time');
        }
        build(f, slot, fit!, p.publicExplanation, []);
      }
      if (!drafts.length) {
        for (const f of feasible.list) {
          if (drafts.length >= 3) break;
          if (used.has(f.c.id) || !f.fit) continue;
          if (!f.slot && intent.kind !== 'movie' && !intent.scheduledEvent && f.c.kind !== 'event') continue;
          build(f, f.slot, f.fit, `${f.c.format ?? f.c.kind.replace('_', ' ')} listed by the source.`, f.slot ? [] : ['Time not confirmed; check source page']);
        }
      }
      return drafts;
    }, (r) => ({ summary: `${r.length} valid options` }));

    if (!options.length) {
      await setStatus(db, plan.id, plan.inputRevision, 'clarifying');
      const text = intent.kind === 'movie' && intent.movieTitle
        ? `I found theater pages for ${intent.movieTitle}, but none confirmed a screening time. Check the source pages for showtimes, then tell me which theater or time window your group prefers.`
        : 'I found places but none with a time I could confirm. What day and time range should I look at?';
      await notifyPlan(db, plan.id, `rev${plan.inputRevision}:none`, text);
      await rec.finish('waiting');
      return { status: 'no_options' as const };
    }

    // 6. Publish only if nothing changed meanwhile (compare-and-swap on input revision).
    const published = await rec.step('state_change', 'publish_version', () =>
      publishVersion(db, { planId: plan.id, inputRevision: plan.inputRevision, runId: rec.runId, options }),
    (r) => ({ summary: `version ${r.version.versionNumber}` }));

    const versionId = published.version.id;
    await ensurePlanGroup(db, plan.id, plan.inputRevision); // private-request plans get a group chat before the first options
    const researchSourceList = researchSources.map(toResearchSource);
    await notifyPlan(db, plan.id, `options:${versionId}`, formatOptions(published.options, job.reason, [...movieFallbackSources, ...researchSourceList], intent.kind === 'movie' ? 'movie' : intent.scheduledEvent ? 'event' : 'outing'), versionId);
    // Part 3's publish_poll handler posts a native poll (labels in A,B,C order) per group chat, then calls registerPoll.
    for (const g of (await planGroupConversations(db, plan.id)).filter((c) => c.provider !== WEB)) {
      await enqueue(db, { kind: 'publish_poll', planId: plan.id, dedupeKey: `publish_poll:${versionId}:${g.id}`,
        payload: { planId: plan.id, versionId, conversationId: g.id, labels: published.options.map((o) => `${o.label}) ${o.title}`.slice(0, 80)) } });
    }
    await enqueue(db, { kind: 'poll_reminder', planId: plan.id, dedupeKey: `poll_reminder:${versionId}`,
      runAfter: new Date(Date.now() + POLL_REMINDER_MS), payload: { planId: plan.id, versionId } });
    await rec.finish('ok');
    return { status: 'published' as const, versionId: published.version.id, options: published.options };
  } catch (e) {
    if (e instanceof AppError && e.code === 'STALE_PLAN') { await rec.finish('stale'); return { status: 'stale' as const }; }
    if (e instanceof LimitError) {
      await rec.finish('limit', e.message);
      // Never leave the group waiting on a plan that stopped: ask for something narrower.
      try {
        await setStatus(db, plan.id, plan.inputRevision, 'clarifying');
        await notifyPlan(db, plan.id, `rev${plan.inputRevision}:limit`, 'I spent my search budget for this round without enough confirmed options. Can you narrow it down (a specific day, time, area or venue)?');
      } catch (inner) { if (!(inner instanceof AppError && inner.code === 'STALE_PLAN')) throw inner; }
      return { status: 'limit' as const };
    }
    await rec.finish('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Short iMessage-style summary: one line per option, then at most two links and one question. The sender splits links into their own bubbles. */
export function formatOptions(options: PlanOption[], repairReason?: string, sourceList: import('@hacktx/contracts').Source[] = [], unknownKind: 'movie' | 'event' | 'outing' = 'outing') {
  const head = repairReason ? 'Updated:' : options.length === 1 ? 'Best fit so far:' : 'Here’s what I found:';
  const sourceById = new Map(sourceList.map(source => [source.id, source]));
  const lines = options.map((o) => {
    const price = o.estimatedPerPerson ? `, $${(o.estimatedPerPerson.amountMinor / 100).toFixed(0)}/person` : '';
    return `${o.label}) ${tidyTitle(o.title)}, ${o.startAt ? localTime(o.startAt, o.timeZone) : 'time to confirm'}${price}`;
  });
  const unknownTimes = options.some(option => !option.startAt);
  const links = unknownTimes ? options.filter(o => !o.startAt).flatMap(o => o.sourceIds.slice(0, 1).map(id => sourceById.get(id)?.url).filter((u): u is string => !!u))
    .filter((u, i, all) => all.indexOf(u) === i).slice(0, 2) : [];
  const note = unknownTimes ? `\n\nI can’t see a confirmed ${unknownKind === 'movie' ? 'showtime' : 'start time'} yet.` : '';
  const prompt = unknownTimes ? `\n\nWhat time works best for you? I’ll check ${unknownKind === 'movie' ? 'that showtime' : 'it'}.` : '';
  return `${head}\n${lines.join('\n')}${note}${prompt}${links.length ? `\n\n${links.join('\n')}` : ''}`;
}

/** Send the same public text to the plan's group chat, or privately to each participant in DM-fallback mode. */
export async function notifyPlan(db: Db, planId: string, key: string, text: string, versionId?: string) {
  const groups = await planGroupConversations(db, planId);
  for (const c of groups) {
    await postToConversation(db, c, text, { effectKey: `${planId}:${key}:${c.id}`, planId, versionId: versionId ?? null });
  }
  if (groups.some((c) => c.provider !== WEB)) return;
  // No messaging group chat (creation unsupported/failed): same options privately to every resolved participant.
  const people = await db.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, planId));
  for (const p of people) {
    if (!p.userId) continue;
    await enqueueMessage(db, { recipient: { kind: 'private', userId: p.userId }, text, effectKey: `${planId}:${key}:${p.userId}`, planId, versionId: versionId ?? null });
  }
}

/** One gentle reminder per version. No-op if the version is obsolete, decided, or everyone has voted. */
export async function runPollReminder(db: Db, job: { planId: string; versionId: string }) {
  const [plan] = await db.select().from(plans).where(eq(plans.id, job.planId));
  if (!plan || plan.activeVersionId !== job.versionId || plan.status !== 'voting') return { sent: false };
  const t = await tally(db, job.versionId);
  const people = (await db.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, plan.id))).filter((p) => p.userId);
  if (t.voters >= people.length) return { sent: false };
  await notifyPlan(db, plan.id, `reminder:${job.versionId}`, `Still waiting on ${people.length - t.voters} of ${people.length} votes. Nothing gets booked without everyone.`);
  return { sent: true };
}

async function planGroupConversations(db: Db, planId: string) {
  return db.select({ id: conversations.id, kind: conversations.kind, provider: conversations.provider }).from(planConversations)
    .innerJoin(conversations, eq(conversations.id, planConversations.conversationId))
    .where(and(eq(planConversations.planId, planId), eq(planConversations.audience, 'group')));
}

/** Keep candidates and their sources so options can show source links and Part 4 can quote the selected candidate. */
async function persistDiscovery(db: Db, discovery: DiscoveryPort, found: Candidate[]) {
  const now = new Date();
  for (const c of found.slice(0, MAX_CANDIDATES)) {
    await db.insert(candidates).values({ id: c.id, kind: c.kind, payload: c, cacheKey: '', fetchedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) })
      .onConflictDoUpdate({ target: candidates.id, set: { payload: c, fetchedAt: now } });
  }
  if (!discovery.getSource) return;
  for (const id of new Set(found.slice(0, MAX_CANDIDATES).flatMap((c) => c.sourceIds))) {
    const s = discovery.getSource(id);
    if (s) await db.insert(sources).values({ ...s, fetchedAt: new Date(s.fetchedAt) }).onConflictDoNothing();
  }
}

async function persistSourceList(db: Db, found: import('@hacktx/contracts').Source[]) {
  for (const source of found) await db.insert(sources).values({ ...source, fetchedAt: new Date(source.fetchedAt) }).onConflictDoNothing();
}
async function persistResearchSources(db: Db, found: (ResearchPageEvidence | ResearchSearchEvidence)[]) {
  for (const source of found) await db.insert(sources).values({ ...toResearchSource(source), fetchedAt: new Date(source.fetchedAt) }).onConflictDoNothing();
}
function toResearchSource(source: ResearchPageEvidence | ResearchSearchEvidence): Source {
  const provider = 'engine' in source ? `serpapi_${source.engine}` : 'serpapi_extract';
  const title = 'title' in source ? source.title : `${source.engine} search: ${source.query}`;
  return { id: source.sourceId, url: source.url, title: title || source.url, fetchedAt: source.fetchedAt, provider, providerSearchId: null };
}

const ResearchCandidates = z.object({ candidates: z.array(z.object({
  sourceId: z.string(), kind: z.enum(['movie_screening', 'event']), title: z.string(), titleQuote: z.string(),
  venue: z.string(), venueQuote: z.string(), date: z.string().nullable(), dateQuote: z.string().nullable(),
  time: z.string().nullable(), timeQuote: z.string().nullable(), timeZone: z.string(),
  priceText: z.string().nullable(), priceQuote: z.string().nullable(),
})) });

/** Extract only scheduled listings whose title, venue and local date/time are each backed by exact source excerpts. */
async function extractResearchCandidates(input: { muse: Muse; sources: (ResearchPageEvidence | ResearchSearchEvidence)[]; kind: 'movie' | 'outing'; city: City; window: Interval; movieTitles: string[]; recorder: RunRecorder }): Promise<Candidate[]> {
  if (!input.sources.length) return [];
  const pages = input.sources.map(s => ({ sourceId: s.sourceId, url: s.url, fetchedAt: s.fetchedAt, text: s.text.slice(0, 12_000) }));
  input.recorder.charge('turn');
  const response = await input.recorder.step('model', 'extract_research_candidates', () => input.muse.structured({
    name: 'research_candidates', schema: ResearchCandidates,
    messages: [
      { role: 'system', content: `Extract at most three distinct ${input.kind === 'movie' ? 'movie screenings' : 'scheduled public events'} from supplied public source text. Include only listings with a source-confirmed local date and start time. Never infer an event from venue hours. Each titleQuote, venueQuote, dateQuote, timeQuote, and optional priceQuote must be verbatim contiguous text from the named source, and must directly establish its field. Use YYYY-MM-DD for date and 24-hour HH:mm for time. Use the city's IANA time zone. Return no candidate if a required quote or field is missing. Do not fabricate facts.` },
      { role: 'user', content: JSON.stringify({ city: input.city.label, timeZone: input.city.timeZone, window: input.window, requestedMovieTitles: input.movieTitles, sources: pages }) },
    ],
  }), r => ({ summary: `${r.value.candidates.length} extracted listings`, usage: r.usage, sourceIds: pages.map(p => p.sourceId) }));
  const byId = new Map(input.sources.map(s => [s.sourceId, s]));
  const output: Candidate[] = [];
  for (const row of response.value.candidates) {
    const source = byId.get(row.sourceId);
    if (!source || row.timeZone !== input.city.timeZone || !row.title.trim() || !row.venue.trim() || !row.titleQuote.includes(row.title) || !row.venueQuote.includes(row.venue)
      || !source.text.includes(row.titleQuote) || !source.text.includes(row.venueQuote)) continue;
    if (!row.date || !row.dateQuote || !row.time || !row.timeQuote || !source.text.includes(row.dateQuote) || !source.text.includes(row.timeQuote)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time) || !dateQuoteMatches(row.dateQuote, row.date) || !timeQuoteMatches(row.timeQuote, row.time)) continue;
    if (row.kind === 'movie_screening' && input.kind !== 'movie') continue;
    if (row.kind === 'event' && input.kind === 'movie') continue;
    if (input.movieTitles.length && row.kind === 'movie_screening' && !input.movieTitles.some(t => row.title.toLocaleLowerCase().includes(t.toLocaleLowerCase()))) continue;
    let startAt: string;
    const quotePositions = [row.titleQuote, row.venueQuote, row.dateQuote, row.timeQuote].map(q => source.text.indexOf(q));
    if (quotePositions.some(pos => pos < 0) || Math.max(...quotePositions) - Math.min(...quotePositions) > 1800) continue;
    try { startAt = localDateTimeToUtc(row.date, row.time, row.timeZone); } catch { continue; }
    if (Date.parse(startAt) < Date.parse(input.window.startAt) || Date.parse(startAt) >= Date.parse(input.window.endAt)) continue;
    const hasPrice = !!row.priceText && !!row.priceQuote && source.text.includes(row.priceQuote) && row.priceQuote.includes(row.priceText);
    output.push({
      id: `research_${source.sourceId}_${output.length}`, kind: row.kind, title: row.title.slice(0, 160), venueName: row.venue.slice(0, 120), address: null,
      timeZone: row.timeZone, startAt, durationMinutes: null, format: null, price: null, rawPriceText: hasPrice ? row.priceText : null,
      rawCurrency: null, priceKind: hasPrice ? 'listed' : 'unknown', bookingUrl: source.url, sourceIds: [source.sourceId],
      evidence: [{ field: 'title', origin: 'source', sourceId: source.sourceId, sourceMessageId: null }, { field: 'startAt', origin: 'source', sourceId: source.sourceId, sourceMessageId: null }, ...(hasPrice ? [{ field: 'price', origin: 'source' as const, sourceId: source.sourceId, sourceMessageId: null }] : [])],
    });
  }
  return output;
}

function dateQuoteMatches(quote: string, expected: string) {
  if (quote.includes(expected)) return true;
  const parsed = Date.parse(quote);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === expected;
}
function timeQuoteMatches(quote: string, expected: string) {
  const m = quote.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? quote.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!m) return quote.includes(expected);
  let h = Number(m[1]); const min = Number(m[2] ?? '0');
  if (m[3]) { if (h < 1 || h > 12) return false; h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` === expected;
}
function localDateTimeToUtc(date: string, time: string, zone: string) {
  const [year, month, day] = date.split('-').map(Number); const [hour, minute] = time.split(':').map(Number);
  const wanted = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    guess += wanted - represented;
  }
  const verified = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(guess));
  if (verified !== `${date}, ${time}`) throw new Error('local event time is invalid in the requested time zone');
  return new Date(guess).toISOString();
}
