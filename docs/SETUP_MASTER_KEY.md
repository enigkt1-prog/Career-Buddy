# Master-Key Setup — OAuth Token Encryption (Supabase Vault)

The OAuth refresh tokens (Gmail / Outlook) are encrypted at rest
via pgcrypto's `pgp_sym_encrypt`. The encryption key lives in
**Supabase Vault** (`vault.secrets` table) rather than a Postgres
GUC, because the Supabase managed Postgres role doesn't have
SUPERUSER (needed for `ALTER DATABASE ... SET`).

## Step 1 — generate key

```bash
openssl rand -hex 32
```

Output: 64 hex chars.

## Step 2 — store in vault + rebind functions

Supabase Dashboard → SQL Editor → New query → paste + Run:

```sql
CREATE EXTENSION IF NOT EXISTS supabase_vault;

SELECT vault.create_secret(
  'PASTE-64-CHAR-HEX-HERE',
  'oauth_master_key',
  'OAuth refresh-token encryption key'
);

CREATE OR REPLACE FUNCTION encrypt_oauth_token(plaintext text) RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE master_key text;
BEGIN
  SELECT decrypted_secret INTO master_key FROM vault.decrypted_secrets WHERE name = 'oauth_master_key' LIMIT 1;
  IF master_key IS NULL OR length(master_key) < 32 THEN
    RAISE EXCEPTION 'oauth_master_key vault secret missing or too short';
  END IF;
  IF plaintext IS NULL OR plaintext = '' THEN
    RAISE EXCEPTION 'encrypt_oauth_token called with empty plaintext';
  END IF;
  RETURN pgp_sym_encrypt(plaintext, master_key);
END $$;

CREATE OR REPLACE FUNCTION decrypt_oauth_token(ciphertext bytea) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE master_key text; plaintext text;
BEGIN
  SELECT decrypted_secret INTO master_key FROM vault.decrypted_secrets WHERE name = 'oauth_master_key' LIMIT 1;
  IF master_key IS NULL OR length(master_key) < 32 THEN
    RAISE EXCEPTION 'oauth_master_key vault secret missing or too short';
  END IF;
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  BEGIN
    plaintext := pgp_sym_decrypt(ciphertext, master_key);
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
  RETURN plaintext;
END $$;
```

## Step 3 — verify

```sql
SELECT length(decrypted_secret) FROM vault.decrypted_secrets
  WHERE name = 'oauth_master_key';
```

Expected: `64`.

## Rotation runbook

1. Generate new key: `openssl rand -hex 32`.
2. Update vault secret (Vault auto-creates a new version):
   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'oauth_master_key'),
     'NEW-64-CHAR-HEX'
   );
   ```
3. The old key is GONE — every existing encrypted refresh-token
   now decrypts to NULL. Two paths:
   - **Soft rotation**: do nothing; users re-OAuth on next sync
     attempt (current UX handles NULL decrypt by prompting re-auth).
   - **Hard rotation**: pre-rotate by capturing all plaintext
     under the OLD key first, then update vault, then re-encrypt:
     ```sql
     CREATE TEMP TABLE _old_tokens AS
       SELECT id, decrypt_oauth_token(oauth_refresh_token) AS pt
         FROM user_email_accounts
        WHERE oauth_refresh_token IS NOT NULL;
     -- Then update_secret in vault.
     -- Then in a fresh session:
     UPDATE user_email_accounts uea
        SET oauth_refresh_token = encrypt_oauth_token(t.pt)
       FROM _old_tokens t
      WHERE uea.id = t.id;
     ```

## Storage rules

- **NEVER commit the key** to git.
- **NEVER share** via Slack / email / chat outside trusted threads.
- **Backup** in a password manager (1Password / Bitwarden).
- **Rotate** annually OR immediately on suspected compromise.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied to set parameter "app..."` | Tried ALTER DATABASE SET on managed Postgres | Use vault instead (this doc) |
| `oauth_master_key vault secret missing` | Step 2 not run | Run Step 2 |
| `function vault.create_secret(...) does not exist` | supabase_vault extension not enabled | `CREATE EXTENSION supabase_vault;` first |
| `decrypt_oauth_token` returns NULL | Ciphertext encrypted under different key | User must re-auth via OAuth |
