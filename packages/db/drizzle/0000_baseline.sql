CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid,
	"task" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"model" text NOT NULL,
	"input_revision" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_templates" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_templates_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "availability_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid,
	"busy" jsonb NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"primary_only" boolean DEFAULT true NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"plan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"version_id" uuid NOT NULL,
	"provider_event_id" text,
	"ics_uid" text NOT NULL,
	"sync_status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"cache_key" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"messaging_identity_id" uuid,
	"unresolved_handle" text,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"sending_line" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"kind" text NOT NULL,
	"active_plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_key" text NOT NULL,
	"kind" text NOT NULL,
	"plan_id" uuid,
	"quote_id" text,
	"state" text DEFAULT 'reserved' NOT NULL,
	"provider_request_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_effects_operation_key_unique" UNIQUE("operation_key")
);
--> statement-breakpoint
CREATE TABLE "friend_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inviter_id" text NOT NULL,
	"recipient_phone_encrypted" text NOT NULL,
	"recipient_phone_digest" text NOT NULL,
	"token_hash" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "friend_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "friend_invite_state" CHECK ("friend_invites"."state" in ('pending','accepted','declined'))
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_low_id" text NOT NULL,
	"user_high_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "friendships_user_low_id_user_high_id_pk" PRIMARY KEY("user_low_id","user_high_id"),
	CONSTRAINT "friendship_order" CHECK ("friendships"."user_low_id" < "friendships"."user_high_id"),
	CONSTRAINT "friendship_status" CHECK ("friendships"."status" in ('accepted'))
);
--> statement-breakpoint
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
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"envelope_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"plan_id" uuid,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"leased_by" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"sender_user_id" text,
	"sender_handle" text NOT NULL,
	"is_private" boolean NOT NULL,
	"body" text,
	"body_enc" text,
	"reply_to_provider_message_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_body_privacy" CHECK (("messages"."is_private" and "messages"."body" is null) or (not "messages"."is_private" and "messages"."body_enc" is null))
);
--> statement-breakpoint
CREATE TABLE "messaging_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"handle" text NOT NULL,
	"kind" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" jsonb NOT NULL,
	"plan_id" uuid,
	"version_id" uuid,
	"effect_key" text NOT NULL,
	"body" text,
	"body_enc" text,
	"provider_message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_effect_key_unique" UNIQUE("effect_key")
);
--> statement-breakpoint
CREATE TABLE "plan_conversations" (
	"plan_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"owner_user_id" text,
	CONSTRAINT "plan_conversations_plan_id_conversation_id_pk" PRIMARY KEY("plan_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE "plan_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"attendee_user_ids" jsonb NOT NULL,
	"evidence_message_ids" jsonb NOT NULL,
	"buyer_user_id" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text,
	"invite_id" uuid,
	"requested_name" text,
	"attendance" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"input_revision" integer NOT NULL,
	"run_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_user_id" text NOT NULL,
	"request" text NOT NULL,
	"template_id" text NOT NULL,
	"city" jsonb NOT NULL,
	"time_zone" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"status" text NOT NULL,
	"input_revision" integer DEFAULT 0 NOT NULL,
	"active_version_id" uuid,
	"selected_option_id" uuid,
	"mode" text DEFAULT 'test' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"plan_id" uuid,
	"kind" text NOT NULL,
	"value_enc" text NOT NULL,
	"source_message_id" uuid,
	"superseded_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"run_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_revision" integer NOT NULL,
	"outcome" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redacted_summary" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "run_steps_run_id_index_pk" PRIMARY KEY("run_id","index")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"provider_search_id" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"run_id" uuid,
	"reserved_units" integer NOT NULL,
	"actual_units" integer,
	"reserved_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"actual_cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"phoneNumber" text,
	"phoneNumberVerified" boolean,
	"city" text,
	"interests" jsonb,
	"onboardingComplete" boolean,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phoneNumber_unique" UNIQUE("phoneNumber")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote_states" (
	"version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"favorite_option_id" uuid,
	"none_acceptable" boolean DEFAULT false NOT NULL,
	"objection" text,
	"source_event_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_states_version_id_user_id_pk" PRIMARY KEY("version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"option_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_version_id_user_id_option_id_pk" PRIMARY KEY("version_id","user_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_snapshots" ADD CONSTRAINT "availability_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_snapshots" ADD CONSTRAINT "availability_snapshots_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_messaging_identity_id_messaging_identities_id_fk" FOREIGN KEY ("messaging_identity_id") REFERENCES "public"."messaging_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_active_plan_id_plans_id_fk" FOREIGN KEY ("active_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_invites" ADD CONSTRAINT "friend_invites_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_id_user_id_fk" FOREIGN KEY ("user_low_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_id_user_id_fk" FOREIGN KEY ("user_high_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_identities" ADD CONSTRAINT "messaging_identities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_conversations" ADD CONSTRAINT "plan_conversations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_conversations" ADD CONSTRAINT "plan_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_conversations" ADD CONSTRAINT "plan_conversations_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decisions" ADD CONSTRAINT "plan_decisions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decisions" ADD CONSTRAINT "plan_decisions_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decisions" ADD CONSTRAINT "plan_decisions_option_id_plan_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."plan_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decisions" ADD CONSTRAINT "plan_decisions_buyer_user_id_user_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decisions" ADD CONSTRAINT "plan_decisions_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_options" ADD CONSTRAINT "plan_options_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_participants" ADD CONSTRAINT "plan_participants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_participants" ADD CONSTRAINT "plan_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_participants" ADD CONSTRAINT "plan_participants_invite_id_friend_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."friend_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_organizer_user_id_user_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_active_version_id_plan_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_selected_option_id_plan_options_id_fk" FOREIGN KEY ("selected_option_id") REFERENCES "public"."plan_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_facts" ADD CONSTRAINT "private_facts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_facts" ADD CONSTRAINT "private_facts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_facts" ADD CONSTRAINT "private_facts_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_facts" ADD CONSTRAINT "private_facts_superseded_by_private_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."private_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_states" ADD CONSTRAINT "vote_states_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_states" ADD CONSTRAINT "vote_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_states" ADD CONSTRAINT "vote_states_favorite_option_id_plan_options_id_fk" FOREIGN KEY ("favorite_option_id") REFERENCES "public"."plan_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_version_id_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_option_id_plan_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."plan_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "availability_snapshots_user_id_plan_id_index" ON "availability_snapshots" USING btree ("user_id","plan_id");--> statement-breakpoint
CREATE INDEX "candidates_cache_key_index" ON "candidates" USING btree ("cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_sending_line_external_chat_id_index" ON "conversations" USING btree ("provider","sending_line","external_chat_id");--> statement-breakpoint
CREATE INDEX "friend_invites_recipient" ON "friend_invites" USING btree ("recipient_phone_digest","state");--> statement-breakpoint
CREATE INDEX "friend_invites_inviter" ON "friend_invites" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE INDEX "friendships_high" ON "friendships" USING btree ("user_high_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_authorizations_plan_id_idx" ON "fulfillment_authorizations" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_bookings_plan_id_idx" ON "fulfillment_bookings" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_changes_plan_id_idx" ON "fulfillment_changes" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_effects_plan_id_idx" ON "fulfillment_effects" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_private_deliveries_plan_id_idx" ON "fulfillment_private_deliveries" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_quotes_plan_id_idx" ON "fulfillment_quotes" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_reimbursements_plan_id_idx" ON "fulfillment_reimbursements" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_reimbursements_booking_id_idx" ON "fulfillment_reimbursements" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_provider_event_id_index" ON "inbound_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "jobs_state_run_after_index" ON "jobs" USING btree ("state","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_id_provider_message_id_index" ON "messages" USING btree ("conversation_id","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_identities_provider_handle_index" ON "messaging_identities" USING btree ("provider","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_options_version_id_label_index" ON "plan_options" USING btree ("version_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_participants_plan_id_user_id_index" ON "plan_participants" USING btree ("plan_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_id_version_number_index" ON "plan_versions" USING btree ("plan_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_conversation_id_provider_message_id_index" ON "polls" USING btree ("conversation_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "private_facts_owner_user_id_plan_id_index" ON "private_facts" USING btree ("owner_user_id","plan_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");