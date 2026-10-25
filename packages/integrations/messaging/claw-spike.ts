// Manual capability check for Claw Messenger with real phones. Not used by the app.
//   pnpm exec tsx --env-file=.env packages/integrations/messaging/claw-spike.ts listen
//   ... claw-spike.ts dm +15125550100
//   ... claw-spike.ts group +15125550100 +15125550101
// Stays connected and prints inbound events until Ctrl+C. Phone numbers are masked in output.
import { ClawMessengerClient, type ClawEvent } from './claw-messenger.ts';

const mask = (s: unknown) => typeof s === 'string' ? s.replace(/\+?\d{6,}(\d{4})/g, '…$1') : s;
const show = (e: ClawEvent) => JSON.stringify(e, (_k, v) => mask(v));

const [cmd = 'listen', ...nums] = process.argv.slice(2);
const apiKey = process.env.CLAW_MESSENGER_API_KEY ?? '';
if (!apiKey) { console.error('Set CLAW_MESSENGER_API_KEY in .env'); process.exit(1); }

const client = new ClawMessengerClient({
  apiKey,
  url: process.env.CLAW_MESSENGER_URL || undefined,
  service: 'iMessage',
  log: (m) => console.log(m),
  onEvent: (e) => { if (e.type !== 'pong' && e.type !== 'ping') console.log(`<- ${show(e)}`); },
});
client.start();
await client.ready();

if (cmd === 'dm' && nums.length === 1) {
  const r = await client.send({ to: nums[0]! }, 'Hi! This is the HackTX planning agent running a connection test. Reply with anything to confirm you got this.');
  console.log(`-> dm result: ${show(r)}`);
} else if (cmd === 'group' && nums.length >= 2) {
  // First message in a new chat: plain text, no links.
  const r = await client.send({ to: nums }, 'Hi all! The HackTX planning agent is testing group chats. Reply here so we can check the group comes back to the agent.');
  console.log(`-> group result: ${show(r)}`);
  if (r.ok && r.chatId) {
    const r2 = await client.send({ chatId: r.chatId }, 'Second message, sent to the group by its chat ID.');
    console.log(`-> group follow-up: ${show(r2)}`);
  }
} else if (cmd !== 'listen') {
  console.error('usage: claw-spike.ts listen | dm <+E164> | group <+E164> <+E164> [...]');
  process.exit(1);
}

console.log('Listening for inbound events; Ctrl+C to stop.');
process.on('SIGINT', async () => { await client.stop(); process.exit(0); });
