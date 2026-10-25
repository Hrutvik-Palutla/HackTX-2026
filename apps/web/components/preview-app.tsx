"use client";
import NextLink from "next/link";
import { useState, type ComponentProps, type FormEvent } from "react";
import { AppShell, PageHeading } from "./app-shell";
import { PlanNavigation } from "./plan-navigation";
import { Feedback } from "./feedback";
function Link({
  href,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string }) {
  return <NextLink href={`${href}?preview=1`} {...props} />;
}
const titles: Record<string, string> = {
  plans: "Plans",
  friends: "Friends",
  settings: "Account",
  detail: "Friday night",
  private: "Private details",
  payment: "Your share",
  studio: "Studio",
  login: "Sign in",
  signup: "Create an account",
  invite: "Friend invitation",
};

export function PreviewApp({
  view = "plans",
  id = "friday",
}: {
  view?: string;
  id?: string;
}) {
  const [message, setMessage] = useState("");
  const [acceptable, setAcceptable] = useState<string[]>([]);
  const [favorite, setFavorite] = useState("");
  const [none, setNone] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  function signIn(event: FormEvent) {
    event.preventDefault();
    setCodeSent(true);
    setMessage(
      "Preview only. No verification code was sent and no session was created.",
    );
  }
  return (
    <AppShell view={view} preview>
      <PageHeading
        title={titles[view] ?? "SideQuest"}
        view={view}
        context="Austin, TX"
        meta={view === "plans" ? "1 open plan" : undefined}
        back={
          ["detail", "private", "payment"].includes(view) ? (
            <Link href="/plans">← Plans</Link>
          ) : undefined
        }
      />
      <Feedback message={message} />
      {view === "plans" && (
        <div className="dashboard-grid">
          <div>
            <div className="section-title">
              <h2>Coming up</h2>
              <span>OCTOBER 2026</span>
            </div>
            <Link className="plan" href="/plans/friday">
              <div className="date-block">
                <span>FRI</span>
                <strong>30</strong>
                <span>OCT</span>
              </div>
              <div className="plan-content">
                <div className="plan-top">
                  <span className="plan-status">Vote needed</span>
                  <span>3 OPTIONS</span>
                </div>
                <h2>Friday night</h2>
                <p>Movie, dinner, or live music.</p>
                <div className="plan-bottom">
                  <span>Jamie, Alex + you</span>
                  <span className="vote-link">
                    Choose an option <span aria-hidden="true">→</span>
                  </span>
                </div>
              </div>
            </Link>
            <div className="plan-caption">
              <span>Nothing else scheduled.</span>
              <span>Times will be confirmed after voting.</span>
            </div>
          </div>
          <aside>
            <div className="section-title">
              <h2>Friends</h2>
              <Link href="/friends">Manage →</Link>
            </div>
            <div className="panel identity-list">
              {["Jamie Park", "Alex Rivera"].map((name) => (
                <Link className="person-row" key={name} href="/friends">
                  <span className="avatar">
                    {name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>Connected</small>
                  </span>
                </Link>
              ))}
              <Link className="invite-link" href="/friends">
                + Add a friend
              </Link>
            </div>
          </aside>
        </div>
      )}
      {["detail", "private", "payment"].includes(view) && (
        <PlanNavigation id={id} view={view} preview />
      )}
      {view === "detail" && (
        <form
          className="form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage("Vote saved in this preview.");
          }}
        >
          <fieldset>
            <legend>Choose all options that work, then a favorite</legend>
            {[
              {
                id: "movie",
                label: "A. Movie night",
                details: "7 PM · About $22 per person",
              },
              {
                id: "dinner",
                label: "B. Dinner",
                details: "6:30 PM · About $28 per person",
              },
              {
                id: "music",
                label: "C. Live music",
                details: "8 PM · About $15 per person",
              },
            ].map((option) => (
              <div className="option-row" key={option.id}>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={acceptable.includes(option.id)}
                    onChange={(e) => {
                      setNone(false);
                      setAcceptable((v) =>
                        e.target.checked
                          ? [...v, option.id]
                          : v.filter((id) => id !== option.id),
                      );
                      if (!e.target.checked && favorite === option.id)
                        setFavorite("");
                    }}
                  />
                  {option.label}
                </label>
                <p>{option.details} · Sample estimate</p>
                <label className="choice">
                  <input
                    type="radio"
                    name="favorite"
                    checked={favorite === option.id}
                    disabled={!acceptable.includes(option.id)}
                    onChange={() => setFavorite(option.id)}
                  />
                  My favorite
                </label>
              </div>
            ))}
            <label className="choice">
              <input
                type="checkbox"
                checked={none}
                onChange={(e) => {
                  setNone(e.target.checked);
                  if (e.target.checked) {
                    setAcceptable([]);
                    setFavorite("");
                  }
                }}
              />
              None of these work
            </label>
          </fieldset>
          <button disabled={!none && !acceptable.length}>Save vote</button>
        </form>
      )}
      {view === "friends" && (
        <>
          <ul className="panel people">
            {[
              "Jamie Park",
              "Alex Rivera",
              ...(accepted ? ["Sofia Chen"] : []),
            ].map((name) => (
              <li className="person-row" key={name}>
                <span className="avatar" aria-hidden="true">
                  {name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </span>
                <strong>{name}</strong>
                <span className="connected">Connected</span>
              </li>
            ))}
          </ul>
          {!accepted && !declined && (
            <section className="panel">
              <h2>Incoming requests</h2>
              <div className="request-row">
                <span>Sofia Chen</span>
                <button
                  onClick={() => {
                    setAccepted(true);
                    setMessage("Request accepted in preview.");
                  }}
                >
                  Accept
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setDeclined(true);
                    setMessage("Request declined in preview.");
                  }}
                >
                  Decline
                </button>
              </div>
            </section>
          )}
          <section className="panel">
            <h2>Invite by phone</h2>
            <form
              className="form-panel"
              onSubmit={(e) => {
                e.preventDefault();
                setMessage(
                  "Preview invitation created. Delivery is not connected yet.",
                );
              }}
            >
              <label>
                Phone number
                <input
                  type="tel"
                  required
                  pattern="\+[1-9][0-9]{7,14}"
                  placeholder="+15125550123"
                />
              </label>
              <button>Create invitation</button>
            </form>
          </section>
        </>
      )}
      {view === "settings" && (
        <>
          <form
            className="form-panel"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage("Account saved in this preview.");
            }}
          >
            <label>
              Name
              <input required maxLength={80} defaultValue="Jordan Davis" />
            </label>
            <label>
              Phone number
              <input disabled readOnly value="Sample account · Not verified" />
            </label>
            <label>
              City
              <select defaultValue="Austin">
                <option value="Austin">Austin, Texas, United States</option>
              </select>
            </label>
            <p className="hint">Time zone: America/Chicago.</p>
            <label>
              Interests (comma separated)
              <input defaultValue="Movies, food, music" />
            </label>
            <button>Save account</button>
          </form>
          <section className="panel">
            <h2>Calendar</h2>
            <p>No calendar connection in this preview.</p>
            <button
              className="secondary"
              onClick={() =>
                setMessage("Calendar connections require live sign-in.")
              }
            >
              Connect Google Calendar
            </button>
          </section>
          <NextLink className="back" href="/login">
            Use live sign-in →
          </NextLink>
        </>
      )}
      {["login", "signup"].includes(view) && (
        <>
          <form className="form-panel" onSubmit={signIn}>
            <label>
              Phone number
              <input
                type="tel"
                autoComplete="tel"
                required
                pattern="\+[1-9][0-9]{7,14}"
                placeholder="+15125550123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            {codeSent && (
              <label>
                Six-digit verification code
                <input
                  required
                  pattern="[0-9]{6}"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            <button>{codeSent ? "Verify and continue" : "Send code"}</button>
          </form>
          <NextLink className="back" href="/login">
            Use live sign-in →
          </NextLink>
        </>
      )}
      {view === "invite" && (
        <section className="panel">
          <h2>Connect with your friend</h2>
          <p>Sign in to see invitations sent to your verified phone.</p>
          <NextLink className="button" href="/signup">
            Sign in
          </NextLink>
        </section>
      )}
      {view === "private" && (
        <section className="panel">
          <h2>Only your account</h2>
          <p>
            Sample details only. No real private information is stored here.
          </p>
          <form
            className="form-panel"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage("Private note saved in this preview only.");
            }}
          >
            <label>
              Private note for the planner
              <textarea
                required
                maxLength={2000}
                placeholder="I need to leave by 10 PM."
              />
            </label>
            <button>Send privately</button>
          </form>
        </section>
      )}
      {view === "payment" && (
        <section className="panel">
          <h2>Test payment — no live purchase</h2>
          <div className="payment-summary">
            <strong>$22.00</strong>
            <p>Sample share · Not provider verified.</p>
            <button
              className="secondary"
              onClick={() =>
                setMessage("Preview acknowledgment only. No money moved.")
              }
            >
              I sent my share
            </button>
          </div>
        </section>
      )}
      {view === "studio" && (
        <>
          <section className="panel">
            <h2>Templates</h2>
            <p>No live templates in this preview.</p>
          </section>
          <section className="panel">
            <h2>Redacted runs</h2>
            <p>No live runs recorded. Sample plans are not agent evidence.</p>
          </section>
        </>
      )}
    </AppShell>
  );
}
