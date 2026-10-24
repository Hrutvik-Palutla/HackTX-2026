import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookingQuote, BookingResult, BuyerAuthorization, Id, Money, Mode } from '../../packages/fulfillment/src/types.ts';

export type CheckoutOutcome =
  | { kind: 'confirmed'; merchantOrderRef: string; confirmationUrl?: string; actualTotal: Money }
  | { kind: 'blocked'; reason: 'captcha' | 'login_required' | 'unsupported_flow' | 'quote_changed' }
  | { kind: 'unknown' };

/** Page-level code in this interface must come from an explicitly reviewed driver. */
export interface CheckoutDriver {
  readonly host: string;
  run(input: {
    quote: BookingQuote;
    /** Drivers must honor abort before taking any irreversible merchant action. */
    signal: AbortSignal;
    /** Private path handle only; never serialize/read this in general application code. */
    paymentCredentialFile?: string;
    fillPaymentCredential?: (privateFile: string, signal: AbortSignal) => Promise<void>;
  }): Promise<CheckoutOutcome>;
}

export interface BookingWorkerOptions {
  mode: Mode;
  allowedHosts: ReadonlySet<string>;
  drivers: ReadonlyMap<string, CheckoutDriver>;
  verifyQuoteBinding(quote: BookingQuote): Promise<boolean>;
  withCredential(authorizationId: Id, use: (privateFile: string) => Promise<CheckoutOutcome>): Promise<CheckoutOutcome>;
  /** Separate trusted code owns DOM field selection and parses the Link file privately. */
  fillPaymentCredential?(driver: CheckoutDriver, privateCredentialFile: string, signal: AbortSignal): Promise<void>;
  driverTimeoutMs?: number;
  now?: () => Date;
}

/**
 * One attempt only. The caller persists the returned state before enqueueing any follow-up;
 * `outcome_unknown` must be reconciled and never triggers another submit from this worker.
 */
export class BookingWorker {
  private readonly now: () => Date;
  private readonly options: BookingWorkerOptions;

