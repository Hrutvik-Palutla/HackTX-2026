ALTER TABLE "messages" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_plan_id_occurred_at_index" ON "messages" USING btree ("plan_id","occurred_at");