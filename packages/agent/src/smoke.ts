// `pnpm muse:smoke`: proves the Muse key, model id, tool calling and structured output work. Needs MODEL_API_KEY.
import { z } from 'zod';
import { createMuse } from './muse';

const muse = createMuse();
const t0 = Date.now();
const a = await muse.chat({
  messages: [{ role: 'user', content: 'What time is it in Austin? Use the tool.' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Current time in a city',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
    },
  }],
});
console.log('tool call:', JSON.stringify(a.message.tool_calls ?? a.message.content), a.usage);
const b = await muse.structured({
  name: 'pick',
  schema: z.object({ choice: z.enum(['A', 'B', 'C']), why: z.string() }),
  messages: [{ role: 'user', content: 'Pick one option for a cheap movie night: A $9 matinee, B $19 IMAX, C $13 standard.' }],
});
console.log('structured:', b.value, b.usage, `${Date.now() - t0}ms model=${muse.model}`);
