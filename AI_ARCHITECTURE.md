# Terrapeak AI Architecture Guide

**Version:** V1 Foundation  
**Audience:** ChatGPT, Codex, Claude, Cursor, GitHub Copilot, and human developers  
**Purpose:** Explain the intended architecture, ownership boundaries, change procedure, deployment impact, and non-negotiable rules for Terrapeak.

---

## 1. Read This First

Terrapeak is a modular AI business operating platform. It is not merely a chatbot application.

> **The Platform Framework is the coat rack. Apps hang on it. The framework should remain stable while apps evolve independently.**

Before changing code, identify:

1. The repository that owns the change.
2. The architectural layer that owns the rule.
3. Whether the change is local or cross-layer.
4. Whether another module, repository, environment, or deployment must also change.
5. Whether data migration, backward compatibility, authorization, onboarding, billing, contracts, or production deployment are affected.

Do not begin by coding blindly.

---

## 2. Repository Topology

Terrapeak uses two repositories.

### Frontend

```text
Terrapeak/terrapeak-gemini-assistant
```

Local Windows path:

```text
C:\Company-related\pearlbot-code-unzipped\terrapeak-master\terrapeak-master
```

Stack:

- React
- Vite
- Redux Toolkit
- RTK Query
- React Router
- Tailwind CSS
- Framer Motion

Deployment:

- Vercel
- Production: `https://terrapeak-gemini-assistant.vercel.app`
- Platform Workspace: `https://terrapeak-gemini-assistant.vercel.app/platform`

Frontend owns presentation, navigation, forms, client state, API calls, loading/error states, and user interaction.

### Backend

```text
Terrapeak/terrapeak-backend
```

Local Windows path:

```text
C:\Company-related\pearlbot-code-unzipped\terrapeak-backend-master\terrapeak-backend-master
```

Stack:

- Node.js
- Express
- MongoDB
- Mongoose
- JWT
- Gemini API integration

Deployment:

- Railway
- Production: `https://terrapeak-backend-production-2866.up.railway.app`

Backend owns authoritative business rules, validation, authorization, provisioning, billing policy, contracts, app installation, usage calculations, and audit activity.

### Database

MongoDB Atlas is the system of record.

Known production context:

- Cluster: `terrapeak-production`
- Database currently observed: `test`

Always verify which environment a script or migration targets before execution.

---

## 3. Source-of-Truth Rules

### Frontend may own

- Layout
- Styling
- Components
- Form state
- Navigation
- Client-side loading and error states
- RTK Query definitions
- Toasts and feedback
- Browser interaction behavior

### Frontend must not own

- Billing policy
- Contract policy
- Company creation
- Customer provisioning
- App entitlement rules
- Platform authorization
- Customer authorization
- AI usage calculations
- Health calculations
- Audit event generation

### Backend may own

- Business rules
- Authentication and authorization
- Customer provisioning
- Company relationships
- App installation and initialization
- Contract state
- Billing and credit state
- AI usage calculations
- Platform and customer roles
- Activity history
- Customer Health scoring

### Backend must not own

- React layout
- Visual styling
- Animation details
- Browser-only UI behavior

When uncertain, business truth belongs in the backend and is rendered by the frontend.

---

## 4. Architectural Scope Classification

Before editing, classify the task into one or more scopes:

```text
Frontend UI
Frontend State
Frontend Routing
Frontend API Client
Backend Route
Backend Controller
Backend Service
MongoDB Model
Authentication
Authorization
Customer Provisioning
Installer
App Registry
Billing
Contract
AI Assistant
AI Usage
Reservations
Appointments
Platform Workspace
Company Workspace
Deployment
Shared Architecture
```

A change is **local** when it affects one layer and one module only.

A change is **cross-layer** when it changes an API contract, data structure, route, authorization rule, provisioning behavior, or deployment requirement.

For cross-layer work, use this order where applicable:

```text
Model
→ Service
→ Controller
→ Route
→ RTK Query
→ UI
→ Deployment validation
```

Do not leave one layer half-updated.

---

## 5. Coat-Rack Architecture

### Platform services

These are foundational services, not ordinary customer apps:

