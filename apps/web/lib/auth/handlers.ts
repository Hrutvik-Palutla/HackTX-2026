import { AccountError, accountService, type Actor } from "@muse/accounts";
import { getAccounts, sessionActor } from "./runtime";
const headers = { "Cache-Control": "private, no-store" };
export function failure(code: string, status: number, message: string) {
  return Response.json(
    {
      error: { code, message, retryable: status === 503 },
      requestId: crypto.randomUUID(),
    },
    { status, headers },
  );
}
export async function accountHandler(
  req: Request,
  action: (
    service: ReturnType<typeof accountService>,
    actor: Actor,
  ) => Promise<unknown>,
) {
  try {
    const runtime = getAccounts();
    if (!runtime)
      return failure(
        "ACCOUNTS_UNAVAILABLE",
        503,
        "Account database and private verification delivery are not connected yet.",
      );
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (
        !origin ||
        origin !==
          (process.env.BETTER_AUTH_URL
            ? new URL(process.env.BETTER_AUTH_URL).origin
            : new URL(req.url).origin)
      )
        return failure("FORBIDDEN", 403, "Request origin is not allowed.");
    }
    const actor = await sessionActor(req.headers);
    if (!actor) return failure("UNAUTHORIZED", 401, "Sign in to continue.");
    return Response.json(
      { data: await action(accountService(runtime.repository), actor) },
      { headers },
    );
  } catch (e) {
    if (e instanceof AccountError) return failure(e.code, e.status, e.message);
    if (e instanceof SyntaxError)
      return failure("INVALID_BODY", 400, "Send a valid JSON body.");
    return failure("INTERNAL_ERROR", 500, "Unable to complete this request.");
  }
}
