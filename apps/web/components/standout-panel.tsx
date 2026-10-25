"use client";
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { voiceNoteWav } from '@/lib/voice-note';

type Chip = { id: string; label: string; evidence: string; kind: 'interest' | 'wish'; confirmed: boolean; shared: boolean };
type Drop = { id: string; note: string; url: string | null; chips: Chip[] };
export type Ground = { id: string; theme: string; searchQuery: string; why: (Chip & { name: string; ownerId: string })[] };
type Quest = { id: string; title: string; runId: string; art?: string; challenges: { id: string; kind: string; title: string; challenge: string; hint: string; completedBy: string | null; completedByName?: string; completedAt: string | null }[] };
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Please try again.';

export function DropNotebook() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { void api<Drop[]>('/drops').then(setDrops).catch(e => setError(errorText(e))); }, []);
  const perform = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const edit = (dropId: string, chipId: string, patch: Partial<Chip>) => setDrops(rows => rows.map(d => d.id === dropId ? { ...d, chips: d.chips.map(c => c.id === chipId ? { ...c, ...patch } : c) } : d));
  return <section className="panel standout-notebook">
    <span className="eyebrow">Start with what you care about</span>
    <h2>What are you into?</h2>
    <p>Drop a note or a link. AI suggests interests and things to try. You choose what friends can see.</p>
    <form className="form-panel" onSubmit={e => { e.preventDefault(); void perform(async () => { const saved = await api<Drop>('/drops', { method: 'POST', body: JSON.stringify({ note, url: url || null }) }); setDrops(v => [saved, ...v]); setNote(''); setUrl(''); setNotice('Suggestions are private. Confirm each one before sharing.'); }); }}>
      <label>Something you enjoy or want to try<textarea required maxLength={4000} value={note} onChange={e => setNote(e.target.value)} placeholder="I want to try stargazing, and I love taking night photos." /></label>
      <label>Link (optional)<input type="url" value={url} maxLength={2000} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
      <details><summary>Add a photo or voice note</summary>
        <label>Photo (PNG, JPEG or WebP, under 1 MB)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; void perform(async () => { if (file.size > 1_000_000) throw Error('Choose a photo under 1 MB.'); const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('Unable to read photo.')); reader.readAsDataURL(file); }); const result = await api<{ text: string }>('/drops/photo', { method: 'POST', body: JSON.stringify({ dataUrl }) }); setNote(v => [v, result.text].filter(Boolean).join('\n')); setNotice('Review the photo description, then find and confirm your interests. The photo is not shared.'); }); }} /></label>
        <label>Voice note (under 2 minutes and 8 MB)<input type="file" accept="audio/*" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; void perform(async () => { const wav = await voiceNoteWav(file); const form = new FormData(); form.set('audio', wav, 'note.wav'); const response = await fetch('/api/drops/voice', { method: 'POST', body: form, credentials: 'same-origin' }); const result = await response.json(); if (!response.ok) throw Error(result.error?.message ?? 'Transcription failed.'); setNote(v => [v, result.data.text].filter(Boolean).join('\n')); setNotice('Review your transcript before confirming and sharing interests. The recording is not shared.'); }); }} /></label>
        <p className="hint">Optional media is limited to eight requests per account. Text notes always remain available.</p>
      </details>
      <p className="hint">Links are saved as references. Paste the relevant text above; linked pages are not fetched.</p>
      <button disabled={busy}>{busy ? 'Finding interests…' : 'Find my interests'}</button>
    </form>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {drops.map(d => <article className="drop-card" key={d.id}>
      <p className="hint">Your private note: {d.note}</p>
      {d.chips.map(c => <div className="interest-chip" key={c.id}>
        <label>{c.kind === 'wish' ? 'Want to try' : 'Interest'}<input aria-label="Interest label" maxLength={120} value={c.label} onChange={e => edit(d.id, c.id, { label: e.target.value })} /></label>
        <blockquote>“{c.evidence}”</blockquote>
        <label className="choice"><input type="checkbox" checked={c.confirmed} onChange={e => edit(d.id, c.id, { confirmed: e.target.checked, ...(!e.target.checked ? { shared: false } : {}) })} />This describes me</label>
        <label className="choice"><input type="checkbox" checked={c.shared} disabled={!c.confirmed} onChange={e => edit(d.id, c.id, { shared: e.target.checked })} />Let my connected friends use this interest and quote in their group plans</label>
      </div>)}
      <div className="standout-actions"><button disabled={busy} onClick={() => void perform(async () => { await api(`/drops/${d.id}`, { method: 'PATCH', body: JSON.stringify({ chips: d.chips.map(({ id, label, confirmed, shared }) => ({ id, label, confirmed, shared })) }) }); setNotice('Sharing choices saved. Only checked interests can be used by your friends.'); })}>Save sharing choices</button>
        <button className="secondary" disabled={busy} onClick={() => void perform(async () => { await api(`/drops/${d.id}`, { method: 'DELETE' }); setDrops(v => v.filter(x => x.id !== d.id)); setNotice('Drop deleted. It can no longer be used for common ground.'); })}>Delete drop</button></div>
    </article>)}
  </section>;
}

