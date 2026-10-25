// Exercise the integrated chat and HTTP boundaries without external messages or purchases.
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { conversations, friendInvites, jobs, messages, outbox, planParticipants, plans, user } from '@hacktx/db';
import { acceptInviteForUser, createPlan, open, pendingRequestsFor, seal } from '@hacktx/core';
import { handleInbound, loadSelectedPlan, setBuyer, type ToolCtx } from '@hacktx/agent';
import { FulfillmentService } from '../../../packages/fulfillment/src/service.ts';
import { MemoryRepository } from '../../../packages/fulfillment/src/repository.ts';
import { handlePart4 } from '../../../packages/fulfillment/src/http.ts';
import { createSyncCalendarHandler } from '@hacktx/integrations/calendar-jobs';
import { synchronizeFulfillment } from '@hacktx/integrations/fulfillment';
import { ingestClawMessage, createSendOutboxHandler } from '@hacktx/integrations/messaging/claw';
import { callTool, votedPlan, sent } from '../../../packages/agent/test/fulfillment-helpers';
import { austin, seedUsers, testDb, web } from '../../../packages/core/test/helpers';

process.env.PHONE_LOOKUP_HMAC_KEY = 'owned-integration-test-lookup-key-32bytes';

it('holds all named people until invitation acceptance; the delivery uses the shared account phone codec', async () => {
  const db = await testDb();
  const ids = await seedUsers(db, ['Alex']);
  await db.update(user).set({ phoneNumber: '+15125550101', phoneNumberVerified: true }).where(eq(user.id, ids.Alex!));
  const [conv] = await db.insert(conversations).values({ provider: 'claw_messenger', sendingLine: 'test-line', externalChatId: 'private-test', kind: 'private' }).returning();
  const [message] = await db.insert(messages).values({ conversationId: conv!.id, providerMessageId: 'start', senderUserId: ids.Alex!, senderHandle: '+15125550101', isPrivate: true, bodyEnc: seal('message', 'Sam and I want a movie. Sam is +15125550102'), occurredAt: new Date() }).returning();
  const ctx: ToolCtx = { db, actor: { userId: ids.Alex!, source: 'private_message' }, planId: null, conversation: { id: conv!.id, kind: 'private' }, messageId: message!.id, providerMessageId: 'start' };
  const args = { request: 'A movie with Sam', friendNames: ['Sam'], includeChatMembers: false, kind: 'movie-night', windowStartAt: null, windowEndAt: null };
  expect(await callTool(ctx, 'start_plan', args)).toMatchObject({ created: false, needsPhoneFor: ['Sam'] });
  expect(await db.select().from(plans)).toHaveLength(0);
  await expect(callTool(ctx, 'start_plan', { ...args, friendContacts: [{ name: 'Sam', phone: '+15125550103' }] })).rejects.toMatchObject({ code: 'INVALID' });
  const created = await callTool(ctx, 'start_plan', { ...args, friendContacts: [{ name: 'Sam', phone: '+15125550102' }] });
  expect(created).toMatchObject({ created: true, status: 'waiting_connections' });
  const [invitation] = await db.select().from(friendInvites);
  const [delivery] = await db.select().from(outbox);
  const token = open('outbox', delivery!.bodyEnc!).match(/\/invite\/([\w-]+)/)![1]!;
  expect((await db.select().from(planParticipants)).some(person => person.inviteId === invitation!.id && person.userId === null)).toBe(true);
  const sentTo: unknown[] = [];
  const sendJob = (await db.select().from(jobs)).find(job => job.kind === 'send_outbox')!;
  await createSendOutboxHandler({ send: async target => { sentTo.push(target); return { type: 'send.result', id: 'test', status: 'accepted', ok: true, messageId: 'test' }; } })({ db, job: sendJob });
  expect(sentTo).toEqual([{ to: '+15125550102' }, { to: '+15125550102' }]); // the invite text, then its link alone so iOS shows a preview
  await db.insert(user).values({ id: 'sam', name: 'Sam', email: 'sam@owned.invalid', emailVerified: false, city: JSON.stringify(austin), phoneNumber: '+15125550102', phoneNumberVerified: true });
  expect(await pendingRequestsFor(db, 'sam')).toMatchObject([{ userId: ids.Alex }]);
  await acceptInviteForUser(db, 'sam', token);
  expect((await db.select().from(plans))[0]!.status).toBe('planning');
  expect((await db.select().from(planParticipants)).map(person => person.userId).sort()).toEqual([ids.Alex, 'sam'].sort());
});

it('decodes encrypted Claw jobs without sending an unknown sender to the model', async () => {
  const db = await testDb();
  await ingestClawMessage(db, 'owned-line', { type: 'message', messageId: 'private-secret', chatId: 'test', from: '+15125550102', text: 'private request' });
  const job = (await db.select().from(jobs)).find(job => job.kind === 'process_inbound')!;
  expect(JSON.stringify(job.payload)).not.toContain('private request');
  expect(await handleInbound({ db, muse: {} as never }, job.payload as Parameters<typeof handleInbound>[1])).toMatchObject({ status: 'unknown_sender' });
});

