# Organization backend hardening

All application-level Organization membership mutations must use
`organizationService` or the validated `OrganizationMembership` model paths.
The model validates document saves, query updates, and `insertMany`. It rejects
protected `updateMany`, upsert, delete, update-pipeline, and `bulkWrite` paths
that cannot preserve role separation and final-owner guarantees safely.

The application cannot intercept writes made through a Mongoose model's raw
`.collection` property, another MongoDB client, or by a database administrator.
Those operationally privileged writes remain outside Mongoose middleware. Run
`npm run organization:hardening-audit` to detect resulting conflicts, and use
`npm run organization:index-audit` to verify critical indexes. Both commands
are read-only and never repair data or indexes.
