// Muse Spark via Meta's OpenAI-compatible endpoint (https://dev.meta.ai/docs/quickstart).
// The `openai` package is only an HTTP client here; no OpenAI account or billing is involved.
import OpenAI from 'openai';
import { z } from 'zod';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ToolSpec = OpenAI.Chat.Completions.ChatCompletionTool;

// Spark Standard list prices (USD per 1M tokens), dev.meta.ai/docs/pricing-rate-limits. Estimates only.
const PRICE_IN = 1.25 / 1e6;
const PRICE_OUT = 4.25 / 1e6;

export type Usage = { inputTokens: number; outputTokens: number; estimatedCostUsd: number };

export interface Muse {
  model: string;
  chat(input: { messages: ChatMessage[]; tools?: ToolSpec[] }): Promise<{ message: OpenAI.Chat.Completions.ChatCompletionMessage; usage: Usage }>;
  structured<T>(input: { messages: ChatMessage[]; name: string; schema: z.ZodType<T> }): Promise<{ value: T; usage: Usage }>;
}

export function createMuse(opts: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof globalThis.fetch } = {}): Muse {
  const apiKey = opts.apiKey ?? process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error('MODEL_API_KEY is not set');
  const model = opts.model ?? process.env.MUSE_MODEL ?? 'muse-spark-1.3';
  const client = new OpenAI({ apiKey, baseURL: opts.baseURL ?? 'https://api.meta.ai/v1', timeout: 45_000, maxRetries: 2, ...(opts.fetch ? { fetch: opts.fetch } : {}) });

  // Production probes returned model_not_found and 200 for identical requests seconds
  // apart. The SDK doesn't retry 404s. Retry only that lookup failure, at the model
  // request boundary, so successful plan/payment tools are never replayed for recovery.
  const request = async <T>(send: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try { return await send(); }
      catch (error) {
        if (!(error instanceof OpenAI.APIError) || error.status !== 404 || error.code !== 'model_not_found' || attempt >= 4) throw error;
        console.warn(`[muse] model lookup failed for ${model}; retry ${attempt + 1}/4`);
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, 200 * 2 ** attempt) * (0.75 + Math.random() * 0.5)));
      }
    }
  };

  const usageOf = (u?: OpenAI.Completions.CompletionUsage): Usage => {
    const inputTokens = u?.prompt_tokens ?? 0;
    const outputTokens = u?.completion_tokens ?? 0;
    return { inputTokens, outputTokens, estimatedCostUsd: inputTokens * PRICE_IN + outputTokens * PRICE_OUT };
  };

  return {
    model,
    async chat({ messages, tools }) {
      const res = await request(() => client.chat.completions.create({
        model,
        messages,
        // Meta only accepts tool_choice "auto"; mandatory steps are invoked by code, not the model.
        ...(tools?.length ? { tools, tool_choice: 'auto' as const, parallel_tool_calls: false } : {}),
      }));
      const message = res.choices[0]?.message;
      if (!message) throw new Error('Muse returned no choices');
      return { message, usage: usageOf(res.usage) };
    },
    async structured({ messages, name, schema }) {
      const res = await request(() => client.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: z.toJSONSchema(schema) as Record<string, unknown> } },
      }));
      const text = res.choices[0]?.message?.content ?? '';
      const parsed = schema.safeParse(JSON.parse(text || 'null'));
      if (!parsed.success) throw new Error(`Muse output failed ${name} schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return { value: parsed.data, usage: usageOf(res.usage) };
    },
  };
}
