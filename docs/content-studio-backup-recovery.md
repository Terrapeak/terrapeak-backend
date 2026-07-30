# Content Studio backup and recovery runbook

This runbook distinguishes backup configuration from a tested recovery. The application must never claim that MongoDB or Cloudinary backups exist only because their credentials are configured.

## Backup scope

- MongoDB: companies, encrypted AI configuration, saved and published content, image metadata, usage summaries, the append-only usage ledger, and audit events.
- Cloudinary: authenticated workspace originals and public publication renditions.
- Railway: environment-variable inventory and deployment configuration. Never export secret values into tickets or logs.

## Required controls

1. Enable automated MongoDB backups with a retention period appropriate to the production plan.
2. Enable Cloudinary backup/versioning when the account plan supports it. If it does not, document the accepted recovery limitation and maintain a separate protected export.
3. Restrict provider administration to named TerraPeak operators with MFA.
4. Run `npm run content-studio:recovery:audit` after verifying provider backup status.
5. Record the verification timestamps in Railway as `MONGO_BACKUP_VERIFIED_AT`, `CLOUDINARY_BACKUP_VERIFIED_AT`, and `CONTENT_STUDIO_RESTORE_DRILL_VERIFIED_AT` using ISO-8601 values.

## Quarterly isolated restore drill

1. Create an isolated non-production MongoDB database and Cloudinary product environment.
2. Restore the most recent approved MongoDB backup into the isolated database.
3. Restore or copy a representative authenticated original and a published rendition into the isolated Cloudinary environment.
4. Point a temporary backend deployment only at the isolated resources.
5. Verify tenant ownership, saved article rendering, published Markdown export, usage reconciliation, and image deletion retention.
6. Compare record counts and a sample of checksums/Cloudinary public IDs with the source backup manifest.
7. Destroy the isolated environment after evidence is retained. Never run a restore drill against production.

## Recovery order

1. Freeze Content Studio writes.
2. Restore MongoDB to the approved recovery point.
3. Restore Cloudinary resources.
4. Run `npm run content-studio:storage:audit` and `npm run content-studio:usage:audit`.
5. Resolve missing or orphaned resources before using any `--apply` command.
6. Test one company-scoped private draft and one explicit public export.
7. Re-enable writes and monitor audit events and storage counters.

## Important limitation

The readiness audit is read-only. It verifies database reachability, record counts, and the presence of operator evidence timestamps. It cannot independently prove that provider backups are restorable; only an isolated restore drill can do that.
