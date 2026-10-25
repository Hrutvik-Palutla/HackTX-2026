// The eight shared-adventure badges: one registry for names, rules and art. Art is a raw SVG string
// so the same drawing renders in the page and on exported share cards.
export type BadgeId = "first-outing" | "three-outings" | "five-outings" | "variety" | "after-dark" | "outdoors" | "quest-team" | "memory" | "first-friend" | "circle" | "full-table" | "planner" | "connector" | "agreed";
export type Badge = { id: BadgeId; name: string; rule: string; goal: number; unit: string };

export const BADGES: Badge[] = [
  { id: "first-outing", name: "Out the Door", rule: "Your first outing together, confirmed by at least two of you.", goal: 1, unit: "outing" },
  { id: "three-outings", name: "Again Soon", rule: "Three outings together, each confirmed by at least two of you.", goal: 3, unit: "outings" },
  { id: "five-outings", name: "The Regulars", rule: "Five outings together, each confirmed by at least two of you.", goal: 5, unit: "outings" },
  { id: "variety", name: "A Little of Everything", rule: "Three outings across three different kinds: food, culture, outdoors, games or music.", goal: 3, unit: "kinds" },
  { id: "after-dark", name: "After Hours", rule: "Two outings that started at or after 7 PM local time.", goal: 2, unit: "late outings" },
  { id: "outdoors", name: "Fresh Air", rule: "Two outdoor outings.", goal: 2, unit: "outdoor outings" },
  { id: "quest-team", name: "Team Effort", rule: "All five challenges on one quest, finished by at least two different people.", goal: 5, unit: "challenges" },
  { id: "memory", name: "Worth Keeping", rule: "The first photo or voice memo saved from an outing.", goal: 1, unit: "memory" },
  { id: "first-friend", name: "Plus One", rule: "Connect with your first friend on SideQuest.", goal: 1, unit: "friend" },
  { id: "circle", name: "Inner Circle", rule: "Five friends connected.", goal: 5, unit: "friends" },
  { id: "full-table", name: "Full Table", rule: "One plan with four or more people.", goal: 4, unit: "people in a plan" },
  { id: "planner", name: "The Instigator", rule: "Start three plans.", goal: 3, unit: "plans" },
  { id: "connector", name: "Bridge Builder", rule: "Make plans with five different people.", goal: 5, unit: "people" },
  { id: "agreed", name: "It’s a Date", rule: "Get a group to agree on a plan.", goal: 1, unit: "agreed plan" },
];

const INK = "#17171a";
const GOLD = "#a3834f";
const MUTE = "#bdb7aa";