- Authentication
- Companies
- Company Memberships
- Platform Roles
- Contracts
- Billing
- AI Usage
- App Registry
- Activity Timeline
- Customer Health
- Customer Provisioning

### Business apps

These hang from the framework:

- AI Assistant
- Reservations
- Future CRM
- Future Analytics
- Future WhatsApp channel
- Future Facebook channel
- Future Voice channel
- Future marketplace modules

Adding a new app should not require redesigning the framework.

A new app should normally add:

- App Registry record
- Installer
- App-specific backend service/routes if needed
- App-specific frontend page/navigation if needed
- Permission rules
- Module initialization

Avoid hardcoding a new app across unrelated services.

---

## 6. Customer Provisioning Pipeline

There must be one provisioning engine.

Canonical service:

```text
services/customerOnboardingService.js
```

CLI adapter:

```text
scripts/onboardCustomer.js
```

The CLI collects input and calls the service. It must not contain the real business logic.

Canonical pipeline:

```text
Owner User
→ Company
→ Company Membership
→ Trial Contract
→ Trial Billing
→ App Installation
→ Module Initialization
→ Validation
```

Provisioning creates or reuses:

- User
- Company
- CompanyMembership
- Contract
- Company billing defaults
- CompanyAppInstallation records
- ChatbotSettings when AI Assistant is installed

### Mandatory onboarding invariants

A customer is not ready unless:

- User exists
- User is approved
- Company exists
- Company is active
- Owner membership exists and is active
- Trial contract exists
- Billing is initialized
- Core apps are installed
- AI Assistant settings are linked to the Company when installed

### Approved entry points

All onboarding paths must call the same service:

- Internal Terrapeak onboarding
- Self-signup approval
- Future sales-assisted onboarding UI
- Future API onboarding
- Future bulk import

Never duplicate onboarding logic in another controller or script.

---

## 7. Internal Onboarding vs Self-Signup

### Internal Terrapeak onboarding

Used after the customer has already been sold or manually accepted.

Behavior:

- User created or reused
- User approved immediately
- Full company environment provisioned
- Core apps installed
- Trial billing and trial contract initialized

### Public self-signup fallback

```text
Request OTP
→ OTP email
→ Verify OTP
→ Pending user created
→ No JWT
→ No login cookie
→ Login blocked
→ Terrapeak approves
→ Provisioning service runs
→ Approval email sent
→ Login allowed
```

Email verification is not platform approval.

Pending login must return:

```text
ACCOUNT_PENDING_APPROVAL
```

Do not auto-approve public signups.

---

## 8. Installer Architecture

Canonical dispatcher:

```text
installers/installApps.js
```

Current mapping:

```text
ai-assistant → installAIAssistant
reservations → installReservations
```

Rules:

- `installApps()` is the single normal app-installation entry point.
- Each installer initializes only its own module.
- Installers must not call each other.
- Installers must not contain unrelated platform logic.
- `CompanyAppInstallation` is the operational installation record.
- App Registry metadata determines visibility, core status, installability, minimum plan, and dependencies.
- Installers and provisioning must be idempotent.

For future apps, extend the registry and installer map instead of adding ad hoc onboarding code.

---

## 9. App Registry and Company Installations

### App Registry

The App model describes platform-wide metadata, including concepts such as:

- `slug`
- `name`
- `description`
- `category`
- `isCore`
- `standalone`
- `requiresAIAssistant`
- `launchUrl`
- `isVisible`
- `isComingSoon`
- `allowInstall`
- `minimumPlan`
- `dependencies`
- `icon`
- `sortOrder`

### CompanyAppInstallation

Represents whether one company has an app installed and enabled.

Important distinction:

- App Registry describes what exists.
- CompanyAppInstallation describes what a company has.

`Company.installedApps` may remain for compatibility, but it must not be treated as the only operational source of truth.

---

## 10. Contracts and Billing Are Separate

Do not merge Contracts and Billing.

### Contract answers

> What commercial agreement exists?

Contract V1 includes:

- `companyId`
- `plan`
- `status`
- `startDate`
- `endDate`
- `autoRenew`
- `billingType`
- `createdBy`
- `convertedFromTrial`

