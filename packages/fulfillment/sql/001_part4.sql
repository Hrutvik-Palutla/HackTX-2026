-- Part 4 owned tables. Intentionally no foreign keys into the team's shared
-- plan/user schema; this migration can be applied before those tables exist.
-- Sensitive credentials and provider tokens do not belong in these records.

CREATE TABLE IF NOT EXISTS fulfillment_quotes (
  id text PRIMARY KEY,
  plan_id text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fulfillment_quotes_plan_id_idx ON fulfillment_quotes (plan_id);

CREATE TABLE IF NOT EXISTS fulfillment_authorizations (
  id text PRIMARY KEY,
  plan_id text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fulfillment_authorizations_plan_id_idx ON fulfillment_authorizations (plan_id);

CREATE TABLE IF NOT EXISTS fulfillment_bookings (
  id text PRIMARY KEY,
  plan_id text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fulfillment_bookings_plan_id_idx ON fulfillment_bookings (plan_id);

CREATE TABLE IF NOT EXISTS fulfillment_reimbursements (
  id text PRIMARY KEY,
  plan_id text NOT NULL,
  booking_id text NOT NULL,
  payer_user_id text NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT fulfillment_reimbursements_booking_payer_unique UNIQUE (booking_id, payer_user_id)
);
CREATE INDEX IF NOT EXISTS fulfillment_reimbursements_plan_id_idx ON fulfillment_reimbursements (plan_id);
CREATE INDEX IF NOT EXISTS fulfillment_reimbursements_booking_id_idx ON fulfillment_reimbursements (booking_id);

CREATE TABLE IF NOT EXISTS fulfillment_effects (
  effect_key text PRIMARY KEY,
  plan_id text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fulfillment_effects_plan_id_idx ON fulfillment_effects (plan_id);

CREATE TABLE IF NOT EXISTS fulfillment_private_deliveries (
  id text PRIMARY KEY,
  plan_id text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fulfillment_private_deliveries_plan_id_idx ON fulfillment_private_deliveries (plan_id);

CREATE TABLE IF NOT EXISTS fulfillment_changes (
  id text PRIMARY KEY,
  plan_id text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS fulfillment_changes_plan_id_idx ON fulfillment_changes (plan_id);