// Motifs on a 64 grid, centred in the medallion. `a` = main stroke colour, `g` = detail colour.
const MOTIF: Record<BadgeId, (a: string, g: string) => string> = {
  "first-outing": (a, g) =>
    `<path d="M24 44V27a8 8 0 0 1 16 0v17" stroke="${a}"/><path d="M21 44h22" stroke="${a}"/><circle cx="36" cy="36" r="1.2" fill="${a}" stroke="none"/><ellipse cx="29" cy="49.5" rx="1.6" ry="2.4" fill="${g}" stroke="none"/><ellipse cx="34.5" cy="52.5" rx="1.6" ry="2.4" fill="${g}" stroke="none"/>`,
  "three-outings": (a, g) =>
    [0, 1, 2]
      .map((i) => `<g transform="translate(${18 + i * 5} ${24 + i * 4}) rotate(${-8 + i * 8} 9 6)"><path d="M0 0h18v4a2 2 0 0 0 0 4v4H0V8a2 2 0 0 0 0-4z" fill="#fbfbfa" stroke="${i === 2 ? a : g}"/><path d="M12 1v10" stroke="${g}" stroke-dasharray="1.5 1.5"/></g>`)
      .join(""),
  "five-outings": (a, g) =>
    Array.from({ length: 5 }, (_, i) => {
      const t = (i / 5) * Math.PI * 2 - Math.PI / 2;
      return `<circle cx="${(32 + Math.cos(t) * 14).toFixed(2)}" cy="${(33 + Math.sin(t) * 14).toFixed(2)}" r="2.6" fill="${g}" stroke="none"/>`;
    }).join("") + `<ellipse cx="32" cy="31" rx="6.5" ry="2.4" stroke="${a}"/><path d="M28 33v6M36 33v6" stroke="${a}"/>`,
  variety: (a, g) =>
    `<circle cx="32" cy="32" r="13" stroke="${a}"/><path d="M32 32L32 21" stroke="${a}"/><path d="M32 32l9.5 5.5" stroke="${g}"/><path d="M32 32l-9.5 5.5" stroke="${a}" stroke-dasharray="2 2"/><circle cx="32" cy="32" r="1.8" fill="${g}" stroke="none"/>`,
  "after-dark": (a, g) =>
    `<path d="M36 18a10 10 0 1 0 8 14 8 8 0 1 1-8-14z" stroke="${a}"/><path d="M18 44h28" stroke="${a}"/><path d="M22 48h20" stroke="${g}"/><circle cx="22" cy="24" r="1.1" fill="${g}" stroke="none"/><circle cx="26" cy="18" r="0.9" fill="${g}" stroke="none"/>`,
  outdoors: (a, g) =>
    `<path d="M22 50c4-6 14-4 18-10s-2-10 4-14" stroke="${a}" stroke-dasharray="2.5 2"/><path d="M26 30c0-7 6-10 10-10 0 6-4 10-10 10z" stroke="${a}"/><path d="M26 30l6-6" stroke="${g}"/><path d="M38 38c0-5 4-7 7-7 0 4-3 7-7 7z" stroke="${g}"/>`,
  "quest-team": (a, g) =>
    `<path d="M22 50V18" stroke="${a}"/><path d="M22 19l15 5-15 5" stroke="${a}"/><path d="M42 50V22" stroke="${g}"/><path d="M42 23l-13 5 13 5" stroke="${g}" fill="#fbfbfa"/>`,
  "first-friend": (a, g) =>
    `<circle cx="26" cy="27" r="5" stroke="${a}"/><path d="M17 44a9 9 0 0 1 18 0" stroke="${a}"/><path d="M42 24v10M37 29h10" stroke="${g}"/>`,
  circle: (a, g) =>
    Array.from({ length: 5 }, (_, i) => { const t = (i / 5) * Math.PI * 2 - Math.PI / 2; return `<circle cx="${(32 + Math.cos(t) * 13).toFixed(2)}" cy="${(32 + Math.sin(t) * 13).toFixed(2)}" r="3.6" stroke="${i ? a : g}"/>`; }).join("") + `<circle cx="32" cy="32" r="13" stroke="${g}" stroke-dasharray="1.5 3"/>`,
  "full-table": (a, g) =>
    `<rect x="24" y="26" width="16" height="12" rx="1.5" stroke="${a}"/>` + [[32, 19], [32, 45], [17, 32], [47, 32]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${g}" stroke="none"/>`).join(""),
  planner: (a, g) =>
    `<rect x="20" y="20" width="24" height="24" rx="2" stroke="${a}"/><path d="M20 27h24M26 17v6M38 17v6" stroke="${a}"/><path d="M26 35l4 4 8-9" stroke="${g}"/>`,
  connector: (a, g) =>
    `<path d="M16 42c6-14 26-14 32 0" stroke="${a}"/><path d="M16 42h32" stroke="${a}"/><path d="M24 36v6M32 33v9M40 36v6" stroke="${g}"/><circle cx="16" cy="42" r="2" fill="${g}" stroke="none"/><circle cx="48" cy="42" r="2" fill="${g}" stroke="none"/>`,
  agreed: (a, g) =>
    `<path d="M22 34l7 7 14-16" stroke="${a}" stroke-width="2.4"/><path d="M45 18l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" fill="${g}" stroke="none"/>`,
  memory: (a, g) =>
    `<rect x="19" y="22" width="26" height="21" rx="1.5" stroke="${a}"/><path d="M22 40l7-8 5 5 3-3 5 6" stroke="${a}"/><circle cx="38" cy="28" r="2" stroke="${g}"/><path d="M45 15v6M42 18h6" stroke="${g}"/>`,
};

/** Shared medallion: notched outer ring, inner ring, motif. Earned = ink + gold; unfinished = muted. */
export function badgeSvg(id: BadgeId, earned: boolean, size = 48) {
  const a = earned ? INK : MUTE;
  const g = earned ? GOLD : MUTE;
  const notches = Array.from({ length: 16 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2;
    return `M${(32 + Math.cos(t) * 28.5).toFixed(2)} ${(32 + Math.sin(t) * 28.5).toFixed(2)}L${(32 + Math.cos(t) * 30.5).toFixed(2)} ${(32 + Math.sin(t) * 30.5).toFixed(2)}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="28.5" fill="#fbfbfa" stroke="${a}"/><path d="${notches}" stroke="${g}" stroke-width="1" opacity="0.75"/><circle cx="32" cy="32" r="24" stroke="${g}" stroke-width="0.9"${earned ? "" : ' stroke-dasharray="2 2.5"'}/>${MOTIF[id](a, g)}</svg>`;
}

export function BadgeIcon({ id, earned, size = 48, className = "" }: { id: BadgeId; earned: boolean; size?: number; className?: string }) {
  return <span className={`badge-icon ${earned ? "is-earned" : ""} ${className}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: badgeSvg(id, earned, size) }} />;
}

/** Earned first, then milestones with progress in words (never colour alone). */
export function BadgeGrid({ progress, onOpen, ids }: { progress: Partial<Record<BadgeId, { have: number; earnedOn?: string }>>; onOpen?: (id: BadgeId) => void; ids?: BadgeId[] }) {
  const rows = BADGES.filter((b) => !ids || ids.includes(b.id)).sort((x, y) => Number(Boolean(progress[y.id]?.earnedOn)) - Number(Boolean(progress[x.id]?.earnedOn)));
  return (
    <ul className="badge-grid">
      {rows.map((b) => {
        const p = progress[b.id];
        const earned = Boolean(p?.earnedOn);
        return (
          <li key={b.id}>
            <button type="button" className={`badge-card${earned ? " is-earned" : ""}`} onClick={() => onOpen?.(b.id)} aria-label={`${b.name}. ${earned ? `Earned ${p!.earnedOn}` : `${Math.min(p?.have ?? 0, b.goal)} of ${b.goal} ${b.unit}`}. ${b.rule}`}>
              <BadgeIcon id={b.id} earned={earned} />
              <strong>{b.name}</strong>
              <small>{earned ? `Earned ${p!.earnedOn}` : `${Math.min(p?.have ?? 0, b.goal)} of ${b.goal} ${b.unit}`}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- reveal: pop + a soft two-note chime, throttled so a run of awards stays pleasant ----------
let lastChime = 0;
export function chime() {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const now = Date.now();
  if (now - lastChime < 4000) return; // several awards in a row get one chime
  lastChime = now;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [659.25, 987.77].forEach((f, i) => {
      const o = ctx.createOscillator();
      const v = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.11;
      v.gain.setValueAtTime(0, t);
      v.gain.linearRampToValueAtTime(0.07, t + 0.02);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(v).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1);
    });
    setTimeout(() => void ctx.close(), 1400);
  } catch {
    /* audio unavailable: silent */
  }
}

/** One combined pop-out for new badges. `quiet` = a small chip instead of the full card (for rapid repeats). */
export function BadgeReveal({ ids, onView, onClose }: { ids: BadgeId[]; onView?: () => void; onClose: () => void }) {
  if (!ids.length) return null;
  const names = ids.map((id) => BADGES.find((b) => b.id === id)?.name ?? id);
  return (
    <div className="badge-reveal" aria-live="polite">
      <div className="badge-reveal-icons">
        {ids.slice(0, 3).map((id, i) => (
          <span key={id} className="badge-pop" style={{ animationDelay: `${i * 110}ms` }}>
            <BadgeIcon id={id} earned size={ids.length > 1 ? 56 : 72} />
          </span>
        ))}
      </div>
      <div>
        <span className="eyebrow">{ids.length > 1 ? `${ids.length} badges earned` : "Badge earned"}</span>
        <strong>{names.join(", ")}</strong>
        <div className="demo-actions">
          {onView && <button type="button" className="secondary" onClick={onView}>View badges</button>}
          <button type="button" className="secondary" onClick={onClose}>Nice</button>
        </div>
      </div>
    </div>
  );
}
