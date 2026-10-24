// plan / repair job: request -> sourced candidates -> code feasibility -> Muse picks & explains -> code validates
// -> CAS publish -> recipient-scoped messages. The model never decides availability, price, or which venues exist.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { candidates, conversations, plans, planParticipants, planConversations, sources, type Db } from '@hacktx/db';
import type { Candidate, City, DiscoveryPort, Interval, PlanOption } from '@hacktx/contracts';
import {
  AppError, WEB, checkSlot, enqueue, enqueueMessage, postToConversation, tally, loadFactsForFeasibility, loadMemberAvailability, publishVersion, setStatus,
  type OptionDraft, type SlotFit,
} from '@hacktx/core';
import { getTemplate } from '@hacktx/templates';
import type { Muse } from './muse';
import { LimitError, RunRecorder } from './recorder';

export type PlannerDeps = { db: Db; muse: Muse; discovery: DiscoveryPort; now?: () => Date };

const MAX_CANDIDATES = 15;
const DEFAULT_DURATION_MIN = 120;
const ARRIVAL_BUFFER_MIN = 15;
const POLL_REMINDER_MS = 30 * 60_000;

const Intent = z.object({
  kind: z.enum(['movie', 'outing']),
  movieTitle: z.string().nullable(),
  searchQuery: z.string(),
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
export const localTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const money = (c: Candidate) => (c.price ? `$${(c.price.amountMinor / 100).toFixed(2)} (${c.priceKind})` : c.rawPriceText ?? 'unknown');

export async function runPlanJob(deps: PlannerDeps, job: { planId: string; inputRevision: number; reason?: string }) {
  const { db, muse } = deps;
  const [plan] = await db.select().from(plans).where(eq(plans.id, job.planId));
  if (!plan || plan.inputRevision !== job.inputRevision || plan.status !== 'planning') return { status: 'stale' as const };

  const template = getTemplate(plan.templateId);
  const rec = await RunRecorder.start(db, { planId: plan.id, task: job.reason ? 'repair' : 'plan', template, model: muse.model, inputRevision: plan.inputRevision });
  try {
    const now = deps.now?.() ?? new Date();
    const window: Interval = plan.windowStart && plan.windowEnd
      ? { startAt: plan.windowStart.toISOString(), endAt: plan.windowEnd.toISOString() }
      : { startAt: now.toISOString(), endAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() };
    const city = plan.city as City;

    // 1. Interpret the request (public request text only).
    rec.charge('turn');
    const { value: intent } = await rec.step('model', 'extract_intent', () => muse.structured({
      name: 'intent',
      schema: Intent,
      messages: [
        { role: 'system', content: `${template.systemInstruction}\nExtract the search intent. durationMinutes only if the request states it.` },
        { role: 'user', content: JSON.stringify({ request: plan.request, city: city.label, template: template.id }) },
      ],
    }), (r) => ({ summary: `kind=${r.value.kind}`, usage: r.usage }));

    // 2. Real candidates from Part 4's DiscoveryPort (SerpApi).
    rec.charge('search');
    const found = await rec.step('tool', 'discover_candidates', () =>
      intent.kind === 'movie' && intent.movieTitle
        ? deps.discovery.searchMovie({ title: intent.movieTitle, city, window })
        : deps.discovery.searchOutings({ query: intent.searchQuery, city, window }),
    (r) => ({ summary: `${r.length} candidates`, sourceIds: [...new Set(r.flatMap((c) => c.sourceIds))] }));
    await persistDiscovery(db, deps.discovery, found);

    // 3. Deterministic feasibility: availability, window, explicit spending limits.
    const participants = (await db.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, plan.id)))
      .map((p) => p.userId).filter((u): u is string => !!u);
    const feasible = await rec.step('validation', 'feasibility', async () => {
      const members = await loadMemberAvailability(db, plan.id, participants, window);
      const facts = await loadFactsForFeasibility(db, plan.id);
      const limits = facts.flatMap((f) => (f.kind === 'spending_limit' ? [f.value.maximumShare.amountMinor] : []));
      const limit = limits.length ? Math.min(...limits) : null;
      const out: Feasible[] = [];
      for (const c of found.slice(0, MAX_CANDIDATES)) {
        const notes: string[] = [];
        if (limit !== null && c.price && c.priceKind !== 'estimated' && c.priceKind !== 'unknown' && c.price.amountMinor > limit) continue;
        if (limit !== null && (!c.price || c.priceKind === 'unknown' || c.priceKind === 'estimated')) notes.push('Price not confirmed yet');
        if (!c.startAt) { out.push({ c, slot: null, fit: null, notes }); continue; } // time chosen by Muse, checked below
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
        { role: 'system', content: `${template.systemInstruction}
Pick up to 3 useful, distinct options from the candidates by id. For a candidate with startLocal=null, set startAt to an
ISO 8601 UTC time inside the window that suits the activity; otherwise set startAt null. Explanation: one short sentence on the real difference versus the other options (format, time of day, listed price,
location), using ONLY facts present in the candidate data; do not invent atmosphere, amenities or reviews. Title, time,
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
      const build = (f: Feasible, slot: Interval, fit: SlotFit, explanation: string, extra: string[]) => {
        used.add(f.c.id);
        drafts.push({
          label: (['A', 'B', 'C'] as const)[drafts.length]!,
          title: `${f.c.title} at ${f.c.venueName}`.slice(0, 160),
          candidateIds: [f.c.id],
          startAt: slot.startAt,
          endAt: slot.endAt,
          timeZone: tz,
          timeline: [{ title: f.c.title, startAt: slot.startAt, endAt: slot.endAt, candidateId: f.c.id }],
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
          if (!f.slot || !f.fit || used.has(f.c.id)) continue;
          build(f, f.slot, f.fit, `${f.c.format ?? f.c.kind.replace('_', ' ')} listed by the source.`, []);
        }
      }
      return drafts;
    }, (r) => ({ summary: `${r.length} valid options` }));

    if (!options.length) {
      await setStatus(db, plan.id, plan.inputRevision, 'clarifying');
      await notifyPlan(db, plan.id, `rev${plan.inputRevision}:none`, 'I found places but none with a time I could confirm. What day and time range should I look at?');
      await rec.finish('waiting');
      return { status: 'no_options' as const };
    }

    // 6. Publish only if nothing changed meanwhile (compare-and-swap on input revision).
    const published = await rec.step('state_change', 'publish_version', () =>
      publishVersion(db, { planId: plan.id, inputRevision: plan.inputRevision, runId: rec.runId, options }),
    (r) => ({ summary: `version ${r.version.versionNumber}` }));

    const versionId = published.version.id;
    await notifyPlan(db, plan.id, `options:${versionId}`, formatOptions(published.options, job.reason), versionId);
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
    if (e instanceof LimitError) { await rec.finish('limit', e.message); return { status: 'limit' as const }; }
    await rec.finish('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export function formatOptions(options: PlanOption[], repairReason?: string) {
  const n = options.length === 1 ? 'is 1 option' : `are ${options.length} options`;
  const head = repairReason ? `Something changed, so here ${n} that fit now:` : `Here ${n}:`;
  const body = options.map((o) => {
    const price = o.estimatedPerPerson ? `$${(o.estimatedPerPerson.amountMinor / 100).toFixed(2)}/person (${o.priceKind})` : 'price unknown';
    const unsure = o.uncertainties.length ? `\n   ⚠ ${o.uncertainties.join('; ')}` : '';
    return `${o.label}) ${o.title}: ${localTime(o.startAt, o.timeZone)}, ${price}\n   ${o.publicExplanation}${unsure}`;
  }).join('\n');
  return `${head}\n${body}\nVote in the poll for every option that works for you, and reply "favorite B" (etc.) for your top pick.`;
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
  await notifyPlan(db, plan.id, `reminder:${job.versionId}`, `Quick nudge: ${people.length - t.voters} of ${people.length} still need to vote on the options above. No rush, nothing gets booked without the group.`);
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
