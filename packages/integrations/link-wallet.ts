import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { BookingQuote, BuyerAuthorization, Id } from '../fulfillment/src/types.ts';

const execFile = promisify(nodeExecFile);

export type LinkCommand = { command: string; args: string[]; timeoutMs?: number };
export type LinkCommandResult = { stdout: string; stderr: string };
export type LinkExecutor = (command: LinkCommand) => Promise<LinkCommandResult>;

export interface LinkSessionVault {
  run<T>(userKey: Id, callback: (authFile: string) => Promise<T>): Promise<T>;
}

export interface WalletAuthorizationStore {
  save(record: {
    authorizationId: Id;
    buyerUserId: Id;
    quoteId: Id;
    quoteBindingHash: string;
    walletRequestId: string;
    mode: 'test' | 'live';
  }): Promise<void>;
  get(authorizationId: Id): Promise<{
    authorizationId: Id;
    buyerUserId: Id;
    quoteId: Id;
    quoteBindingHash: string;
    walletRequestId: string;
    mode: 'test' | 'live';
    checkedAt: string;
  } | null>;
}

export interface LinkWalletOptions {
  /** Absolute, private directory on encrypted storage. Auth files are separated per app user. */
  authDirectory: string;
  /** Link CLI executable, normally `link-cli`; invoked with execFile and fixed argv. */
  executable?: string;
  mode: 'test' | 'live';
  allowedMerchantHosts: ReadonlySet<string>;
  loadQuote(quoteId: Id): Promise<BookingQuote | null>;
  store: WalletAuthorizationStore;
  /** Production should always supply an encrypted per-user session vault. */
  sessionVault?: LinkSessionVault;
  execute?: LinkExecutor;
  now?: () => Date;
}

