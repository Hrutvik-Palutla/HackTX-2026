import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMuse } from '../src/muse';

const messages = [{ role: 'user' as const, content: 'Reply OK.' }];
const missingModel = () => Response.json({ error: { code: 'model_not_found', type: 'invalid_request_error', message: 'The requested model was not found.' } }, { status: 404 });
const completion = (content = 'OK') => Response.json({ id: 'response', object: 'chat.completion', model: 'muse-spark-1.3',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });

describe('Muse model lookup recovery', () => {
  it('retries an identical tool request after an intermittent model-not-found response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(missingModel()).mockResolvedValueOnce(completion());
    const muse = createMuse({ apiKey: 'test-key', fetch });
    const tools = [{ type: 'function' as const, function: { name: 'read_plan', parameters: { type: 'object', properties: {} } } }];
    const result = await muse.chat({ messages, tools });
    expect(result.message.content).toBe('OK');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1]?.body).toEqual(fetch.mock.calls[1]![1]?.body);
    expect(JSON.parse(fetch.mock.calls[1]![1]?.body as string).tools).toEqual(tools);
  });

  it('also recovers structured planner calls', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(missingModel()).mockResolvedValueOnce(completion('{"ok":true}'));
    const result = await createMuse({ apiKey: 'test-key', fetch }).structured({ messages, name: 'result', schema: z.object({ ok: z.boolean() }) });
    expect(result.value).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops after five attempts if the configured model remains unavailable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => missingModel());
    await expect(createMuse({ apiKey: 'test-key', fetch }).chat({ messages })).rejects.toMatchObject({ status: 404, code: 'model_not_found' });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it.each([[401, 'invalid_api_key'], [404, 'file_not_found'], [400, 'invalid_request_error']])('does not retry unrelated %i errors (%s)', async (status, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ error: { code, message: 'Rejected.' } }, { status }));
    await expect(createMuse({ apiKey: 'test-key', fetch }).chat({ messages })).rejects.toMatchObject({ status, code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