Statuses:

```text
trial
active
expired
cancelled
```

### Billing answers

> What is the operational payment and credit state?

Company billing includes:

- `status`
- `trialEndDate`
- `renewalDate`
- `contractEndDate`
- `creditsRemaining`
- `paymentStatus`

Billing statuses:

```text
not_configured
trial
active
past_due
cancelled
manual
```

Payment statuses:

```text
not_configured
paid
unpaid
past_due
failed
manual
```

### Trial defaults

Newly provisioned companies receive:

- Starter plan
- 30-day trial
- 1000 AI credits
- Trial billing status
- Trial contract

Do not silently reset or extend an existing trial during idempotent onboarding.

---

## 11. Billing Controls App Access

Backend policy decides whether an app may be installed or enabled.

Optional apps are currently allowed under:

```text
trial
active
manual
```

Blocking states include:

```text
not_configured
past_due
cancelled
```

Rules:

- Disabling an app is allowed.
- Installing or re-enabling an optional app requires valid billing.
- Core apps form part of the base environment.
- `minimumPlan` is enforced in the backend.
- `isComingSoon` and `allowInstall` are enforced in the backend.
- Frontend buttons are not security controls.

Structured restriction code:

```text
APP_BILLING_RESTRICTION
```

Frontend should display the backend message and keep the modal open.

---

## 12. AI Assistant and AI Usage

### AI Assistant

ChatbotSettings is linked to:

- User
- Company

A production chatbot must have the correct `companyId`.

The live widget identifies a chatbot through its API key, which resolves ChatbotSettings.

Sessions store concepts including:

- `sessionId`
- `chatbotId`
- `userId` where applicable
- `isPreview`
- `chatLogs`
- timestamps

### Usage relationship

```text
Company
→ ChatbotSettings by companyId
→ Session by chatbotId
→ chatLogs
```

Current metrics:

- Messages Today
- Messages This Month
- Conversations
- Last Activity
- Credits Remaining

Rules:

- Preview sessions never count.
- Use `{ isPreview: { $ne: true } }` for legacy compatibility.
- Production sessions must belong to a chatbot linked to a Company.
- Billing is the source of truth for `creditsRemaining`.
- Do not duplicate credit state in an AI-specific record without an intentional architectural change.

A previous production issue occurred because Terrapeak's live ChatbotSettings lacked the correct `companyId`. Provisioning invariants must prevent recurrence.

---

## 13. Reservations vs Appointments

This distinction is permanent.

### Appointments

Appointments are an integrated capability inside AI Assistant.

They cover:

- Online meetings
- Callbacks
- Scheduling connected to the assistant
- Google Meet integration

### Reservations

Reservations is a standalone app/product.

It covers:

- In-person bookings
- Table reservations
- Service reservations
- Reservation dashboard and business configuration

AI Assistant may use Reservations, but Reservations is not Appointments.

Never merge their models, navigation, product identity, or business logic.

---

## 14. Authorization Model

Terrapeak has two separate role systems.

### Platform roles

Stored as `platformRole` on User:

```text
none
platform-owner
platform-admin
support-admin
billing-admin
developer-admin
sales-admin
viewer
```

Platform routes include:

```text
/platform
/platform/apps
/platform/companies/:companyId
```

Platform Workspace is for Terrapeak operators only.

### Legacy admin compatibility

Existing users may also use:

- `isAdmin`
- `role: admin`

A temporary compatibility fallback allows `isAdmin === true` to access platform routes. Preserve it until all auth paths and user migrations reliably use `platformRole`.

### Customer roles

CompanyMembership roles are separate:

```text
owner
admin
staff
viewer
```

Never treat a customer owner as a platform admin.

Backend middleware is the final authorization layer. Frontend route guards improve UX but are not sufficient security.

---

## 15. Platform and Company Workspaces

### Platform Workspace

Terrapeak-only operational workspace.

Main route:

```text
/platform
```

Current overview concepts:

- Good morning, Terrapeak
- Company count
- User count
- Installed app count
- Platform status
- Needs Attention
- Activity Feed
- Customer Search

