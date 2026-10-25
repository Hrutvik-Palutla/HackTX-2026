import { accountHandler } from "@/lib/auth/handlers";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  return accountHandler(req, (service, actor) => service.friends(actor));
}
