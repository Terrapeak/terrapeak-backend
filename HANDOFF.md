# Terrapeak Platform Handoff

**Milestone:** V1 Foundation  
**Audience:** Raimondo, Tim, future developers, ChatGPT, Codex, Claude, Cursor, and other coding assistants  
**Status:** Active reference document  
**Last updated:** July 2026

---

## 1. Purpose of this document

This handoff exists so a new developer or AI assistant can understand Terrapeak quickly without reconstructing months of architectural decisions from chat history.

Read this document before making structural changes.

The platform is close to market-ready. The current priority is to preserve the framework, finish focused cleanup, validate production behavior, and improve modules incrementally without redesigning the core.

---

## 2. What Terrapeak is

Terrapeak is a modular AI business operating platform.

It is not merely a chatbot application.

The AI Assistant is one module running on a stable platform framework. Other present and future modules include Reservations, Billing, Contracts, CRM, Analytics, messaging channels, and operational tools.

The framework should remain stable while modules evolve independently.

---

## 3. The coat-rack principle

The platform framework is the coat rack.

Apps hang on the framework.

The framework provides shared platform services such as:

- Authentication
- Companies
- Company memberships
- Platform roles
- Contracts
- Billing
- AI usage
- App registry
- App installations
- Activity tracking
- Customer health
- Customer provisioning

Business modules attach to those services without redesigning the platform.

Examples of modules:

- AI Assistant
- Reservations
- CRM
- Analytics
- WhatsApp
- Facebook
- Voice
- Marketplace

New modules should be installable through the App Registry and installer architecture.

---

## 4. Core business rules

### 4.1 Platform Workspace

The Platform Workspace is for Terrapeak platform staff only.

Customers must never access Platform Admin pages.

Platform routes are protected by platform roles.

### 4.2 Platform roles and customer roles are separate

Platform roles govern Terrapeak operational access.

Current platform-role values include:

- `platform-owner`
- `platform-admin`
- `support-admin`
- `billing-admin`
- `developer-admin`
- `sales-admin`
- `viewer`
- `none`

Customer roles govern access within a company environment.

Current customer membership roles include owner and other customer-level roles.

Never mix these two authorization systems.

### 4.3 Reservations and Appointments are different

Appointments belong inside the AI Assistant capability.

Reservations is a standalone module and product.

The AI Assistant may use Reservations, but Reservations must not be merged into Appointments.

### 4.4 Contracts and Billing are different

Contracts define the commercial agreement.

Billing executes and tracks the commercial state.

Do not merge them into one concept.

### 4.5 Billing controls operational permissions

Optional apps may only be enabled when billing allows it.

Current valid billing states for enabling optional apps are:

- `trial`
- `active`
- `manual`

Blocked states include:

- `not_configured`
- `past_due`
- `cancelled`

Core apps remain part of the base customer environment.

### 4.6 Production AI usage must belong to a company

AI usage is calculated through this relationship:

```text
Session
  -> ChatbotSettings
  -> Company
```

Preview sessions do not count.

Production sessions must be linked to a `ChatbotSettings` record with the correct `companyId`.

---

## 5. Repositories

Terrapeak currently uses two GitHub repositories.

### Frontend

Repository:

```text
Terrapeak/terrapeak-gemini-assistant
```

Local path used during development:

```text
C:\Company-related\pearlbot-code-unzipped\terrapeak-master\terrapeak-master
```

Technology:

- React
- Vite
- Redux Toolkit
- RTK Query
- Tailwind CSS
- React Router

Deployment:

- Vercel

Production URL:

```text
https://terrapeak-gemini-assistant.vercel.app
```

Platform URL:

```text
https://terrapeak-gemini-assistant.vercel.app/platform
```

### Backend

Repository:

```text
Terrapeak/terrapeak-backend
```

Local path used during development:

```text
C:\Company-related\pearlbot-code-unzipped\terrapeak-backend-master\terrapeak-backend-master
```

Technology:

- Node.js
- Express
- MongoDB
- Mongoose

