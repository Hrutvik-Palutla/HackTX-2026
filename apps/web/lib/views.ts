// App-owned view types mapped from CONTRACTS.md. Part 2 remains the shared-contract owner.
export type Money = { amountMinor: number; currency: "USD" };
export type Person = { id: string; name: string; avatarUrl: string | null };
export type Option = {
  id: string;
  versionId: string;
  label: "A" | "B" | "C";
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  estimatedPerPerson: Money | null;
  priceKind: "quoted" | "listed" | "estimated" | "unknown";
  publicExplanation: string;
  uncertainties: string[];
  sourceIds: string[];
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
  sources: { id: string; url: string; title: string }[];
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
