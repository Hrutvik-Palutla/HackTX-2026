// Claw Messenger (hosted iMessage) WebSocket client. Docs: https://www.clawmessenger.com/docs
// Inbound arrives only over this socket (no self-serve webhooks), so the worker keeps one connection open,
// answers keepalives, reconnects with backoff, and replays missed messages with `sync`.
// The API key travels in the `key` query parameter (the documented WebSocket auth); never log the URL.

export const CLAW_DEFAULT_URL = 'wss://claw-messenger.onrender.com/ws';

export type ClawService = 'iMessage' | 'SMS' | 'RCS';

export type ClawInboundMessage = {
  type: 'message';
  messageId: string;
  chatId: string;
  from: string;
  text: string;
  attachments?: { url: string; mimeType: string }[];
  service?: ClawService;
  isGroup?: boolean; // omitted on private messages (observed in the live check)
  participants?: string[];
  replyTo?: { messageId: string; partIndex?: number };
  groupName?: string | null;
  sentAt?: string;
  replay?: boolean;
};

export type ClawSendResult = {
  type: 'send.result';
  id: string;
  ok: boolean;
  status: 'accepted' | 'failed' | 'not_confirmed';
  messageId?: string;
  chatId?: string;
  selectedService?: ClawService;
  retryable?: boolean;
  errorCode?: string;
  error?: string;
};

export type ClawStatus = {
  type: 'status';
  messageId: string;
  chatId?: string;
  status: 'delivered' | 'read' | 'failed';
  deliveryStatus?: 'delivery_confirmed' | 'failed' | 'not_confirmed';
};

export type ClawEvent =
  | ClawInboundMessage
  | ClawSendResult
  | ClawStatus
  | { type: 'error'; code: string; message: string }
  | { type: 'sync.done'; count: number }
  | { type: 'group.name.updated'; chatId: string; groupName: string | null; previousGroupName: string | null; changedBy?: string }
  | { type: string; [k: string]: unknown };

export type SendTarget = { to: string | string[] } | { chatId: string };

export type ClawClientOptions = {
  apiKey: string;
  url?: string;
  service?: ClawService;
  onMessage?: (m: ClawInboundMessage) => void | Promise<void>;
  onEvent?: (e: ClawEvent) => void;
  /** Called after every (re)connect; return an ISO instant to replay messages received since then. */
  syncSince?: () => string | null;
  log?: (msg: string) => void;
  sendTimeoutMs?: number;
};

const PING_MS = 25_000; // server closes sockets idle for 90s and pings every 30s

export class ClawMessengerClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (r: ClawSendResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private attempt = 0;
  private seq = 0;
  private openWaiters: (() => void)[] = [];

  constructor(private readonly o: ClawClientOptions) {
    if (!o.apiKey) throw new Error('Claw Messenger API key is required');
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  start() {
    this.stopped = false;
    this.connect();
  }

  /** Resolves once the socket is open. */
  ready(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((r) => this.openWaiters.push(r));
  }

  async stop() {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('client stopped')); }
    this.pending.clear();
    this.ws?.close(1000);
    this.ws = null;
  }

  /** Send text to one handle, several handles (creates a group), or an existing chat. */
  async send(target: SendTarget, text: string, opts: { replyToMessageId?: string; id?: string } = {}): Promise<ClawSendResult> {
    await this.ready();
    const id = opts.id ?? `send-${Date.now()}-${++this.seq}`;
    const frame = {
      type: 'send', id, ...target,
      parts: [{ type: 'text', value: text }],
      ...(this.o.service ? { service: this.o.service } : {}),
      ...(opts.replyToMessageId ? { replyTo: { messageId: opts.replyToMessageId } } : {}),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Outcome unknown: the caller must reconcile rather than blindly resend.
        reject(new Error(`send ${id} timed out without send.result`));
      }, this.o.sendTimeoutMs ?? 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  sync(since: string) { this.raw({ type: 'sync', since }); }

  private raw(frame: object) { if (this.connected) this.ws!.send(JSON.stringify(frame)); }

  private log(msg: string) { this.o.log?.(`[claw] ${msg}`); }

  private connect() {
    const url = new URL(this.o.url ?? CLAW_DEFAULT_URL);
    url.searchParams.set('key', this.o.apiKey);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.log('connected');
      this.pingTimer = setInterval(() => this.raw({ type: 'ping' }), PING_MS);
      const since = this.o.syncSince?.();
      if (since) this.sync(since);
      for (const w of this.openWaiters.splice(0)) w();
    });

    ws.addEventListener('message', (ev) => {
      let e: ClawEvent;
      try { e = JSON.parse(String(ev.data)); } catch { this.log('ignored non-JSON frame'); return; }
      this.handle(e);
    });

    ws.addEventListener('close', (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) + Math.floor(Math.random() * 500);
      this.log(`closed (${ev.code}); reconnecting in ${delay}ms`);
      setTimeout(() => { if (!this.stopped) this.connect(); }, delay);
    });

    ws.addEventListener('error', () => this.log('socket error'));
  }

  private handle(e: ClawEvent) {
    switch (e.type) {
      case 'ping': this.raw({ type: 'pong' }); return;
      case 'pong': return;
      case 'send.result': {
        const r = e as ClawSendResult;
        const p = this.pending.get(r.id);
        if (p) { clearTimeout(p.timer); this.pending.delete(r.id); p.resolve(r); }
        break;
      }
      case 'message': {
        const m = e as ClawInboundMessage;
        Promise.resolve(this.o.onMessage?.(m)).catch((err) => this.log(`onMessage failed: ${err instanceof Error ? err.message : err}`));
        break;
      }
    }
    this.o.onEvent?.(e);
  }
}
