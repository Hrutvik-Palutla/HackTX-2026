"use client";
// Public "Try a group adventure" demo. Everything here is fictional fixture data held in this browser tab:
// no API calls, no bookings, no messages, no posts. Photos never leave the device.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SideQuestLogo } from "./brand";
import { BADGES, BadgeGrid, BadgeIcon, BadgeReveal, chime, type BadgeId } from "./badges";
import { MemoryBox } from "./memory-box";

type Category = "food" | "culture" | "outdoors" | "games" | "music";
type Idea = { id: string; title: string; place: string; time: string; hour: number; cost: string; costValue: number; category: Category; note: string; unknown?: string; x: number; y: number };
type Outing = { id: string; title: string; date: string; time: string; hour: number; category: Category; confirmedBy: string[] };

const ME = "Alex";
const FRIENDS = ["Maya", "Jordan"];
const DATE = "Fri, Oct 23";
const IDEAS: Idea[] = [
  { id: "walk", title: "Night photo walk", place: "Riverbend Trail", time: "7:30 PM", hour: 19.5, cost: "Free", costValue: 0, category: "outdoors", note: "Lit river path, about 2 miles, bridges at both ends.", x: 92, y: 128 },
  { id: "gallery", title: "Late hours at Lantern Gallery", place: "Lantern Gallery", time: "8:00 PM", hour: 20, cost: "$12 listed", costValue: 12, category: "culture", note: "Open until 11 on Fridays.", x: 206, y: 66 },
  { id: "games", title: "Board games at Meeple House", place: "Meeple House café", time: "7:00 PM", hour: 19, cost: "$8 table fee", costValue: 8, category: "games", note: "Tables are first come, first served.", unknown: "Table availability not listed", x: 250, y: 142 },
  { id: "tacos", title: "Taco crawl on Comal Row", place: "Comal Row", time: "7:15 PM", hour: 19.25, cost: "About $15", costValue: 15, category: "food", note: "Three stands within two blocks.", unknown: "Prices are estimates", x: 150, y: 52 },
  { id: "vinyl", title: "Vinyl night at Groove Cellar", place: "Groove Cellar", time: "8:30 PM", hour: 20.5, cost: "Free entry", costValue: 0, category: "music", note: "Bring a record to play.", x: 118, y: 40 },
  { id: "kayak", title: "Sunset kayak from Pier 9", place: "Pier 9 rentals", time: "6:30 PM", hour: 18.5, cost: "$25 listed", costValue: 25, category: "outdoors", note: "Last rental goes out at 6:45.", x: 54, y: 156 },
];
const PAST: Outing[] = [
  { id: "past-gallery", title: "Gallery opening at Lantern Gallery", date: "Oct 16", time: "8:00 PM", hour: 20, category: "culture", confirmedBy: [ME, ...FRIENDS] },
  { id: "past-coffee", title: "Coffee at Little Fox", date: "Oct 9", time: "6:00 PM", hour: 18, category: "food", confirmedBy: [ME, ...FRIENDS] },
];
const CHALLENGES = [
  { id: "c1", kind: "Photo", text: "A long exposure of the bridge lights." },
  { id: "c2", kind: "Photo", text: "All of your shadows in one frame." },
  { id: "c3", kind: "Photo", text: "Something reflecting the skyline." },
  { id: "c4", kind: "Riddle", text: "I have a face but no mouth, and I tell you when to head home.", answer: "A clock" },
  { id: "c5", kind: "Riddle", text: "The more of me you take, the more you leave behind.", answer: "Footsteps" },
];
const STEPS = ["A quest for you", "Check everyone’s time", "Agree on an outing", "Lock it in", "Tonight’s quest", "We went", "Earlier outings", "Memories", "What next?"];
const QUICK = ["Tonight", "This weekend", "Keep it affordable", "Surprise us"];