### Company Workspace

Route:

```text
/platform/companies/:companyId
```

Current sections:

- Customer Header
- Customer Health
- Quick Actions
- Function Search
- Company Information
- Contract
- Billing
- AI Usage
- Installed Apps
- Users & Roles
- Activity Timeline

Each card represents a separate platform service. Do not collapse them into one mixed-responsibility component.

---

## 16. Customer Health

Customer Health is calculated in the backend and rendered in the frontend.

Current factors include:

- Company active state
- AI Assistant installed
- AI Assistant enabled
- Recent AI activity
- Billing health
- Active users
- Installed apps

Status bands:

```text
Excellent
Healthy
Needs Attention
Critical
```

Health is not manually edited.

When adding a factor, return structured strengths and attention items.

Do not hardcode health scores in React.

---

## 17. Activity Timeline

Activity events are generated by the backend. Frontend only renders them.

Current app events include:

```text
installed
enabled
disabled
uninstalled
updated
```

The actor is the person performing the action, not the target company label.

Example:

```text
Reservations disabled
By Terrapeak Group
```

means the Terrapeak operator performed the action inside that company workspace.

Do not generate authoritative audit events in React.

---

## 18. API and Data-Contract Discipline

When changing a backend response:

1. Identify every frontend consumer.
2. Update RTK Query when needed.
3. Update component fallbacks.
4. Preserve safe defaults for legacy records.
5. Test loading, success, empty, and error states.

Do not rename fields casually.

Important company-detail payload concepts include:

- `company`
- `contract`
- `users`
- `apps`
- `availableApps`
- `activityEvents`
- `billingSummary`
- `aiUsage`
- `healthSummary`

Prefer focused backend summaries over making frontend components derive business state from raw records.

---

## 19. File and Naming Discipline

Vercel builds on Linux and Linux is case-sensitive.

A real deployment failure occurred because of:

```text
NeedsAttentionwidget.jsx
```

versus:

```text
NeedsAttentionWidget.jsx
```

Rules:

- Import casing must exactly match filename casing.
- Use `.js` and `.jsx` consistently with project convention.
- Windows may not detect case-only renames in Git.
- Use a temporary rename:

```text
git mv OldName.jsx TempName.jsx
git mv TempName.jsx CorrectName.jsx
```

Validation commands:

```text
npm run build
node --check path\to\file.js
```

---

## 20. Git and Multi-Developer Workflow

Raimondo and Tim may work concurrently.

Do not both work directly on `main`.

Recommended branch structure:

```text
main
├── raimondo/<task>
└── tim/<task>
```

Workflow:

1. Pull latest `main`.
2. Create a focused task branch.
3. Make changes.
4. Commit locally.
5. Push the branch.
6. Test locally or with preview deployment.
7. Open Pull Request.
8. Review cross-repository impact.
9. Merge when ready.
10. Let `main` trigger production deployment.

Avoid editing the same file simultaneously where possible.

Deployment behavior:

- Production frontend branch triggers Vercel deployment.
- Railway-connected backend branch triggers Railway deployment.
- Documentation-only commits may still trigger deployments depending on provider settings.
- Frontend feature branches may receive Vercel preview deployments.

Do not schedule automatic pushes of unfinished work. Use an agreed release window and manually merge ready PRs.

---

## 21. Cross-Repository Deployment Order

### Additive backend-first change

```text
Deploy backward-compatible backend field/route
→ Deploy frontend consumer
→ Remove legacy behavior later if needed
```

### Breaking change

Avoid direct breaking changes.

Use temporary compatibility:

```text
Backend supports old and new contract
→ Frontend migrates
→ Verify production
→ Backend removes old contract later
```

Never deploy a frontend that requires an API response not yet available.

Never remove a backend field still consumed by production frontend.

---

## 22. Safe Change Procedure for AI Assistants

Before editing:

1. Read `HANDOFF.md`.
2. Read `AI_ARCHITECTURE.md`.
3. Inspect the exact files involved.
4. Identify repository and branch.
5. State architectural scope.
6. Identify API, data, auth, onboarding, billing, contract, and deployment impact.
7. Prefer the smallest complete change.