export class LinkWalletError extends Error {
  readonly code: 'CONFIG' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NOT_FOUND' | 'QUOTE_INVALID';
  constructor(message: string, code: 'CONFIG' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NOT_FOUND' | 'QUOTE_INVALID') {
    super(message);
    this.name = 'LinkWalletError';
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function parseJson(stdout: string, operation: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(stdout);
    // Link CLI v0.30 emits async command results as a JSON array, even when the
    // command yielded only one object. Polling commands may emit several; their
    // final object is the most recent authoritative state.
    if (Array.isArray(parsed) && parsed.length > 0) {
      const entries = parsed.map(object);
      if (entries.every((entry) => entry !== null)) return entries[entries.length - 1]!;
    }
    const result = object(parsed);
    if (result) return result;
  } catch {
    // Error output is deliberately omitted: some future CLI commands may include sensitive context.
  }
  throw new LinkWalletError(`Link CLI returned an unreadable ${operation} response.`, 'INVALID_RESPONSE');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validLinkUrl(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['app.link.com', 'link.com'].includes(url.hostname) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validId(value: unknown): string | null {
  const result = text(value);
  return result && /^[A-Za-z0-9_-]{3,128}$/.test(result) ? result : null;
}

function mapWalletStatus(status: unknown): BuyerAuthorization['status'] {
  switch (status) {
    case 'approved': return 'approved';
    case 'rejected':
    case 'denied':
    case 'failed': return 'rejected';
    case 'expired': return 'expired';
    case 'canceled':
    case 'cancelled': return 'canceled';
    default: return 'pending';
  }
}

function spendModeContradicts(data: JsonObject, mode: 'test' | 'live'): boolean {
  if (typeof data.test === 'boolean' && data.test !== (mode === 'test')) return true;
  if (typeof data.test_mode === 'boolean' && data.test_mode !== (mode === 'test')) return true;
  if (typeof data.livemode === 'boolean' && data.livemode !== (mode === 'live')) return true;
  const metadataMode = object(data.metadata)?.mode;
  return typeof metadataMode === 'string' && metadataMode !== mode;
}

/** Production executor: no shell, bounded output, generic errors that never echo CLI output. */
export const executeLinkCli: LinkExecutor = async ({ command, args, timeoutMs = 15_000 }) => {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_UPDATE_NOTIFIER: '1' };
    // These variables override per-user auth files or redirect Link requests.
    delete env.LINK_ACCESS_TOKEN;
    delete env.LINK_REFRESH_TOKEN;
    delete env.LINK_AUTH_FILE;
    delete env.LINK_API_BASE_URL;
    delete env.LINK_AUTH_BASE_URL;
    const result = await execFile(command, args, {
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      env,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const code = object(error)?.code;
    if (code === 'ENOENT') throw new LinkWalletError('Link Agent Wallet CLI is unavailable; install the official @stripe/link-cli package.', 'UNAVAILABLE');
    // Do not expose stderr/stdout or the original error, which could contain private data.
    throw new LinkWalletError('Link Agent Wallet CLI operation failed. Check the server-side CLI installation and account setup.', 'UNAVAILABLE');
  }
};

export class LinkWalletAdapter {
  private readonly execute: LinkExecutor;
  private readonly executable: string;
  private readonly authDirectory: string;
  private readonly now: () => Date;
  private readonly options: LinkWalletOptions;

  constructor(options: LinkWalletOptions) {
    this.options = options;
    if (!isAbsolute(options.authDirectory)) throw new LinkWalletError('LINK_AUTH_DIRECTORY must be an absolute path.', 'CONFIG');
    if (options.allowedMerchantHosts.size === 0) throw new LinkWalletError('At least one exact merchant host must be configured.', 'CONFIG');
    this.authDirectory = resolve(options.authDirectory);
    this.executable = options.executable ?? 'link-cli';
    this.execute = options.execute ?? executeLinkCli;
    this.now = options.now ?? (() => new Date());
  }

  /** Starts Link's official device authorization flow for this account's private auth file. */
  async startConnect(userId: Id): Promise<{ url: string; phrase?: string; connectionId: Id }> {
    return this.withAuthFile(userId, (authFile) => this.startConnectWithAuthFile(userId, authFile));
  }

  private async startConnectWithAuthFile(userId: Id, authFile: string): Promise<{ url: string; phrase?: string; connectionId: Id }> {
    const existing = await this.readAuthStatus(authFile);
    const connectionId = createHash('sha256').update(userId).digest('hex');
    if (existing?.authenticated === true) throw new LinkWalletError('This buyer already has a connected Link wallet.', 'QUOTE_INVALID');
    const existingUrl = existing?.pending === true
      ? validLinkUrl(existing.verification_url ?? existing.verification_uri)
      : null;
    if (existingUrl) {
      const phrase = text(existing?.phrase) ?? undefined;
      return { url: existingUrl, ...(phrase ? { phrase } : {}), connectionId };
    }
    const result = await this.call(['auth', 'login', '--client-name', 'HackTX Group Planner', '--auth', authFile, '--format', 'json'], 30_000);
    const data = parseJson(result.stdout, 'auth login');
    const next = object(data._next);
    if (next?.command !== 'auth status --interval 5 --max-attempts 60') {
      throw new LinkWalletError('Link CLI did not return the documented resumable auth polling action.', 'INVALID_RESPONSE');
    }
    const url = validLinkUrl(data.verification_url ?? data.verification_uri ?? data.verificationUrl);
    if (!url) throw new LinkWalletError('Link CLI did not return a supported verification URL.', 'INVALID_RESPONSE');
    const phrase = text(data.phrase ?? data.user_code ?? data.userCode) ?? undefined;
    // The CLI persisted pending device-auth state in the per-user auth file. Start one
    // bounded poll now; later checkConnection calls resume from that same file.
    await this.readAuthStatus(authFile, true);
    return { url, ...(phrase ? { phrase } : {}), connectionId };
  }

  /** Reads authoritative per-user CLI auth state. A browser return alone is never enough. */
  async checkConnection(userId: Id): Promise<'pending' | 'connected' | 'not_connected'> {
    return this.withAuthFile(userId, (authFile) => this.checkConnectionWithAuthFile(authFile));
  }

  private async checkConnectionWithAuthFile(authFile: string): Promise<'pending' | 'connected' | 'not_connected'> {
    const data = await this.readAuthStatus(authFile, true);
    if (!data) return 'pending';
    if (data.authenticated === true) return 'connected';
    if (data.pending === true) return 'pending';
    if (data.authenticated === false) return 'not_connected';
    return 'pending';
  }

  private async readAuthStatus(authFile: string, poll = false): Promise<JsonObject | null> {
    try {
      const file = await stat(authFile);
      if (!file.isFile() || (file.mode & 0o077) !== 0) {
        throw new LinkWalletError('Link auth file permissions are not private.', 'CONFIG');
      }
    } catch (error) {
      if (error instanceof LinkWalletError) throw error;
      if (object(error)?.code === 'ENOENT') return null;
      throw error;
    }
    const args = ['auth', 'status', '--auth', authFile, '--format', 'json'];
    if (poll) args.push('--interval', '1', '--max-attempts', '1');
    const result = await this.call(args, poll ? 5_000 : 15_000);
    return parseJson(result.stdout, 'auth status');
  }

  /** Creates a one-time spend request with an explicit buyer approval prompt. */
  async requestPurchaseApproval(quoteId: Id): Promise<{ authorizationId: Id; approvalUrl: string }> {
    const quote = await this.options.loadQuote(quoteId);
    if (!quote || quote.id !== quoteId) throw new LinkWalletError('The quote could not be found.', 'NOT_FOUND');
    this.validateQuote(quote);
    return this.withAuthFile(quote.buyerUserId, (authFile) => this.requestPurchaseApprovalWithAuthFile(quote, authFile));
  }

  private async requestPurchaseApprovalWithAuthFile(quote: BookingQuote, authFile: string): Promise<{ authorizationId: Id; approvalUrl: string }> {
    if (await this.checkConnectionWithAuthFile(authFile) !== 'connected') throw new LinkWalletError('The nominated buyer must connect their own Link wallet first.', 'QUOTE_INVALID');
    const merchantUrl = new URL(quote.merchantUrl);
    const context = `The buyer authorized a request to purchase ${quote.attendeeUserIds.length} ticket(s) for the selected event from ${quote.merchantHost}. This request is limited to quote ${quote.id}, binding ${quote.bindingHash}, with a total of ${quote.total.amountMinor} ${quote.total.currency} minor units. Any changed seats, attendees, merchant, or total requires a new quote and approval.`;
    const args = [
      'spend-request', 'create', '--auth', authFile, '--format', 'json',
      '--merchant-name', merchantUrl.hostname,
      '--merchant-url', quote.merchantUrl,
      '--context', context,
      '--amount', String(quote.total.amountMinor),
      '--currency', quote.total.currency.toLowerCase(),
      '--request-approval',
      '--metadata', `quote_id:${quote.id}`,
      '--metadata', `binding_hash:${quote.bindingHash}`,
      '--metadata', `mode:${this.options.mode}`,
      ...(this.options.mode === 'test' ? ['--test'] : []),
    ];
    for (const item of quote.lineItems) {
      args.push('--line-item', `name:${item.label},unit_amount:${item.amount.amountMinor},quantity:1`);
    }
    args.push('--total', `type:total,display_text:Total,amount:${quote.total.amountMinor}`);

    const result = await this.call(args, 30_000);
    const data = parseJson(result.stdout, 'spend request creation');
    const walletRequestId = validId(data.id);
    const actionDetails = object(object(object(data.status_details)?.requires_action)?.next_action);
    const approvalUrl = validLinkUrl(data.approval_url ?? data.approvalUrl ?? actionDetails?.action_url);
    if (!walletRequestId || !approvalUrl) throw new LinkWalletError('Link CLI did not return a valid spend request and approval URL.', 'INVALID_RESPONSE');
    this.assertSpendMatchesQuote(data, quote);
    if (spendModeContradicts(data, this.options.mode)) {
      throw new LinkWalletError('Link spend request mode contradicts the mode used at creation.', 'QUOTE_INVALID');
    }
    const authorizationId = randomUUID();
    await this.options.store.save({
      authorizationId,
      buyerUserId: quote.buyerUserId,
      quoteId: quote.id,
      quoteBindingHash: quote.bindingHash,
      walletRequestId,
      mode: this.options.mode,
    });
    return { authorizationId, approvalUrl };
  }

  /** Retrieves status without requesting credentials. Only Link's returned status can approve. */
  async refreshAuthorization(authorizationId: Id): Promise<BuyerAuthorization> {
    const record = await this.options.store.get(authorizationId);
    if (!record) throw new LinkWalletError('Wallet authorization could not be found.', 'NOT_FOUND');
    return this.withAuthFile(record.buyerUserId, (authFile) => this.refreshAuthorizationWithAuthFile(record, authFile));
  }

  private async refreshAuthorizationWithAuthFile(
    record: NonNullable<Awaited<ReturnType<WalletAuthorizationStore['get']>>>,
    authFile: string,
  ): Promise<BuyerAuthorization> {
    const quote = await this.options.loadQuote(record.quoteId);
    if (!quote || quote.bindingHash !== record.quoteBindingHash || quote.buyerUserId !== record.buyerUserId) {
      throw new LinkWalletError('Quote changed after wallet authorization; a new approval is required.', 'QUOTE_INVALID');
    }
    const result = await this.call(['spend-request', 'retrieve', record.walletRequestId, '--auth', authFile, '--format', 'json']);
    const data = parseJson(result.stdout, 'spend request status');
    if (validId(data.id) !== record.walletRequestId) throw new LinkWalletError('Link CLI returned a different spend request.', 'INVALID_RESPONSE');
    this.assertSpendMatchesQuote(data, quote);
    if (record.mode !== quote.mode || spendModeContradicts(data, record.mode)) throw new LinkWalletError('Link spend request mode does not match the saved quote.', 'QUOTE_INVALID');
    const status = mapWalletStatus(data.status);
    return {
      id: record.authorizationId,
      quoteId: record.quoteId,
      buyerUserId: record.buyerUserId,
      walletRequestId: record.walletRequestId,
      status,
      approvedBindingHash: status === 'approved' ? record.quoteBindingHash : null,
      checkedAt: this.now().toISOString(),
      mode: record.mode,
    };
  }

  /**
   * Materializes a Link-issued card only inside a private one-use file and passes its path
   * to a trusted payment-fill callback. The card JSON is never parsed, returned, or logged.
   * This is intentionally not part of WalletPort or any model-visible tool.
   */
  async withApprovedCredential<T>(authorizationId: Id, consume: (privateCredentialFile: string) => Promise<T>): Promise<T> {
    const record = await this.options.store.get(authorizationId);
    if (!record) throw new LinkWalletError('Wallet authorization could not be found.', 'NOT_FOUND');
    return this.withAuthFile(record.buyerUserId, async (authFile) => {
      const authorization = await this.refreshAuthorizationWithAuthFile(record, authFile);
      if (authorization.status !== 'approved' || !authorization.approvedBindingHash) {
        throw new LinkWalletError('The buyer has not approved this purchase.', 'QUOTE_INVALID');
      }
      const dir = await mkdtemp(join(dirname(authFile), 'credential-'));
      await chmod(dir, 0o700);
      const credentialPath = join(dir, 'link-card.json');
      try {
        const result = await this.call([
          'spend-request', 'retrieve', record.walletRequestId,
          '--auth', authFile,
          '--include', 'card', '--output-file', credentialPath, '--format', 'json',
        ]);
        const response = parseJson(result.stdout, 'credential retrieval');
        if (validId(response.id) !== record.walletRequestId || mapWalletStatus(response.status) !== 'approved') {
          throw new LinkWalletError('Link no longer reports this spend request as approved.', 'QUOTE_INVALID');
        }
        const quote = await this.options.loadQuote(record.quoteId);
        if (!quote || quote.bindingHash !== record.quoteBindingHash) throw new LinkWalletError('Quote changed after wallet authorization.', 'QUOTE_INVALID');
        this.assertSpendMatchesQuote(response, quote);
        if (record.mode !== quote.mode || spendModeContradicts(response, record.mode)) throw new LinkWalletError('Link credential mode does not match the saved quote.', 'QUOTE_INVALID');
        const outputPath = text(response.card_output_file);
        if (outputPath !== credentialPath) throw new LinkWalletError('Link CLI did not write credentials to the expected private file.', 'INVALID_RESPONSE');
        const file = await stat(credentialPath);
        if (!file.isFile() || (file.mode & 0o077) !== 0) throw new LinkWalletError('Link CLI credential file permissions are not private.', 'CONFIG');
        return await consume(credentialPath);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  private async withAuthFile<T>(userId: Id, callback: (authFile: string) => Promise<T>): Promise<T> {
    if (this.options.sessionVault) return this.options.sessionVault.run(userId, callback);
    return callback(await this.authFile(userId));
  }

  private assertSpendMatchesQuote(data: JsonObject, quote: BookingQuote): void {
    const metadata = object(data.metadata);
    const amountMatches = typeof data.amount === 'number' && Number.isSafeInteger(data.amount) && data.amount === quote.total.amountMinor;
    const currencyMatches = typeof data.currency === 'string' && data.currency.toUpperCase() === quote.total.currency;
    const merchantUrl = text(data.merchant_url);
    const merchantName = text(data.merchant_name);
    const quoteMatches = metadata?.quote_id === quote.id && metadata?.binding_hash === quote.bindingHash;
    let host: string;
    try { host = new URL(quote.merchantUrl).hostname; } catch {
      throw new LinkWalletError('Saved quote merchant URL is invalid.', 'QUOTE_INVALID');
    }
    if (!amountMatches || !currencyMatches || merchantUrl !== quote.merchantUrl || merchantName?.toLowerCase() !== host.toLowerCase() || !quoteMatches) {
      throw new LinkWalletError('Link spend request amount, currency, merchant, or quote binding does not match the saved quote.', 'QUOTE_INVALID');
    }
  }

  private validateQuote(quote: BookingQuote): void {
    if (quote.mode !== this.options.mode) throw new LinkWalletError('Wallet mode does not match the quote mode.', 'QUOTE_INVALID');
    if (quote.total.currency !== 'USD' || !Number.isSafeInteger(quote.total.amountMinor) || quote.total.amountMinor <= 0 || quote.total.amountMinor > 50_000) {
      throw new LinkWalletError('Link card spend requests currently require a supported amount of 1 to 50,000 USD cents.', 'QUOTE_INVALID');
    }
    const expiresAt = Date.parse(quote.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) throw new LinkWalletError('The quote has expired or has an invalid expiry.', 'QUOTE_INVALID');
    if (!quote.bindingHash || quote.attendeeUserIds.length === 0 || quote.attendeeUserIds.length !== quote.lineItems.length ||
      new Set(quote.attendeeUserIds).size !== quote.attendeeUserIds.length) {
      throw new LinkWalletError('The quote is missing its binding or attendee line items.', 'QUOTE_INVALID');
    }
    const attendees = new Set(quote.attendeeUserIds);
    let itemTotal = 0;
    for (const item of quote.lineItems) {
      if (!attendees.has(item.attendeeUserId) || !Number.isSafeInteger(item.amount.amountMinor) || item.amount.amountMinor < 0 ||
        item.amount.currency !== quote.total.currency || !item.label.trim() || /[:,\r\n]/.test(item.label)) {
        throw new LinkWalletError('The quote contains an invalid ticket line item.', 'QUOTE_INVALID');
      }
      itemTotal += item.amount.amountMinor;
    }
    if (new Set(quote.lineItems.map((item) => item.attendeeUserId)).size !== attendees.size ||
      quote.sharedFees.currency !== 'USD' || quote.sharedDiscount.currency !== 'USD' ||
      !Number.isSafeInteger(quote.sharedFees.amountMinor) || quote.sharedFees.amountMinor < 0 ||
      !Number.isSafeInteger(quote.sharedDiscount.amountMinor) || quote.sharedDiscount.amountMinor < 0 ||
      itemTotal + quote.sharedFees.amountMinor - quote.sharedDiscount.amountMinor !== quote.total.amountMinor) {
      throw new LinkWalletError('The quote line items do not reconcile to its exact total.', 'QUOTE_INVALID');
    }
    let parsed: URL;
    try { parsed = new URL(quote.merchantUrl); } catch { throw new LinkWalletError('The quote merchant URL is invalid.', 'QUOTE_INVALID'); }
    const host = parsed.hostname.toLowerCase();
    const allowed = [...this.options.allowedMerchantHosts].some((value) => value.toLowerCase() === host);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowed || host !== quote.merchantHost.toLowerCase()) {
      throw new LinkWalletError('The quote merchant URL is not on the configured exact host allowlist.', 'QUOTE_INVALID');
    }
  }

  private async authFile(userId: Id): Promise<string> {
    await mkdir(this.authDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.authDirectory, 0o700);
    const filename = createHash('sha256').update(userId).digest('hex');
    return join(this.authDirectory, `${filename}.json`);
  }

  private async call(args: string[], timeoutMs = 15_000): Promise<LinkCommandResult> {
    return this.execute({ command: this.executable, args, timeoutMs });
  }
}
