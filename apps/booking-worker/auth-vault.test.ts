import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AuthVault, AuthVaultError } from './auth-vault.ts';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'auth-vault-test-'));
}

const keyHex = randomBytes(32).toString('hex');
const userDirectory = (root: string, user: string) => join(root, createHash('sha256').update(user).digest('hex'));

test('encrypts and restores the auth file and pending device-auth sidecars, then removes plaintext temp files', async () => {
  const root = await tempRoot();
  const vaultDirectory = join(root, 'vault');
  const vault = new AuthVault({ directory: vaultDirectory, keyHex, tempDirectory: root });
  let temporaryDirectory = '';
  try {
    await vault.run('buyer-a', async (authFile) => {
      temporaryDirectory = dirname(authFile);
      await writeFile(authFile, JSON.stringify({ access_token: 'private-token-a' }), { mode: 0o600 });
      await writeFile(join(temporaryDirectory, 'pending-device-auth.json'), JSON.stringify({ device_code: 'device-secret-a' }), { mode: 0o600 });
    });
    await assert.rejects(access(temporaryDirectory));
    const snapshotPath = join(userDirectory(vaultDirectory, 'buyer-a'), 'snapshot.vault');
    const encrypted = await readFile(snapshotPath);
    assert.equal(encrypted.includes(Buffer.from('private-token-a')), false);
    assert.equal(encrypted.includes(Buffer.from('device-secret-a')), false);

    await vault.run('buyer-a', async (authFile) => {
      const directory = dirname(authFile);
      assert.deepEqual(JSON.parse(await readFile(authFile, 'utf8')), { access_token: 'private-token-a' });
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'pending-device-auth.json'), 'utf8')), { device_code: 'device-secret-a' });
      temporaryDirectory = directory;
    });
    await assert.rejects(access(temporaryDirectory));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('per-user encrypted snapshots are isolated', async () => {
  const root = await tempRoot();
  const vaultDirectory = join(root, 'vault');
  const vault = new AuthVault({ directory: vaultDirectory, keyHex, tempDirectory: root });
  try {
    await vault.run('buyer-a', (authFile) => writeFile(authFile, 'buyer-a-token'));
    await vault.run('buyer-b', async (authFile) => {
      await assert.rejects(access(authFile));
      await writeFile(authFile, 'buyer-b-token');
    });
    await vault.run('buyer-a', async (authFile) => {
      assert.equal(await readFile(authFile, 'utf8'), 'buyer-a-token');
    });
    assert.notEqual(userDirectory(vaultDirectory, 'buyer-a'), userDirectory(vaultDirectory, 'buyer-b'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tampering with an encrypted snapshot fails before invoking the callback', async () => {
  const root = await tempRoot();
  const vaultDirectory = join(root, 'vault');
  const vault = new AuthVault({ directory: vaultDirectory, keyHex, tempDirectory: root });
  try {
    await vault.run('buyer-a', (authFile) => writeFile(authFile, 'buyer-a-token'));
    const path = join(userDirectory(vaultDirectory, 'buyer-a'), 'snapshot.vault');
    const bytes = await readFile(path);
    bytes[bytes.length - 3] ^= 0x01;
    await writeFile(path, bytes, { mode: 0o600 });
    let called = false;
    await assert.rejects(vault.run('buyer-a', async () => { called = true; }), (error: unknown) => {
      assert.ok(error instanceof AuthVaultError);
      assert.equal(error.code, 'CORRUPT');
      return true;
    });
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('same-user operations serialize and the later callback sees the prior CLI update', async () => {
  const root = await tempRoot();
  const vault = new AuthVault({ directory: join(root, 'vault'), keyHex, tempDirectory: root });
  let enteredFirst!: () => void;
  let releaseFirst!: () => void;
  const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const events: string[] = [];
  try {
    const first = vault.run('buyer-a', async (authFile) => {
      events.push('first:start');
      enteredFirst();
      await firstGate;
      await writeFile(authFile, 'first-update');
      events.push('first:end');
    });
    await firstEntered;
    const second = vault.run('buyer-a', async (authFile) => {
      events.push('second:start');
      assert.equal(await readFile(authFile, 'utf8'), 'first-update');
      await writeFile(authFile, 'second-update');
      events.push('second:end');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  } finally {
    releaseFirst();
    await rm(root, { recursive: true, force: true });
  }
});

test('missing encryption key fails closed without creating a plaintext session', async () => {
  const root = await tempRoot();
  const vaultDirectory = join(root, 'vault');
  const vault = new AuthVault({ directory: vaultDirectory, tempDirectory: root });
  try {
    await assert.rejects(vault.run('buyer-a', async () => undefined), (error: unknown) => {
      assert.ok(error instanceof AuthVaultError);
      assert.equal(error.code, 'UNAVAILABLE');
      return true;
    });
    await assert.rejects(access(vaultDirectory));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
