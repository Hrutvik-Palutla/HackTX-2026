import { and, eq, isNull } from 'drizzle-orm';
import { user, privateFacts, plans, type Db } from '@hacktx/db';
import { AppError, sealJson } from '@hacktx/core';
import { loadTemplate } from '@hacktx/templates';
import type { ActorContext } from '@hacktx/contracts';
import { createMuse, museBaseURL } from './muse';
import { RunRecorder } from './recorder';
import { readQuest } from './standout';

// A small lifetime allowance bounds optional media usage during the hackathon.
async function reserveMedia(db: Db, ownerId: string, kind: string) {
  await db.transaction(async tx => {
    await tx.select().from(user).where(eq(user.id, ownerId)).for('update');
    const rows = await tx.select({ id: privateFacts.id }).from(privateFacts).where(and(eq(privateFacts.ownerUserId, ownerId), eq(privateFacts.kind, 'media_usage'), isNull(privateFacts.planId)));
    if (rows.length >= 8) throw new AppError('QUOTA_LIMIT', 'This account has used its eight optional media requests. Text notes still work.');
    await tx.insert(privateFacts).values({ ownerUserId: ownerId, kind: 'media_usage', valueEnc: sealJson('private_fact', { kind }) });
  });
}

async function recorder(db: Db, actor: ActorContext, task: string, templateId: 'drop-extraction' | 'quest', tool: string, model: string, planId: string | null = null) {
  const template = await loadTemplate(db, templateId);
  if (!template.allowedTools.includes(tool)) throw new AppError('FORBIDDEN', 'This media tool is disabled in the recipe.');
  await reserveMedia(db, actor.userId, task);
  const rec = await RunRecorder.start(db, { planId, task, template, model, inputRevision: 0 });
  rec.charge('turn');
  return rec;
}

export async function describePhoto(db: Db, actor: ActorContext, dataUrl: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 1_600_000) throw new AppError('INVALID', 'Use a PNG, JPEG or WebP photo under 1 MB.');
  const muse = createMuse();
  const rec = await recorder(db, actor, 'photo-input', 'drop-extraction', 'describe_photo', muse.model);
  try {
    const result = await rec.step('model', 'describe_photo', () => muse.chat({ messages: [{ role: 'system', content: 'Describe visible activities, objects and setting in at most 80 words to help the owner express an interest. Do not infer identities, sensitive traits or relationships. This is a suggested description for the owner to review, not a confirmed preference.' }, { role: 'user', content: [{ type: 'text', text: 'Suggest a grounded description I can review before adding an interest.' }, { type: 'image_url', image_url: { url: dataUrl } }] }] }), r => ({ summary: 'Private photo described for owner review; image omitted.', usage: r.usage }));
    await rec.finish('ok');
    return { text: result.message.content?.slice(0, 3500) ?? '', runId: rec.runId };
  } catch (e) { await rec.finish('error', 'Photo description failed.'); throw e; }
}

export async function transcribeVoice(db: Db, actor: ActorContext, audio: Blob) {
  if (audio.size > 8_000_000 || audio.size < 44) throw new AppError('INVALID', 'Upload a WAV recording under 8 MB.');
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (Buffer.from(bytes.slice(0, 4)).toString() !== 'RIFF' || Buffer.from(bytes.slice(8, 12)).toString() !== 'WAVE') throw new AppError('INVALID', 'This recording must be a WAV file.');
  const buffer = Buffer.from(bytes);
  let format: { codec: number; channels: number; rate: number; bits: number } | null = null;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const tag = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
    if (size > buffer.length - offset - 8) throw new AppError('INVALID', 'Incomplete WAV recording.');
    if (tag === 'fmt ' && size >= 16) format = { codec: buffer.readUInt16LE(offset + 8), channels: buffer.readUInt16LE(offset + 10), rate: buffer.readUInt32LE(offset + 12), bits: buffer.readUInt16LE(offset + 22) };
    if (tag === 'data') dataSize = size;
    offset += 8 + size + size % 2;
  }
  if (!format || format.codec !== 1 || format.channels !== 1 || ![16000, 24000].includes(format.rate) || format.bits !== 16 || !dataSize) throw new AppError('INVALID', 'Use mono 16-bit WAV at 16 or 24 kHz. The app converts uploaded recordings automatically.');
  if (dataSize / (format.rate * 2) > 120) throw new AppError('INVALID', 'Keep voice notes under two minutes.');
  const rec = await recorder(db, actor, 'voice-input', 'drop-extraction', 'transcribe_voice', 'muse-voice-transcribe-1.0');
  try {
    const form = new FormData();
    form.set('request', new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }));
    form.set('audio', new Blob([bytes], { type: 'audio/wav' }), 'note.wav');
    const result = await rec.step('model', 'transcribe_voice', async () => {
      const response = await fetch(`${museBaseURL()}/asr/transcribe`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` }, body: form, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new AppError('PROVIDER', 'Voice transcription is unavailable. Type your note instead.', true);
      return await response.json() as { transcript?: string };
    }, () => ({ summary: 'Private recording transcribed for owner review. Provider cost unavailable; excluded from the displayed Spark cost total.' }));
    await rec.finish('ok');
    return { text: typeof result.transcript === 'string' ? result.transcript.slice(0, 4000) : '', runId: rec.runId };
  } catch (e) { await rec.finish('error', 'Voice transcription failed.'); throw e; }
}

export async function createQuestArt(db: Db, actor: ActorContext, planId: string) {
  const quest = await readQuest(db, actor, planId);
  if (!quest) throw new AppError('UNRESOLVED', 'Create the current outing quest first.');
  if (quest.art) return quest;
  const rec = await recorder(db, actor, 'quest-art', 'quest', 'create_quest_art', 'muse-image-1.0', planId);
  try {
    const art = await rec.step('model', 'create_quest_art', async () => {
      const response = await fetch(`${museBaseURL()}/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'muse-image-1.0', prompt: `A playful violet and warm orange illustrated cooperative adventure badge inspired by this quest title: ${quest.title}. No words, no identifiable people.`, n: 1, response_format: 'b64_json', output_format: 'png' }), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new AppError('PROVIDER', 'Quest art is unavailable. The text quest still works.', true);
      const result = await response.json() as { data?: { b64_json?: string }[] };
      const value = result.data?.[0]?.b64_json;
      if (!value || value.length > 8_000_000 || Buffer.from(value, 'base64').subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AppError('PROVIDER', 'Image provider did not return a supported image.');
      return `data:image/png;base64,${value}`;
    }, () => ({ summary: 'Quest illustration generated from its public title. Provider cost unavailable; excluded from the displayed Spark cost total.' }));
    const updated = await db.transaction(async tx => {
      await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
      const current = await readQuest(tx, actor, planId);
      if (!current || current.id !== quest.id) throw new AppError('STALE_PLAN', 'The outing changed. Create a card for its new quest.');
      if (current.art) return current;
      const { id, ...value } = current;
      const withArt = { ...value, art };
      await tx.update(privateFacts).set({ valueEnc: sealJson('private_fact', withArt), updatedAt: new Date() }).where(eq(privateFacts.id, id));
      return { id, ...withArt };
    });
    await rec.finish('ok'); return updated;
  } catch (e) { await rec.finish('error', 'Quest illustration failed.'); throw e; }
}
