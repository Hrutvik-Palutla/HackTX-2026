import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinkWalletAdapter, type LinkCommand, type LinkExecutor, type WalletAuthorizationStore } from './link-wallet.ts';
import type { BookingQuote, Id } from '../fulfillment/src/types.ts';
import { AuthVault } from '../../apps/booking-worker/auth-vault.ts';

const quote: BookingQuote = {
  id: 'quote_123', planId: 'plan_123', versionId: 'version_123', optionId: 'option_123',
  attendeeUserIds: ['buyer_123'], buyerUserId: 'buyer_123', merchantHost: 'tickets.example.test',
  merchantUrl: 'https://tickets.example.test/checkout', performanceRef: 'screening_123', seatRefs: ['A1'],
  lineItems: [{ attendeeUserId: 'buyer_123', label: 'Adult ticket', amount: { amountMinor: 2400, currency: 'USD' } }],
  sharedFees: { amountMinor: 200, currency: 'USD' }, sharedDiscount: { amountMinor: 0, currency: 'USD' },
  total: { amountMinor: 2600, currency: 'USD' }, expiresAt: '2099-01-01T00:00:00.000Z', bindingHash: 'binding_123', mode: 'test',
};

class MemoryAuthorizationStore implements WalletAuthorizationStore {
  private rows = new Map<Id, Awaited<ReturnType<WalletAuthorizationStore['get']>> & {}>();
  async save(row: { authorizationId: Id; buyerUserId: Id; quoteId: Id; quoteBindingHash: string; walletRequestId: string; mode: 'test' | 'live' }) {
    this.rows.set(row.authorizationId, { ...row, checkedAt: '2026-10-24T00:00:00.000Z' });
  }
  async get(id: Id) { return this.rows.get(id) ?? null; }
}