Deployment:

- Railway

Production service:

```text
https://terrapeak-backend-production-2866.up.railway.app
```

### Database

- MongoDB Atlas
- Production cluster previously referenced as `terrapeak-production`
- Database name currently referenced as `test`

---

## 6. Current customer lifecycle

Terrapeak supports two onboarding entry points, both using the same provisioning engine.

### 6.1 Internal Terrapeak onboarding

Used when Terrapeak or a sales representative provisions a customer directly.

Flow:

```text
Collect customer details
  -> create or reuse User
  -> create or reuse Company
  -> create owner CompanyMembership
  -> create Trial Contract
  -> initialize Trial Billing
  -> install core and selected apps
  -> run app-specific installers
  -> validate environment
```

This path auto-approves the customer because Terrapeak initiated the onboarding.

CLI entry point:

```text
scripts/onboardCustomer.js
```

Reusable service:

```text
services/customerOnboardingService.js
```

### 6.2 Public self-signup

This is a safeguarded fallback, not the primary sales process.

Flow:

```text
Customer requests OTP
  -> OTP email sent
  -> customer enters OTP
  -> pending User created
  -> no JWT issued
  -> login blocked while pending
  -> Terrapeak approves customer
  -> customerOnboardingService provisions full environment
  -> approval email sent
  -> customer can log in
```

Pending users receive backend code:

```text
ACCOUNT_PENDING_APPROVAL
```

Self-signup must never create an active customer environment before approval.

---

## 7. Provisioning architecture

The provisioning pipeline is centralized.

### Entry points

- Internal CLI onboarding
- Admin approval flow
- Future Platform Admin onboarding UI
- Future API or import flow

### Single provisioning service

```text
services/customerOnboardingService.js
```

This service is responsible for creating or reusing:

- User
- Company
- CompanyMembership
- Contract
- Billing defaults
- CompanyAppInstallation records
- App-specific resources
- Linked ChatbotSettings

Do not duplicate this logic in controllers, scripts, or frontend code.

### Validation returned by onboarding

The service returns readiness checks such as:

- `userReady`
- `companyReady`
- `membershipReady`
- `aiAssistantReady`

A customer should not be treated as fully active when required validation fails.

---

## 8. App installation architecture

The App Registry is the source of truth for available apps.

Installation flow:

```text
App Registry
  -> selected app slugs
  -> installApps()
  -> module-specific installer
  -> CompanyAppInstallation
```

Main dispatcher:

```text
installers/installApps.js
```

Current installers:

- `installAIAssistant.js`
- `installReservations.js`

Current mapping includes:

- `ai-assistant`
- `reservations`

Installers must not call each other.

Installers should initialize only their own module.

Core apps are installed automatically during onboarding.

Optional apps are selected or enabled separately.

---

## 9. Authentication and authorization

### User schema

The User model includes:

- `role`
- `isAdmin`
- `platformRole`
- `isApproved`

### Login payload

The login response includes:

- `_id`
- `name`
- `email`
- `phone`
- `country`
- `companyName`
- `isAdmin`
- `role`
- `platformRole`
- `isApproved`

JWT payload includes role-related fields.

### Platform route protection

Frontend `ProtectedRoute` supports a platform route type.

Platform access is allowed for:

- `platform-owner`
- `platform-admin`

A temporary legacy fallback still allows `isAdmin === true` for V1 compatibility.

Do not remove that fallback until all authentication paths are confirmed to return platform roles reliably.

### Terrapeak owner

The Terrapeak account was updated to:

```text
role: admin
isAdmin: true
platformRole: platform-owner
```

---

## 10. Platform Workspace

Route:

```text
/platform
```

Purpose:

Terrapeak operational overview across customers.

Current Platform Overview includes:

- Greeting
- Companies count
- Users count
- Installed apps count
- Platform status
- Needs Attention widget
- Activity Feed widget
- Customer Search widget

The visible greeting was changed from `Good morning, Tim` to:

```text
Good morning, Terrapeak
```

