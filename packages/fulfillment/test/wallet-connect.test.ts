import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWalletConnect } from '../src/wallet-connect.ts';
import type { LinkCommand } from '../../integrations/link-wallet.ts';

test('local wallet CLI exposes only device connect and status through encrypted sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wallet-connect-cli-'));
  const key = createHash('sha256').update('wallet-connect-test').digest('hex');
  const calls: LinkCommand[] = [];
  let connected = false;
  try {
    const env: NodeJS.ProcessEnv = { LINK_AUTH_ENCRYPTION_KEY: key };
    const execute = async (input: LinkCommand) => {
      calls.push(input);
      const authPath = input.args[input.args.indexOf('--auth') + 1];
      if (input.args[0] === 'auth' && input.args[1] === 'login') {
        await writeFile(authPath, '{"opaque":"device-session"}', { mode: 0o600 });
        return { stdout: JSON.stringify([{
          verification_url: 'https://app.link.com/verify/local-test',
          phrase: 'TEST PHRASE',
          _next: { command: 'auth status --interval 5 --max-attempts 60' },
        }]), stderr: '' };
      }
      if (input.args[0] === 'auth' && input.args[1] === 'status') {
        return { stdout: JSON.stringify([connected ? { authenticated: true } : { authenticated: false, pending: true }]), stderr: '' };
      }
      throw new Error('Unexpected mock invocation.');
    };

    const connectedResult = await runWalletConnect(['connect'], {
      repositoryRoot: root,
      authDirectory: join(root, 'encrypted-auth'),
      executable: process.execPath,
      tempDirectory: root,
      env,
      execute,
    });
    assert.deepEqual(connectedResult, {
      action: 'connect', url: 'https://app.link.com/verify/local-test', phrase: 'TEST PHRASE',
      connectionId: createHash('sha256').update('local-buyer').digest('hex'),
    });
    assert.deepEqual(await runWalletConnect(['status'], {
      repositoryRoot: root,
      authDirectory: join(root, 'encrypted-auth'),
      executable: process.execPath,
      tempDirectory: root,
      env,
      execute,
    }), { action: 'status', status: 'pending' });
    assert.deepEqual(await runWalletConnect(['status', 'operator-2'], {
      repositoryRoot: root,
      authDirectory: join(root, 'encrypted-auth'),
      executable: process.execPath,
      tempDirectory: root,
      env,
      execute,
    }), { action: 'status', status: 'pending' });
    connected = true;
    assert.deepEqual(await runWalletConnect(['status'], {
      repositoryRoot: root,
      authDirectory: join(root, 'encrypted-auth'),
      executable: process.execPath,
      tempDirectory: root,
      env,
      execute,
    }), { action: 'status', status: 'connected' });

    assert.ok(calls.every((call) => call.args[0] === 'auth'));
    const localBuyerDir = join(root, 'encrypted-auth', createHash('sha256').update('local-buyer').digest('hex'));
    const artifact = await readFile(join(localBuyerDir, 'snapshot.vault'), 'utf8');
    assert.equal(artifact.includes('device-session'), false);
    assert.deepEqual(await readdir(localBuyerDir), ['snapshot.vault']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local wallet CLI rejects spend and malformed commands and fails closed without its key', async () => {
  let invoked = false;
  const execute = async () => {
    invoked = true;
    return { stdout: '{}', stderr: '' };
  };
  await assert.rejects(runWalletConnect(['spend'], { env: {}, execute }), /Usage:/);
  await assert.rejects(runWalletConnect(['connect'], { env: {}, execute }), /LINK_AUTH_ENCRYPTION_KEY/);
  await assert.rejects(runWalletConnect(['status', 'user', 'extra'], { env: {}, execute }), /Usage:/);
  assert.equal(invoked, false);
});
