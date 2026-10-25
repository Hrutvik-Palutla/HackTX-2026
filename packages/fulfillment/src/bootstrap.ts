import { isAbsolute, resolve } from 'node:path';
import type { ActorContext, BookingQuote, BookingResult, BuyerAuthorization, Mode } from './types.ts';
import { FulfillmentError } from './errors.ts';
import { quoteBinding, validateQuote } from './quote.ts';
import type { FulfillmentRepository } from './repository.ts';
import { FulfillmentService, type FulfillmentOptions, type SelectedPlan } from './service.ts';
import { walletAuthorizationStore } from './wallet-store.ts';
import type { Part4Runtime as Part4RuntimeType } from './http.ts';
import { AuthVault } from '../../../apps/booking-worker/auth-vault.ts';
import { BookingWorker, OwnedTestCheckoutDriver, type CheckoutDriver } from '../../../apps/booking-worker/worker.ts';
import { LinkWalletAdapter, type LinkExecutor } from '../../integrations/link-wallet.ts';

export type ProductionPart4Options = {
  repository: FulfillmentRepository;
  loadPlan(actor: ActorContext, planId: string): Promise<SelectedPlan | null>;
  authenticate: Part4RuntimeType['authenticate'];
  authorizeMutation: Part4RuntimeType['authorizeMutation'];
  /** Exact merchant hosts only; no wildcard entries. */
  allowedMerchantHosts: ReadonlySet<string>;
  /** Authoritative merchant quote integration. Omit to keep checkout on handoff. */
  quoteProvider?: FulfillmentOptions['quote'];
  /** Authoritative read-only purchase status lookup; never resubmits checkout. */
  reconcile?: FulfillmentOptions['reconcile'];
  /** Only explicitly configured drivers are used for real merchants. */
  drivers?: ReadonlyMap<string, CheckoutDriver>;
  fillPaymentCredential?: (driver: CheckoutDriver, privateCredentialFile: string, signal: AbortSignal) => Promise<void>;
  mode?: Mode;
  env?: NodeJS.ProcessEnv;
  authDirectory?: string;
  authTempDirectory?: string;
  executable?: string;
  execute?: LinkExecutor;
  driverTimeoutMs?: number;
  now?: () => Date;
};

export type ProductionPart4 = {
  mode: Mode;
  service: FulfillmentService;
  runtime: Part4RuntimeType;
  wallet: LinkWalletAdapter;
  worker: BookingWorker;
  authVault: AuthVault;
};

function modeFrom(options: ProductionPart4Options, env: NodeJS.ProcessEnv): Mode {
  const configured = options.mode ?? env.BOOKING_MODE;
  if (configured === undefined || configured === '') return 'test';
  if (configured === 'test' || configured === 'live') return configured;
  throw new FulfillmentError('CONFIG', 'BOOKING_MODE must be test or live.', 500);
}

function exactHosts(input: ReadonlySet<string>): Set<string> {
  if (input.size === 0) {
    throw new FulfillmentError('CONFIG', 'Configure at least one exact booking merchant host.', 500);
  }
  const hosts = new Set<string>();
  for (const value of input) {
    const host = value.toLowerCase();
    if (host.length > 253 || host.startsWith('*.') || host.includes('*') ||
      host.endsWith('.') || host.includes('://') || host.includes('/') || host.includes(':') ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
      throw new FulfillmentError('CONFIG', 'Merchant allowlist entries must be lowercase exact hostnames.', 500);
    }
    hosts.add(host);
  }
  return hosts;
}

function absolutePath(value: string | undefined, label: string): string {
  if (!value || !isAbsolute(value)) throw new FulfillmentError('CONFIG', `${label} must be configured as an absolute path.`, 500);
  return resolve(value);
}

function cliPath(options: ProductionPart4Options, env: NodeJS.ProcessEnv): string {
  const value = options.executable ?? env.LINK_CLI_PATH;
  return absolutePath(value, 'LINK_CLI_PATH');
}

