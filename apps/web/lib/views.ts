// App-owned view types mapped from CONTRACTS.md. Part 2 remains the shared-contract owner.
export type Money = { amountMinor: number; currency: "USD" };
export type Person = { id: string; name: string; avatarUrl: string | null };
export type Option = {
  id: string;
  versionId: string;
  label: "A" | "B" | "C";
  title: string;
  startAt: string | null;
  endAt: string | null;
  timeZone: string;
  estimatedPerPerson: Money | null;
  priceKind: "quoted" | "listed" | "estimated" | "unknown";
  publicExplanation: string;
  uncertainties: string[];
  sourceIds: string[];
  fit?: "fits_known_constraints" | "needs_clarification";
  timeline?: { title: string; startAt: string; endAt: string; candidateId: string }[];
};
export type Tally = {
  versionId: string;
  options: { optionId: string; label: string; acceptable: number; favorite: number }[];
  noneAcceptable: number;
  voters: number;
  leader: string | null;
  tiedOptionIds: string[];
};
export type PlanView = {
  id: string;
  title?: string;
  request: string;
  status: string;
  mode: "live" | "test";
  revision: number;
  activeVersionId: string | null;
  options: Option[];
  participants: Person[];
  votes: {
    userId: string;
    versionId: string;
    acceptableOptionIds: string[];
    favoriteOptionId: string | null;
    noneAcceptable: boolean;
  }[];
  sources: { id: string; url: string; title: string; provider?: string; fetchedAt?: string }[];
  timeZone?: string;
  organizerUserId?: string;
  pendingInvites?: string[];
  decision?: { optionId: string; attendeeUserIds: string[]; recordedAt: string } | null;
  tally?: Tally | null;
};
export type PrivateView = {
  ownerUserId: string;
  facts: { id: string; kind: string; value: unknown }[];
  messages?: { id: string; text: string }[];
};
export type Reimbursement = {
  id: string;
  payerUserId: string;
  recipientUserId: string;
  amount: Money;
  paymentUrl: string | null;
  status: string;
  confirmationSource: "none" | "manual_buyer";
  mode: "live" | "test";
};
export type PaymentView = {
  handoffUrl?: string | null;
  viewerUserId: string;
  buyerUserId: string | null;
  quote?: {
    id: string;
    total: Money;
    expiresAt: string;
    mode: "live" | "test";
    status?: string;
  };
  booking?: {
    status: string;
    mode: "live" | "test";
    actualTotal: Money | null;
  };
  ownShare: Reimbursement | null;
  buyerLedger?: Reimbursement[];
};
export type StudioTemplate = {
  systemInstruction: string;
  id: string;
  version: number;
  model: string;
  allowedTools: string[];
  limits: { maxTurns: number; maxTools: number; maxSearches: number };
  outputSchemaVersion: number;
};
export type RunStep = {
  index: number;
  kind: "model" | "tool" | "validation" | "state_change";
  name: string;
  durationMs: number;
  inputRevision: number;
  outcome: "ok" | "error" | "stale" | "waiting";
  redactedSummary: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
export type StudioRun = {
  id: string;
  status: string;
  startedAt: string;
  summary: string;
  steps?: RunStep[];
  mode: "live" | "test";
};
export function money(value: Money | null | undefined) {
  return value
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: value.currency,
      }).format(value.amountMinor / 100)
    : "Price not available";
}
export function safeUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function planStatusLabel(status: string) {
  return ({ waiting_connections: 'Waiting for friends', planning: 'Finding places', clarifying: 'A few details needed', voting: 'Waiting for votes', selected: 'Plan confirmed', quoting: 'Checking the price', awaiting_payment_approval: 'Waiting for the buyer', booking: 'Checking out', booked: 'Booking recorded', needs_handoff: 'Continue with the venue', change_requested: 'Updating the plan', closed: 'Plan closed' } as Record<string, string>)[status] ?? 'Plan in progress';
}

export function initials(name: string) {
  return name.split(/\s+/).map((n) => n[0] ?? "").join("").slice(0, 2).toUpperCase();
}
/** "Fri, Oct 30, 7:15 PM CDT" in the option's own time zone; null stays explicit for the caller. */
export function localTime(iso: string | null | undefined, timeZone = "America/Chicago", withZone = true) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) });
}
export function clockTime(iso: string, timeZone = "America/Chicago") {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}
/** Wall-clock date + time in `timeZone` -> UTC ISO. Two passes settle DST edges. */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const offset = (at: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!) - at;
  };
  let at = wall - offset(wall);
  at = wall - offset(at);
  return new Date(at).toISOString().replace(".000Z", "Z");
}
export const priceKindLabel: Record<string, string> = { quoted: "quoted by the venue", listed: "listed price", estimated: "estimate", unknown: "price unknown" };
