import { cortexRecap, snowflakeConfig } from '../packages/agent/src/snowflake-recap';

// Synthetic data only. Makes exactly one paid inference call; no app DB or messaging access.
try {
  const config = snowflakeConfig();
  const startedAt = Date.now();
  const result = await cortexRecap([
    { id: 'synthetic-1', text: 'Could we start after 7 pm? I’m working until 6.' },
    { id: 'synthetic-2', text: 'I would like something outside, perhaps a photo walk.' },
    { id: 'synthetic-3', text: 'Where should we meet?' },
  ], config);
  console.log(JSON.stringify({ provider: 'snowflake', model: config.model, synthetic: true, durationMs: Date.now() - startedAt, ...result, costKnown: false }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Snowflake verification failed.');
  process.exitCode = 1;
}