export function CommonGroundPicker({ friendIds, onPick }: { friendIds: string[]; onPick: (ground: Ground | null) => void }) {
  const [ground, setGround] = useState<Ground | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = friendIds.slice().sort().join(',');
  useEffect(() => { setGround(null); onPick(null); }, [key]);
  return <section className="common-ground-card">
    <h3>Find our thing</h3><p>Connect your shared interests to a real outing for this group.</p>
    <button type="button" className="secondary" disabled={busy || !friendIds.length} onClick={() => { setBusy(true); setError(''); void api<Ground>('/common-ground', { method: 'POST', body: JSON.stringify({ friendIds }) }).then(g => { setGround(g); onPick(g); }).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>{busy ? 'Finding your common ground…' : 'Find our thing'}</button>
    {!friendIds.length && <p className="hint">Select connected friends first.</p>}
    {error && <p role="alert">{error}</p>}
    {ground && <GroundEvidence ground={ground} />}
  </section>;
}

function GroundEvidence({ ground }: { ground: Ground }) {
  return <div className="ground-evidence"><h3>{ground.theme}</h3><ul>{ground.why.map(c => <li key={c.id}><strong>{c.name}</strong>: {c.label}<blockquote>“{c.evidence}”</blockquote></li>)}</ul><p className="hint">Searching for: {ground.searchQuery}</p></div>;
}

export function QuestPanel({ planId, userId, status }: { planId: string; userId: string; status: string }) {
  const [quest, setQuest] = useState<Quest | null>(null);
  const [ground, setGround] = useState<Ground | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = ['selected', 'booked', 'handoff'].includes(status);
  useEffect(() => { let active = true; const load = () => { void api<Quest | null>(`/plans/${planId}/quest`).then(q => { if (active) setQuest(q); }).catch(e => { if (active) setError(errorText(e)); }); }; load(); void api<Ground | null>(`/plans/${planId}/common-ground`).then(g => { if (active) setGround(g); }).catch(() => {}); const timer = setInterval(load, 5000); return () => { active = false; clearInterval(timer); }; }, [planId, status]);
  const perform = async (fn: () => Promise<Quest>) => { setBusy(true); setError(''); try { setQuest(await fn()); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const completed = quest?.challenges.filter(c => c.completedBy).length ?? 0;
  return <section className="panel quest-panel">
    {ground && <GroundEvidence ground={ground} />}
    <span className="eyebrow">Make it an adventure</span><h2>{quest?.title ?? 'Your cooperative quest'}</h2>
    {!quest && <><p>Three photo challenges and two riddles, made for your chosen outing. Work together and track your progress.</p><button disabled={busy || !eligible} onClick={() => void perform(() => api<Quest>(`/plans/${planId}/quest`, { method: 'POST' }))}>{busy ? 'Creating your quest…' : 'Create our quest'}</button>{!eligible && <p className="hint">Agree on an outing first. A changed plan needs a new quest.</p>}</>}
    {error && <p role="alert">{error}</p>}
    {quest?.art && <img className="quest-art" src={quest.art} alt="AI-generated illustration for this cooperative quest" />}
    {quest && !quest.art && <button className="secondary" disabled={busy} onClick={() => void perform(() => api<Quest>(`/plans/${planId}/quest/art`, { method: 'POST' }))}>{busy ? 'Creating…' : 'Make a quest card'}</button>}
    {quest && <><p role="status">{completed} / 5 complete</p><progress max={5} value={completed} aria-label="Quest progress" /><div className="quest-grid">{quest.challenges.map(c => <article className="quest-challenge" key={c.id}>
      <span className="eyebrow">{c.kind === 'photo' ? 'Photo challenge' : 'Riddle'}</span><h3>{c.title}</h3><p>{c.challenge}</p><details><summary>Need a hint?</summary><p>{c.hint}</p></details>
      <label className="choice"><input type="checkbox" checked={Boolean(c.completedBy)} disabled={busy || Boolean(c.completedBy && c.completedBy !== userId)} onChange={e => void perform(() => api<Quest>(`/plans/${planId}/quest`, { method: 'PATCH', body: JSON.stringify({ challengeId: c.id, done: e.target.checked }) }))} />{c.completedBy === userId ? 'Completed by you' : c.completedBy ? `Completed by ${c.completedByName ?? 'a friend'}` : 'We did this'}</label>
    </article>)}</div>{completed === 5 && <div className="quest-recap"><h3>Quest complete!</h3><p>You turned a shared interest into an adventure.</p><ul>{quest.challenges.map(c => <li key={c.id}>{c.title} · {c.completedBy === userId ? 'You' : c.completedByName ?? 'A friend'} · {c.completedAt ? new Date(c.completedAt).toLocaleTimeString() : ''}</li>)}</ul></div>}<p className="hint">Generated for this outing. No tickets or reservations are implied.</p></>}
  </section>;
}

export type Recipe = { id: string; version: number; model: string; systemInstruction: string; allowedTools: string[]; limits: { maxTurns: number; maxTools: number; maxSearches: number }; outputSchemaVersion: number };
export function RecipeEditor({ recipe, onSaved }: { recipe: Recipe; onSaved: () => void }) {
  const [instructions, setInstructions] = useState(recipe.systemInstruction);
  const [tools, setTools] = useState(recipe.allowedTools.join(', '));
  const [limits, setLimits] = useState(recipe.limits);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <details className="recipe-editor"><summary><strong>{recipe.id}</strong> · version {recipe.version}</summary><p>{recipe.model} · Changes apply to the next run. Existing traces keep their recipe version.</p><form className="form-panel" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void api(`/studio/templates/${recipe.id}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: recipe.version, systemInstruction: instructions, allowedTools: tools.split(',').map(s => s.trim()).filter(Boolean), limits }) }).then(onSaved).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>
    <label>Instructions<textarea required maxLength={12000} rows={8} value={instructions} onChange={e => setInstructions(e.target.value)} /></label><label>Allowed tools (comma separated)<input value={tools} onChange={e => setTools(e.target.value)} /></label>
    {(['maxTurns', 'maxTools', 'maxSearches'] as const).map(key => <label key={key}>{key}<input type="number" min={key === 'maxTurns' ? 1 : 0} max={key === 'maxTurns' ? 12 : key === 'maxTools' ? 24 : 8} value={limits[key]} onChange={e => setLimits(v => ({ ...v, [key]: Number(e.target.value) }))} /></label>)}
    {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Saving…' : 'Save new recipe version'}</button>
  </form></details>;
}
