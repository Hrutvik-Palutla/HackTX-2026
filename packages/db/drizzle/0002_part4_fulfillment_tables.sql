CREATE TABLE IF NOT EXISTS "fulfillment_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_effects" (
	"effect_key" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_private_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_reimbursements" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"booking_id" text NOT NULL,
	"payer_user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "fulfillment_reimbursements_booking_payer_unique" UNIQUE("booking_id","payer_user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_authorizations_plan_id_idx" ON "fulfillment_authorizations" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_bookings_plan_id_idx" ON "fulfillment_bookings" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_changes_plan_id_idx" ON "fulfillment_changes" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_effects_plan_id_idx" ON "fulfillment_effects" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_private_deliveries_plan_id_idx" ON "fulfillment_private_deliveries" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_quotes_plan_id_idx" ON "fulfillment_quotes" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_reimbursements_plan_id_idx" ON "fulfillment_reimbursements" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_reimbursements_booking_id_idx" ON "fulfillment_reimbursements" USING btree ("booking_id");