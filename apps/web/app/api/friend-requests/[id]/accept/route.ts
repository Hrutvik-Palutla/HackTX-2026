import { accountHandler } from "@/lib/auth/handlers";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return accountHandler(req, (service, actor) =>
    service.respond(actor, id, "accepted"),
  );
}