### Customer search

Company search supports:

- Company name
- Company display name
- Company slug
- User name
- User email
- User company name

User-based matches resolve through active CompanyMembership records.

---

## 11. Company Workspace

Route:

```text
/platform/companies/:companyId
```

Current layout includes:

- Customer Header
- Customer Health
- Quick Actions
- Function Search
- Company card
- Contract card
- Billing card
- AI Usage card
- Installed Apps card
- Users & Roles card
- Activity Timeline
- Manage Apps modal

### Quick Actions

Current working actions include:

- Open Dashboard
- Manage Apps
- Open Billing

Some future actions remain intentionally disabled or deferred.

### Function Search

Function Search scrolls to workspace sections using React refs.

Current searchable sections include:

- Customer Health
- Company Information
- Contract
- Billing
- AI Usage
- Installed Apps
- Users & Roles
- Activity Timeline

---

## 12. Customer Health

Customer Health is computed in the backend.

The frontend only renders the result.

Current scoring considers:

- Company active state
- AI Assistant installed
- AI Assistant enabled
- Recent AI conversations
- Billing status
- Active users
- Installed apps

Current status thresholds:

- Excellent
- Healthy
- Needs Attention
- Critical

Health returns:

- score
- status
- strengths
- attention items

Trial, active, and manual billing are treated as healthy billing states.

---

## 13. Activity Timeline

Activity events are stored on the Company record.

Current app-related events include:

- installed
- enabled
- disabled
- uninstalled
- updated

The timeline displays the actor.

Example:

```text
Reservations disabled
By Terrapeak Group
```

The actor identifies who performed the action, not the company whose workspace is open.

Do not generate audit activity in React.

Activity should be produced by backend business actions.

---

## 14. AI Assistant and usage tracking

### Live flow

The live website chatbot is currently able to reach the Railway backend and receive Gemini responses.

### Session logging

`askGemini`:

- validates API key
- resolves ChatbotSettings
- creates or reuses Session
- saves user and model messages to `chatLogs`

### AI usage calculation

Platform AI usage currently shows:

- Messages Today
- Messages This Month
- Conversations
- Credits Remaining
- Last Activity

Preview sessions are excluded with:

```js
isPreview: { $ne: true }
```

This preserves older production sessions that may not have an `isPreview` field.

### Important incident and fix

Terrapeak live chatbot sessions originally did not appear in AI Usage because the live ChatbotSettings record was not linked to the Terrapeak Company.

A one-time linking script connected the exact live chatbot API key to `companyId`.

The permanent prevention is centralized onboarding: when AI Assistant is installed, ChatbotSettings must be created or linked with the correct Company ID.

### Credit source

AI Usage reads credits from:

```text
Company.billing.creditsRemaining
```

There must not be a second competing credit source.

---

## 15. Billing Foundation V1

Billing currently lives on the Company model.

Fields include:

- status
- trialEndDate
- renewalDate
- contractEndDate
- creditsRemaining
- paymentStatus

Current billing statuses include:

- `not_configured`
- `trial`
- `active`
- `past_due`
- `cancelled`
- `manual`

Current payment statuses include:

- `not_configured`
- `paid`
- `unpaid`
- `past_due`
- `failed`
- `manual`

### Default trial

Newly provisioned companies receive:

- Starter plan
- Trial status
- 30-day trial
- 1000 starting credits
- Payment status `not_configured`

### App gating

Optional app installation and re-enablement is checked in the backend.

The backend also enforces:

- Coming Soon restrictions
- `allowInstall === false`
- Minimum plan requirements
- Billing status requirements

Disabling an already-enabled app remains allowed.

The frontend catches `APP_BILLING_RESTRICTION` and shows the backend message in a toast.

Do not implement billing authorization only in React.

---

## 16. Contracts V1

Contracts are a first-class platform service.

Model:

```text
models/contract.js
```

Service:

```text
services/contractService.js
```

Current contract fields include:

