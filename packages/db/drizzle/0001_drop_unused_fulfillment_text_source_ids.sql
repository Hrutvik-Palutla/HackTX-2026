ALTER TABLE "booking_quotes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buyer_authorizations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reimbursements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallet_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "booking_quotes" CASCADE;--> statement-breakpoint
DROP TABLE "bookings" CASCADE;--> statement-breakpoint
DROP TABLE "buyer_authorizations" CASCADE;--> statement-breakpoint
DROP TABLE "reimbursements" CASCADE;--> statement-breakpoint
DROP TABLE "wallet_connections" CASCADE;--> statement-breakpoint
ALTER TABLE "external_effects" DROP CONSTRAINT IF EXISTS "external_effects_quote_id_booking_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "external_effects" ALTER COLUMN "quote_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "id" DROP DEFAULT;