test('Link adapter uses per-buyer auth files, fixed argv, and authoritative CLI status', async () => {
  const authDirectory = await mkdtemp(join(tmpdir(), 'wallet-test-'));
  await writeFile(join(authDirectory, `${createHash('sha256').update('buyer_123').digest('hex')}.json`), '{}', { mode: 0o600 });
  const calls: LinkCommand[] = [];
  let status = 'pending_approval';
  let authenticated = false;
  let providerAmount = 2600;
  let providerTest = true;
  const executor: LinkExecutor = async (input) => {
    calls.push(input);
    const args = input.args;
    if (args[0] === 'auth' && args[1] === 'login') {
      await writeFile(args[args.indexOf('--auth') + 1], '{}', { mode: 0o600 });
      return { stdout: JSON.stringify({
        verification_url: 'https://app.link.com/verify/device', phrase: 'BLUE BIRD',
        _next: { command: 'auth status --interval 5 --max-attempts 60' },
      }), stderr: '' };
    }
    if (args[0] === 'auth' && args[1] === 'status') {
      return { stdout: JSON.stringify(authenticated
        ? { authenticated: true }
        : { authenticated: false, pending: true, verification_url: 'https://app.link.com/verify/device', phrase: 'BLUE BIRD' }), stderr: '' };
    }
    if (args[0] === 'spend-request' && args[1] === 'create') {
      return { stdout: JSON.stringify({
        id: 'lsrq_123', approval_url: 'https://app.link.com/approve/123', status: 'pending_approval',
        amount: providerAmount, currency: 'usd', merchant_name: 'tickets.example.test', merchant_url: quote.merchantUrl,
        metadata: { quote_id: quote.id, binding_hash: quote.bindingHash, mode: 'test' }, test: providerTest,
      }), stderr: '' };
    }
    if (args[0] === 'spend-request' && args[1] === 'retrieve') {
      const info = {
        id: 'lsrq_123', status, amount: providerAmount, currency: 'usd', merchant_name: 'tickets.example.test', merchant_url: quote.merchantUrl,
        metadata: { quote_id: quote.id, binding_hash: quote.bindingHash, mode: 'test' }, test: providerTest,
      };
      if (args.includes('--include')) {
        const output = args[args.indexOf('--output-file') + 1];
        await writeFile(output, JSON.stringify({ card: { number: 'test-only-secret' } }), { mode: 0o600 });
        return { stdout: JSON.stringify({ ...info, card_output_file: output }), stderr: '' };
      }
      return { stdout: JSON.stringify(info), stderr: '' };
    }
    throw new Error(`unexpected command ${args.join(' ')}`);
  };
  const store = new MemoryAuthorizationStore();
  try {
    const adapter = new LinkWalletAdapter({
      authDirectory, mode: 'test', allowedMerchantHosts: new Set(['tickets.example.test']),
      loadQuote: async () => quote, store, execute: executor,
    });
    const connect = await adapter.startConnect('buyer_123');
    assert.equal(connect.url, 'https://app.link.com/verify/device');
    assert.equal(connect.phrase, 'BLUE BIRD');
    const resumed = await adapter.startConnect('buyer_123');
    assert.equal(resumed.connectionId, connect.connectionId);
    assert.equal(resumed.url, connect.url);
    assert.equal(await adapter.checkConnection('buyer_123'), 'pending');
    authenticated = true;
    assert.equal(await adapter.checkConnection('buyer_123'), 'connected');
    const request = await adapter.requestPurchaseApproval(quote.id);
    assert.equal(request.approvalUrl, 'https://app.link.com/approve/123');
    assert.equal((await adapter.refreshAuthorization(request.authorizationId)).status, 'pending');
    status = 'approved';
    const approved = await adapter.refreshAuthorization(request.authorizationId);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvedBindingHash, quote.bindingHash);
    providerAmount = 2601;
    await assert.rejects(adapter.refreshAuthorization(request.authorizationId), /amount, currency, merchant, or quote binding/);
    providerAmount = 2600;
    providerTest = false;
    await assert.rejects(adapter.refreshAuthorization(request.authorizationId), /mode does not match/);
    providerTest = true;
    let credentialPath = '';
    const consumed = await adapter.withApprovedCredential(request.authorizationId, async (path) => {
      credentialPath = path;
      assert.ok((await stat(path)).mode & 0o600);
      return 'consumed-in-trusted-callback';
    });
    assert.equal(consumed, 'consumed-in-trusted-callback');
    await assert.rejects(access(credentialPath));

    const authPaths = calls.map((call) => call.args[call.args.indexOf('--auth') + 1]);
    assert.ok(authPaths.every((path) => path && path.startsWith(authDirectory)));
    assert.ok(authPaths.every((path) => path === authPaths[0]));
    assert.ok(calls.every((call) => call.command === 'link-cli'));
    assert.ok(calls.every((call) => call.timeoutMs !== undefined && call.timeoutMs <= 30_000));
    const create = calls.find((call) => call.args[0] === 'spend-request' && call.args[1] === 'create');
    assert.ok(create);
    assert.ok(create.args.includes('--request-approval'));
    assert.ok(create.args.includes('--test'));
    assert.ok(create.args.includes('binding_hash:binding_123'));
    assert.ok(create.args.includes('mode:test'));
    assert.ok(calls.some((call) => call.args[0] === 'auth' && call.args[1] === 'status' && call.args.includes('--max-attempts')));
  } finally {
    await rm(authDirectory, { recursive: true, force: true });
  }
});

