-- 0010_user_email_accounts.sql
-- Per-user email-provider accounts for the upcoming Phase 1.5 email
-- integration (UI-session owned). Multi-account support from day one
-- so a user can connect Gmail + Outlook + IMAP in parallel.
--
-- user_id is nullable so the current single-user app keeps working;
-- when multi-tenant auth lands the FK becomes mandatory.
-- oauth_refresh_token is stored ENCRYPTED — the application layer is
-- responsible for KMS / pgcrypto wrapping; this column is the
-- ciphertext blob, never a plaintext token.

CREATE TABLE IF NOT EXISTS user_email_accounts (
    id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                uuid          NULL,
    email                  text          NOT NULL,
    provider               text          NOT NULL,
    oauth_refresh_token    bytea         NULL,
    is_primary             boolean       NOT NULL DEFAULT false,
    created_at             timestamptz   NOT NULL DEFAULT now(),
    updated_at             timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT user_email_accounts_provider_check
        CHECK (provider IN ('gmail', 'outlook', 'imap'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_email_accounts_user_email_idx
    ON user_email_accounts (COALESCE(user_id::text, ''), email);

CREATE INDEX IF NOT EXISTS user_email_accounts_user_id_idx
    ON user_email_accounts (user_id)
    WHERE user_id IS NOT NULL;

-- Only one primary account per user.
CREATE UNIQUE INDEX IF NOT EXISTS user_email_accounts_one_primary_per_user_idx
    ON user_email_accounts (COALESCE(user_id::text, ''))
    WHERE is_primary = true;

COMMENT ON TABLE  user_email_accounts                     IS 'Connected email-provider accounts for inbox sync (Phase 1.5).';
COMMENT ON COLUMN user_email_accounts.user_id              IS 'NULL for the current single-user app; becomes mandatory when multi-tenant auth lands.';
COMMENT ON COLUMN user_email_accounts.provider             IS 'gmail | outlook | imap.';
COMMENT ON COLUMN user_email_accounts.oauth_refresh_token  IS 'Encrypted refresh-token ciphertext (never plaintext). Application layer wraps via KMS or pgcrypto.';
COMMENT ON COLUMN user_email_accounts.is_primary           IS 'True for the user-default account; enforced unique-per-user via partial index.';
