# Content Studio AI key encryption migration

This is a one-time, reversible migration. It encrypts existing company text and
image Gemini keys without deleting the plaintext fields.

## Prerequisite

Configure a stable 32-byte key in Railway:

```text
CONTENT_STUDIO_CREDENTIAL_ENCRYPTION_KEY=<32-byte base64 or 64-character hex>
```

Back up this value through TerraPeak's approved secret-recovery process. Losing
it makes encrypted company credentials unrecoverable.

## Required sequence

Run each command against the same production release and encryption key.

1. Audit only:

   ```bash
   node scripts/migrateContentStudioAiKeys.js audit
   ```

2. Apply encryption while preserving plaintext:

   ```bash
   node scripts/migrateContentStudioAiKeys.js apply
   ```

3. Verify every migrated company:

   ```bash
   node scripts/migrateContentStudioAiKeys.js verify
   ```

The verification command exits unsuccessfully and lists company IDs if any
ciphertext cannot be decrypted or does not match the fingerprint captured
during apply.

Do not remove the plaintext fields unless all candidates have:

- an encryption migration marker;
- valid ciphertext for every configured key;
- a non-null `verifiedAt`;
- successful text and image connection tests through Platform Admin.

## Rollback

If apply or verification fails, keep the previous application release active
and run:

```bash
node scripts/migrateContentStudioAiKeys.js rollback
```

Rollback removes only the v1 encrypted fields and migration marker. It does not
modify or remove the original plaintext keys.

## Final plaintext removal

Plaintext removal is intentionally not part of this migration. It requires a
separate reviewed migration after every company passes verification and live
connection testing. That later migration must include its own backup, audit,
and rollback procedure.
