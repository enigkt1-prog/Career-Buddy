-- 0016_oauth_token_crypto.sql
-- Phase 1.6 — encrypt OAuth refresh tokens at rest.
--
-- The schema column `user_email_accounts.oauth_refresh_token bytea`
-- already exists (0010); this migration adds the encrypt / decrypt
-- helper functions using pgcrypto's symmetric AES under a project-
-- wide master key stored in the Postgres GUC `app.oauth_master_key`.
--
-- Set the key once via Supabase dashboard:
--   ALTER DATABASE postgres SET app.oauth_master_key TO '<32-byte-hex>';
-- (Generate: `openssl rand -hex 32`.) DO NOT commit the key. The
-- runbook documents the manual step. After setting, re-connect via
-- psql so the GUC is read at session start.
--
-- Upgrade path to Supabase Vault / KMS: replace the body of the two
-- functions with KMS round-trips; the column shape stays the same
-- so no schema migration is needed at swap time.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt a plaintext refresh-token. Reads the master key from the
-- Postgres GUC. Fails loudly if the key isn't set — refuses to
-- write plaintext-shaped ciphertext.
CREATE OR REPLACE FUNCTION encrypt_oauth_token(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  master_key text;
BEGIN
  master_key := current_setting('app.oauth_master_key', true);
  IF master_key IS NULL OR length(master_key) < 32 THEN
    RAISE EXCEPTION 'app.oauth_master_key not set or too short — see 0016 runbook';
  END IF;
  IF plaintext IS NULL OR plaintext = '' THEN
    RAISE EXCEPTION 'encrypt_oauth_token called with empty plaintext';
  END IF;
  RETURN pgp_sym_encrypt(plaintext, master_key);
END $$;

-- Decrypt to plaintext. Returns NULL on key-mismatch / corrupted
-- ciphertext rather than throwing — caller treats NULL as "needs
-- re-auth".
CREATE OR REPLACE FUNCTION decrypt_oauth_token(ciphertext bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  master_key text;
  plaintext  text;
BEGIN
  master_key := current_setting('app.oauth_master_key', true);
  IF master_key IS NULL OR length(master_key) < 32 THEN
    RAISE EXCEPTION 'app.oauth_master_key not set or too short — see 0016 runbook';
  END IF;
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  BEGIN
    plaintext := pgp_sym_decrypt(ciphertext, master_key);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;
  RETURN plaintext;
END $$;

-- Lock the functions so only the service-role / Postgres superuser
-- can call them directly. The edge functions hit them via RPC; the
-- anon role MUST NOT.
REVOKE ALL ON FUNCTION encrypt_oauth_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrypt_oauth_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encrypt_oauth_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION decrypt_oauth_token(bytea) TO service_role;

COMMENT ON FUNCTION encrypt_oauth_token(text) IS
  'Phase 1.6: encrypt an OAuth refresh-token via pgp_sym_encrypt with the project master key. Service-role only.';
COMMENT ON FUNCTION decrypt_oauth_token(bytea) IS
  'Phase 1.6: decrypt an OAuth refresh-token. Returns NULL on key-mismatch / corrupted ciphertext. Service-role only.';

COMMIT;
