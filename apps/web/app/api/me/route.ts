import { accountHandler } from "@/lib/auth/handlers";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  return accountHandler(req, (service, actor) => service.me(actor));
}
export function PATCH(req: Request) {
  return accountHandler(req, async (service, actor) =>
    service.update(actor, await req.json()),
  );
}
