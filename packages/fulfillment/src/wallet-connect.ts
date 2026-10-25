import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthVault } from '../../../apps/booking-worker/auth-vault.ts';
import { LinkWalletAdapter, type LinkExecutor } from '../../integrations/link-wallet.ts';
import type { Id } from './types.ts';

const LOCAL_USER_ID = 'local-buyer';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');

export type WalletConnectAction = 'connect' | 'status';
export type WalletConnectResult =
  | { action: 'connect'; url: string; phrase?: string; connectionId: Id }
  | { action: 'status'; status: 'pending' | 'connected' | 'not_connected' };

export type WalletConnectOptions = {
  env?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
  authDirectory?: string;
  executable?: string;
  tempDirectory?: string;
  execute?: LinkExecutor;
};

function parseArguments(args: readonly string[]): { action: WalletConnectAction; userId: Id } {
  const [action, userId = LOCAL_USER_ID, ...extra] = args;
  if ((action !== 'connect' && action !== 'status') || extra.length > 0 || !userId.trim() || userId.length > 256) {
    throw new Error('Usage: node wallet-connect.ts <connect|status> [user-id]');
  }
  return { action, userId };
}

function configuredPath(value: string, root: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function cliExecutable(env: NodeJS.ProcessEnv, root: string, override?: string): string {
  const configured = override ?? env.LINK_CLI_PATH;
  const executable = configured
    ? configuredPath(configured, root)
    : join(root, 'apps/booking-worker/node_modules/.bin/link-cli');
  return executable;
}

/**
 * Local operator-only Link device connection and status. This intentionally has no
 * quote or purchase path; all durable CLI auth artifacts pass through AuthVault.
 */
export async function runWalletConnect(
  args: readonly string[],
  options: WalletConnectOptions = {},
): Promise<WalletConnectResult> {
  const { action, userId } = parseArguments(args);
  const env = options.env ?? process.env;
  const root = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const authDirectory = configuredPath(options.authDirectory ?? env.LINK_AUTH_DIRECTORY ?? '.part4-data/link-auth', root);
  const executable = cliExecutable(env, root, options.executable);

  if (!env.LINK_AUTH_ENCRYPTION_KEY) {
    throw new Error('Configure LINK_AUTH_ENCRYPTION_KEY in the ignored local environment before connecting a wallet.');
  }
  if (!options.execute) {
    try {
      await access(executable, constants.X_OK);
      const info = await stat(executable);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`Link CLI executable is unavailable at ${executable}. Install @stripe/link-cli or set LINK_CLI_PATH.`);
    }
  }

  const sessionVault = new AuthVault({
    directory: authDirectory,
    keyHex: env.LINK_AUTH_ENCRYPTION_KEY,
    ...(options.tempDirectory ? { tempDirectory: options.tempDirectory } : {}),
  });
  const adapter = new LinkWalletAdapter({
    authDirectory,
    executable,
    // This local utility can only start/check device auth. No quote can be loaded,
    // and the fixed host is a test-only constructor value, never a purchase target.
    mode: 'test',
    allowedMerchantHosts: new Set(['fixture.booking.test']),
    loadQuote: async () => null,
    store: {
      async save() { throw new Error('Wallet purchase authorization is unavailable in this local command.'); },
      async get() { return null; },
    },
    sessionVault,
    ...(options.execute ? { execute: options.execute } : {}),
  });

  if (action === 'connect') {
    const result = await adapter.startConnect(userId);
    return {
      action,
      url: result.url,
      ...(result.phrase ? { phrase: result.phrase } : {}),
      connectionId: result.connectionId,
    };
  }
  return { action, status: await adapter.checkConnection(userId) };
}

function isDirectExecution(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_PATH;
}

if (isDirectExecution()) {
  try {
    const result = await runWalletConnect(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wallet connection command failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
