# Terrapeak Backend — Codex Instructions

Backend stack:
- Node.js
- Express
- MongoDB
- Mongoose
- JWT auth

Important backend files:

controllers/platformAdminController.js
routes/platformAdmin.js
models/app.js
models/company.js
models/companyMembership.js
models/companyAppInstallation.js
middleware/isPlatformAdmin.js

## Current Backend Sprint

Customer Module — Connect Phase.

First task:
Make Manage Apps actions write to Activity Timeline.

## Existing Platform Model Context

App Registry model:
models/app.js

Fields include:
- slug
- name
- description
- category
- isCore
- standalone
- requiresAIAssistant
- launchUrl
- isVisible
- isComingSoon
- allowInstall
- minimumPlan
- dependencies
- icon
- sortOrder

App Registry is the single source of truth.

## Rules

Do not modify auth unless explicitly approved.

Do not change:
- JWT structure
- login/register flow
- company isolation
- platform admin middleware
- payment/billing logic

Before creating a new model:
- Search existing models first.
- Prefer extending existing platform admin structure if appropriate.

Before adding routes:
- Check routes/platformAdmin.js.
- Reuse controller patterns in platformAdminController.js.

Do not create duplicate APIs.

For Activity Timeline:
- Prefer backend-backed data.
- Company actions should be scoped by companyId.
- Platform admin actions should remain platform-admin only.

Before claiming complete:
- Run backend build/test/start check if available.
- Report exact files changed.
- Mention if no automated tests exist.