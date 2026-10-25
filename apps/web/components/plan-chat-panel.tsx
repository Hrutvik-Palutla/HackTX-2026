"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ChatRecap } from './chat-recap';
type Chat = { linkedGroupChat: boolean; messages: { id: string; scope: 'group' | 'private'; from: 'agent' | 'unknown' | { id: string; name: string }; text: string; at: string; source: 'website' | 'messages'; deliveryStatus: string | null }[] };
const delivery: Record<string, string> = { pending: 'Queued for Messages', sent: 'Accepted by Messages', failed: 'Not sent', unknown: 'Delivery unconfirmed' };
export function PlanChatPanel({ planId }: { planId: string }) {
  const [chat, setChat] = useState<Chat | null>(null); const [text, setText] = useState('');
  const [destination, setDestination] = useState('website'); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const base = `/plans/${encodeURIComponent(planId)}`;
  useEffect(() => {
    let active = true;
    const load = async () => { try { const data = await api<Chat>(`${base}/chat`); if (active) { setChat(data); setError(''); } } catch { if (active) setError('Chat couldn’t load. It will retry shortly.'); } };
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [base]);
  return <section className="panel" id="group-chat"><h2>Group chat</h2>
    <p className="hint">{chat?.linkedGroupChat ? 'This plan’s website and linked Messages group are shown together.' : 'Website messages. Start a plan with Sid in your Messages group to link that conversation.'}</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!chat ? <p role="status">Loading messages…</p> : <><ol className="chat-log" aria-label="Group messages">{chat.messages.filter(m => m.scope === 'group').map(m => <li key={m.id} id={`chat-message-${m.id}`}><strong>{m.from === 'agent' ? 'Sid' : typeof m.from === 'object' ? m.from.name : 'Member'}</strong><span className="hint"> · {m.source === 'messages' ? 'Messages' : 'Website'}{m.deliveryStatus ? ` · ${delivery[m.deliveryStatus] ?? 'Delivery unconfirmed'}` : ''}</span><p>{m.text}</p></li>)}</ol>{!chat.messages.some(m => m.scope === 'group') && <p>No messages for this plan yet. Try “Sid, what works for Friday?”</p>}</>}
    <form className="form-panel" onSubmit={e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice(''); void api(`${base}/messages`, { method: 'POST', body: JSON.stringify({ text, scope: 'group', destination }) }).then(() => { setText(''); setNotice(destination === 'linked_chat' ? 'Queued for the linked Messages group.' : 'Posted here.'); setDestination('website'); void api<Chat>(`${base}/chat`).then(setChat).catch(() => setError('Your message is saved. Chat will retry loading shortly.')); }).catch(() => setError('Your message couldn’t be posted. Check the connection and try again.')).finally(() => setBusy(false)); }}>
      <label>Message the group<textarea required maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="Sid, can we move this to 7?" /></label>
      <fieldset><legend>Send to</legend><label className="choice"><input type="radio" name={`destination-${planId}`} checked={destination === 'website'} onChange={() => setDestination('website')} />Website</label><label className="choice"><input type="radio" name={`destination-${planId}`} checked={destination === 'linked_chat'} disabled={!chat?.linkedGroupChat} onChange={() => setDestination('linked_chat')} />Linked Messages group</label></fieldset>
      <button disabled={busy || !chat}>{busy ? 'Posting…' : destination === 'linked_chat' ? 'Send to linked group' : 'Post message'}</button><Link className="back" href={`${base}/private`}>Tell Sid privately →</Link>
    </form>
    <ChatRecap key={planId} planId={planId} messages={chat?.messages ?? []} />
  </section>;
}
