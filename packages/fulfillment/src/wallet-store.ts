import type { WalletAuthorizationStore } from '../../integrations/link-wallet.ts';
import type { FulfillmentRepository } from './repository.ts';

/** Bridges the CLI adapter to the same durable state used by the fulfillment service. */
export function walletAuthorizationStore(repository: FulfillmentRepository, now = () => new Date()): WalletAuthorizationStore {
  return {
    async save(record) {
      await repository.transact(s => {
        s.authorizations[record.authorizationId] = {
          id: record.authorizationId, buyerUserId: record.buyerUserId, quoteId: record.quoteId,
          walletRequestId: record.walletRequestId, status: 'pending', approvedBindingHash: null,
          requestedBindingHash: record.quoteBindingHash, checkedAt: now().toISOString(), mode: record.mode,
        };
      });
    },
    async get(id) {
      return repository.read(s => {
        const row = s.authorizations[id];
        if (!row?.requestedBindingHash) return null;
        return {
          authorizationId: row.id, buyerUserId: row.buyerUserId, quoteId: row.quoteId,
          quoteBindingHash: row.requestedBindingHash, walletRequestId: row.walletRequestId,
          checkedAt: row.checkedAt, mode: row.mode,
        };
      });
    },
  };
}
