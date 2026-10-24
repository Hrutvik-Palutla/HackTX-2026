/** Owned fake-money harness. Never install this as the production wallet or plan provider. */
import { randomUUID } from 'node:crypto';
import { FulfillmentService } from './service.ts';
import type { SelectedPlan, FulfillmentOptions } from './service.ts';
import { MemoryRepository } from './repository.ts';
import type { FulfillmentRepository } from './repository.ts';
import type { ActorContext, BookingQuote, BuyerAuthorization, WalletPort } from './types.ts';
import { quoteBinding } from './quote.ts';
import { runOwnedFixtureBrowserTest } from '../../../apps/booking-worker/worker.ts';

export const testActor = (userId = 'buyer'): ActorContext => ({ userId, source: 'web' });

export class TestWallet implements WalletPort {
  readonly records = new Map<string, BuyerAuthorization>();
  readonly approvalRequests: string[] = [];
  readonly quotes: Map<string, BookingQuote>;
  constructor(quotes: Map<string, BookingQuote>) { this.quotes = quotes; }
  async startConnect(userId: string) { return { url: `https://fixture.booking.test/connect/${encodeURIComponent(userId)}`, connectionId: `test-${userId}` }; }
  async checkConnection(): Promise<'connected'> { return 'connected'; }
  async requestPurchaseApproval(quoteId: string) {
    const q = this.quotes.get(quoteId); if (!q || q.mode !== 'test') throw new Error('Test wallet accepts only owned test quotes.');
    const id = randomUUID();
    this.approvalRequests.push(quoteId);
    this.records.set(id, { id, quoteId, buyerUserId: q.buyerUserId, walletRequestId: `test_${randomUUID()}`, status: 'pending', approvedBindingHash: null, checkedAt: new Date().toISOString(), mode: 'test' });
    return { authorizationId: id, approvalUrl: `https://fixture.booking.test/approve/${id}` };
  }
  async refreshAuthorization(id: string) {
    const record = this.records.get(id); if (!record) throw new Error('Unknown test authorization.');
    return { ...record };
  }
  approve(id: string): void {
    const record = this.records.get(id); if (!record) throw new Error('Unknown test authorization.');
    const quote = this.quotes.get(record.quoteId)!;
    this.records.set(id, { ...record, status: 'approved', approvedBindingHash: quote.bindingHash });
  }
}

export function createTestHarness(options: { repository?: FulfillmentRepository; submit?: FulfillmentOptions['submit']; now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  const repository = options.repository ?? new MemoryRepository();
  const plan: SelectedPlan = {
    planId: 'test-plan', revision: 1, versionId: 'test-v1', optionId: 'test-option', title: 'Owned test movie checkout',
    memberUserIds: ['buyer', 'mark', 'mel'], attendeeUserIds: ['buyer', 'mark', 'mel'], buyerUserId: 'buyer', mode: 'test',
    candidate: { id: 'owned-fixture', kind: 'movie_screening', title: 'Test Fixture Movie (not a live screening)', venueName: 'Owned test checkout', address: null, timeZone: 'America/Chicago', startAt: null, durationMinutes: 120, format: 'Test', price: null, rawPriceText: null, rawCurrency: null, priceKind: 'unknown', bookingUrl: 'https://fixture.booking.test/checkout', sourceIds: [], evidence: [] },
  };
  const quotes = new Map<string, BookingQuote>();
  const wallet = new TestWallet(quotes);
  let submissions = 0;
  const service = new FulfillmentService({
    repository, now, wallet,
    loadPlan: async (_actor, id) => id === plan.planId ? structuredClone(plan) : null,
    quote: async (selection) => {
      if (selection.mode !== 'test') throw new Error('The owned fixture cannot quote live purchases.');
      const q: BookingQuote = {
        id: randomUUID(), planId: selection.planId, versionId: selection.versionId, optionId: selection.optionId,
        attendeeUserIds: [...selection.attendeeUserIds], buyerUserId: selection.buyerUserId!,
        merchantHost: 'fixture.booking.test', merchantUrl: 'https://fixture.booking.test/checkout', performanceRef: 'owned-test-screening',
        seatRefs: selection.attendeeUserIds.map((_, index) => `C${index + 1}`),
        lineItems: selection.attendeeUserIds.map(attendeeUserId => ({ attendeeUserId, label: 'Owned test ticket', amount: { amountMinor: 1500, currency: 'USD' } })),
        sharedFees: { amountMinor: 275, currency: 'USD' }, sharedDiscount: { amountMinor: 0, currency: 'USD' },
        total: { amountMinor: 1500 * selection.attendeeUserIds.length + 275, currency: 'USD' },
        expiresAt: new Date(now().getTime() + 15 * 60_000).toISOString(), bindingHash: '', mode: 'test',
      };
      q.bindingHash = quoteBinding(q); quotes.set(q.id, q); return q;
    },
    submit: async input => {
      submissions++;
      if (options.submit) return options.submit(input);
      const outcome = await runOwnedFixtureBrowserTest(input.quote);
      return { id: randomUUID(), planId: input.quote.planId, versionId: input.quote.versionId, quoteId: input.quote.id, authorizationId: input.authorization.id,
        status: outcome.kind === 'confirmed' ? 'test_confirmed' : outcome.kind === 'blocked' ? 'handoff_required' : 'outcome_unknown',
        merchantOrderRef: outcome.kind === 'confirmed' ? outcome.merchantOrderRef : null,
        confirmationUrl: null, actualTotal: outcome.kind === 'confirmed' ? outcome.actualTotal : null, mode: 'test' };
    },
  });
  return { service, repository, plan, wallet, quotes, get submissions() { return submissions; } };
}
