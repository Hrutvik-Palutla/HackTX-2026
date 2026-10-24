import { nextPart4Route } from "@hacktx/fulfillment/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = nextPart4Route("confirm-received");
