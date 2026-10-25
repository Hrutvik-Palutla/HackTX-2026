"use client";
import Link from 'next/link';
import { useState } from 'react';
import { AppShell, PageHeading } from './app-shell';

const people = ['Alex', 'Mel', 'Mark'] as const;
type Person = typeof people[number];
const options = [
  { id: 'A', name: 'Outdoor movie', detail: 'Watch a film outside, then get something to eat.' },
  { id: 'B', name: 'Tacos + live music', detail: 'Dinner together, with time to stay for a set.' },
  { id: 'C', name: 'Evening photo walk', detail: 'A walk with a few photo challenges along the way.' },
];
const interests: Record<Person, string[]> = { Alex: ['Photography', 'Food trucks'], Mel: ['Live music', 'Being outside'], Mark: ['Stargazing', 'Trying new food'] };
const challenges = ['Take a photo with three different colors.', 'Find a reflection and photograph it together.', 'Take one group photo, with everyone’s permission.', 'What follows you in the light but disappears in the dark?', 'What gets bigger the more you take away?'];
type Message = { from: string; text: string };

/** Browser-only sample. It never authenticates as these people or calls messaging/model/write APIs. */
export function ExampleWorkspace() {
  const [person, setPerson] = useState<Person>('Alex');
  const [tab, setTab] = useState('places');
  const [time, setTime] = useState('19:00');
  const [votes, setVotes] = useState<Record<Person, string>>({ Alex: '', Mel: 'B', Mark: 'B' });
  const [selected, setSelected] = useState('');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ from: 'Alex', text: 'Anyone free Friday?' }, { from: 'Mel', text: 'I can make 7. Somewhere outdoors?' }, { from: 'Sid', text: 'Here are three example options. Pick one to try voting.' }]);
  const [done, setDone] = useState<Record<number, Person | undefined>>({});
  const allAgree = options.find(o => people.every(p => votes[p] === o.id));
  const fits = time !== '18:30';
  const post = (from: string, message: string) => setMessages(v => [...v, { from, text: message }]);
  function vote(id: string) { setVotes(v => ({ ...v, [person]: id })); setSelected(''); setDone({}); post(person, `Option ${id} works for me.`); }
  function changeTime(value: string) {
    if (value === time) return;
    setTime(value); setVotes({ Alex: '', Mel: '', Mark: '' }); setSelected(''); setDone({});
    post('Sid', 'The time changed. Everyone needs to vote again.');
  }
  function send() {
    const value = text.trim(); if (!value) return;
    post(person, value); setText('');
    const match = /\bvote\s+(?:for\s+)?([abc])\b/i.exec(value);
    if (match) { setVotes(v => ({ ...v, [person]: match[1]!.toUpperCase() })); setSelected(''); setDone({}); post('Sid', `Marked option ${match[1]!.toUpperCase()} as your example vote.`); }
    else if (/after\s+7|7\s*pm/i.test(value)) { if (time === '19:00') post('Sid', 'The example is already set to 7 PM.'); else changeTime('19:00'); }
    else post('Sid', 'This example supports “vote for B” and “after 7pm”. Your own group uses the live agent.');
  }
  return <AppShell view="example"><PageHeading title="Friday after 6" view="example" context="Friday crew · Example" />
    <p className="notice">Example group. Changes stay in this browser. No messages, bookings, or calendar events are sent.</p>
    <div className="standout-actions"><label>Try a friend’s view<select value={person} onChange={e => setPerson(e.target.value as Person)}>{people.map(p => <option key={p}>{p}</option>)}</select></label><Link className="button" href="/signup?next=/plans">Use with my friends</Link></div>
    <nav className="standout-actions" aria-label="Example navigation">{[['places', 'Places'], ['time', 'Time'], ['friends', 'Friends'], ['activities', 'Things to do']].map(([id, label]) => <button key={id} className={tab === id ? '' : 'secondary'} aria-pressed={tab === id} onClick={() => setTab(id!)}>{label}</button>)}</nav>
    <div className="dashboard-grid"><section>
      {tab === 'places' && <section className="panel"><h2>Pick a place</h2><p>Fictional choices to try the flow. Prices and opening times haven’t been checked.</p>{options.map(o => <article className="option-row" key={o.id}><h3>{o.id}. {o.name}</h3><p>{o.detail}</p><p className="hint">Example · price not checked</p><button className={votes[person] === o.id ? '' : 'secondary'} aria-pressed={votes[person] === o.id} onClick={() => vote(o.id)}>{votes[person] === o.id ? 'Works for me ✓' : `Choose ${o.id}`}</button><p className="hint">{people.filter(p => votes[p] === o.id).join(', ') || 'No votes yet'}</p></article>)}<p>{people.filter(p => votes[p]).length} of 3 have voted.</p><button disabled={!allAgree || !fits || !!selected} onClick={() => { setSelected(allAgree!.id); post('Sid', `${allAgree!.name} is confirmed in this example. No booking was made.`); }}>{selected ? 'Plan confirmed' : 'Confirm this plan'}</button>{!allAgree && <p className="hint">Everyone must choose the same option. Switch friend views to try it.</p>}{!fits && <p role="status">Mel can’t make 6:30. Choose a later time.</p>}{selected && <p role="status">Confirmed: {options.find(o => o.id === selected)?.name}. Try the activities tab next.</p>}</section>}
      {tab === 'time' && <section className="panel"><h2>Choose a time</h2><p>Friday, October 30 · Austin time</p><label>Start time<select value={time} onChange={e => changeTime(e.target.value)}><option value="18:30">6:30 PM</option><option value="19:00">7:00 PM</option><option value="19:30">7:30 PM</option></select></label><ul><li>Alex: after 6 PM</li><li>Mel: after 7 PM</li><li>Mark: before 10 PM</li></ul><p role="status">{fits ? 'This time works for all three example friends.' : 'Mel can’t make 6:30. Try 7 PM.'}</p><p className="hint">Changing the time clears old votes. In your group, connect Google Calendar or set times yourself.</p></section>}
      {tab === 'friends' && <section className="panel"><h2>What everyone likes</h2>{people.map(p => <article className="option-row" key={p}><h3>{p}</h3><p>{interests[p].join(' · ')}</p></article>)}<p>The food option fits Alex and Mark’s food interests and Mel’s live music. These are example interests; your real notes are shared only when you choose.</p></section>}
      {tab === 'activities' && <section className="panel"><h2>Something to do when you get there</h2>{!selected ? <p>Confirm a plan first, then try the photo challenges and riddles.</p> : <><p>{Object.values(done).filter(Boolean).length} of 5 complete</p>{challenges.map((challenge, index) => <article className="option-row" key={challenge}><span className="eyebrow">{index < 3 ? 'Photo challenge' : 'Riddle'}</span><p>{challenge}</p>{index >= 3 && <details><summary>Answer</summary><p>{index === 3 ? 'Your shadow.' : 'A hole.'}</p></details>}<label className="choice"><input type="checkbox" checked={!!done[index]} disabled={!!done[index] && done[index] !== person} onChange={e => setDone(v => ({ ...v, [index]: e.target.checked ? person : undefined }))} />{done[index] ? `Completed by ${done[index]}` : 'We did this'}</label></article>)}<p className="hint">Example progress only. No photos are uploaded.</p></>}</section>}
    </section><aside className="panel"><h2>Group chat</h2><p className="hint">Example conversation. No live AI or Messages connection.</p><ol className="chat-log" aria-label="Example group messages">{messages.map((m, i) => <li key={i}><strong>{m.from}</strong><p>{m.text}</p></li>)}</ol><form onSubmit={e => { e.preventDefault(); send(); }}><label>Message the example group<textarea maxLength={1000} required value={text} onChange={e => setText(e.target.value)} placeholder="Try: vote for B" /></label><button>Send example message</button></form><p className="hint">In your own group, start a plan with Sid in Messages. The website shows that plan’s chat, choices and votes.</p></aside></div>
  </AppShell>;
}
