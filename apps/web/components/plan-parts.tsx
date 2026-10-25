"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  clockTime,
  initials,
  localTime,
  money,
  planStatusLabel,
  priceKindLabel,
  safeUrl,
  zonedToUtc,
  type Option,
  type PlanView,
} from "@/lib/views";

/** Small decorative Anatomy figure for empty states; hidden from assistive technology. */
export function Figure({ name, className = "" }: { name: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`figure-small ${className}`} src={`/illustrations/${name}.svg`} alt="" aria-hidden="true" draggable={false} />;
}

export function Avatars({ people, voted = [] }: { people: { id: string; name: string }[]; voted?: string[] }) {
  return (
    <ul className="avatar-stack" aria-label={people.map((p) => p.name).join(", ")}>
      {people.map((p) => (
        <li key={p.id} className={voted.includes(p.id) ? "is-voted" : undefined} title={p.name} aria-hidden="true">
          {initials(p.name)}
        </li>
      ))}
    </ul>
  );
}

// Lifecycle as five readable stages. Statuses come from the backend; anything unknown stays on "Options".
const STAGES = ["Request", "Options", "Votes", "Agreed", "Wrapped up"];
export function stageOf(status: string) {
  if (status === "waiting_connections") return 0;
  if (status === "voting") return 2;
  if (["selected", "quoting", "awaiting_payment_approval", "booking", "needs_handoff", "handoff", "booked"].includes(status)) return 3;
  if (status === "closed") return 4;
  return 1;
}
export function PlanJourney({ status }: { status: string }) {
  const at = stageOf(status);
  return (
    <figure className="journey">
      <ol style={{ ["--progress" as string]: at / (STAGES.length - 1) }}>
        {STAGES.map((label, i) => (
          <li key={label} className={i < at ? "is-done" : i === at ? "is-current" : undefined} aria-current={i === at ? "step" : undefined}>
            <span className="journey-dot" aria-hidden="true" />
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <figcaption className="hint">
        Stage {at + 1} of {STAGES.length}: {planStatusLabel(status)}
      </figcaption>
    </figure>
  );
}

/** One readable next step, derived only from the plan's recorded state and the viewer's own vote. */
export function NextAction({ plan, userId }: { plan: PlanView; userId: string }) {
  const people = plan.participants.length;
  const voted = new Set(plan.votes.filter((v) => v.versionId === plan.activeVersionId).map((v) => v.userId));
  const mine = voted.has(userId);
  const [title, body, href] =
    plan.status === "voting" && !mine
      ? ["Your vote is needed", "Mark every option that works for you, then pick a favorite.", "#options"]
      : plan.status === "voting"
        ? ["You’ve voted", `${voted.size} of ${people} ${people === 1 ? "person has" : "people have"} voted on these options. You can change your vote until the group decides.`, "#options"]
        : plan.status === "clarifying"
          ? ["Sid needs a detail", "Check the group chat and answer Sid’s question.", "#group-chat"]
          : ["planning", "change_requested"].includes(plan.status)
            ? ["Sid is comparing places", "New options appear here when they’re ready. Earlier votes don’t carry over to new options.", "#group-chat"]
            : plan.status === "waiting_connections"
              ? ["Waiting for friends", "Planning starts once everyone invited is connected.", null]
              : stageOf(plan.status) === 3
                ? ["Plan agreed", "Add it to your calendar. Calendar events don’t reserve the venue.", "#agreed"]
                : [planStatusLabel(plan.status), "", null];
  return (
    <div className="next-action">
      <span className="eyebrow">Next</span>
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {href && <a className="back" href={href}>{href === "#group-chat" ? "Open the group chat" : href === "#agreed" ? "See the plan" : "Go to the options"} ↓</a>}
    </div>
  );
}

/** Bar of N seats (one per member); filled seats are members who marked this option as workable. */
function VoteBar({ yes, favorite, total }: { yes: number; favorite: number; total: number }) {
  const seats = Math.max(total, yes, 1);
  return (
    <div className="vote-bar">
      <svg viewBox={`0 0 ${seats * 14} 8`} aria-hidden="true" preserveAspectRatio="none">
        {Array.from({ length: seats }, (_, i) => (
          <rect key={i} x={i * 14} y="0" width="12" height="8" rx="1" className={i < yes ? "is-yes" : undefined} />
        ))}
      </svg>
      <span>
        {yes} of {total} can do this{favorite ? ` · ${favorite} favorite${favorite === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}

const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

export function OptionCard({
  option,
  plan,
  acceptable,
  favorite,
  onAcceptable,
  onFavorite,
}: {
  option: Option;
  plan: PlanView;
  acceptable: boolean;
  favorite: boolean;
  onAcceptable: (checked: boolean) => void;
  onFavorite: () => void;
}) {
  const sources = plan.sources.filter((s) => option.sourceIds.includes(s.id) && safeUrl(s.url));
  const count = plan.tally?.versionId === option.versionId ? plan.tally.options.find((o) => o.optionId === option.id) : undefined;
  const votes = plan.votes.filter((v) => v.versionId === option.versionId);
  const yes = count?.acceptable ?? votes.filter((v) => v.acceptableOptionIds.includes(option.id)).length;
  const fav = count?.favorite ?? votes.filter((v) => v.favoriteOptionId === option.id).length;
  const when = localTime(option.startAt, option.timeZone);
  return (
    <article className={`option-card${acceptable ? " is-picked" : ""}`} aria-labelledby={`option-${option.id}`}>
      <header>
        <span className="option-letter" aria-hidden="true">{option.label}</span>
        <div>
          <h3 id={`option-${option.id}`}>
            <span className="visually-hidden">Option {option.label}: </span>
            {option.title}
          </h3>
          {option.fit && (
            <span className={`fit-tag${option.fit === "fits_known_constraints" ? " is-fit" : ""}`}>
              {option.fit === "fits_known_constraints" ? "Fits everyone’s known times" : "Some schedules unknown"}
            </span>
          )}
        </div>
      </header>
      <dl className="option-facts">
        <div>
          <dt>When</dt>
          <dd>{when ?? "Time unknown — check showtimes"}</dd>
        </div>
        <div>
          <dt>Cost per person</dt>
          <dd>
            {option.estimatedPerPerson ? money(option.estimatedPerPerson) : "Unknown"}
            <small> · {priceKindLabel[option.priceKind] ?? option.priceKind}</small>
          </dd>
        </div>
      </dl>
      {option.timeline && option.timeline.length > 1 && (
        <ol className="mini-timeline" aria-label="Sequence">
          {option.timeline.map((step) => (
            <li key={`${step.candidateId}:${step.startAt}`}>
              <time dateTime={step.startAt}>{clockTime(step.startAt, option.timeZone)}</time> {step.title}
            </li>
          ))}
        </ol>
      )}
      {option.publicExplanation && <p>{option.publicExplanation}</p>}
      {option.uncertainties.length > 0 && (
        <ul className="unknowns" aria-label="Not yet known">
          {option.uncertainties.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
      {sources.length > 0 && (
        <p className="option-sources">
          <span>Sources</span>
          {sources.map((s) => (
            <a key={s.id} href={safeUrl(s.url)!} target="_blank" rel="noreferrer" title={s.title}>
              {host(s.url)} ↗{s.fetchedAt && <small> checked {clockTime(s.fetchedAt, option.timeZone)}</small>}
            </a>
          ))}
        </p>
      )}
      <VoteBar yes={yes} favorite={fav} total={plan.participants.length} />
      <div className="option-vote">
        <label className="choice">
          <input type="checkbox" checked={acceptable} onChange={(e) => onAcceptable(e.target.checked)} />
          {option.label}. {option.title}
          <span className="visually-hidden"> works for me</span>
        </label>
        <label className="choice">
          <input type="radio" name="favorite" checked={favorite} disabled={!acceptable} onChange={onFavorite} />
          My favorite
        </label>
      </div>
    </article>
  );
}

type CalendarResult = { mode: "google" | "ics"; eventId?: string; icsUrl: string };
export function AgreedPlan({ plan, planId }: { plan: PlanView; planId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CalendarResult | null>(null);
  const [error, setError] = useState("");
  const option = plan.options.find((o) => o.id === plan.decision?.optionId);
  if (!plan.decision || !option || stageOf(plan.status) < 3) return null;
  const attendees = plan.participants.filter((p) => plan.decision!.attendeeUserIds.includes(p.id));
  const notComing = plan.participants.filter((p) => !plan.decision!.attendeeUserIds.includes(p.id));
  const ics = `/api/plans/${encodeURIComponent(planId)}/calendar.ics`;
  const steps = option.timeline?.length ? option.timeline : null;
  return (
    <section className="panel agreed" id="agreed" aria-labelledby="agreed-title">
      <span className="eyebrow">Agreed plan</span>
      <h2 id="agreed-title">{option.title}</h2>
      <dl className="option-facts">
        <div>
          <dt>When</dt>
          <dd>{localTime(option.startAt, option.timeZone) ?? "Time not recorded yet"}</dd>
        </div>
        <div>
          <dt>Who’s going</dt>
          <dd>{attendees.map((p) => p.name).join(", ") || "Not recorded"}</dd>
        </div>
        <div>
          <dt>Cost per person</dt>
          <dd>
            {option.estimatedPerPerson ? money(option.estimatedPerPerson) : "Unknown"}
            <small> · {priceKindLabel[option.priceKind] ?? option.priceKind}</small>
          </dd>
        </div>
      </dl>
      {notComing.length > 0 && <p className="hint">Not attending: {notComing.map((p) => p.name).join(", ")}</p>}
      {steps && (
        <ol className="itinerary" aria-label="Order of the outing">
          {steps.map((step) => (
            <li key={`${step.candidateId}:${step.startAt}`}>
              <time dateTime={step.startAt}>{clockTime(step.startAt, option.timeZone)}</time>
              <span>{step.title}</span>
              <small>until {clockTime(step.endAt, option.timeZone)}</small>
            </li>
          ))}
        </ol>
      )}
      <div className="action-row">
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void api<CalendarResult>(`/plans/${encodeURIComponent(planId)}/calendar`, { method: "POST", body: "{}" })
              .then(setResult)
              .catch((e) => setError(e instanceof Error ? e.message : "Couldn’t add it to your calendar."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Adding…" : result?.mode === "google" ? "Update my calendar" : "Add to my calendar"}
        </button>
        <a className="button secondary-link" href={ics} download>
          Download calendar file
        </a>
      </div>
      {result?.mode === "google" && <p role="status">Added to your Google Calendar. Trying again updates the same event.</p>}
      {result?.mode === "ics" && (
        <p role="status">
          Your Google Calendar isn’t connected for adding events. Download the calendar file, or{" "}
          <a className="inline-link" href="/api/calendar/connect?write=1">allow SideQuest to add outings</a>.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        A calendar event only holds the time. It doesn’t reserve the venue or buy tickets; see{" "}
        <Link className="inline-link" href={`/plans/${encodeURIComponent(planId)}/payment`}>My share</Link> for checkout.
      </p>
    </section>
  );
}

/** Pre-booking changes route to private facts or Sid; after booking they go to the buyer as a handoff. */
export function SomethingChanged({ plan, planId, onDone }: { plan: PlanView; planId: string; onDone: (notice: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/plans/${encodeURIComponent(planId)}`;
  const booked = ["booked", "handoff"].includes(plan.status);
  return (
    <details className="something-changed">
      <summary>Something changed?</summary>
      {!booked ? (
        <ul className="change-paths">
          <li>
            <Link href={`${base}/private#availability`}>My times changed</Link>
            <span className="hint">Update when you’re free. Only you see the details.</span>
          </li>
          <li>
            <Link href={`${base}/private#budget`}>My budget changed</Link>
            <span className="hint">Set a private spending limit.</span>
          </li>
          <li>
            <a href="#group-chat">Tell Sid in the group chat</a>
            <span className="hint">For a new place, time or member.</span>
          </li>
        </ul>
      ) : (
        <form
          className="form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void api(`${base}/change-requests`, { method: "POST", body: JSON.stringify({ text, expectedRevision: plan.revision }) })
              .then(() => {
                setText("");
                onDone("Change request sent to the buyer. Nothing was cancelled or refunded automatically.");
              })
              .catch((e) => setError(e instanceof Error ? e.message : "The change request couldn’t be sent."))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            What needs to change?
            <textarea required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Mel can’t make it anymore." />
          </label>
          <p className="hint">This is booked, so the buyer reviews the venue’s change or cancellation options. Nothing changes automatically.</p>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy}>{busy ? "Sending…" : "Send to the buyer"}</button>
        </form>
      )}
    </details>
  );
}

// ---------- Private availability ----------

type Range = { from: string; to: string };
const DAY_START = 6; // track runs 6 AM to midnight
const pct = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Math.min(100, Math.max(0, ((h! + m! / 60 - DAY_START) / (24 - DAY_START)) * 100));
};
/** 6 AM–midnight track with free ranges filled; text equivalent is supplied by the caller. */
export function DayTrack({ ranges, label }: { ranges: Range[]; label: string }) {
  return (
    <figure className="day-track">
      <div className="day-track-bar" aria-hidden="true">
        {ranges.map((r, i) => (
          <span key={i} style={{ left: `${pct(r.from)}%`, width: `${Math.max(0, pct(r.to === "00:00" ? "24:00" : r.to) - pct(r.from))}%` }} />
        ))}
      </div>
      <div className="day-track-scale" aria-hidden="true">
        <span>6a</span>
        <span>noon</span>
        <span>6p</span>
        <span>12a</span>
      </div>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  );
}

const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
};
const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

export function AvailabilityEditor({
  planId,
  timeZone,
  revision,
  calendarConnected,
  onSaved,
}: {
  planId: string;
  timeZone: string;
  revision: number;
  calendarConnected: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(() => todayIn(timeZone));
  const [ranges, setRanges] = useState<Range[]>([{ from: "18:00", to: "22:00" }]);
  const [busyDay, setBusyDay] = useState(false);
  const [tentative, setTentative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [manual, setManual] = useState(false);
  const shown = busyDay ? [] : ranges;
  const summary = busyDay
    ? `Not free on ${date}.`
    : `Free on ${date}: ${ranges.map((r) => `${fmt12(r.from)} to ${fmt12(r.to)}`).join(", ")}.`;
  return (
    <section className="panel" id="availability" aria-labelledby="availability-title">
      <span className="eyebrow">Only you see this</span>
      <h2 id="availability-title">When you’re free</h2>
      <div className="calendar-first">
        <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="33" rx="3" /><path d="M6 18h36M15 5v8M33 5v8" /><path d="M15 27h6M27 27h6M15 34h6" className="cal-gold" /></svg>
        <div>
          <strong>{calendarConnected ? "Google Calendar is connected" : "Let Sid check your calendar"}</strong>
          <p>{calendarConnected ? "Sid already sees when you’re busy (never what the events are). Add an exception below if needed." : "Sid reads only busy and free times, never event names, and checks every option for you."}</p>
          <div className="action-row">
            <a className="button" href="/api/calendar/connect">{calendarConnected ? "Reconnect" : "Connect Google Calendar"}</a>
            <button type="button" className="secondary" aria-expanded={manual} onClick={() => setManual((v) => !v)}>{manual ? "Hide manual times" : calendarConnected ? "Add an exception" : "I’ll add times myself"}</button>
          </div>
        </div>
      </div>
      {manual && (
      <>
      <p>
        One day at a time. Friends see whether an option fits everyone, never your hours. Times are in <strong>{timeZone}</strong>.
      </p>
      <form
        className="form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setSaved("");
          const bad = shown.find((r) => !r.from || !r.to || (r.to !== "00:00" && r.to <= r.from));
          if (bad) return setError("Each time range needs an end after its start.");
          const end = (r: Range) => (r.to === "00:00" ? zonedToUtc(nextDay(date), "00:00", timeZone) : zonedToUtc(date, r.to, timeZone));
          const fact = {
            kind: "availability",
            value: {
              window: { startAt: zonedToUtc(date, "00:00", timeZone), endAt: zonedToUtc(nextDay(date), "00:00", timeZone) },
              available: shown.map((r) => ({ startAt: zonedToUtc(date, r.from, timeZone), endAt: end(r) })),
              unavailable: [],
              certainty: tentative ? "tentative" : "explicit",
            },
          };
          setBusy(true);
          void api(`/plans/${encodeURIComponent(planId)}/private`, { method: "PUT", body: JSON.stringify({ fact, expectedRevision: revision }) })
            .then(async () => {
              setSaved("Saved privately. Sid will recheck the options, and votes on changed options reset.");
              await onSaved();
            })
            .catch((e) => setError(e instanceof Error ? e.message : "Your times couldn’t be saved."))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Day
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="choice">
          <input type="checkbox" checked={busyDay} onChange={(e) => setBusyDay(e.target.checked)} />
          I’m not free this day
        </label>
        {!busyDay && (
          <fieldset className="ranges">
            <legend>Free between</legend>
            {ranges.map((r, i) => (
              <div className="range-row" key={i}>
                <label>
                  From
                  <input type="time" required value={r.from} onChange={(e) => setRanges((v) => v.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                </label>
                <label>
                  To
                  <input type="time" required value={r.to} onChange={(e) => setRanges((v) => v.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                </label>
                {ranges.length > 1 && (
                  <button type="button" className="secondary" aria-label={`Remove time range ${i + 1}`} onClick={() => setRanges((v) => v.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            {ranges.length < 4 && (
              <button type="button" className="secondary" onClick={() => setRanges((v) => [...v, { from: "12:00", to: "14:00" }])}>
                Add another time
              </button>
            )}
          </fieldset>
        )}
        <DayTrack ranges={shown} label={summary} />
        <p className="hint" aria-hidden="true">{summary}</p>
        <label className="choice">
          <input type="checkbox" checked={tentative} onChange={(e) => setTentative(e.target.checked)} />
          These times might still change
        </label>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">{saved}</p>}
        <button disabled={busy}>{busy ? "Saving…" : "Save this day"}</button>
      </form>
      </>
      )}
    </section>
  );
}

export function SpendingLimitEditor({ planId, revision, onSaved }: { planId: string; revision: number; onSaved: () => Promise<void> | void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  return (
    <section className="panel" id="budget" aria-labelledby="budget-title">
      <span className="eyebrow">Only you see this</span>
      <h2 id="budget-title">Your spending limit</h2>
      <p>Sid keeps options at or under this for your share. Friends never see the amount.</p>
      <form
        className="form-panel inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setSaved("");
          const amountMinor = Math.round(Number(amount) * 100);
          if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter an amount above $0.");
          setBusy(true);
          void api(`/plans/${encodeURIComponent(planId)}/private`, {
            method: "PUT",
            body: JSON.stringify({ fact: { kind: "spending_limit", value: { maximumShare: { amountMinor, currency: "USD" } } }, expectedRevision: revision }),
          })
            .then(async () => {
              setAmount("");
              setSaved("Limit saved privately. Sid will recheck the options.");
              await onSaved();
            })
            .catch((e) => setError(e instanceof Error ? e.message : "Your limit couldn’t be saved."))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Maximum for my share (USD)
          <input type="number" inputMode="decimal" min="1" step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="40" />
        </label>
        <button disabled={busy}>{busy ? "Saving…" : "Save limit"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
    </section>
  );
}

/** Own availability fact rendered back as a day track in the plan's zone (owner-only page). */
export function AvailabilityFact({ value, timeZone }: { value: unknown; timeZone: string }): ReactNode {
  const v = value as { window?: { startAt: string }; available?: { startAt: string; endAt: string }[] | null; certainty?: string } | null;
  if (!v?.window) return <p>Availability recorded privately for this plan.</p>;
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const ranges = (v.available ?? []).map((r) => ({ from: hhmm(r.startAt), to: hhmm(r.endAt) }));
  const day = new Date(v.window.startAt).toLocaleDateString("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" });
  const text = ranges.length ? `Free ${day}: ${ranges.map((r) => `${fmt12(r.from)}–${fmt12(r.to)}`).join(", ")}` : `Not free ${day}`;
  return (
    <>
      <p>
        {text}
        {v.certainty === "tentative" ? " · might change" : ""}
      </p>
      <DayTrack ranges={ranges} label={text} />
    </>
  );
}
