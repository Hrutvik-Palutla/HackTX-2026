"use client";
import { useEffect, useState, type FormEvent } from "react";
import { accountApi } from "@/lib/api";

// US numbers may be typed without the country code; everything else must already be E.164.
function toE164(raw: string) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

function safeNext() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/plans";
}

/** One field for both sign-in and sign-up: the phone code proves the number, then new accounts finish signup. */
export function HomeSignIn() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // Already signed in: go straight to the right place.
  useEffect(() => {
    void fetch("/api/auth/get-session", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s?.user) void route(); })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function route() {
    const me = await accountApi.me().catch(() => null);
    const next = safeNext();
    window.location.href = me?.onboardingComplete ? next : `/signup?next=${encodeURIComponent(next)}`;
  }

  async function sendCode() {
    const response = await fetch("/api/auth/phone-number/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: toE164(phone) }),
    });
    if (!response.ok) throw Error("We couldn’t send a code to that number. Check it and try again.");
    setSent(true);
    setCooldown(60);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!sent) return await sendCode();
      const response = await fetch("/api/auth/phone-number/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: toE164(phone), code }),
      });
      if (!response.ok) throw Error("That code didn’t work. Check it, or send a new one.");
      await route();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="home-form" onSubmit={submit}>
      {!sent ? (
        <label className="home-field">
          <span>Mobile number</span>
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            placeholder="(512) 555-0123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      ) : (
        <label className="home-field">
          <span>Code sent to {toE164(phone)}</span>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </label>
      )}
      <button className="home-submit" disabled={busy}>
        {busy ? "One moment…" : sent ? "Continue" : "Continue with phone"}
      </button>
      {error && <p className="home-error" role="alert">{error}</p>}
      {sent ? (
        <div className="home-secondary">
          <button type="button" disabled={busy || cooldown > 0} onClick={() => { setBusy(true); void sendCode().catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
          <button type="button" disabled={busy} onClick={() => { setSent(false); setCode(""); }}>
            Use a different number
          </button>
        </div>
      ) : (
        <p className="home-fine">New here? This creates your account. We’ll text you a code.</p>
      )}
    </form>
  );
}