/**
 * Compose Part 4 around injected application-owned auth, membership, persistence,
 * quote, and merchant-driver ports. No shared auth or database implementation is assumed.
 */
export function createProductionPart4(options: ProductionPart4Options): ProductionPart4 {
  const env = options.env ?? process.env;
  const mode = modeFrom(options, env);
  const now = options.now ?? (() => new Date());
  const hosts = exactHosts(options.allowedMerchantHosts);
  const authDirectory = absolutePath(options.authDirectory ?? env.LINK_AUTH_DIRECTORY, 'LINK_AUTH_DIRECTORY');
  const vault = new AuthVault({
    directory: authDirectory,
    tempDirectory: options.authTempDirectory,
    keyHex: env.LINK_AUTH_ENCRYPTION_KEY,
  });
  const executable = cliPath(options, env);
  const store = walletAuthorizationStore(options.repository, options.now);
  const walletHosts = new Set(hosts);
  if (mode === 'test') walletHosts.add('fixture.booking.test');
  const wallet = new LinkWalletAdapter({
    authDirectory,
    executable,
    mode,
    allowedMerchantHosts: walletHosts,
    loadQuote: async (quoteId) => options.repository.read((state) => state.quotes[quoteId]?.quote ?? null),
    store,
    sessionVault: vault,
    ...(options.execute ? { execute: options.execute } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  const drivers = new Map<string, CheckoutDriver>();
  for (const [rawHost, driver] of options.drivers ?? []) {
    const host = rawHost.toLowerCase();
    if (!hosts.has(host) || driver.host.toLowerCase() !== host) {
      throw new FulfillmentError('CONFIG', 'Each booking driver must match one exact allowlisted merchant host.', 500);
    }
    if (mode === 'live' && (host === 'fixture.booking.test' || driver instanceof OwnedTestCheckoutDriver)) {
      throw new FulfillmentError('CONFIG', 'The owned fake-money checkout fixture cannot be configured in live mode.', 500);
    }
    drivers.set(host, driver);
  }
  const workerHosts = new Set(hosts);
  if (mode === 'test') workerHosts.add('fixture.booking.test');

  const worker = new BookingWorker({
    mode,
    allowedHosts: workerHosts,
    drivers,
    verifyQuoteBinding: async (quote) => {
      try { validateQuote(quote, now()); }
      catch { return false; }
      const saved = await options.repository.read((state) => state.quotes[quote.id]?.quote ?? null);
      return Boolean(saved && saved.id === quote.id && saved.bindingHash === quote.bindingHash &&
        quoteBinding(saved) === quoteBinding(quote));
    },
    withCredential: (authorizationId, use) => wallet.withApprovedCredential(authorizationId, async (file) => {
      const outcome = await use(file);
      // This bridge is intentionally typed by the worker callback; data never leaves its private file.
      return outcome;
    }),
    ...(options.fillPaymentCredential ? { fillPaymentCredential: options.fillPaymentCredential } : {}),
    ...(options.driverTimeoutMs === undefined ? {} : { driverTimeoutMs: options.driverTimeoutMs }),
    ...(options.now ? { now: options.now } : {}),
  });

  const quote = options.quoteProvider ?? (async (_plan: SelectedPlan): Promise<BookingQuote> => {
    throw new FulfillmentError('HANDOFF_REQUIRED', 'Direct booking is not configured for this deployment. Use merchant checkout handoff.', 409);
  });
  const service = new FulfillmentService({
    repository: options.repository,
    loadPlan: options.loadPlan,
    wallet,
    quote,
    submit: async ({ quote: savedQuote, authorization }): Promise<BookingResult> => worker.submit({ quote: savedQuote, authorization }),
    ...(options.reconcile ? { reconcile: options.reconcile } : {}),
    now,
  });
  const runtime: Part4RuntimeType = {
    service,
    authenticate: options.authenticate,
    authorizeMutation: options.authorizeMutation,
  };
  return { mode, service, runtime, wallet, worker, authVault: vault };
}
