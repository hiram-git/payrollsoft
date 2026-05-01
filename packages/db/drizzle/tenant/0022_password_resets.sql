-- Migration 0022: Password reset tokens.
--
-- Backs the "forgot password" flow. The plaintext token never leaves the
-- API process — only its SHA-256 hash is stored, so a leaked dump can't
-- be replayed. Tokens are single-use (`used_at` is set on redemption)
-- and time-bound (`expires_at` enforces the lifetime).
--
-- Idempotent: CREATE TABLE / INDEX use IF NOT EXISTS — safe to re-run.

CREATE TABLE IF NOT EXISTS "password_resets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(128) NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "password_resets_user_id_idx"
  ON "password_resets" ("user_id");

CREATE INDEX IF NOT EXISTS "password_resets_token_hash_idx"
  ON "password_resets" ("token_hash");
