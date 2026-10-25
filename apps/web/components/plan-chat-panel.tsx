"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ChatRecap } from './chat-recap';
import { Figure } from './plan-parts';
type Message = { id: string; scope: 'group' | 'private'; from: 'agent' | 'unknown' | { id: string; name: string }; text: string; at: string; source: 'website' | 'messages'; deliveryStatus: string | null };
type Chat = { linkedGroupChat: boolean; messages: Message[] };
const delivery: Record<string, string> = { pending: 'Queued for Messages', sent: 'Accepted by Messages', failed: 'Not sent', unknown: 'Delivery unconfirmed' };
const author = (m: Message) => m.from === 'agent' ? 'Sid' : typeof m.from === 'object' ? m.from.name : 'Member';
const stamp = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', d.toDateString() === new Date().toDateString() ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export function PlanChatPanel({ planId }: { planId: string }) {
  const [chat, setChat] = useState<Chat | null>(null); const [text, setText] = useState('');
  const [destination, setDestination] = useState('website'); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [announce, setAnnounce] = useState('');
  const seen = useRef<Set<string> | null>(null); const log = useRef<HTMLOListElement>(null);
  const base = `/plans/${encodeURIComponent(planId)}`;
  const toBottom = () => requestAnimationFrame(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; });
  // Announce only messages that arrive after the first load, never the whole history.
  const receive = useCallback((data: Chat) => {
    const group = data.messages.filter(m => m.scope === 'group');
    if (seen.current) { const fresh = group.filter(m => !seen.current!.has(m.id)); if (fresh.length) setAnnounce(fresh.map(m => `${author(m)}: ${m.text}`).join('. ')); }
    seen.current = new Set(group.map(m => m.id));
    const el = log.current; const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setChat(data);
    if (atBottom) toBottom();
  }, []);
  const load = useCallback(async () => { try { receive(await api<Chat>(`${base}/chat`)); setError(''); } catch { setError('Chat couldn’t load. It will retry shortly.'); } }, [base, receive]);
  useEffect(() => {
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  const group = chat?.messages.filter(m => m.scope === 'group') ?? [];
  return <section className="panel chat-panel" id="group-chat"><h2>Group chat</h2>
    <p className="hint">{chat?.linkedGroupChat ? 'This plan’s website and linked Messages group are shown together.' : 'Website messages. Start a plan with Sid in your Messages group to link that conversation.'}</p>
    {error && <p role="alert" className="chat-error">{error} <button type="button" className="secondary" onClick={() => void load()}>Retry now</button></p>}{notice && <p role="status">{notice}</p>}
    <p className="visually-hidden" aria-live="polite">{announce}</p>
    {!chat ? <p role="status" className="chat-loading">Loading messages…</p> : <><ol className="chat-log" aria-label="Group messages" ref={log} tabIndex={0}>{group.map(m => <li key={m.id} id={`chat-message-${m.id}`} className={m.from === 'agent' ? 'from-sid' : undefined}><strong>{author(m)}</strong><span className="hint"> · {m.source === 'messages' ? 'Messages' : 'Website'}{m.deliveryStatus ? ` · ${delivery[m.deliveryStatus] ?? 'Delivery unconfirmed'}` : ''}</span>{stamp(m.at) && <time className="hint" dateTime={m.at}>{stamp(m.at)}</time>}<p>{m.text}</p></li>)}</ol>{!group.length && <div className="empty-state with-figure chat-empty"><Figure name="record-player" /><p>No messages for this plan yet. Try “Sid, what works for Friday?”</p></div>}</>}
    <form className="form-panel" onSubmit={e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice(''); void api(`${base}/messages`, { method: 'POST', body: JSON.stringify({ text, scope: 'group', destination }) }).then(() => { setText(''); setNotice(destination === 'linked_chat' ? 'Queued for the linked Messages group.' : 'Posted here.'); setDestination('website'); toBottom(); void api<Chat>(`${base}/chat`).then(receive).catch(() => setError('Your message is saved. Chat will retry loading shortly.')); }).catch(() => setError('Your message couldn’t be posted. Check the connection and try again.')).finally(() => setBusy(false)); }}>
      <label>Message the group<textarea required maxLength={1000} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Sid, can we move this to 7?" /></label>
      <fieldset><legend>Send to</legend><label className="choice"><input type="radio" name={`destination-${planId}`} checked={destination === 'website'} onChange={() => setDestination('website')} />Website</label><label className="choice"><input type="radio" name={`destination-${planId}`} checked={destination === 'linked_chat'} disabled={!chat?.linkedGroupChat} onChange={() => setDestination('linked_chat')} />Linked Messages group</label></fieldset>
      <button disabled={busy || !chat}>{busy ? 'Posting…' : destination === 'linked_chat' ? 'Send to linked group' : 'Post message'}</button><Link className="back" href={`${base}/private`}>Tell Sid privately →</Link>
      <p className="hint chat-keys">Ctrl + Enter sends.</p>
    </form>
    <ChatRecap key={planId} planId={planId} messages={chat?.messages ?? []} />
  </section>;
}
