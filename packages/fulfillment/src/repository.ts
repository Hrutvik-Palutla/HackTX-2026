import type { BookingQuote, BuyerAuthorization, BookingResult, Reimbursement, Mode } from './types.ts';

export type Effect = {
  key: string;
  planId: string;
  kind: 'quote' | 'wallet_approval' | 'booking' | 'reimbursements' | 'change';
  state: 'started' | 'confirmed' | 'unknown' | 'failed';
  createdAt: string;
  resultId: string | null;
  resultUrl?: string;
};
export type AuthorizationRecord = BuyerAuthorization & { requestedBindingHash?: string };
export type BookingRecord = BookingResult & { buyerUserId?: string; attendeeUserIds?: string[] };
export type QuoteRecord = { quote: BookingQuote; inputRevision: number; effectKey: string };
export type PrivateDelivery = {
  id: string;
  planId: string;
  bookingId: string;
  recipientUserId: string;
  text: string;
  mode: Mode;
  status: 'pending' | 'delivered';
};
export type ChangeRequest = {
  id: string;
  planId: string;
  requestedBy: string;
  text: string;
  createdAt: string;
  status: 'requested' | 'buyer_handoff';
};
export type RepositoryState = {
  schemaVersion: 1;
  quotes: Record<string, QuoteRecord>;
  authorizations: Record<string, AuthorizationRecord>;
  bookings: Record<string, BookingRecord>;
  reimbursements: Record<string, Reimbursement>;
  effects: Record<string, Effect>;
  deliveries: Record<string, PrivateDelivery>;
  changes: Record<string, ChangeRequest>;
};
/** Mutations must be synchronous; never hold a transaction over network/model calls. */
export interface FulfillmentRepository {
  read<T>(fn: (state: Readonly<RepositoryState>) => T): Promise<T>;
  transact<T>(fn: (state: RepositoryState) => T): Promise<T>;
}
export function emptyState(): RepositoryState {
  return { schemaVersion: 1, quotes: {}, authorizations: {}, bookings: {}, reimbursements: {}, effects: {}, deliveries: {}, changes: {} };
}

export class MemoryRepository implements FulfillmentRepository {
  protected state: RepositoryState;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(initial: RepositoryState = emptyState()) { this.state = structuredClone(initial); }

  protected async persist(_next: RepositoryState): Promise<void> { /* in-memory adapter */ }

  async read<T>(fn: (state: Readonly<RepositoryState>) => T): Promise<T> {
    await this.tail;
    return structuredClone(fn(structuredClone(this.state)));
  }

  transact<T>(fn: (state: RepositoryState) => T): Promise<T> {
    const work = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = fn(next);
      if (result instanceof Promise) throw new Error('Repository transactions must be synchronous.');
      await this.persist(next);
      this.state = next;
      return structuredClone(result);
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
}
