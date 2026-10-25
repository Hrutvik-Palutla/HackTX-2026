// Run inside the deployed worker. Synthetic prompts only; never logs credentials or chat data.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { createMuse } = await import(pathToFileURL(`${process.cwd()}/packages/agent/src/muse.ts`));
const { toolsFor } = await import(pathToFileURL(`${process.cwd()}/packages/agent/src/tools.ts`));
const { templates } = await import(pathToFileURL(`${process.cwd()}/packages/templates/src/index.ts`));

const model = process.env.MUSE_MODEL ?? 'muse-spark-1.3';
const apiKey = process.env.MODEL_API_KEY ?? '';
const expectedHash = process.argv[2];
console.log(JSON.stringify({ probe: 'runtime', revision: process.env.SOURCE_REVISION, model, modelLength: model.length,
  credentialConfigured: !!apiKey,
  ...(expectedHash ? { credentialMatchesDeployment: createHash('sha256').update(apiKey).digest('hex') === expectedHash } : {}),
}));
const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
const messages = [{ role: 'user', content: 'Reply with OK. Do not call any tools.' }];
const tools = toolsFor(templates['local-outing'].allowedTools).specs;
const catalog = await fetch('https://api.meta.ai/v1/models', { headers, signal: AbortSignal.timeout(20000) });
const catalogBody = await catalog.json();
console.log(JSON.stringify({ probe: 'catalog', status: catalog.status, models: catalogBody.data?.map(m => m.id), error: catalogBody.error }));
for (const [name, extra] of [['minimal-1', {}], ['full-tools-1', { tools, tool_choice: 'auto', parallel_tool_calls: false }], ['minimal-2', {}], ['full-tools-2', { tools, tool_choice: 'auto', parallel_tool_calls: false }]]) {
  try {
    const started = Date.now();
    const response = await fetch('https://api.meta.ai/v1/chat/completions', { method: 'POST', headers,
      body: JSON.stringify({ model, messages, ...extra }), signal: AbortSignal.timeout(25000) });
    const body = await response.json();
    console.log(JSON.stringify({ probe: name, status: response.status, ms: Date.now() - started, model: body.model,
      error: body.error, requestId: response.headers.get('x-request-id'), toolCount: extra.tools?.length ?? 0 }));
  } catch (error) {
    console.log(JSON.stringify({ probe: name, error: error.message }));
  }
}
const muse = createMuse();
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const response = await muse.chat({ messages, tools });
    console.log(JSON.stringify({ probe: 'actual-sdk-client', attempt, ok: true, usage: response.usage }));
  } catch (error) {
    console.log(JSON.stringify({ probe: 'actual-sdk-client', attempt, ok: false, status: error.status, code: error.code,
      error: error.error, requestId: error.request_id }));
  }
}
