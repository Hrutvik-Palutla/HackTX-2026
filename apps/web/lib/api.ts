import type { Profile, FriendRequest } from "@muse/accounts";
export type ApiErrorBody = {
  error: { code: string; message: string; retryable: boolean };
  requestId: string;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: ApiErrorBody,
  ) {
    super(detail.error.message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error
        ? body
        : {
            error: {
              code:
                response.status === 404 ? "NOT_CONNECTED" : "REQUEST_FAILED",
              message:
                response.status === 404
                  ? "This feature is waiting for its service to be connected."
                  : "The request could not be completed.",
              retryable: response.status >= 500,
            },
            requestId: "",
          },
    );

  if (
    typeof body?.revision === "number" &&
    body.data &&
    typeof body.data === "object" &&
    !Array.isArray(body.data)
  )
    return { ...body.data, revision: body.revision } as T;
  return body?.data as T;
}
export const accountApi = {
  me: () => api<Profile>("/me"),
  update: (profile: Pick<Profile, "name" | "city" | "interests">) =>
    api<Profile>("/me", { method: "PATCH", body: JSON.stringify(profile) }),
  friends: () =>
    api<{
      friends: Pick<Profile, "id" | "name" | "avatarUrl">[];
      requests: FriendRequest[];
    }>("/friends"),
  invite: (phoneE164: string) =>
    api<{ requested: true; invitationId?: string; inviteToken?: string }>(
      "/friend-requests",
      {
        method: "POST",
        body: JSON.stringify({ phoneE164 }),
      },
    ),
  respond: (id: string, action: "accept" | "decline") =>
    api<{ state: "accepted" | "declined" }>(
      `/friend-requests/${encodeURIComponent(id)}/${action}`,
      { method: "POST" },
    ),
};
// The feature owners supply these projections; keep recipient-private payloads separate.
export type VoteInput = {
  versionId: string;
  acceptableOptionIds: string[];
  favoriteOptionId: string | null;
  noneAcceptable: boolean;
};
export function planApi<PublicPlan, PrivatePlan, PaymentView>() {
  return {
    list: () => api<PublicPlan[]>("/plans"),
    get: (id: string) => api<PublicPlan>(`/plans/${encodeURIComponent(id)}`),
    vote: (id: string, vote: VoteInput) =>
      api<PublicPlan>(`/plans/${encodeURIComponent(id)}/vote`, {
        method: "PUT",
        body: JSON.stringify(vote),
      }),
    private: (id: string) =>
      api<PrivatePlan>(`/plans/${encodeURIComponent(id)}/private`),
    payment: (id: string) =>
      api<PaymentView>(`/plans/${encodeURIComponent(id)}/payment`),
  };
}