- companyId
- plan
- status
- startDate
- endDate
- autoRenew
- billingType
- createdBy
- convertedFromTrial

Current statuses:

- trial
- active
- expired
- cancelled

New customers receive one trial contract during onboarding.

Contract creation is idempotent at the onboarding level: the service checks for an existing company contract before creating one.

The Company Workspace currently displays the Contract in a read-only card.

V1 intentionally does not include:

- Contract PDFs
- Signatures
- Amendments
- Discounts
- Tax logic
- Invoices
- Stripe
- Multiple concurrent contracts

The intended next contract action is a focused Trial-to-Active conversion flow, not free-form field editing.

---

## 17. Current frontend structure of interest

Important frontend locations include:

```text
src/routes/AppRoutes.jsx
src/middleware/ProtectedRoute.jsx
src/pages/auth/AuthForm.jsx
src/platform/pages/PlatformOverview.jsx
src/platform/pages/CompanyWorkspace.jsx
src/platform/services/platformAdminApi.js
src/platform/components/customer/
src/platform/widgets/
```

Important customer workspace components include:

- `CustomerHeader.jsx`
- `CustomerHealthCard.jsx`
- `CompanyCard.jsx`
- `ContractCard.jsx`
- `BillingCard.jsx`
- `AIUsageCard.jsx`
- `InstalledAppsCard.jsx`
- `UsersCard.jsx`
- `QuickActionsCard.jsx`
- `FunctionSearchCard.jsx`
- `ManageAppsModal.jsx`
- `ActivityTimelineCard.jsx`

---

## 18. Current backend structure of interest

Important backend locations include:

```text
controllers/authController.js
controllers/userController.js
controllers/platformAdminController.js
controllers/chatbotController.js
models/user.js
models/company.js
models/companyMembership.js
models/companyAppInstallation.js
models/chatbotSettings.js
models/sessionModel.js
models/app.js
models/contract.js
services/customerOnboardingService.js
services/contractService.js
installers/installApps.js
installers/installAIAssistant.js
installers/installReservations.js
scripts/onboardCustomer.js
scripts/setupTerrapeakCompany.js
scripts/linkTerrapeakLiveChatbot.js
```

---

## 19. Important implementation lessons

### 19.1 Centralize provisioning

Before centralization, users, companies, memberships, apps, and chatbots could be created through disconnected paths.

The result was incomplete environments and missing company links.

All onboarding entry points must call `customerOnboardingService`.

### 19.2 Do not confuse actor with target company

Activity Timeline displays the user who performed the action.

A Terrapeak platform admin acting inside a dummy company correctly appears as the actor.

### 19.3 Linux filename casing matters

A Vercel deployment failed because Git tracked:

```text
NeedsAttentionwidget.jsx
```

while the import expected:

```text
NeedsAttentionWidget.jsx
```

Windows tolerated it; Linux did not.

Case-only renames on Windows must be forced through a temporary filename or `git mv`.

Always keep filename casing and import casing identical.

### 19.4 Do not issue JWTs during pending signup

OTP verification confirms email ownership.

It does not approve the customer.

Pending self-signup users must not receive a JWT or authenticated cookie.

### 19.5 Do not silently swallow backend restrictions

The app toggle initially returned HTTP 409 correctly but the UI only logged the error.

The frontend now displays the backend restriction in a toast.

### 19.6 Legacy compatibility can be temporary

The Platform route guard currently accepts `isAdmin === true` as a fallback because the system previously omitted `platformRole` from login payloads.

The preferred authority is `platformRole`.

---

## 20. Git and collaboration workflow

Raimondo and Tim may work in parallel.

Do not both develop directly on `main`.

Recommended workflow:

```text
main
  -> production branch

raimondo/<task>
  -> Raimondo working branch

tim/<task>
  -> Tim working branch
```

Process:

1. Pull latest `main`.
2. Create one branch per task.
3. Push branches freely.
4. Test frontend branches through Vercel preview deployments when available.
5. Open a pull request.
6. Have the other partner review.
7. Merge only completed and tested changes into `main`.
8. Production deployment follows the merge.

