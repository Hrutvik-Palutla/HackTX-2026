import { accountHandler } from "@/lib/auth/handlers";
import { AccountError } from "@muse/accounts";
export const dynamic = "force-dynamic";
export function POST(req: Request) {
  return accountHandler(req, async (service, actor) => {
    const body = await req.json();
    if (!body || typeof body.phoneE164 !== "string")
      throw new AccountError("INVALID_PHONE", 400, "Provide a phone number.");
    return service.invite(actor, body.phoneE164);
  });
}