During editing:

- Preserve naming conventions.
- Reuse services and API patterns.
- Avoid duplicate helpers, models, routes, and components.
- Avoid hardcoded module behavior.
- Keep business logic out of React.
- Keep UI behavior out of backend services.
- Maintain idempotency for provisioning and installers.

After editing:

- Run syntax checks.
- Run frontend build if frontend changed.
- Test the affected workflow.
- Verify one unrelated workflow did not regress.
- Record limitations.
- Commit with a focused message.

---

## 23. Required Impact Statement

For each proposed change, report:

```text
Repository:
Files:
Layer:
Business rule affected:
Data migration required:
Frontend deployment required:
Backend deployment required:
Backward compatibility:
Test steps:
Rollback point:
```

For a small local UI change, some fields may be `none`, but scope must still be explicit.

---

## 24. Things AI Assistants Must Never Do

Do not:

- Create a second onboarding flow.
- Bypass `customerOnboardingService`.
- Bypass `installApps()` for normal app installation.
- Put billing policy in React.
- Trust frontend routes as the only authorization layer.
- Treat Reservations and Appointments as the same product.
- Hardcode customer-specific records into production code.
- Count preview sessions as production AI usage.
- Add app-specific logic to unrelated platform services.
- Force-push over remote changes.
- Commit `.env` files or secrets.
- Assume Windows filename casing will work on Linux.
- Run destructive MongoDB scripts without confirming environment and scope.
- Redesign stable architecture to add one feature.
- Start a new module before the current V1 task is complete.

---

## 25. Current Stable Foundation

Treat these as established V1 architecture:

- OTP signup
- Pending approval flow
- Internal onboarding flow
- Unified customer provisioning service
- Company model
- Company membership model
- Platform roles
- App Registry
- Installer architecture
- CompanyAppInstallation
- AI Assistant company linkage
- Production AI usage tracking
- Preview exclusion
- Trial billing
- Billing app restrictions
- Trial contracts
- Company Workspace
- Platform Workspace
- Customer Health
- Activity Timeline
- Function Search
- Quick Actions

Extend these patterns rather than casually replacing them.

---

## 26. Deferred Work

Intentionally deferred from V1:

- Stripe integration
- Automated invoices
- Taxes
- Discounts
- Contract PDFs and signatures
- Full trial-to-contract wizard
- Automatic renewals
- Payment reconciliation
- Fine-grained enforcement for every platform role
- Full impersonation/company-switching
- CRM
- Advanced analytics
- WhatsApp
- Facebook
- Voice
- Marketplace

Deferred work is not missing architecture. The framework is designed so these capabilities can be added later.

---

## 27. V1 Product Direction

Terrapeak is close to sellable.

Current priority is not large architectural expansion.

Current direction:

- Small dashboard cleanup
- Operational stability
- Real customer onboarding
- AI Assistant reliability
- Billing usability
- Feedback-driven iteration

Go to market before unnecessary complexity is added.

---

## 28. Recovery Prompt for a New AI Session

```text
You are assisting with the Terrapeak Platform.

First read HANDOFF.md and AI_ARCHITECTURE.md in the repository root.

Terrapeak is a modular AI business operating platform using a stable coat-rack framework. Frontend and backend are separate repositories. Business rules belong in the backend. Customer provisioning must use customerOnboardingService. App installation must use installApps and module-specific installers. Contracts and Billing are separate services. Reservations and Appointments are separate products. Platform Workspace is Terrapeak-only. Preview AI sessions never count toward usage.

Before changing code, identify the affected repository, layer, files, API/data impact, deployment impact, and test plan. Do not create duplicate architecture or bypass established services.
```

---

## 29. Final Rule

When code and this document appear inconsistent:

1. Inspect the latest code.
2. Determine whether it is a deliberate newer decision or accidental drift.
3. Preserve the intended architecture unless project owners explicitly approve a change.
4. Update this document when architecture deliberately changes.

The goal is not merely to make code work.

The goal is to keep Terrapeak understandable, modular, safe to operate, and easy to extend while it moves to market.
