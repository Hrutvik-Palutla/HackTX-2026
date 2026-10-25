"use client";
import Link from "next/link";
import {
  useEffect,
  useState,
  useCallback,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Profile, FriendRequest } from "@muse/accounts";
import { AppShell, PageHeading } from "./app-shell";
import { PlanNavigation } from "./plan-navigation";
import { Feedback } from "./feedback";
import { PreviewApp } from "./preview-app";
import { api, accountApi, ApiError } from "@/lib/api";
import {
  money,
  safeUrl,
  type PlanView,
  type PrivateView,
  type PaymentView,
  type StudioRun,
  type StudioTemplate,
} from "@/lib/views";

type Session = { user: { id: string; name: string }; session: { id: string } };
type Status = "loading" | "ready" | "signed-out" | "unavailable";
const austin = {
  label: "Austin, Texas, United States",
  countryCode: "US",
  latitude: 30.2672,
  longitude: -97.7431,
  timeZone: "America/Chicago",
};
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}
function privateFactText(fact: { kind: string; value: unknown }) {
  const value = fact.value as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return String(fact.value ?? "");
  if (fact.kind === "spending_limit")
    return `Maximum share: ${money(value.maximumShare as Parameters<typeof money>[0])}`;
  if (fact.kind === "preference" || fact.kind === "requirement")
    return `${String(value.key ?? "Preference")}: ${Array.isArray(value.value) ? value.value.join(", ") : String(value.value ?? "")}`;
  if (fact.kind === "availability")
    return "Availability recorded privately for this plan.";
  return "Private detail recorded.";
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

export function MuseApp({
  view = "plans",
  id,
}: {
  view?: string;
  id?: string;
}) {
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [friends, setFriends] = useState<Awaited<
    ReturnType<typeof accountApi.friends>
  > | null>(null);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("Austin");
  const [interests, setInterests] = useState("");
  const [returnTo, setReturnTo] = useState("/plans");
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [privateView, setPrivateView] = useState<PrivateView | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [runs, setRuns] = useState<StudioRun[] | null>(null);
  const [templates, setTemplates] = useState<StudioTemplate[] | null>(null);
  const [acceptable, setAcceptable] = useState<string[]>([]);
  const [favorite, setFavorite] = useState("");
  const [none, setNone] = useState(false);
  const [note, setNote] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [request, setRequest] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/get-session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setStatus("unavailable");
        return;
      }
      const value = await response.json();
      if (!value?.user) {
        setStatus("signed-out");
        return;
      }
      setSession(value);
      const own = await accountApi.me();
      setProfile(own);
      setName(own?.name === "New friend" ? "" : (own?.name ?? ""));
      setCity(own?.city?.label?.startsWith("Austin") ? "Austin" : "");
      setInterests(own?.interests.join(", ") ?? "");
      setStatus("ready");
    } catch (e) {
      setError(errorText(e));
      setStatus("unavailable");
    }
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const isPreview = query.get("preview") === "1";
    setPreview(isPreview);
    if (!["login", "signup"].includes(view))
      setReturnTo(window.location.pathname);
    const next = query.get("next");
    if (next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\"))
      setReturnTo(next);
    if (!isPreview) void loadSession();
  }, [loadSession]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const applyPlan = useCallback(
    (value: PlanView) => {
      setPlan(value);
      const own = value.votes?.find(
        (v) =>
          v.userId === session?.user.id &&
          v.versionId === value.activeVersionId,
      );
      setAcceptable(own?.acceptableOptionIds ?? []);
      setFavorite(own?.favoriteOptionId ?? "");
      setNone(own?.noneAcceptable ?? false);
    },
    [session?.user.id],
  );
  const loadData = useCallback(async () => {
    if (status !== "ready" || !profile?.onboardingComplete) return;
    setDataLoading(true);
    setError("");
    setPrivateView(null);
    setPayment(null);
    try {
      if (view === "friends" || view === "plans")
        setFriends(await accountApi.friends());
      if (view === "plans") setPlans(await api<PlanView[]>("/plans"));
      if (["detail", "private", "payment"].includes(view) && id) {
        const value = await api<PlanView>(`/plans/${encodeURIComponent(id)}`);
        applyPlan(value);
        if (view === "private") {
          const data = await api<PrivateView>(
            `/plans/${encodeURIComponent(id)}/private`,
          );
          if (data.ownerUserId !== session?.user.id)
            throw Error("Private details are not available for this account.");
          setPrivateView(data);
        }
        if (view === "payment") {
          const data = await api<PaymentView>(
            `/plans/${encodeURIComponent(id)}/payment`,
          );
          if (data.viewerUserId !== session?.user.id)
            throw Error("Payment details are not available for this account.");
          if (data.ownShare && data.ownShare.payerUserId !== session?.user.id)
            throw Error("Payment details are not available for this account.");
          setPayment(data);
        }
      }
      if (view === "studio") {
        const [runData, templateData] = await Promise.all([
          api<StudioRun[]>("/studio/runs"),
          api<StudioTemplate[]>("/studio/templates"),
        ]);
        setRuns(runData);
        setTemplates(templateData);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDataLoading(false);
    }
  }, [
    status,
    profile?.onboardingComplete,
    view,
    id,
    applyPlan,
    session?.user.id,
  ]);
  useEffect(() => {
    void loadData();
  }, [loadData]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 409) {
        await loadData();
        setError(
          "This plan changed. Review the latest options before submitting again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function sendCode() {
    const response = await fetch("/api/auth/phone-number/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone.replace(/[\s().-]/g, "") }),
    });
    if (!response.ok)
      throw Error(
        "Unable to send a verification code. Check your number or try again later.",
      );
    setSent(true);
    setCooldown(60);
    setNotice(
      "A verification code was requested. Check your private messages.",
    );
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      if (!sent) {
        await sendCode();
        return;
      }
      const response = await fetch("/api/auth/phone-number/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phone.replace(/[\s().-]/g, ""),
          code,
        }),
      });
      if (!response.ok)
        throw Error(
          "The code is invalid or expired. Try again or request a new code.",
        );
      window.location.href = returnTo;
    });
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      if (city !== "Austin")
        throw Error(
          "Choose Austin. Other cities need a resolved location and time zone from the city provider.",
        );
      const updated = await accountApi.update({
        name,
        city: austin,
        interests: interests
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
      setProfile(updated);
      setNotice("Account saved.");
      if (!profile?.onboardingComplete) window.location.href = returnTo;
    });
  }
  async function respond(requestId: string, action: "accept" | "decline") {
    await perform(async () => {
      await accountApi.respond(requestId, action);
      setFriends(await accountApi.friends());
      setNotice(
        action === "accept"
          ? "Friend request accepted."
          : "Friend request declined.",
      );
    });
  }
  async function signOut() {
    await perform(async () => {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw Error("Could not sign out. Try again.");
      window.location.href = "/login";
    });
  }
  if (preview) return <PreviewApp view={view} id={id} />;
  const authView = ["login", "signup"].includes(view);
  const onboarding = status === "ready" && !profile?.onboardingComplete;
  const title = onboarding
    ? "Finish your account"
    : ({
        plans: "Plans",
        friends: "Friends",
        settings: "Account",
        detail: plan?.title ?? "Plan",
        private: "Private details",
        payment: "Your share",
        studio: "Studio",
        invite: "Friend invitation",
        login: "Sign in",
        signup: "Create an account",
      }[view] ?? "SideQuest");
  const incoming =
    friends?.requests.filter((r) => r.direction === "incoming") ?? [];
  const outgoing =
    friends?.requests.filter((r) => r.direction === "outgoing") ?? [];
  const base = id ? `/plans/${encodeURIComponent(id)}` : "/plans";
  return (
    <AppShell
      view={view}
      footer={
        status === "ready" ? (
          <Link href="/studio">Team Studio →</Link>
        ) : undefined
      }
    >
      {status === "loading" ? (
        <p role="status">Checking your session…</p>
      ) : (
        <>
          <PageHeading
            title={title}
            view={view}
            context={profile?.city?.label ?? "SideQuest"}
            meta={session?.user.name}
            back={
              ["detail", "private", "payment"].includes(view) ? (
                <Link href="/plans">← Plans</Link>
              ) : undefined
            }
          />
          <Feedback
            message={error}
            error
            busy={busy}
            onRetry={() =>
              void (status === "ready" ? loadData() : loadSession())
            }
          />
          <Feedback message={notice} />
          {status === "unavailable" ? (
            <section className="panel empty-state">
              <h2>Accounts are not connected yet</h2>
              <p>
                Live sign-in is unavailable right now. You can explore the
                sample workspace while the service is being connected.
              </p>
              <Link className="button" href="/plans?preview=1">
                Open sample workspace
              </Link>
            </section>
          ) : status === "signed-out" || (authView && status !== "ready") ? (
            <>
              <p>Sign in with your phone to see your plans and friends.</p>
              <form className="form-panel" onSubmit={signIn}>
                <Field label="Phone number">
                  <input
                    type="tel"
                    autoComplete="tel"
                    required
                    pattern="\+[1-9][0-9 ()\.\-]{7,24}"
                    placeholder="+15125550123"
                    value={phone}
                    disabled={sent}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                {sent && (
                  <Field label="Six-digit verification code">
                    <input
                      required
                      pattern="[0-9]{6}"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </Field>
                )}
                <button disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : sent
                      ? "Verify and continue"
                      : "Send code"}
                </button>
                {sent && (
                  <div className="action-row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || cooldown > 0}
                      onClick={() => void perform(sendCode)}
                    >
                      {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setSent(false);
                        setCode("");
                      }}
                    >
                      Change number
                    </button>
                  </div>
                )}
              </form>
              <p className="hint">
                Codes expire after five minutes. Never share yours.
              </p>
              <Link className="back" href="/plans?preview=1">
                View sample workspace →
              </Link>
            </>
          ) : onboarding || view === "settings" || authView ? (
            <>
              <p>
                {onboarding
                  ? "Add your name, city, and interests to finish signup."
                  : "Your phone and interests are private."}
              </p>
              <form className="form-panel" onSubmit={saveProfile}>
                <Field label="Name">
                  <input
                    required
                    maxLength={80}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="Verified phone">
                  <input value={profile?.phoneE164 ?? ""} disabled readOnly />
                </Field>
                <Field label="City">
                  <select
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  >
                    <option value="">Choose a city</option>
                    <option value="Austin">Austin, Texas, United States</option>
                  </select>
                </Field>
                <p className="hint">
                  Time zone: America/Chicago. Austin is the supported city for
                  this version.
                </p>
                <Field label="Interests (comma separated)">
                  <input
                    maxLength={480}
                    value={interests}
                    placeholder="Movies, food, music"
                    onChange={(e) => setInterests(e.target.value)}
                  />
                </Field>
                <button disabled={busy}>
                  {busy ? "Saving…" : "Save account"}
                </button>
              </form>
              {!onboarding && (
                <section className="panel">
                  <h2>Calendar</h2>
                  <p>
                    {profile?.calendarConnected
                      ? "Calendar connected."
                      : "No calendar connection reported."}{" "}
                    Event titles stay private.
                  </p>
                  <Link className="back" href="/api/calendar/connect">
                    Connect Google Calendar →
                  </Link>
                  <button
                    className="secondary"
                    disabled={busy || !profile?.calendarConnected}
                    onClick={() =>
                      void perform(async () => {
                        await api("/calendar/connection", {
                          method: "DELETE",
                        });
                        await loadSession();
                        setNotice("Calendar disconnected.");
                      })
                    }
                  >
                    Disconnect calendar
                  </button>
                </section>
              )}
              <section className="panel">
                <h2>Session</h2>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </section>
            </>
          ) : (
            <>
              {dataLoading && <p role="status">Loading…</p>}
              {view === "plans" && (
                <>
                  <div className="dashboard-grid">
                    <div>
                      <div className="section-title">
                        <h2>Your plans</h2>
                        <span>{plans?.length ?? 0} VISIBLE</span>
                      </div>
                      {plans?.map((p) => (
                        <Link
                          className="plan live-plan"
                          href={`/plans/${encodeURIComponent(p.id)}`}
                          key={p.id}
                        >
                          <div className="plan-content">
                            <div className="plan-top">
                              <span className="plan-status">
                                {p.status.replaceAll("_", " ")}
                              </span>
                              <span>{p.mode === "test" ? "TEST" : "LIVE"}</span>
                            </div>
                            <h2>{p.title ?? p.request}</h2>
                            <p>
                              {p.participants
                                .map((person) => person.name)
                                .join(", ")}
                            </p>
                            <span className="vote-link">View plan →</span>
                          </div>
                        </Link>
                      ))}
                      {plans?.length === 0 && (
                        <p>No plans yet. Start one below.</p>
                      )}
                    </div>
                    <aside>
                      <div className="section-title">
                        <h2>New plan</h2>
                      </div>
                      <form
                        className="form-panel"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void perform(async () => {
                            const result = await api<{
                              id?: string;
                              planId?: string;
                              jobId?: string;
                            }>("/plans", {
                              method: "POST",
                              body: JSON.stringify({
                                request,
                                participantUserIds: selectedFriends,
                                mode: "live",
                              }),
                            });
                            const createdId = result.planId ?? result.id;
                            if (createdId)
                              window.location.href = `/plans/${encodeURIComponent(createdId)}`;
                            else {
                              setRequest("");
                              await loadData();
                              setNotice(
                                "Plan requested. It will appear when the planner has prepared it.",
                              );
                            }
                          });
                        }}
                      >
                        <Field label="What would you like to do?">
                          <textarea
                            required
                            maxLength={2000}
                            value={request}
                            onChange={(e) => setRequest(e.target.value)}
                            placeholder="Movie on Friday in Austin"
                          />
                        </Field>
                        <fieldset>
                          <legend>Invite connected friends</legend>
                          {friends?.friends.map((f) => (
                            <label className="choice" key={f.id}>
                              <input
                                type="checkbox"
                                checked={selectedFriends.includes(f.id)}
                                onChange={(e) =>
                                  setSelectedFriends((v) =>
                                    e.target.checked
                                      ? [...v, f.id]
                                      : v.filter((id) => id !== f.id),
                                  )
                                }
                              />
                              {f.name}
                            </label>
                          ))}
                        </fieldset>
                        <button disabled={busy}>Create plan</button>
                      </form>
                    </aside>
                  </div>
                </>
              )}
              {view === "friends" && (
                <>
                  <div className="section-title">
                    <h2>Connected</h2>
                    <span>{friends?.friends.length ?? 0}</span>
                  </div>
                  <ul className="people panel">
                    {friends?.friends.map((f) => (
                      <li key={f.id}>
                        <span className="avatar">
                          {f.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                        <strong>{f.name}</strong>
                        <span className="connected">Connected</span>
                      </li>
                    ))}
                  </ul>
                  {friends?.friends.length === 0 && (
                    <p>No friends connected yet.</p>
                  )}
                  <section className="panel">
                    <h2>Incoming requests</h2>
                    {!incoming.length && <p>No pending requests.</p>}
                    {incoming.map((r) => (
                      <div className="request-row" key={r.id}>
                        <span>{r.inviterName}</span>
                        <button
                          disabled={busy}
                          onClick={() => void respond(r.id, "accept")}
                        >
                          Accept
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void respond(r.id, "decline")}
                        >
                          Decline
                        </button>
                      </div>
                    ))}
                  </section>
                  <section className="panel">
                    <h2>Invite by phone</h2>
                    <form
                      className="form-panel"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void perform(async () => {
                          const result = await accountApi.invite(invitePhone);
                          setInvitePhone("");
                          if (result.inviteToken)
                            setInviteUrl(
                              `${window.location.origin}/invite/${encodeURIComponent(result.inviteToken)}`,
                            );
                          setFriends(await accountApi.friends());
                          setNotice(
                            "Invitation created. Share the link privately with the intended recipient.",
                          );
                        });
                      }}
                    >
                      <Field label="Phone number">
                        <input
                          type="tel"
                          required
                          placeholder="+15125550123"
                          value={invitePhone}
                          onChange={(e) => setInvitePhone(e.target.value)}
                        />
                      </Field>
                      <button disabled={busy}>Create invitation</button>
                    </form>
                    {inviteUrl && (
                      <div className="share-link">
                        <Field label="Private invitation link">
                          <input
                            readOnly
                            value={inviteUrl}
                            onFocus={(e) => e.target.select()}
                          />
                        </Field>
                        <button
                          className="secondary"
                          onClick={() =>
                            void perform(async () => {
                              await navigator.clipboard.writeText(inviteUrl);
                              setNotice("Invitation link copied.");
                            })
                          }
                        >
                          Copy link
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="panel">
                    <h2>Sent requests</h2>
                    {!outgoing.length && <p>No pending sent requests.</p>}
                    {outgoing.map((r) => (
                      <p key={r.id}>
                        Invitation pending · Expires{" "}
                        {new Date(r.expiresAt).toLocaleDateString()}
                      </p>
                    ))}
                  </section>
                </>
              )}
              {view === "invite" && (
                <section className="panel">
                  <h2>Connect with your friend</h2>
                  <p>
                    This invitation can only be accepted by its verified
                    intended recipient.
                  </p>
                  <div className="action-row">
                    <button
                      disabled={busy || !id}
                      onClick={() =>
                        void perform(async () => {
                          await accountApi.respond(id!, "accept");
                          window.location.href = "/friends";
                        })
                      }
                    >
                      Accept invitation
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || !id}
                      onClick={() =>
                        void perform(async () => {
                          await accountApi.respond(id!, "decline");
                          window.location.href = "/friends";
                        })
                      }
                    >
                      Decline
                    </button>
                  </div>
                </section>
              )}
              {["detail", "private", "payment"].includes(view) && plan && (
                <>
                  <PlanNavigation id={id!} view={view} />
                  <p>{plan.request}</p>
                  <p className="hint">
                    {plan.status.replaceAll("_", " ")} · Revision{" "}
                    {plan.revision} ·{" "}
                    {plan.mode === "test"
                      ? "TEST — no live purchase"
                      : "Live plan"}
                  </p>
                  {view === "detail" && (
                    <>
                      <form
                        className="form-panel"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void perform(async () => {
                            await api(`${base}/vote`, {
                              method: "PUT",
                              body: JSON.stringify({
                                versionId: plan.activeVersionId,
                                acceptableOptionIds: acceptable,
                                favoriteOptionId: favorite || null,
                                noneAcceptable: none,
                              }),
                            });
                            await loadData();
                            setNotice("Vote saved to the current plan.");
                          });
                        }}
                      >
                        <fieldset
                          disabled={
                            busy ||
                            !plan.activeVersionId ||
                            plan.status !== "voting"
                          }
                        >
                          <legend>
                            Choose all options that work, then a favorite
                          </legend>
                          {plan.options.map((o) => (
                            <div className="option-row" key={o.id}>
                              <label className="choice">
                                <input
                                  type="checkbox"
                                  checked={acceptable.includes(o.id)}
                                  onChange={(e) => {
                                    setNone(false);
                                    setAcceptable((v) =>
                                      e.target.checked
                                        ? [...v, o.id]
                                        : v.filter((id) => id !== o.id),
                                    );
                                    if (!e.target.checked && favorite === o.id)
                                      setFavorite("");
                                  }}
                                />
                                {o.label}. {o.title}
                              </label>
                              <p>
                                {new Date(o.startAt).toLocaleString("en-US", {
                                  timeZone: o.timeZone,
                                })}{" "}
                                ({o.timeZone}) · {money(o.estimatedPerPerson)} ·{" "}
                                {o.priceKind}
                              </p>
                              <p>{o.publicExplanation}</p>
                              {o.uncertainties.map((u) => (
                                <p className="hint" key={u}>
                                  {u}
                                </p>
                              ))}
                              <label className="choice">
                                <input
                                  type="radio"
                                  name="favorite"
                                  checked={favorite === o.id}
                                  disabled={!acceptable.includes(o.id)}
                                  onChange={() => setFavorite(o.id)}
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
                          <button disabled={!none && !acceptable.length}>
                            Save vote
                          </button>
                        </fieldset>
                      </form>
                      <section className="panel">
                        <h2>Sources</h2>
                        {!plan.sources.length && <p>No sources reported.</p>}
                        {plan.sources.map((source) => {
                          const url = safeUrl(source.url);
                          return url ? (
                            <p key={source.id}>
                              <a href={url} target="_blank" rel="noreferrer">
                                {source.title} ↗
                              </a>
                            </p>
                          ) : null;
                        })}
                      </section>
                      <section className="panel">
                        <h2>Group discussion</h2>
                        <form
                          className="form-panel"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void perform(async () => {
                              await api(`${base}/messages`, {
                                method: "POST",
                                body: JSON.stringify({
                                  text: note,
                                  scope: "group",
                                  expectedRevision: plan.revision,
                                }),
                              });
                              setNote("");
                              await loadData();
                              setNotice("Message sent to the group.");
                            });
                          }}
                        >
                          <Field label="Message everyone">
                            <textarea
                              required
                              maxLength={2000}
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                            />
                          </Field>
                          <button disabled={busy}>Send to group</button>
                        </form>
                      </section>
                    </>
                  )}
                  {view === "private" && privateView && (
                    <section className="panel">
                      <h2>Only your account</h2>
                      {privateView.facts.length === 0 && (
                        <p>No private details recorded.</p>
                      )}
                      {privateView.facts.map((f) => (
                        <div className="private-fact" key={f.id}>
                          <strong>{f.kind}</strong>
                          <p>{privateFactText(f)}</p>
                        </div>
                      ))}
                      {privateView.messages?.map((m) => (
                        <p key={m.id}>{m.text}</p>
                      ))}
                      <form
                        className="form-panel"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void perform(async () => {
                            await api(`${base}/messages`, {
                              method: "POST",
                              body: JSON.stringify({
                                text: note,
                                scope: "private",
                                expectedRevision: plan.revision,
                              }),
                            });
                            setNote("");
                            await loadData();
                            setNotice("Private message saved.");
                          });
                        }}
                      >
                        <Field label="Private note for the planner">
                          <textarea
                            required
                            maxLength={2000}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="I need to leave by 10 PM."
                          />
                        </Field>
                        <button disabled={busy}>Send privately</button>
                      </form>
                    </section>
                  )}
                  {view === "payment" && payment && (
                    <section className="panel">
                      <h2>
                        {payment.quote?.mode === "test" ||
                        payment.booking?.mode === "test" ||
                        payment.ownShare?.mode === "test"
                          ? "Test payment — no live purchase"
                          : "Payment details"}
                      </h2>
                      {payment.booking && (
                        <p>
                          Booking: {payment.booking.status.replaceAll("_", " ")}
                          {payment.booking.status === "buyer_reported"
                            ? " · Reported by buyer, not merchant verified"
                            : ""}
                        </p>
                      )}
                      {payment.ownShare ? (
                        <div className="payment-summary">
                          <strong>{money(payment.ownShare.amount)}</strong>
                          <p>
                            {payment.ownShare.status.replaceAll("_", " ")} ·{" "}
                            {payment.ownShare.confirmationSource ===
                            "manual_buyer"
                              ? "Buyer confirmed manually"
                              : "Not provider verified"}
                          </p>
                          {safeUrl(payment.ownShare.paymentUrl) && (
                            <a
                              className="button"
                              href={safeUrl(payment.ownShare.paymentUrl)!}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open repayment link ↗
                            </a>
                          )}
                          <button
                            className="secondary"
                            disabled={
                              busy || payment.ownShare.status !== "requested"
                            }
                            onClick={() =>
                              void perform(async () => {
                                await api(
                                  `/reimbursements/${encodeURIComponent(payment.ownShare!.id)}/report-sent`,
                                  { method: "POST", body: "{}" },
                                );
                                await loadData();
                                setNotice(
                                  "Marked as sent. The buyer still needs to confirm receipt.",
                                );
                              })
                            }
                          >
                            I sent my share
                          </button>
                        </div>
                      ) : (
                        <p>No share has been requested.</p>
                      )}
                      {payment.buyerUserId === session?.user.id && (
                        <section className="panel">
                          <h2>Buyer ledger</h2>
                          {payment.buyerLedger?.map((r) => (
                            <div className="request-row" key={r.id}>
                              <span>
                                {r.payerUserId} · {money(r.amount)} ·{" "}
                                {r.status.replaceAll("_", " ")}
                              </span>
                              <button
                                disabled={
                                  busy || r.status !== "payer_reported_sent"
                                }
                                onClick={() =>
                                  void perform(async () => {
                                    await api(
                                      `/reimbursements/${encodeURIComponent(r.id)}/confirm-received`,
                                      { method: "POST", body: "{}" },
                                    );
                                    await loadData();
                                    setNotice("Receipt confirmed manually.");
                                  })
                                }
                              >
                                Confirm received
                              </button>
                            </div>
                          ))}
                          {payment.quote && (
                            <>
                              <p>
                                Quote total: {money(payment.quote.total)} ·
                                Expires{" "}
                                {new Date(
                                  payment.quote.expiresAt,
                                ).toLocaleString()}
                              </p>
                              <button
                                disabled={
                                  busy ||
                                  new Date(payment.quote.expiresAt).getTime() <=
                                    Date.now()
                                }
                                onClick={() =>
                                  void perform(async () => {
                                    const result = await api<{
                                      approvalUrl?: string;
                                    }>(
                                      `/quotes/${encodeURIComponent(payment.quote!.id)}/approval`,
                                      {
                                        method: "POST",
                                        body: JSON.stringify({
                                          expectedRevision: plan.revision,
                                        }),
                                      },
                                    );
                                    const url = safeUrl(result.approvalUrl);
                                    if (url) window.location.href = url;
                                    else await loadData();
                                  })
                                }
                              >
                                Review buyer approval
                              </button>
                              <p className="hint">
                                Approval is bound to the provider quote. This
                                page cannot purchase on your behalf.
                              </p>
                            </>
                          )}
                        </section>
                      )}
                    </section>
                  )}
                </>
              )}
              {view === "studio" && (
                <>
                  <p>
                    Team-only run history. The Studio API enforces the team
                    allowlist.
                  </p>
                  <section className="panel">
                    <h2>Templates</h2>
                    {templates?.length === 0 && <p>No templates yet.</p>}
                    {templates?.map((t) => (
                      <div key={t.id}>
                        <h3>
                          {t.id} · v{t.version}
                        </h3>
                        <p>
                          {t.model} · Schema {t.outputSchemaVersion}
                        </p>
                        <p>Tools: {t.allowedTools.join(", ")}</p>
                        <p>
                          Limits: {t.limits.maxTurns} turns ·{" "}
                          {t.limits.maxTools} tool calls ·{" "}
                          {t.limits.maxSearches} searches
                        </p>
                      </div>
                    ))}
                  </section>
                  <section className="panel">
                    <h2>Redacted runs</h2>
                    {runs?.length === 0 && <p>No runs recorded.</p>}
                    {runs?.map((r) => (
                      <article key={r.id}>
                        <h3>
                          {r.id} · {r.status}
                        </h3>
                        <p>
                          {r.mode.toUpperCase()} ·{" "}
                          {new Date(r.startedAt).toLocaleString()}
                        </p>
                        <p>{r.summary}</p>
                        {r.steps && (
                          <details>
                            <summary>
                              Execution record ({r.steps.length} steps)
                            </summary>
                            <ol className="run-steps">
                              {r.steps.map((step) => (
                                <li key={step.index}>
                                  <strong>{step.name}</strong>
                                  <p>
                                    {step.kind} · {step.outcome} · Revision{" "}
                                    {step.inputRevision} · {step.durationMs} ms
                                  </p>
                                  <p>{step.redactedSummary}</p>
                                  <p>
                                    {step.inputTokens} input /{" "}
                                    {step.outputTokens} output tokens ·
                                    Estimated $
                                    {step.estimatedCostUsd.toFixed(4)}
                                  </p>
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </article>
                    ))}
                  </section>
                </>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
