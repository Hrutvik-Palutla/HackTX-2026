// AES-256-GCM envelopes for private columns. `domain` is bound as associated data so a
// ciphertext from one column (e.g. OAuth token) cannot be replayed into another (e.g. private fact).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type Domain = 'private_fact' | 'message' | 'outbox' | 'oauth' | 'wallet' | 'phone' | 'inbound';

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64');
  return k;
}

export function seal(domain: Domain, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(domain));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function open(domain: Domain, envelope: string): string {
  const [v, iv, tag, ct] = envelope.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad envelope');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(domain));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export const sealJson = (domain: Domain, value: unknown) => seal(domain, JSON.stringify(value));
export const openJson = <T>(domain: Domain, envelope: string): T => JSON.parse(open(domain, envelope)) as T;
