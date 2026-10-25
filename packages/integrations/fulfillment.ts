// One composition for HTTP and messaging. Sid's selection bridge remains authoritative for both.
import { resolve } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { plans, type Db } from '@hacktx/db';
import { afterBooking, deliverPrivate, loadSelectedPlan, moveStatus } from '@hacktx/agent';
import { createProductionPart4, type ProductionPart4Options } from '../fulfillment/src/bootstrap.ts';
import { PostgresRepository, type PgPool } from '../fulfillment/src/postgres-repository.ts';
import type { FulfillmentService } from '../fulfillment/src/service.ts';

export function createSharedFulfillment(options: {
  db: Db; pool: PgPool; env?: NodeJS.ProcessEnv;
  authenticate?: ProductionPart4Options['authenticate'];
  authorizeMutation?: ProductionPart4Options['authorizeMutation'];
}) {
  const env = options.env ?? process.env;
  const hosts = (env.BOOKING_ALLOWED_HOSTS || env.BOOKING_MERCHANT_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return createProductionPart4({
    repository: new PostgresRepository(options.pool),
    loadPlan: (actor, planId) => loadSelectedPlan(options.db, actor, planId),
    authenticate: options.authenticate ?? (async () => null),
    authorizeMutation: options.authorizeMutation ?? (async () => false),
    // No merchant driver/quote is installed by default. An allowlist never enables purchasing on its own.
    allowedMerchantHosts: new Set(hosts.length ? hosts : ['handoff.invalid']),
    authDirectory: resolve(env.LINK_AUTH_DIRECTORY || '.part4-data/link-auth'),
    executable: resolve(env.LINK_CLI_PATH || 'apps/booking-worker/node_modules/.bin/link-cli'),
    env,
  });
}

/** Replays durable outcomes through the same chat bridge, including purchases completed in the web app. */
export async function synchronizeFulfillment(db: Db, service: FulfillmentService) {
  const state = await service.repository.read(value => value);
  const all = Object.values(state.bookings);
  for (const planId of new Set(all.map(booking => booking.planId))) {
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
    if (!plan || ['closed', 'planning', 'waiting_connections', 'clarifying', 'voting'].includes(plan.status)) continue;
    const current = all.filter(booking => booking.planId === planId && booking.versionId === plan.activeVersionId && booking.mode === plan.mode);
    // An older failed attempt must not overwrite a confirmed or still-uncertain purchase.
    const success = current.find(booking => ['merchant_confirmed', 'buyer_reported', 'test_confirmed'].includes(booking.status));
    const booking = success ?? current.find(booking => ['submitting', 'outcome_unknown'].includes(booking.status))
      ?? current.find(booking => booking.status === 'handoff_required') ?? current.at(-1);
    if (!booking) continue;
    const buyerId = booking.buyerUserId ?? (await loadSelectedPlan(db, { userId: plan.organizerUserId, source: 'provider_event' }, planId))?.buyerUserId;
    if (!buyerId) continue;
    if (booking.status === 'failed' && ['booking', 'needs_handoff', 'quoting', 'awaiting_payment_approval'].includes(plan.status)) {
      await db.update(plans).set({ status: 'selected', updatedAt: new Date() }).where(and(eq(plans.id, planId), eq(plans.status, plan.status)));
    }
    await afterBooking(db, service, { userId: buyerId, source: 'provider_event' }, booking);
  }
  // Web quote/approval endpoints update the same workflow that chat tools read.
  for (const { quote, inputRevision } of Object.values(state.quotes)) {
    const selected = await loadSelectedPlan(db, { userId: quote.buyerUserId, source: 'provider_event' }, quote.planId);
    if (!selected?.selectionReady || selected.revision !== inputRevision || selected.optionId !== quote.optionId
      || selected.versionId !== quote.versionId || selected.buyerUserId !== quote.buyerUserId
      || Date.parse(quote.expiresAt) <= Date.now() || all.some(booking => booking.planId === quote.planId && booking.status !== 'failed')) continue;
    const approval = Object.values(state.authorizations).some(value => value.quoteId === quote.id && ['approved', 'pending'].includes(value.status));
    await moveStatus(db, quote.planId, approval ? 'awaiting_payment_approval' : 'quoting');
  }
  await deliverPrivate(db, service);
}