function pickIdeas(mode: string, request: string) {
  const text = request.toLowerCase();
  let list = [...IDEAS];
  if (mode === "different") list = IDEAS.slice(3);
  else if (mode === "cheaper") list.sort((a, b) => a.costValue - b.costValue);
  else if (mode === "later") list = list.filter((i) => i.hour >= 19.5).concat(list.filter((i) => i.hour < 19.5));
  else {
    const hit = IDEAS.find((i) => text.includes(i.category) || i.title.toLowerCase().split(" ").some((w) => w.length > 4 && text.includes(w)));
    if (hit) list = [hit, ...IDEAS.filter((i) => i !== hit)];
  }
  return list.slice(0, 3);
}

function Map({ ideas, chosen, onPick }: { ideas: Idea[]; chosen: string | null; onPick: (id: string) => void }) {
  return (
    <figure className="demo-map">
      <svg viewBox="0 0 320 200" role="img" aria-label={`Map of the three options: ${ideas.map((i, n) => `${"ABC"[n]} ${i.place}`).join(", ")}. Illustrative, not to scale.`}>
        <rect width="320" height="200" fill="#f4f1ea" />
        {[40, 80, 120, 160].map((y) => <path key={`h${y}`} d={`M0 ${y + (y % 3)}H320`} stroke="#e6e1d6" strokeWidth="1" />)}
        {[60, 130, 200, 270].map((x) => <path key={`v${x}`} d={`M${x} 0L${x - 18} 200`} stroke="#e6e1d6" strokeWidth="1" />)}
        <path d="M22 186c18-24 30-50 62-46s54 26 88 10 42-52 78-56 52 12 70 4" fill="none" stroke="#d9d0bd" strokeWidth="9" strokeLinecap="round" />
        <path d="M22 186c18-24 30-50 62-46s54 26 88 10 42-52 78-56 52 12 70 4" fill="none" stroke="#fbfbfa" strokeWidth="1" strokeDasharray="3 5" />
        <path d="M228 18c18-6 40 0 44 14s-14 22-32 20-30-26-12-34z" fill="#e8e3d4" />
        {[[240, 28], [252, 36], [262, 28], [246, 42]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.2" fill="#cfc6b0" />)}
        {chosen && (() => {
          const c = ideas.find((i) => i.id === chosen);
          return c ? <circle className="demo-map-ring" cx={c.x} cy={c.y - 10} r="16" fill="none" stroke="#a3834f" strokeWidth="1" /> : null;
        })()}
        {ideas.map((i, n) => (
          <g key={i.id} className={`demo-pin${chosen === i.id ? " is-chosen" : ""}`} style={{ animationDelay: `${n * 90}ms` }} onClick={() => onPick(i.id)}>
            <path d={`M${i.x} ${i.y}c-7-9-11-14-11-19a11 11 0 0 1 22 0c0 5-4 10-11 19z`} fill={chosen === i.id ? "#17171a" : "#fbfbfa"} stroke="#17171a" strokeWidth="1.2" />
            <text x={i.x} y={i.y - 15.5} textAnchor="middle" fontSize="10" fontWeight="600" fill={chosen === i.id ? "#fbfbfa" : "#17171a"}>{"ABC"[n]}</text>
            <text x={i.x > 200 ? i.x - 14 : i.x + 14} y={i.y - 4} textAnchor={i.x > 200 ? "end" : "start"} fontSize="8.5" fill="#6c6a65">{i.place}</text>
          </g>
        ))}
      </svg>
      <figcaption>Illustrative map · fictional places · not to scale</figcaption>
    </figure>
  );
}

const DEMO_MEMORIES = "sq:demo-memories";
const DEMO_BADGES: BadgeId[] = ["first-outing", "three-outings", "variety", "after-dark", "outdoors", "quest-team", "memory", "full-table"];

export function AdventureDemo() {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"plan" | "memories" | "badges">("plan");
  const [request, setRequest] = useState("");
  const [quick, setQuick] = useState<string[]>([]);
  const [friends, setFriends] = useState<string[]>(FRIENDS);
  const [facts, setFacts] = useState<{ when: string; area: string; budget: string } | null>(null);
  const [mode, setMode] = useState("first");
  const [votes, setVotes] = useState<Record<string, string[]>>({});
  const [chosen, setChosen] = useState<string | null>(null);
  const [reserved, setReserved] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [past, setPast] = useState(false);
  const [suggest, setSuggest] = useState<number | null>(null);
  const [cal, setCal] = useState<"connected" | "manual" | null>(null);
  const [slots, setSlots] = useState<boolean[]>([]);
  const [memoryShared, setMemoryShared] = useState(false);
  const [openBadge, setOpenBadge] = useState<BadgeId | null>(null);
  const [reveal, setReveal] = useState<BadgeId[]>([]);
  const [tweak, setTweak] = useState(false);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const ideas = useMemo(() => pickIdeas(mode, request), [mode, request]);
  const pick = IDEAS.find((i) => i.id === chosen) ?? null;
  const people = [ME, ...friends];

  // ----- badge rules, computed from recorded demo facts only
  const outings: Outing[] = [
    ...(pick && confirmed.length >= 2 ? [{ id: "current", title: pick.title, date: "Oct 23", time: pick.time, hour: pick.hour, category: pick.category, confirmedBy: confirmed }] : []),
    ...(past ? PAST : []),
  ];
  const completers = new Set(Object.values(done));
  const progress: Partial<Record<BadgeId, { have: number; earnedOn?: string }>> = {};
  const set = (id: BadgeId, have: number, earned: boolean) => (progress[id] = { have, earnedOn: earned ? "Oct 23" : undefined });
  set("first-outing", outings.length, outings.length >= 1);
  set("three-outings", outings.length, outings.length >= 3);
  set("five-outings", outings.length, outings.length >= 5);
  const kinds = new Set(outings.map((o) => o.category)).size;
  set("variety", kinds, kinds >= 3);
  const late = outings.filter((o) => o.hour >= 19).length;
  set("after-dark", late, late >= 2);
  const outside = outings.filter((o) => o.category === "outdoors").length;
  set("outdoors", outside, outside >= 2);
  const challenges = Object.keys(done).length;
  set("quest-team", challenges, challenges === 5 && completers.size >= 2);
  set("full-table", outings.length ? people.length : 0, outings.length > 0 && people.length >= 4);
  set("memory", memoryShared ? 1 : 0, memoryShared);
  const earned = BADGES.filter((b) => DEMO_BADGES.includes(b.id) && progress[b.id]?.earnedOn).map((b) => b.id);
  const earnedKey = earned.join(",");
  const seen = useRef<Set<BadgeId>>(new Set());
  useEffect(() => {
    const fresh = earned.filter((id) => !seen.current.has(id));
    earned.forEach((id) => seen.current.add(id));
    [...seen.current].forEach((id) => { if (!earned.includes(id)) seen.current.delete(id); });
    if (fresh.length) {
      chime();
      setReveal(fresh);
      later(() => setReveal((r) => (r === fresh ? [] : r)), 6500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnedKey]);

  // ----- actions
  function plan(text = request, picks = quick) {
    const t = text.toLowerCase();
    const quick = picks;
    setFacts({
      when: quick.includes("This weekend") || t.includes("weekend") ? "This weekend" : quick.includes("Tonight") || t.includes("tonight") || t.includes("friday") ? `${DATE} · after 7 PM` : "Not set · any evening",
      area: t.includes("east") ? "East Austin" : "Austin · not narrowed",
      budget: quick.includes("Keep it affordable") || t.includes("cheap") || t.includes("afford") ? "Affordable · no amount set" : /\$\s?\d+/.test(t) ? `About ${t.match(/\$\s?\d+/)![0].replace(" ", "")} each` : "Not set",
    });
    setMode(quick.includes("Surprise us") ? "different" : quick.includes("Keep it affordable") ? "cheaper" : "first");
    setStep(1);
  }
  function vote(id: string) {
    if (chosen) return;
    setVotes((v) => {
      const mine = (v[id] ?? []).includes(ME);
      return { ...v, [id]: mine ? v[id]!.filter((n) => n !== ME) : [...(v[id] ?? []), ME] };
    });
  }
  function friendsVote() {
    const mine = Object.entries(votes).filter(([, names]) => names.includes(ME)).map(([id]) => id);
    const target = mine[0] ?? ideas[0]!.id;
    if (!mine.length) setVotes((v) => ({ ...v, [target]: [...(v[target] ?? []), ME] }));
    friends.forEach((name, i) =>
      later(() => {
        setVotes((v) => {
          const next = { ...v, [target]: [...new Set([...(v[target] ?? []), ME, name])] };
          if (i === 0 && ideas[1]) next[ideas[1].id] = [...new Set([...(v[ideas[1].id] ?? []), name])];
          return next;
        });
        if (i === friends.length - 1) later(() => setChosen(target), 260);
      }, 450 * (i + 1)),
    );
    if (!friends.length) later(() => setChosen(target), 300);
  }
  function finishQuest() {
    setDone((d) => {
      const next = { ...d };
      CHALLENGES.forEach((c, i) => { if (!next[c.id]) next[c.id] = i % 2 ? friends[0] ?? ME : i === 4 ? friends[1] ?? ME : ME; });
      return next;
    });
  }
  function confirmFriends() {
    setConfirmed((c) => [...new Set([...c, ME])]);
    friends.forEach((name, i) => later(() => setConfirmed((c) => [...new Set([...c, name])]), 420 * (i + 1)));
  }
  // Presenter: run a step's actions so each one can be shown without filling anything in.
  function runStep(n: number) {
    if (n >= 1 && !facts) plan();
    if (n >= 2) setCal((c) => c ?? "connected");
    if (n === 2 && !chosen) friendsVote();
    if (n >= 3 && !chosen) setChosen(ideas.find((i) => i.id === "walk")?.id ?? ideas[0]!.id);
    if (n === 3) setReserved(true);
    if (n >= 4 && !reserved) setReserved(true);
    if (n === 5) confirmFriends();
    if (n > 5 && confirmed.length < 2) setConfirmed([ME, ...friends]);
    if (n === 6) setPast(true);
    if (n === 8) setSuggest(0);
    setStep(n);
    setTab("plan");
  }
  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    seen.current = new Set();
    setStep(0); setTab("plan"); setRequest(""); setQuick([]); setFriends(FRIENDS); setFacts(null); setMode("first"); setVotes({}); setChosen(null);
    setCal(null); setSlots([]); setMemoryShared(false);
    try { localStorage.removeItem(DEMO_MEMORIES); } catch { /* ignore */ }
    setReserved(false); setDone({}); setConfirmed([]); setPast(false); setSuggest(null); setOpenBadge(null); setReveal([]);
  }

  const suggestions = [
    [
      { title: "Sunrise paddle on the river", why: "Your night photo walk was outdoors and everyone confirmed it. This keeps the river, in daylight.", query: "Austin sunrise kayak rental", kind: "outdoors" },
      { title: "Record store crawl, then tacos", why: "You’ve done culture and food; music is new for this group.", query: "Austin record stores near food trucks", kind: "music" },
      { title: "Coffee and a gallery, back to back", why: "Your two earlier outings were coffee (Oct 9) and a gallery (Oct 16). Same group, both in one evening.", query: "Austin gallery near coffee open late", kind: "culture" },
    ],
    [
      { title: "Night market and a photo challenge", why: "Like the photo walk: after dark, on foot, with something to look for.", query: "Austin night market Saturday", kind: "food" },
      { title: "Trivia night", why: "Something different: none of your three outings were games.", query: "Austin trivia night Friday", kind: "games" },
      { title: "Stargazing outside town", why: "A wildcard that keeps the late start you’ve liked: two of three outings started after 7.", query: "stargazing near Austin public night", kind: "outdoors" },
    ],
  ];

  const tally = (id: string) => (votes[id] ?? []).length;
  const voted = new Set(Object.values(votes).flat());
  const badgeInfo = openBadge ? BADGES.find((b) => b.id === openBadge)! : null;

  return (
    <div className="demo">
      <header className="demo-top">
        <Link className="logo" href="/" aria-label="SideQuest home"><SideQuestLogo /></Link>
        <p className="demo-flag">Demo · fictional friends · no real bookings or posts</p>
        <button type="button" className="secondary" onClick={reset}>Reset demo</button>
      </header>

      <div className="demo-layout">
        <nav className="demo-steps" aria-label="Demo steps">
          <span className="eyebrow">Walk through it</span>
          <ol>
            {STEPS.map((label, n) => (
              <li key={label}>
                <button type="button" aria-current={step === n ? "step" : undefined} className={n < step ? "is-done" : undefined} onClick={() => runStep(n)}>
                  <span className="demo-step-n">{n + 1}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
          <p className="hint">Click any step and it sets itself up. Every field is optional.</p>
        </nav>

        <main className="demo-stage">
          <div className="demo-heading">
            <span className="eyebrow">{DATE} · Austin</span>
            <h1>{facts ? `${pick?.title ?? "Something fun"} with ${friends.join(" and ") || "just you"}` : "Friday night, sorted"}</h1>
          </div>
          <div className="demo-tabs" role="tablist" aria-label="Plan sections">
            {(["plan", "memories", "badges"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === "plan" ? "Plan" : t === "memories" ? `Memories${outings.length ? ` ${outings.length}` : ""}` : `Badges${earned.length ? ` ${earned.length}` : ""}`}
              </button>
            ))}
          </div>

          {tab === "plan" && (
            <div className="demo-panel" key={step}>
              {facts && step > 0 && (
                <dl className="demo-facts">
                  {[
                    ["Friends", friends.join(", ") || "Just you"],
                    ["When", facts.when],
                    ["Area", facts.area],
                    ["Spending", facts.budget],
                  ].map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                  <button type="button" className="demo-edit" onClick={() => setStep(0)}>Edit</button>
                </dl>
              )}

              {step === 0 && (
                <section className="quest-banner">
                  <div className="quest-banner-art" aria-hidden="true">
                    <img src="/illustrations/canoe.svg" alt="" />
                  </div>
                  <div className="quest-scroll">
                    <div className="scroll-rod" aria-hidden="true" />
                    <div className="scroll-sheet">
                      <div>
                        <span className="eyebrow">Sid · SideQuest’s planner</span>
                        <h2 className="quest-hero">We’ve got a quest for you.</h2>
                        <p>Friday night with Maya and Jordan: a night photo walk along the river, 7:30, free. Five small challenges if you want them.</p>
                        <div className="demo-actions is-centered">
                          <button type="button" className="demo-primary" onClick={() => { setRequest("Night photo walk"); plan("Night photo walk tonight", ["Tonight"]); }}>Let’s do it</button>
                          <button type="button" className="secondary" aria-expanded={tweak} onClick={() => setTweak((v) => !v)}>Not our thing</button>
                        </div>
                      </div>
                    </div>
                    <div className="scroll-rod" aria-hidden="true" />
                  </div>
                  {tweak && (
                    <div className="demo-start">
                      <label>
                        Tell Sid what you’re into <span className="hint">(optional)</span>
                        <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Tacos, live music, something outdoors…" />
                      </label>
                      <div className="chips" role="group" aria-label="Quick choices">
                        {QUICK.map((q) => (
                          <button key={q} type="button" aria-pressed={quick.includes(q)} onClick={() => setQuick((v) => (v.includes(q) ? v.filter((x) => x !== q) : [...v, q]))}>{q}</button>
                        ))}
                      </div>
                      <div className="chips" role="group" aria-label="Who’s coming">
                        {FRIENDS.map((f) => (
                          <button key={f} type="button" aria-pressed={friends.includes(f)} onClick={() => setFriends((v) => (v.includes(f) ? v.filter((x) => x !== f) : [...v, f]))}>
                            <span className="chip-avatar">{f[0]}</span>{f}
                          </button>
                        ))}
                      </div>
                      <button type="button" className="demo-primary" onClick={() => plan()}>Find another quest</button>
                    </div>
                  )}
                </section>
              )}

              {step === 1 && (
                <section className="demo-cal">
                  <span className="eyebrow">Before suggesting times</span>
                  <h2>When is everyone free?</h2>
                  {!cal ? (
                    <div className="calendar-first">
                      <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="33" rx="3" /><path d="M6 18h36M15 5v8M33 5v8" /><path d="M15 27h6M27 27h6M15 34h6" className="cal-gold" /></svg>
                      <div>
                        <strong>Connect Google Calendar</strong>
                        <p>Sid reads only busy and free times, never what your events are.</p>
                        <div className="action-row">
                          <button type="button" className="demo-primary" onClick={() => setCal("connected")}>Connect (simulated)</button>
                          <button type="button" className="secondary" onClick={() => setCal("manual")}>I’ll answer myself</button>
                        </div>
                      </div>
                    </div>
                  ) : cal === "manual" && slots.length < 3 ? (
                    <div className="slot-ask" key={slots.length}>
                      <p className="demo-meta">Question {slots.length + 1} of 3</p>
                      <strong>{["Free Friday 7–10 PM?", "Free Saturday afternoon?", "Free Sunday morning?"][slots.length]}</strong>
                      <div className="action-row">
                        <button type="button" className="demo-primary" onClick={() => setSlots((v) => [...v, true])}>Yes</button>
                        <button type="button" className="secondary" onClick={() => setSlots((v) => [...v, false])}>No</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <figure className="free-chart">
                        <svg viewBox="0 0 320 120" role="img" aria-label="Friday 5 PM to midnight. Everyone is free from 7:15 to 10:30 PM.">
                          {["5p", "7p", "9p", "11p"].map((t, i) => <text key={t} x={64 + i * 70} y="112" fontSize="9" fill="#6c6a65">{t}</text>)}
                          <rect className="free-window" x={64 + 2.25 * 35} y="4" width={3.25 * 35} height="96" fill="#a3834f22" stroke="#a3834f" strokeDasharray="3 3" />
                          {[[ME, [[0, 1.8]]], ["Maya", [[0, 2.2], [5.6, 7]]], ["Jordan", [[0.5, 2]]]].map(([name, busy], r) => (
                            <g key={name as string}>
                              <text x="0" y={22 + r * 32} fontSize="10" fill="#17171a">{name as string}</text>
                              <rect x="64" y={12 + r * 32} width="245" height="14" fill="none" stroke="#e6e3dc" />
                              {(busy as number[][]).map(([f, t]) => <rect key={f} className="busy" x={64 + f * 35} y={12 + r * 32} width={(t - f) * 35} height="14" fill="#cfc6b4" />)}
                            </g>
                          ))}
                        </svg>
                        <figcaption>{cal === "connected" ? "From calendars (simulated): busy blocks only." : "From your answers plus Maya’s and Jordan’s calendars."} Everyone is free 7:15–10:30 PM.</figcaption>
                      </figure>
                      <button type="button" className="demo-primary" onClick={() => setStep(2)}>See options for that window</button>
                    </>
                  )}
                </section>
              )}

              {step === 2 && (
                <section>
                  <div className="demo-split">
                    <div className="demo-options">
                      {ideas.map((i, n) => (
                        <article key={i.id} className={`demo-option${chosen === i.id ? " is-chosen" : ""}${(votes[i.id] ?? []).includes(ME) ? " is-mine" : ""}`}>
                          <span className="option-letter" aria-hidden="true">{"ABC"[n]}</span>
                          <div>
                            <h3>{i.title}</h3>
                            <p className="demo-meta">{i.time} · {i.cost} · {i.place}</p>
                            <p>{i.note}</p>
                            {i.unknown && <p className="hint">Unknown: {i.unknown}</p>}
                            <div className="demo-vote">
                              <button type="button" aria-pressed={(votes[i.id] ?? []).includes(ME)} disabled={Boolean(chosen)} onClick={() => vote(i.id)}>Works for me</button>
                              <span className="demo-dots" aria-label={`${tally(i.id)} of ${people.length} can do this`}>
                                {people.map((p) => <i key={p} className={(votes[i.id] ?? []).includes(p) ? "is-on" : undefined} title={p} />)}
                                <small>{tally(i.id)} of {people.length}</small>
                              </span>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <Map ideas={ideas} chosen={chosen} onPick={(id) => vote(id)} />
                  </div>
                  {!chosen ? (
                    <div className="demo-actions">
                      <span className="hint">Refine:</span>
                      {[["first", "Best match"], ["cheaper", "Cheaper"], ["later", "Later"], ["different", "Something different"]].map(([m, l]) => (
                        <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => { setMode(m); setVotes({}); }}>{l}</button>
                      ))}
                      <button type="button" className="demo-primary" onClick={friendsVote}>{voted.has(ME) ? "Send to Maya and Jordan" : "Let the group vote"}</button>
                    </div>
                  ) : (
                    <div className="demo-agreed" role="status">
                      <strong>Everyone can do {pick?.title}.</strong>
                      <button type="button" className="demo-primary" onClick={() => setStep(3)}>Review it</button>
                    </div>
                  )}
                </section>
              )}

              {step === 3 && pick && (
                <section className="demo-review">
                  <span className="eyebrow">One review before anything happens</span>
                  <h2>{pick.title}</h2>
                  <dl className="option-facts">
                    <div><dt>When</dt><dd>{DATE}, {pick.time}</dd></div>
                    <div><dt>Who</dt><dd>{people.join(", ")}</dd></div>
                    <div><dt>Cost</dt><dd>{pick.cost}</dd></div>
                    <div><dt>Where</dt><dd>{pick.place}</dd></div>
                  </dl>
                  <p className="hint">{pick.costValue === 0 ? "Free, so there’s nothing to reserve. Confirming just locks the plan." : "In the live app, this opens the venue’s own checkout. Booked only shows after the venue confirms."}</p>
                  {!reserved ? (
                    <button type="button" className="demo-primary" onClick={() => setReserved(true)}>{pick.costValue === 0 ? "Confirm our plan" : "Simulate reservation"}</button>
                  ) : (
                    <div className="demo-agreed" role="status">
                      <strong>{pick.costValue === 0 ? "Plan agreed." : "Simulated confirmation · DEMO-1023 · not a real booking"}</strong>
                      <button type="button" className="demo-primary" onClick={() => setStep(4)}>See tonight’s quest</button>
                    </div>
                  )}
                </section>
              )}

              {step === 4 && (
                <section>
                  <div className="quest-scroll">
                    <div className="scroll-rod" aria-hidden="true" />
                    <div className="scroll-sheet">
                      <div>
                        <span className="eyebrow">Tonight’s quest · optional</span>
                        <h2>{pick?.category === "outdoors" ? "Catch the city after dark" : "Leave with a story"}</h2>
                        <p>Five small things to try together. Skip any of them; showing up is the point.</p>
                        <ol className="quest-list">
                          {CHALLENGES.map((c) => (
                            <li key={c.id} className={done[c.id] ? "is-done" : undefined}>
                              <label>
                                <input type="checkbox" checked={Boolean(done[c.id])} onChange={(e) => setDone((d) => { const n = { ...d }; if (e.target.checked) n[c.id] = ME; else delete n[c.id]; return n; })} />
                                <span><small>{c.kind}</small> {c.text}{c.answer && done[c.id] ? <em> · {c.answer}</em> : null}</span>
                                {done[c.id] && <span className="quest-by">{done[c.id] === ME ? "You" : done[c.id]}</span>}
                              </label>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                    <div className="scroll-rod" aria-hidden="true" />
                  </div>
                  <div className="demo-actions">
                    <button type="button" className="secondary" onClick={finishQuest}>Maya and Jordan finish theirs</button>
                    <button type="button" className="demo-primary" onClick={() => setStep(5)}>Later that night…</button>
                  </div>
                </section>
              )}

              {step === 5 && (
                <section className="demo-went">
                  <span className="eyebrow">After the outing</span>
                  <h2>Did you go?</h2>
                  <p>Each person confirms only themselves. Badges need at least two of you; photos and receipts aren’t proof and aren’t required.</p>
                  <ul className="went-list">
                    {people.map((p) => (
                      <li key={p} className={confirmed.includes(p) ? "is-on" : undefined}>
                        <span className="chip-avatar">{p[0]}</span>
                        {p}
                        {p === ME ? (
                          <button type="button" aria-pressed={confirmed.includes(ME)} onClick={() => setConfirmed((c) => (c.includes(ME) ? c.filter((x) => x !== ME) : [...c, ME]))}>{confirmed.includes(ME) ? "You went ✓" : "We went"}</button>
                        ) : (
                          <span className="hint">{confirmed.includes(p) ? "Confirmed" : "Hasn’t confirmed"}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="demo-actions">
                    <button type="button" className="secondary" onClick={confirmFriends}>Maya and Jordan confirm</button>
                    <button type="button" className="demo-primary" disabled={confirmed.length < 2} onClick={() => setStep(6)}>Next</button>
                  </div>
                </section>
              )}

              {step === 6 && (
                <section>
                  <span className="eyebrow">Our adventures</span>
                  <h2>This group’s history</h2>
                  <p>Only these three people see it. Planning with someone else starts a separate history.</p>
                  <ol className="history">
                    {outings.map((o) => (
                      <li key={o.id}><time>{o.date}</time><strong>{o.title}</strong><span className="hint">{o.time} · {o.category} · confirmed by {o.confirmedBy.length}</span></li>
                    ))}
                  </ol>
                  {!past && <button type="button" className="secondary" onClick={() => setPast(true)}>Add our two earlier outings</button>}
                  <div className="demo-actions"><button type="button" className="demo-primary" onClick={() => setStep(7)}>Add memories</button></div>
                </section>
              )}

              {step === 7 && (
                <section>
                  <MemoryBox storageKey={DEMO_MEMORIES} title="tonight" onFirst={() => setMemoryShared(true)} />
                  <div className="demo-actions"><button type="button" className="demo-primary" onClick={() => setStep(8)}>What next?</button></div>
                </section>
              )}

              {step === 8 && (
                <section>
                  <span className="eyebrow">Your next outing</span>
                  <h2>{suggest === null ? "Want an idea?" : "Based on what you’ve done together"}</h2>
                  {suggest === null ? (
                    <button type="button" className="demo-primary" onClick={() => setSuggest(0)}>Suggest our next outing</button>
                  ) : (
                    <>
                      <p className="hint">Standard suggestion built from this demo’s outings. No AI call in the demo.</p>
                      <div className="next-grid">
                        {suggestions[suggest]!.map((s) => (
                          <article key={s.title} className="demo-option">
                            <div>
                              <span className="eyebrow">{s.kind}</span>
                              <h3>{s.title}</h3>
                              <p>{s.why}</p>
                              <button type="button" className="secondary" onClick={() => { setRequest(s.title); setQuick([]); setFacts(null); setVotes({}); setChosen(null); setReserved(false); setDone({}); setConfirmed([]); setStep(0); }}>Plan this</button>
                            </div>
                          </article>
                        ))}
                      </div>
                      <div className="demo-actions">
                        <button type="button" className="chip" aria-pressed={suggest === 0} onClick={() => setSuggest(0)}>More like this</button>
                        <button type="button" className="chip" aria-pressed={suggest === 1} onClick={() => setSuggest(1)}>Something different</button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>
          )}

          {tab === "memories" && (
            <div className="demo-panel">
              {!outings.length ? <p>No outings yet. Finish one and confirm you went.</p> : (
                <ul className="memory-grid">
                  {outings.map((o) => (
                    <li key={o.id}>
                      <div className="memory-blank" aria-hidden="true">{o.category}</div>
                      <strong>{o.title}</strong>
                      <span className="hint">{o.date} · {o.time}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "badges" && (
            <div className="demo-panel">
              <p className="hint">Earned in code from confirmed outings. No streaks, no points, nothing for spending more.</p>
              <BadgeGrid progress={progress} onOpen={setOpenBadge} ids={DEMO_BADGES} />
              {badgeInfo && (
                <div className="badge-detail" role="dialog" aria-label={badgeInfo.name}>
                  <BadgeIcon id={badgeInfo.id} earned={earned.includes(badgeInfo.id)} size={80} />
                  <div>
                    <h3>{badgeInfo.name}</h3>
                    <p>{badgeInfo.rule}</p>
                    <p className="hint">{earned.includes(badgeInfo.id) ? `Earned with ${friends.join(" and ")} on Oct 23.` : `${Math.min(progress[badgeInfo.id]?.have ?? 0, badgeInfo.goal)} of ${badgeInfo.goal} ${badgeInfo.unit}.`}</p>
                    <button type="button" className="secondary" onClick={() => setOpenBadge(null)}>Close</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <BadgeReveal ids={reveal} onView={() => { setTab("badges"); setReveal([]); }} onClose={() => setReveal([])} />
    </div>
  );
}