it('uses the same buyer and outcome for web handoff and chat, without duplicate private shares', async () => {
  const t = await votedPlan();
  await callTool(await t.say(t.u.Alex!, 'Go with A for all three'), 'propose_selection', { label: 'A', attendeeUserIds: [t.u.Alex!, t.u.Mark!, t.u.Mel!], evidenceMessageIds: [] });
  await setBuyer(t.db, web(t.u.Mark!), t.planId, true, 0);
  expect(await setBuyer(t.db, web(t.u.Alex!), t.planId, true, 1)).toMatchObject({ confirmed: false, error: 'BUYER_EXISTS' });
  const selected = await loadSelectedPlan(t.db, web(t.u.Mark!), t.planId);
  expect(selected).toMatchObject({ revision: 1, buyerUserId: t.u.Mark, selectionReady: true });
  const service = new FulfillmentService({ repository: new MemoryRepository(), loadPlan: (actor, id) => loadSelectedPlan(t.db, actor, id), wallet: {} as never, quote: async () => { throw Error('unused'); }, submit: async () => { throw Error('unused'); } });
  const runtime = { service, authenticate: async () => web(t.u.Mark!), authorizeMutation: async () => true, afterMutation: () => synchronizeFulfillment(t.db, service) };
  const handoff = await handlePart4('handoff', new Request('https://owned.test/api', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) }), { id: t.planId }, runtime);
  expect(handoff.status).toBe(200);
  const bookingId = (await handoff.json()).data.booking.id;
  expect((await t.db.select().from(plans).where(eq(plans.id, t.planId)))[0]!.status).toBe('needs_handoff');
  const completed = await handlePart4('report-completed', new Request('https://owned.test/api', { method: 'POST', body: JSON.stringify({ expectedRevision: 1, total: { amountMinor: 4801, currency: 'USD' }, orderReference: 'OWNED-FAKE-ORDER' }) }), { id: bookingId }, runtime);
  expect(completed.status).toBe(200);
  await synchronizeFulfillment(t.db, service);
  expect((await t.db.select().from(plans).where(eq(plans.id, t.planId)))[0]!.status).toBe('booked');
  const shares = (await sent(t.db)).filter(message => message.text.includes('simulated share'));
  expect(shares).toHaveLength(2);
  expect(shares.every(message => message.recipient.kind === 'private')).toBe(true);
});

it('returns payment status before selection and refuses checkout without inventing a candidate', async () => {
  const db = await testDb();
  const users = await seedUsers(db, ['Alex']);
  const { plan } = await createPlan(db, web(users.Alex!), { request: 'An outing', templateId: 'local-outing', city: austin, window: null, participantUserIds: [] });
  const service = new FulfillmentService({ repository: new MemoryRepository(), loadPlan: (actor, id) => loadSelectedPlan(db, actor, id), wallet: {} as never, quote: async () => { throw Error('unused'); }, submit: async () => { throw Error('unused'); } });
  expect(await service.paymentView(web(users.Alex!), plan.id)).toMatchObject({ buyerUserId: null });
  await expect(service.handoff(web(users.Alex!), plan.id, 0)).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
});


it('calendar jobs exclude a member who is not among the selected attendees', async () => {
  const t = await votedPlan();
  await callTool(await t.say(t.u.Alex!, 'Go with A for Alex and Mark; Mel cannot come'), 'propose_selection', { label: 'A', attendeeUserIds: [t.u.Alex!, t.u.Mark!], evidenceMessageIds: [] });
  const { calendarConnections, calendarEvents } = await import('@hacktx/db');
  await t.db.insert(calendarConnections).values({ userId: t.u.Mel!, refreshTokenEnc: seal('oauth', 'unused-owned-token'), status: 'active', scopes: ['https://www.googleapis.com/auth/calendar.events'] });
  const writes: string[] = [];
  const handler = createSyncCalendarHandler({ getBusy: async () => ({ status: 'ok', fetchedAt: new Date().toISOString(), busy: [] }), upsertOwnEvent: async (userId: string) => { writes.push(userId); return { eventId: 'owned-test', status: 'synced' }; } } as never);
  const job = (await t.db.select().from(jobs)).find(job => job.kind === 'sync_calendar')!;
  await handler({ db: t.db, job });
  expect(writes).toEqual([]);
  expect((await t.db.select().from(calendarEvents)).map(event => event.userId).sort()).toEqual([t.u.Alex, t.u.Mark].sort());
});

it('organizer can remove a declined invitee or close a waiting plan through chat tools', async () => {
  const db = await testDb();
  const users = await seedUsers(db, ['Alex', 'Mark']);
  const { inviteByPhone } = await import('@hacktx/core');
  const { plan } = await createPlan(db, web(users.Alex!), { request: 'A movie', templateId: 'movie-night', city: austin, window: null, participantUserIds: [] });
  await inviteByPhone(db, web(users.Alex!), { name: 'Sam', phone: '+15125550109', planId: plan.id });
  const [conv] = await db.insert(conversations).values({ provider: 'web', sendingLine: 'web', externalChatId: 'recovery', kind: 'private', activePlanId: plan.id }).returning();
  const context = (userId: string): ToolCtx => ({ db, actor: web(userId), planId: plan.id, conversation: { id: conv!.id, kind: 'private' }, messageId: 'owned-recovery', providerMessageId: 'owned-recovery' });
  // Organizer-only enforcement is preserved even for a member of the plan.
  await db.insert(planParticipants).values({ planId: plan.id, userId: users.Mark! });
  await expect(callTool(context(users.Mark!), 'remove_participant', { participantName: 'Sam' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(callTool(context(users.Mark!), 'close_plan', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await db.delete(planParticipants).where(eq(planParticipants.userId, users.Mark!));
  expect(await callTool(context(users.Alex!), 'remove_participant', { participantName: 'Sam' })).toMatchObject({ removed: true, status: 'planning' });
  expect(await callTool(context(users.Alex!), 'close_plan', {})).toMatchObject({ closed: true });
  expect((await db.select().from(plans))[0]!.status).toBe('closed');
});
