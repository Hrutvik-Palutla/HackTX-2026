import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductionPart4 } from '../src/bootstrap.ts';
import { MemoryRepository } from '../src/repository.ts';
import type { ActorContext } from '../src/types.ts';
import type { SelectedPlan } from '../src/service.ts';
import type { CheckoutDriver } from '../../../apps/booking-worker/worker.ts';
import type { LinkExecutor } from '../../integrations/link-wallet.ts';

const actor: ActorContext = { userId: 'buyer-1', source: 'web' };
const plan: SelectedPlan = {
  planId: 'plan-1', revision: 2, versionId: 'version-1', optionId: 'option-1', title: 'Movie night',
  memberUserIds: ['buyer-1'], attendeeUserIds: ['buyer-1'], buyerUserId: 'buyer-1', mode: 'test',
  candidate: {
    id: 'candidate-1', kind: 'movie_screening', title: 'Film', venueName: 'Cinema', address: null,
    timeZone: 'America/Chicago', startAt: null, durationMinutes: null, format: null, price: null,
    rawPriceText: null, rawCurrency: null, priceKind: 'unknown', bookingUrl: 'https://tickets.example.test/checkout',
    sourceIds: [], evidence: [],
  },
};

function baseOptions(directory: string) {
  return {
    repository: new MemoryRepository(),
    loadPlan: async (_actor: ActorContext, planId: string) => planId === plan.planId ? structuredClone(plan) : null,
    authenticate: async () => actor,
    authorizeMutation: async () => true,
    allowedMerchantHosts: new Set(['tickets.example.test']),
    authDirectory: join(directory, 'encrypted-auth'),
    authTempDirectory: directory,
    executable: '/opt/link-cli/bin/link-cli',
    env: { LINK_AUTH_ENCRYPTION_KEY: createHash('sha256').update('bootstrap-test-key').digest('hex') } as NodeJS.ProcessEnv,
  };
}

test('production bootstrap defaults to test mode and leaves quote-less deployments on explicit handoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'part4-bootstrap-test-'));
  try {
    const part4 = createProductionPart4(baseOptions(directory));
    assert.equal(part4.mode, 'test');
    assert.equal(part4.service, part4.runtime.service);
    await assert.rejects(part4.service.createQuote(actor, {
      planId: plan.planId, versionId: plan.versionId, optionId: plan.optionId,
      buyerUserId: plan.buyerUserId!, expectedRevision: plan.revision, requestId: 'request-1',
    }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'HANDOFF_REQUIRED');
    const handoff = await part4.service.handoff(actor, plan.planId, plan.revision);
    assert.equal(handoff.booking.status, 'handoff_required');
    assert.equal(handoff.handoffUrl, plan.candidate?.bookingUrl);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production bootstrap routes Link auth through encrypted session storage only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'part4-bootstrap-vault-'));
  try {
    const execute: LinkExecutor = async ({ args }) => {
      const authPath = args[args.indexOf('--auth') + 1];
      if (args[0] === 'auth' && args[1] === 'login') {
        await writeFile(authPath, '{"private":"pending-device-session"}', { mode: 0o600 });
        return { stdout: JSON.stringify({
          verification_url: 'https://app.link.com/verify/bootstrap',
          _next: { command: 'auth status --interval 5 --max-attempts 60' },
        }), stderr: '' };
      }
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '{"authenticated":false,"pending":true}', stderr: '' };
      throw new Error('Unexpected mock command.');
    };
    const part4 = createProductionPart4({ ...baseOptions(directory), execute });
    const started = await part4.wallet.startConnect(actor.userId);
    assert.equal(started.url, 'https://app.link.com/verify/bootstrap');
    const userDir = join(directory, 'encrypted-auth', createHash('sha256').update(actor.userId).digest('hex'));
    const files = await readdir(userDir);
    assert.deepEqual(files, ['snapshot.vault']);
    const encrypted = await readFile(join(userDir, 'snapshot.vault'), 'utf8');
    assert.equal(encrypted.includes('pending-device-session'), false);
    assert.equal(encrypted.includes('auth.json'), false);
    assert.equal((await stat(join(directory, 'encrypted-auth'))).isDirectory(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production bootstrap fails closed without the encrypted auth key and rejects the fixture in live mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'part4-bootstrap-live-'));
  try {
    const missingKey = baseOptions(directory);
    missingKey.env = {};
    const withoutKey = createProductionPart4(missingKey);
    await assert.rejects(withoutKey.wallet.startConnect(actor.userId), /configure a 32-byte encryption key/);

    const fixtureDriver: CheckoutDriver = {
      host: 'fixture.booking.test',
      async run() { return { kind: 'unknown' }; },
    };
    const liveOptions = baseOptions(directory);
    liveOptions.env = { ...liveOptions.env, BOOKING_MODE: 'live' };
    assert.throws(() => createProductionPart4({
      ...liveOptions,
      allowedMerchantHosts: new Set(['fixture.booking.test']),
      drivers: new Map([['fixture.booking.test', fixtureDriver]]),
    }), /cannot be configured in live mode/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