  constructor(options: BookingWorkerOptions) {
    if (options.driverTimeoutMs !== undefined && (!Number.isSafeInteger(options.driverTimeoutMs) || options.driverTimeoutMs < 1 || options.driverTimeoutMs > 10 * 60_000)) {
      throw new Error('driverTimeoutMs must be between 1 ms and 10 minutes.');
    }
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  async submit(input: { quote: BookingQuote; authorization: BuyerAuthorization }): Promise<BookingResult> {
    const { quote, authorization } = input;
    const startedAt = this.now();
    if (quote.mode !== this.options.mode || authorization.mode !== this.options.mode) {
      return this.result(quote, authorization, 'failed', null, null, null);
    }
    if (quote.expiresAt <= startedAt.toISOString() || authorization.status !== 'approved' ||
      authorization.quoteId !== quote.id || authorization.buyerUserId !== quote.buyerUserId ||
      authorization.approvedBindingHash !== quote.bindingHash || !(await this.options.verifyQuoteBinding(quote))) {
      return this.result(quote, authorization, 'failed', null, null, null);
    }
    let url: URL;
    try { url = new URL(quote.merchantUrl); } catch {
      return this.result(quote, authorization, 'failed', null, null, null);
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || !this.options.allowedHosts.has(host) || host !== quote.merchantHost.toLowerCase()) {
      return this.result(quote, authorization, 'handoff_required', null, null, null);
    }
    const driver = this.options.drivers.get(host);
    if (!driver || driver.host.toLowerCase() !== host) {
      return this.result(quote, authorization, 'handoff_required', null, null, null);
    }
    if ((host === 'fixture.booking.test' && this.options.mode !== 'test') ||
      (driver instanceof OwnedTestCheckoutDriver && this.options.mode !== 'test') ||
      (this.options.mode === 'test' && !(driver instanceof OwnedTestCheckoutDriver))) {
      return this.result(quote, authorization, 'failed', null, null, null);
    }

    let outcome: CheckoutOutcome;
    try {
      if (driver instanceof OwnedTestCheckoutDriver) {
        outcome = await this.runBounded(driver, quote);
      } else {
        if (!authorization.id) return this.result(quote, authorization, 'failed', null, null, null);
        outcome = await this.options.withCredential(authorization.id, (privateFile) => this.runBounded(driver, quote, privateFile));
      }
    } catch {
      // A failed final action may have reached the merchant. Do not retry it here.
      return this.result(quote, authorization, 'outcome_unknown', null, null, null);
    }
    if (outcome.kind === 'unknown') return this.result(quote, authorization, 'outcome_unknown', null, null, null);
    if (outcome.kind === 'blocked') {
      return this.result(quote, authorization, 'handoff_required', null, null, null);
    }
    if (!outcome.merchantOrderRef || outcome.actualTotal.currency !== quote.total.currency ||
      !Number.isSafeInteger(outcome.actualTotal.amountMinor) || outcome.actualTotal.amountMinor < 0) {
      return this.result(quote, authorization, 'outcome_unknown', null, null, null);
    }
    return this.result(
      quote,
      authorization,
      this.options.mode === 'test' ? 'test_confirmed' : 'merchant_confirmed',
      outcome.merchantOrderRef,
      outcome.confirmationUrl ?? null,
      outcome.actualTotal,
    );
  }

  private async runBounded(driver: CheckoutDriver, quote: BookingQuote, credentialFile?: string): Promise<CheckoutOutcome> {
    const controller = new AbortController();
    const timeoutMs = this.options.driverTimeoutMs ?? 10 * 60_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CheckoutOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new Error('Checkout driver timed out'));
        resolve({ kind: 'unknown' });
      }, timeoutMs);
    });
    const run = driver.run({
      quote,
      signal: controller.signal,
      ...(credentialFile ? { paymentCredentialFile: credentialFile } : {}),
      ...(credentialFile ? { fillPaymentCredential: async (file: string) => {
        if (controller.signal.aborted) throw new Error('Checkout was aborted.');
        if (!this.options.fillPaymentCredential) throw new Error('No trusted payment field filler is configured.');
        await this.options.fillPaymentCredential(driver, file, controller.signal);
        if (controller.signal.aborted) throw new Error('Checkout was aborted.');
      } } : {}),
    });
    try {
      return await Promise.race([run, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  private result(
    quote: BookingQuote,
    authorization: BuyerAuthorization,
    status: BookingResult['status'],
    merchantOrderRef: string | null,
    confirmationUrl: string | null,
    actualTotal: Money | null,
  ): BookingResult {
    return {
      id: randomUUID(), planId: quote.planId, versionId: quote.versionId, quoteId: quote.id,
      authorizationId: authorization.id, status, merchantOrderRef, confirmationUrl, actualTotal, mode: this.options.mode,
    };
  }
}

/** Minimal Playwright page surface keeps Playwright an optional runtime dependency. */
export interface FixturePage {
  setContent(html: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<void>;
  locator(selector: string): {
    fill(value: string): Promise<void>;
    click(): Promise<void>;
    textContent(): Promise<string | null>;
    getAttribute(name: string): Promise<string | null>;
  };
}

let ownedCheckoutHtml: Promise<string> | undefined;
function loadOwnedTestCheckoutHtml(): Promise<string> {
  ownedCheckoutHtml ??= readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'checkout.html'), 'utf8');
  return ownedCheckoutHtml;
}

/** Browser-backed fixture driver. It has no payment form and is accepted only in test mode. */
export class OwnedTestCheckoutDriver implements CheckoutDriver {
  readonly host = 'fixture.booking.test';
  private readonly page: FixturePage;
  private readonly html?: string;
  constructor(page: FixturePage, html?: string) {
    this.page = page;
    this.html = html;
  }

  async run({ quote, signal }: { quote: BookingQuote; signal: AbortSignal }): Promise<CheckoutOutcome> {
    if (quote.merchantHost.toLowerCase() !== this.host || quote.mode !== 'test') return { kind: 'blocked', reason: 'unsupported_flow' };
    if (signal.aborted) return { kind: 'unknown' };
    await this.page.setContent(this.html ?? await loadOwnedTestCheckoutHtml(), { waitUntil: 'load' });
    if (signal.aborted) return { kind: 'unknown' };
    await this.page.locator('[data-testid="fixture-total"]').fill(`${quote.total.amountMinor} ${quote.total.currency}`);
    await this.page.locator('[data-testid="attendees"]').fill(String(quote.attendeeUserIds.length));
    if (signal.aborted) return { kind: 'unknown' };
    await this.page.locator('[data-testid="place-test-order"]').click();
    const confirmation = this.page.locator('[data-testid="confirmation"]');
    const ref = await confirmation.getAttribute('data-order-ref');
    const text = await confirmation.textContent();
    if (!ref || !text?.includes('Test order confirmed:')) return { kind: 'unknown' };
    return { kind: 'confirmed', merchantOrderRef: ref, actualTotal: quote.total };
  }
}

/** Optional smoke path for environments that install `playwright` in the isolated worker image. */
export async function runOwnedFixtureBrowserTest(quote: BookingQuote): Promise<CheckoutOutcome> {
  let chromium: { launch(options?: object): Promise<{ newPage(): Promise<FixturePage>; close(): Promise<void> }> };
  try {
    // @ts-ignore Playwright is supplied by the isolated booking-worker image only.
    ({ chromium } = await import('playwright') as unknown as { chromium: typeof chromium });
  } catch {
    throw new Error('Playwright is optional and is not installed in this worker image.');
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await new OwnedTestCheckoutDriver(page).run({ quote, signal: new AbortController().signal });
  } finally {
    await browser.close();
  }
}