test('Link adapter rejects approval links outside the official host', async () => {
  const authDirectory = await mkdtemp(join(tmpdir(), 'wallet-test-'));
  await writeFile(join(authDirectory, `${createHash('sha256').update('buyer_123').digest('hex')}.json`), '{}', { mode: 0o600 });
  const store = new MemoryAuthorizationStore();
  const executor: LinkExecutor = async ({ args }) => {
    if (args[0] === 'auth' && args[1] === 'status') return { stdout: '{"authenticated":true}', stderr: '' };
    if (args[0] === 'spend-request' && args[1] === 'create') return { stdout: '{"id":"lsrq_123","approval_url":"https://evil.example/steal"}', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  try {
    const adapter = new LinkWalletAdapter({
      authDirectory, mode: 'test', allowedMerchantHosts: new Set(['tickets.example.test']),
      loadQuote: async () => quote, store, execute: executor,
    });
    await assert.rejects(adapter.requestPurchaseApproval(quote.id), /valid spend request and approval URL/);
  } finally {
    await rm(authDirectory, { recursive: true, force: true });
  }
});

test('Link connection and quote approval operate only on encrypted vault sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wallet-vault-test-'));
  const persistentFallback = join(root, 'must-not-be-created');
  const vault = new AuthVault({
    directory: join(root, 'encrypted-sessions'),
    tempDirectory: root,
    keyHex: createHash('sha256').update('unit-test-key').digest('hex'),
  });
  let connected = false;
  let cliStatus = 'approved';
  const authPaths: string[] = [];
  const executor: LinkExecutor = async ({ args }) => {
    const authIndex = args.indexOf('--auth');
    if (authIndex >= 0) authPaths.push(args[authIndex + 1]);
    if (args[0] === 'auth' && args[1] === 'login') {
      await writeFile(args[authIndex + 1], '{"pending":"device flow"}', { mode: 0o600 });
      return { stdout: JSON.stringify([{
        verification_url: 'https://app.link.com/verify/vault', phrase: 'GREEN OWL',
        _next: { command: 'auth status --interval 5 --max-attempts 60' },
      }]), stderr: '' };
    }
    if (args[0] === 'auth' && args[1] === 'status') {
      return { stdout: JSON.stringify([connected
        ? { authenticated: true }
        : { authenticated: false, pending: true, verification_url: 'https://app.link.com/verify/vault', phrase: 'GREEN OWL' }]), stderr: '' };
    }
    if (args[0] === 'spend-request' && args[1] === 'create') {
      return { stdout: JSON.stringify({
        id: 'lsrq_vault_123', approval_url: 'https://app.link.com/approve/vault', status: 'pending_approval',
        amount: 2600, currency: 'USD', merchant_name: 'tickets.example.test', merchant_url: quote.merchantUrl,
        metadata: { quote_id: quote.id, binding_hash: quote.bindingHash, mode: 'test' },
      }), stderr: '' };
    }
    if (args[0] === 'spend-request' && args[1] === 'retrieve') {
      const request = {
        id: 'lsrq_vault_123', status: cliStatus, amount: 2600, currency: 'USD',
        merchant_name: 'tickets.example.test', merchant_url: quote.merchantUrl,
        metadata: { quote_id: quote.id, binding_hash: quote.bindingHash, mode: 'test' },
      };
      if (args.includes('--include')) {
        const credentialPath = args[args.indexOf('--output-file') + 1];
        await writeFile(credentialPath, '{"card":{"number":"vault-test-only"}}', { mode: 0o600 });
        return { stdout: JSON.stringify({ ...request, card_output_file: credentialPath }), stderr: '' };
      }
      return { stdout: JSON.stringify(request), stderr: '' };
    }
    throw new Error('Unexpected mock CLI invocation.');
  };
  try {
    const store = new MemoryAuthorizationStore();
    const adapter = new LinkWalletAdapter({
      authDirectory: persistentFallback,
      mode: 'test', allowedMerchantHosts: new Set(['tickets.example.test']),
      loadQuote: async () => quote, store, sessionVault: vault, execute: executor,
    });
    const connect = await adapter.startConnect('buyer_123');
    assert.equal(connect.url, 'https://app.link.com/verify/vault');
    connected = true;
    assert.equal(await adapter.checkConnection('buyer_123'), 'connected');
    const approval = await adapter.requestPurchaseApproval(quote.id);
    assert.equal(approval.approvalUrl, 'https://app.link.com/approve/vault');
    assert.equal((await adapter.refreshAuthorization(approval.authorizationId)).status, 'approved');
    let credentialPath = '';
    await adapter.withApprovedCredential(approval.authorizationId, async (path) => {
      credentialPath = path;
      assert.ok(path.startsWith(root));
      assert.ok((await stat(path)).isFile());
    });
    await assert.rejects(access(credentialPath));
    await assert.rejects(access(persistentFallback));
    assert.ok(authPaths.length >= 5);
    assert.ok(authPaths.every((path) => path.startsWith(root)));
    assert.ok(authPaths.every((path) => path.endsWith('auth.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
