"use client";
// Public "Try a group adventure" demo. Everything here is fictional fixture data held in this browser tab:
// no API calls, no bookings, no messages, no posts. Photos never leave the device.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SideQuestLogo } from "./brand";
import { BADGES, BadgeGrid, BadgeIcon, badgeSvg, type BadgeId } from "./badges";

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
const STEPS = ["Start fresh", "Agree on an outing", "Reserve (simulated)", "Tonight’s quest", "We went", "Earlier outings", "Add a photo", "What next?"];
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

function sampleImage(): string {
  // A drawn night scene so the demo never ships someone's real photo.
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 900;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, "#151826");
  sky.addColorStop(1, "#3a3550");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1200, 900);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,248,230,${0.3 + ((i * 37) % 70) / 100})`;
    g.fillRect((i * 173) % 1200, (i * 97) % 520, 2, 2);
  }
  g.fillStyle = "#0e0f17";
  g.fillRect(0, 610, 1200, 290);
  g.strokeStyle = "#e9c98a";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, 600);
  g.quadraticCurveTo(600, 470, 1200, 600);
  g.stroke();
  for (let x = 40; x < 1200; x += 70) {
    g.fillStyle = "#f6dfa8";
    g.beginPath();
    g.arc(x, 600 - Math.sin((x / 1200) * Math.PI) * 64, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(246,223,168,.18)";
    g.fillRect(x - 2, 640, 4, 120 + ((x * 7) % 90));
  }
  [[420, 3], [520, 0], [610, 2]].forEach(([x, k]) => {
    g.fillStyle = "#07070b";
    g.beginPath();
    g.arc(x, 700 - k * 4, 26, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 30, 722 - k * 4, 60, 140);
  });
  return c.toDataURL("image/jpeg", 0.9);
}

async function normalise(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && file.type !== "") throw Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 12_000_000) throw Error("Choose a photo under 12 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error("That photo couldn’t be opened. Try a JPEG or PNG."));
      i.src = url;
    });
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88); // re-encoding drops EXIF, including location
  } finally {
    URL.revokeObjectURL(url);
  }
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

async function drawCard(canvas: HTMLCanvasElement, o: { photo: string; caption: string; title: string; date: string; names: string | null; badge: BadgeId | null; portrait: boolean }) {
  const W = 1080;
  const H = o.portrait ? 1350 : 1080;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const display = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "Georgia";
  const body = getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim() || "system-ui";
  g.fillStyle = "#fbfbfa";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#a3834f";
  g.lineWidth = 2;
  g.strokeRect(36, 36, W - 72, H - 72);
  const img = await loadImage(o.photo);
  const box = { x: 84, y: 84, w: W - 168, h: H - (o.portrait ? 480 : 400) };
  const s = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight); // contain: never crop the subject
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  g.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  let y = box.y + box.h + 78;
  g.fillStyle = "#a3834f";
  g.font = `600 22px ${body}`;
  g.letterSpacing = "6px";
  g.fillText(`${o.date.toUpperCase()} · SIDEQUEST`, 84, y);
  g.letterSpacing = "0px";
  y += 62;
  g.fillStyle = "#17171a";
  g.font = `500 56px ${display}`;
  g.fillText(o.title, 84, y, W - 300);
  if (o.caption) {
    y += 54;
    g.fillStyle = "#3b3a37";
    g.font = `400 30px ${body}`;
    g.fillText(o.caption.slice(0, 80), 84, y, W - 300);
  }
  if (o.names) {
    y += 46;
    g.fillStyle = "#6c6a65";
    g.font = `400 26px ${body}`;
    g.fillText(o.names, 84, y, W - 300);
  }
  if (o.badge) {
    const b = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg(o.badge, true, 160))}`);
    g.drawImage(b, W - 84 - 160, box.y + box.h + 40, 160, 160);
  }
}

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
  const [photo, setPhoto] = useState<{ src: string; caption: string; shared: boolean; sample: boolean } | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [suggest, setSuggest] = useState<number | null>(null);
  const [openBadge, setOpenBadge] = useState<BadgeId | null>(null);
  const [reveal, setReveal] = useState<BadgeId[]>([]);
  const [card, setCard] = useState({ portrait: false, names: true, badge: true });
  const [shareNote, setShareNote] = useState("");
  const cardRef = useRef<HTMLCanvasElement>(null);
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
  set("memory", photo?.shared ? 1 : 0, Boolean(photo?.shared));
  const earned = BADGES.filter((b) => progress[b.id]?.earnedOn).map((b) => b.id);
  const earnedKey = earned.join(",");
  const seen = useRef<Set<BadgeId>>(new Set());
  useEffect(() => {
    const fresh = earned.filter((id) => !seen.current.has(id));
    earned.forEach((id) => seen.current.add(id));
    [...seen.current].forEach((id) => { if (!earned.includes(id)) seen.current.delete(id); });
    if (fresh.length) {
      setReveal(fresh);
      later(() => setReveal((r) => (r === fresh ? [] : r)), 6500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnedKey]);

  // ----- actions
  function plan() {
    const t = request.toLowerCase();
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
    if (n === 1 && !chosen) friendsVote();
    if (n >= 2 && !chosen) setChosen(ideas.find((i) => i.id === "walk")?.id ?? ideas[0]!.id);
    if (n === 2) setReserved(true);
    if (n >= 3 && !reserved) setReserved(true);
    if (n === 3) finishQuest();
    if (n === 4) confirmFriends();
    if (n > 4 && confirmed.length < 2) setConfirmed([ME, ...friends]);
    if (n === 5) setPast(true);
    if (n === 6 && !photo) setPhoto({ src: sampleImage(), caption: "Bridge lights, finally got the shot.", shared: false, sample: true });
    if (n === 7) setSuggest(0);
    setStep(n);
    setTab("plan");
  }
  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    seen.current = new Set();
    setStep(0); setTab("plan"); setRequest(""); setQuick([]); setFriends(FRIENDS); setFacts(null); setMode("first"); setVotes({}); setChosen(null);
    setReserved(false); setDone({}); setConfirmed([]); setPast(false); setPhoto(null); setPhotoError(""); setSuggest(null); setOpenBadge(null); setReveal([]); setShareNote("");
  }

  useEffect(() => {
    if (step === 6 && photo?.shared && cardRef.current)
      void drawCard(cardRef.current, { photo: photo.src, caption: photo.caption, title: pick?.title ?? "Night photo walk", date: "Oct 23", names: card.names ? people.join(", ") : null, badge: card.badge ? (earned.includes("memory") ? "memory" : earned[0] ?? null) : null, portrait: card.portrait });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, photo, card, earnedKey, chosen]);

  async function shareCard(kind: "share" | "download") {
    const canvas = cardRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return;
    const file = new File([blob], "sidequest-memory.png", { type: "image/png" });
    if (kind === "share" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: photo?.caption ?? "" });
        setShareNote("Opened your share sheet. Pick Instagram, Facebook or anywhere else; SideQuest doesn’t post for you.");
      } catch {
        setShareNote("Share cancelled.");
      }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sidequest-memory.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setShareNote(kind === "share" ? "This browser can’t share files directly, so the card was downloaded. Post it from Instagram or Facebook." : "Card downloaded.");
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
            <h1>{facts ? `${pick?.title ?? "Something fun"} with ${friends.join(" and ") || "just you"}` : "Plan something"}</h1>
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
                <section className="demo-start">
                  <p className="demo-intro"><strong>Meet Sid,</strong> SideQuest’s planning assistant. Say what you’re in the mood for, or don’t: Sid can start from nothing.</p>
                  <label>
                    What do you want to do? <span className="hint">(optional)</span>
                    <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Something fun Friday after 7, about $25 each" />
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
                  <button type="button" className="demo-primary" onClick={plan}>Plan it</button>
                </section>
              )}

              {step === 1 && (
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
                      <button type="button" className="demo-primary" onClick={() => setStep(2)}>Review it</button>
                    </div>
                  )}
                </section>
              )}

              {step === 2 && pick && (
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
                      <button type="button" className="demo-primary" onClick={() => setStep(3)}>See tonight’s quest</button>
                    </div>
                  )}
                </section>
              )}

              {step === 3 && (
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
                    <button type="button" className="demo-primary" onClick={() => setStep(4)}>Later that night…</button>
                  </div>
                </section>
              )}

              {step === 4 && (
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
                    <button type="button" className="demo-primary" disabled={confirmed.length < 2} onClick={() => setStep(5)}>Next</button>
                  </div>
                </section>
              )}

              {step === 5 && (
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
                  <div className="demo-actions"><button type="button" className="demo-primary" onClick={() => setStep(6)}>Add a photo</button></div>
                </section>
              )}

              {step === 6 && (
                <section className="demo-photo">
                  <span className="eyebrow">Memories</span>
                  <h2>Add a photo from tonight</h2>
                  {!photo ? (
                    <>
                      <p>From your phone or laptop. It stays on this device in the demo.</p>
                      <div className="demo-actions">
                        <label className="button demo-upload">
                          Choose a photo
                          <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setPhotoError(""); void normalise(f).then((src) => setPhoto({ src, caption: "", shared: false, sample: false })).catch((err) => setPhotoError(err.message)); }} />
                        </label>
                        <button type="button" className="secondary" onClick={() => setPhoto({ src: sampleImage(), caption: "Bridge lights, finally got the shot.", shared: false, sample: true })}>Use a sample photo</button>
                      </div>
                      {photoError && <p role="alert">{photoError}</p>}
                    </>
                  ) : !photo.shared ? (
                    <div className="photo-draft">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.src} alt={photo.sample ? "Sample image: bridge lights at night" : "Your photo"} />
                      <div>
                        <p className="demo-meta">Private draft · only you can see it</p>
                        <label>Caption <span className="hint">(optional)</span><input value={photo.caption} maxLength={80} onChange={(e) => setPhoto({ ...photo, caption: e.target.value })} /></label>
                        <p className="hint">Location data is removed. Sharing with the group doesn’t post anywhere else.</p>
                        <div className="demo-actions">
                          <button type="button" className="demo-primary" onClick={() => setPhoto({ ...photo, shared: true })}>Share with this group</button>
                          <button type="button" className="secondary" onClick={() => setPhoto(null)}>Discard</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="card-builder">
                      <canvas ref={cardRef} className={card.portrait ? "is-portrait" : undefined} aria-label="Share card preview" role="img" />
                      <div>
                        <p className="demo-meta">Shared with Maya and Jordan</p>
                        <fieldset>
                          <legend>Share card</legend>
                          <div className="chips">
                            <button type="button" aria-pressed={!card.portrait} onClick={() => setCard({ ...card, portrait: false })}>Square</button>
                            <button type="button" aria-pressed={card.portrait} onClick={() => setCard({ ...card, portrait: true })}>Portrait</button>
                          </div>
                          <label className="choice"><input type="checkbox" checked={card.names} onChange={(e) => setCard({ ...card, names: e.target.checked })} />Show names</label>
                          <label className="choice"><input type="checkbox" checked={card.badge} onChange={(e) => setCard({ ...card, badge: e.target.checked })} />Show a badge</label>
                        </fieldset>
                        <div className="demo-actions">
                          <button type="button" className="demo-primary" onClick={() => void shareCard("share")}>Share to Instagram, Facebook…</button>
                          <button type="button" className="secondary" onClick={() => void shareCard("download")}>Download image</button>
                          <button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(photo.caption); setShareNote("Caption copied."); }}>Copy caption</button>
                        </div>
                        {shareNote && <p role="status">{shareNote}</p>}
                        <p className="hint">Uses your device’s share sheet; Instagram and Facebook show up there when installed. Nothing is posted automatically.</p>
                        <button type="button" className="demo-primary" onClick={() => setStep(7)}>What next?</button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {step === 7 && (
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
                      {o.id === "current" && photo?.shared ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.src} alt="" />
                      ) : (
                        <div className="memory-blank" aria-hidden="true">{o.category}</div>
                      )}
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
              <BadgeGrid progress={progress} onOpen={setOpenBadge} />
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

      {reveal.length > 0 && (
        <div className="badge-reveal" role="status">
          <div className="badge-reveal-icons">{reveal.map((id) => <BadgeIcon key={id} id={id} earned size={reveal.length > 1 ? 56 : 72} className="is-revealing" />)}</div>
          <div>
            <span className="eyebrow">{reveal.length > 1 ? `${reveal.length} badges earned` : "Badge earned"}</span>
            <strong>{reveal.map((id) => BADGES.find((b) => b.id === id)!.name).join(", ")}</strong>
            <div className="demo-actions">
              <button type="button" className="secondary" onClick={() => { setTab("badges"); setReveal([]); }}>View badges</button>
              <button type="button" className="secondary" onClick={() => setReveal([])}>Dismiss</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
