// Scripted run of IDEA.md's two entry flows through the REAL agent (Muse) with a fake iMessage client,
// so behavior can be checked without phones. Prints every message the agent sends and to whom.
//   pnpm exec tsx --env-file=.env packages/integrations/messaging/flow-sim.ts [group|dm]
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, migrationsFolder, friendships, user, type Db } from '@hacktx/db';
import type { DiscoveryPort } from '@hacktx/contracts';
import { createMuse, fixtureDiscovery } from '@hacktx/agent';
import { ingestClawMessage } from './claw-adapter.ts';
import { linkVerifiedPhone } from './otp.ts';
import { agentHandlers, drain } from './agent-runtime.ts';
import type { ClawInboundMessage, ClawSendResult, SendTarget } from './claw-messenger.ts';

process.env.APP_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
process.env.PHONE_LOOKUP_HMAC_KEY ||= randomBytes(32).toString('base64');
const LINE = '+12053690702';
const austin = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };
const people = { Sid: '+15125550100', Mark: '+15125550101', Mel: '+15125550102' } as const;
const nameOf = (h: string) => Object.entries(people).find(([, p]) => p === h)?.[0] ?? h;

const db = drizzle(new PGlite(), { schema }) as unknown as Db;
await migrate(db as never, { migrationsFolder });
for (const [name, phone] of Object.entries(people)) {
  const id = `u_${name.toLowerCase()}`;
  await db.insert(user).values({ id, name, email: `${id}@users.invalid`, city: JSON.stringify(austin), emailVerified: false, phoneNumber: phone, phoneNumberVerified: true, onboardingComplete: true });
  await linkVerifiedPhone(db, id, phone);
}
for (const f of ['u_mark', 'u_mel']) await db.insert(friendships).values({ userLow: f < 'u_sid' ? f : 'u_sid', userHigh: f < 'u_sid' ? 'u_sid' : f, requestedBy: 'u_sid', status: 'accepted', acceptedAt: new Date() });

let n = 0;
const sentTexts: string[] = [];
const chats = new Map<string, string>(); // chatId -> label
const client = {
  async send(target: SendTarget, text: string): Promise<ClawSendResult> {
    let chatId: string;
    if ('chatId' in target) chatId = target.chatId;
    else if (Array.isArray(target.to)) { chatId = `group-${++n}`; chats.set(chatId, `NEW GROUP ${target.to.map(nameOf).join(', ')}`); }
    else { chatId = `dm-${nameOf(target.to)}`; chats.set(chatId, `DM ${nameOf(target.to)}`); }
    console.log(`\n  📤 to ${chats.get(chatId) ?? chatId}:\n     ${text.replace(/\n/g, '\n     ')}`);
    sentTexts.push(text);
    return { type: 'send.result', id: String(++n), ok: true, status: 'accepted', messageId: `out-${n}`, chatId };
  },
};

const part4Discovery = '../../discovery/src/index.ts';
const discovery: DiscoveryPort = process.env.SERPAPI_API_KEY
  ? ((await import(part4Discovery)) as { createSerpApiDiscovery(o: { apiKey: string }): DiscoveryPort }).createSerpApiDiscovery({ apiKey: process.env.SERPAPI_API_KEY })
  : fixtureDiscovery;
const handlers = agentHandlers({ db, muse: createMuse(), discovery, client, sendingLine: LINE });
const quiet = process.env.SIM_VERBOSE ? undefined : () => {};

let mid = 0;
async function say(from: keyof typeof people, text: string, chat: { chatId: string; group?: (keyof typeof people)[] }) {
  console.log(`\n💬 ${from}${chat.group ? ' (group)' : ' (DM)'}: ${text}`);
  const m: ClawInboundMessage = {
    type: 'message', messageId: `in-${++mid}`, chatId: chat.chatId, from: people[from], text, sentAt: new Date().toISOString(),
    ...(chat.group ? { isGroup: true, participants: [...chat.group.map((g) => people[g]), LINE] } : {}),
  };
  chats.set(chat.chatId, chat.group ? `GROUP ${chat.group.join(', ')}` : `DM ${from}`);
  await ingestClawMessage(db, LINE, m);
  await drain(db, handlers, quiet);
}

const flow = process.argv[2] ?? 'group';
console.log(`discovery: ${process.env.SERPAPI_API_KEY ? 'LIVE SerpApi' : 'FIXTURE'} | flow: ${flow}`);
if (flow === 'group') {
  const g = { chatId: 'gc-existing', group: ['Sid', 'Mark', 'Mel'] as (keyof typeof people)[] };
  await say('Mark', 'lol did anyone see the game', g);
  await say('Sid', 'SideQuest can you find a time for the three of us to watch Dune on Sunday?', g);
  await say('Mark', 'A and B both work for me, B is my favorite', g);
  await say('Mel', 'only B works for me', g);
  await say('Mark', 'wait actually I have practice until 4:30 on Sunday, so anything before that is out for me', g);
  await say('Mark', 'B works for me now, favorite B', g);
  await say('Mel', 'B is fine', g);
  await say('Sid', 'Great, go ahead with B for all three of us', g);
} else if (flow === 'invite') {
  await say('Sid', 'Me, Mark, and Jo want to watch Dune on Sunday', { chatId: 'dm-Sid' });
  await say('Sid', "Jo's number is 512-555-0199", { chatId: 'dm-Sid' });
  // Jo opens the link, signs up with that phone, and accepts (what Part 1's /invite/:token page does).
  const token = sentTexts.join('\n').match(/\/invite\/([\w-]+)/)?.[1];
  if (!token) throw new Error('no invite link was sent');
  await db.insert(user).values({ id: 'u_jo', name: 'Jo', email: 'u_jo@users.invalid', city: JSON.stringify(austin), emailVerified: false, phoneNumber: '+15125550199', phoneNumberVerified: true, onboardingComplete: true });
  await linkVerifiedPhone(db, 'u_jo', '+15125550199');
  (people as Record<string, string>).Jo = '+15125550199';
  console.log('\n🔗 Jo signs up and accepts the invite');
  const { acceptInviteForUser } = await import('@hacktx/core');
  console.log(await acceptInviteForUser(db, 'u_jo', token));
  await drain(db, handlers, quiet);
} else {
  await say('Sid', 'Me, Mark, and Mel want to watch Dune this weekend', { chatId: 'dm-Sid' });
  // Replies go to the group the agent created, or to private chats if it could not create one.
  const created = [...chats.entries()].find(([, label]) => label.startsWith('NEW GROUP'))?.[0];
  const g = created ? { chatId: created, group: ['Sid', 'Mark', 'Mel'] as (keyof typeof people)[] } : null;
  await say('Mark', 'B works for me, favorite B', g ?? { chatId: 'dm-Mark' });
  await say('Mel', 'I can do A or B', g ?? { chatId: 'dm-Mel' });
  await say('Sid', 'Sounds good, lets do B for all three of us', g ?? { chatId: 'dm-Sid' });
}
if (process.env.SIM_VERBOSE) {
  const { agentRuns, runSteps } = await import('@hacktx/db');
  const { eq } = await import('drizzle-orm');
  for (const r of await db.select().from(agentRuns)) {
    if (r.status === 'ok' && !process.env.SIM_TRACE) continue;
    console.log(`\nrun ${r.task} ${r.status} ${r.error ?? ''}`);
    for (const st of (await db.select().from(runSteps).where(eq(runSteps.runId, r.id))).sort((a, b) => a.index - b.index)) {
      console.log(`  ${st.index} ${st.kind}:${st.name} ${st.outcome} ${st.redactedSummary}`);
    }
  }
}
process.exit(0);
