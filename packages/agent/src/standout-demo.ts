// Explicit synthetic accounts + live providers. No real phone, calendar write, or purchase is used.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, user, friendships, privateFacts, plans, jobs } from '@hacktx/db';
import { createPlan, recordVote, recordDecision, sealJson, webConversation } from '@hacktx/core';
import type { DiscoveryPort } from '@hacktx/contracts';
import { createMuse } from './muse';
import { runPlanJob } from './planner';
import { findCommonGround, attachGround, generateQuest, completeQuestChallenge, readQuest } from './standout';

if (process.env.DEMO_SEED !== '1') throw Error('Set DEMO_SEED=1 to create the explicitly synthetic demo accounts.');
const { db, pool } = createDb();
const city = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.2672, longitude: -97.7431, timeZone: 'America/Chicago' };
const people = [
  { id: 'sidequest_demo_alex', name: 'Alex (demo)', note: 'I want to try stargazing and enjoy walking outdoors.', label: 'Stargazing and outdoor walks' },
  { id: 'sidequest_demo_mel', name: 'Mel (demo)', note: 'I love night photography and exploring parks with friends.', label: 'Night photography and parks' },
  { id: 'sidequest_demo_mark', name: 'Mark (demo)', note: 'I enjoy astronomy and learning about the night sky.', label: 'Astronomy and the night sky' },
];
const actor = (userId: string) => ({ userId, source: 'web' as const });
try {
  for (const p of people) {
    await db.insert(user).values({ id: p.id, name: p.name, email: `${p.id}@demo.sidequest.invalid`, emailVerified: false, city: JSON.stringify(city), interests: [p.label], onboardingComplete: true }).onConflictDoNothing();
    const [existing] = await db.select({ id: privateFacts.id }).from(privateFacts).where(and(eq(privateFacts.ownerUserId, p.id), eq(privateFacts.kind, 'interest_drop'))).limit(1);
    if (!existing) await db.insert(privateFacts).values({ ownerUserId: p.id, kind: 'interest_drop', valueEnc: sealJson('private_fact', { note: `Synthetic demo fixture: ${p.note}`, url: null, chips: [{ id: randomUUID(), label: p.label, evidence: p.note, kind: 'interest', confirmed: true, shared: true }] }) });
  }
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const pair = [people[i]!.id, people[j]!.id].sort();
    await db.insert(friendships).values({ userLow: pair[0]!, userHigh: pair[1]!, requestedBy: pair[0]!, status: 'accepted', acceptedAt: new Date() }).onConflictDoNothing();
  }
  console.log('Three labeled synthetic accounts and their accepted friendships are ready. No phone numbers assigned.');
  if (process.argv.includes('--verify-live')) {
    if (!process.env.SERPAPI_API_KEY) throw Error('SERPAPI_API_KEY required for live verification');
    const muse = createMuse();
    const ground = await findCommonGround(db, muse, actor(people[0]!.id), people.slice(1).map(p => p.id));
    const { plan } = await createPlan(db, actor(people[0]!.id), { request: `${ground.theme}. Search: ${ground.searchQuery}`, templateId: 'local-outing', city, participantUserIds: people.slice(1).map(p => p.id), window: null, mode: 'test' });
    await attachGround(db, actor(people[0]!.id), plan.id, ground);
    await webConversation(db, plan.id, 'group', people[0]!.id);
    // The adapter has its own worker typecheck; preserve the existing strict backend config.
    const adapterPath = '../../discovery/src/index.ts';
    const { createSerpApiDiscovery } = await import(adapterPath) as { createSerpApiDiscovery(options: { apiKey: string; maxRequests: number }): DiscoveryPort };
    const result = await runPlanJob({ db, muse, discovery: createSerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY, maxRequests: 8 }) }, { planId: plan.id, inputRevision: plan.inputRevision });
    if (result.status !== 'published') throw Error(`Live planner returned ${result.status}; inspect the redacted run.`);
    const { planOptions } = await import('@hacktx/db');
    const [current] = await db.select().from(plans).where(eq(plans.id, plan.id));
    const options = await db.select().from(planOptions).where(eq(planOptions.versionId, current!.activeVersionId!));
    if (!options.length) throw Error('No sourced options were published');
    for (const p of people) await recordVote(db, actor(p.id), { planId: plan.id, versionId: current!.activeVersionId!, acceptableOptionIds: [options[0]!.id], favoriteOptionId: options[0]!.id, noneAcceptable: false, source: 'web', sourceEventId: `demo:${randomUUID()}` });
    await recordDecision(db, actor(people[0]!.id), { planId: plan.id, versionId: current!.activeVersionId!, optionId: options[0]!.id, attendeeUserIds: people.map(p => p.id), evidenceMessageIds: [], expectedRevision: current!.inputRevision });
    const quest = await generateQuest(db, muse, actor(people[0]!.id), plan.id);
    for (let i = 0; i < quest.challenges.length; i++) await completeQuestChallenge(db, actor(people[i % people.length]!.id), plan.id, quest.challenges[i]!.id, true);
    const completed = await readQuest(db, actor(people[1]!.id), plan.id);
    if (completed?.challenges.filter(c => c.completedBy).length !== 5) throw Error('Shared quest progress was not persisted');
    await db.update(jobs).set({ state: 'done', updatedAt: new Date() }).where(and(eq(jobs.planId, plan.id), eq(jobs.state, 'queued'), inArray(jobs.kind, ['plan', 'publish_poll', 'poll_reminder'])));
    console.log(JSON.stringify({ verified: true, planId: plan.id, commonGround: ground.theme, evidencePeople: [...new Set(ground.why.map(c => c.name))], sourcedOptions: options.length, questChallenges: completed.challenges.length, completed: 5, realProviders: ['Meta Muse Spark', 'SerpApi'], noExternalMessages: true }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo verification failed'); process.exitCode = 1;
} finally { await pool.end(); }
