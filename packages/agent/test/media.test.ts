import { describe, expect, it } from 'vitest';
import { privateFacts } from '@hacktx/db';
import { sealJson } from '@hacktx/core';
import { describePhoto, transcribeVoice } from '@hacktx/agent';
import { testDb, seedUsers, web } from '../../core/test/helpers';

describe('optional media boundaries', () => {
  it('rejects remote photo URLs and invalid audio before any provider call', async () => {
    const db = await testDb(); const u = await seedUsers(db, ['Alex']);
    await expect(describePhoto(db, web(u.Alex!), 'https://private-network.invalid/')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(transcribeVoice(db, web(u.Alex!), new Blob(['not a WAV']))).rejects.toMatchObject({ code: 'INVALID' });
  });
  it('enforces the per-account media allowance before making a model request', async () => {
    const db = await testDb(); const u = await seedUsers(db, ['Alex']);
    for (let i = 0; i < 8; i++) await db.insert(privateFacts).values({ ownerUserId: u.Alex!, kind: 'media_usage', valueEnc: sealJson('private_fact', { kind: 'test' }) });
    const old = process.env.MODEL_API_KEY; process.env.MODEL_API_KEY = 'test-only-key';
    try { await expect(describePhoto(db, web(u.Alex!), 'data:image/png;base64,aGVsbG8=')).rejects.toMatchObject({ code: 'QUOTA_LIMIT' }); }
    finally { if (old === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = old; }
  });
});
