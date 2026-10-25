"use client";
import { useState } from 'react';
import { api } from '@/lib/api';

type Message = { id: string; scope: string; text: string };
type Recap = { items: { kind: string; text: string; evidence: { messageId: string; quote: string }[] }[]; model: string; generatedAt: string };
export function ChatRecap({ planId, messages }: { planId: string; messages: Message[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const group = messages.filter(message => message.scope === 'group');
  return <details className="chat-recap"><summary>Catch up on the conversation</summary><p>Select up to 20 group messages to turn into a short recap. Nothing is sent until you ask.</p>
    <form onSubmit={event => {
      event.preventDefault(); if (busy || !consent || !selected.length) return;
      setBusy(true); setError(''); setRecap(null);
      void api<Recap>(`/plans/${encodeURIComponent(planId)}/chat/recap`, { method: 'POST', body: JSON.stringify({ messageIds: selected, consent: true }) })
        .then(setRecap).catch(error => setError(error instanceof Error ? error.message : 'The recap couldn’t load.')).finally(() => setBusy(false));
    }}><fieldset disabled={busy}><div className="recap-message-picker">{group.map((message, index) => <label className="choice" key={message.id}>
      <input type="checkbox" checked={selected.includes(message.id)} disabled={!selected.includes(message.id) && selected.length >= 20} onChange={event => { setRecap(null); setSelected(ids => event.target.checked ? [...ids, message.id] : ids.filter(id => id !== message.id)); }} />
      <span>Message {index + 1}: {message.text}</span></label>)}</div>
      {!group.length && <p>No group messages to summarize yet.</p>}
      <label className="choice"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />Send the selected message text to Snowflake Cortex for this recap. Don’t select sensitive information.</label>
      <p className="hint">Only selected group text is sent. Private threads and account/calendar details are excluded. Eight requests per account, including failed attempts.</p>
      <button disabled={busy || !consent || !selected.length}>{busy ? 'Making your recap…' : `Summarize ${selected.length} selected messages`}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {recap && <div role="status"><h3>Here’s what came up</h3><p className="hint">Advisory snapshot of selected messages. Votes, availability and plan decisions still come from the plan. This recap isn’t posted or saved for future planning.</p>
      {!recap.items.length && <p>No clear ideas, concerns or questions found.</p>}
      {recap.items.map((item, index) => <article key={index}><span className="eyebrow">{item.kind}</span><p>{item.text}</p>{item.evidence.map((evidence, i) => <blockquote key={i}><a href={`#chat-message-${evidence.messageId}`}>“{evidence.quote}”</a></blockquote>)}</article>)}
      <p className="hint">Snowflake Cortex · {recap.model} · {new Date(recap.generatedAt).toLocaleString()} · Cost unavailable</p></div>}
  </details>;
}
