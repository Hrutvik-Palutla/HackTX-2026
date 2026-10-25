import { getAccounts } from "@/lib/auth/runtime";
import { failure } from "@/lib/auth/handlers";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  try {
    const runtime = getAccounts();
    if (!runtime)
      return failure(
        "AUTH_UNAVAILABLE",
        503,
        "Private phone verification is not connected yet.",
      );
    const response = await runtime.auth.handler(req);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return failure(
      "AUTH_UNAVAILABLE",
      503,
      "Sign-in is temporarily unavailable. Try again later.",
    );
  }
}
export { handle as GET, handle as POST };