Avoid scheduled automatic pushes of unfinished code.

A release window may be agreed operationally, but the actual merge should remain manual and deliberate.

### Deployment impact

- Frontend-only changes require Vercel deployment.
- Backend-only changes require Railway deployment.
- Cross-layer API changes require both.
- Documentation changes do not require runtime validation, although a Git-connected host may still create a deployment automatically.

---

## 21. Git milestones

Both repositories use the milestone tag:

```text
v1-foundation
```

This marks the Platform Foundation milestone.

Frontend and backend are separate repositories and must be committed independently.

---

## 22. Current known cleanup and deferred work

The platform is close to sellable, but not every future capability is complete.

Known cleanup or deferred areas include:

- Small Platform and Company Workspace UX cleanup
- Proper Trial-to-Active contract conversion
- Billing editor for Terrapeak platform staff
- Automated credit deduction and replenishment rules
- Payment provider integration
- Invoice handling
- Needs Attention based on real aggregated conditions
- Real platform activity feed
- More granular platform-role permissions
- Customer-facing module navigation generated from the App Registry
- Remaining chatbot implementation cleanup
- Existing React key warning previously observed in ChatbotSettingsPage
- Production accessibility issue investigation if some networks or devices fail to load the Vercel app

Do not expand these into large redesigns unless the current milestone explicitly requires it.

---

## 23. Current go-to-market posture

The framework is active and nearly sellable.

Recommended operating posture:

- Start onboarding controlled real customers.
- Keep Terrapeak-managed onboarding as the main path.
- Use the public signup path as a safeguarded fallback.
- Improve based on real customer usage.
- Avoid postponing launch for nonessential V2 features.
- Preserve modularity while iterating.

---

## 24. Non-negotiable development principles

1. Finish V1 modules before starting new ones.
2. Do not redesign the platform to add one module.
3. Reuse services and existing APIs.
4. Avoid duplicated models, controllers, and components.
5. Business rules belong in the backend.
6. React renders state and captures user intent; it does not own platform policy.
7. Use the App Registry and installer pattern for modules.
8. Use the centralized onboarding service for customer creation.
9. Keep Contracts and Billing separate.
10. Keep Reservations and Appointments separate.
11. Keep Platform roles and customer roles separate.
12. Customers never access Platform Workspace.
13. Preview AI usage never counts toward production usage.
14. Production AI sessions must be company-linked.
15. V1 should be practical, understandable, and shippable.

---

## 25. Instructions for a new chat or AI assistant

At the beginning of a new development conversation:

1. Read this file.
2. Read `AI_ARCHITECTURE.md` when available.
3. Identify whether the requested change affects frontend, backend, database, deployment, or multiple layers.
4. Inspect the current implementation before proposing changes.
5. Do not assume an old chat summary is more current than the repository.
6. Preserve the coat-rack architecture.
7. State the files and repositories affected before cross-layer work.
8. Prefer complete, testable milestones over scattered edits.
9. Add a test checkpoint after critical authorization, billing, onboarding, or data-model changes.
10. Keep explanations practical and step-by-step for manual execution when requested.

---

## 26. Immediate next steps after this handoff

The agreed sequence is:

1. Create and commit this handoff.
2. Create and commit `AI_ARCHITECTURE.md`.
3. Perform small dashboard cleanup requested by Raimondo.
4. Preserve the V1 Foundation as the stable baseline.
5. Move toward controlled go-to-market use.

---

## 27. Final architectural summary

Terrapeak is built around this hierarchy:

```text
Platform Framework
  -> Companies
    -> Memberships
    -> Contracts
    -> Billing
    -> Installed Apps
    -> AI Usage
    -> Activity
    -> Health
      -> Business Modules
```

Customer creation follows one provisioning engine.

Apps attach through the registry and installer system.

The Platform Workspace belongs to Terrapeak.

The Company Workspace represents one customer's operational environment.

The framework should remain stable while apps and workflows improve incrementally.
