# OpsPilot SaaS

OpsPilot is an AI operations manager for small service businesses. It watches email, invoices, calendars, customer messages, and internal notes, then turns operational noise into owner-approved actions.

## Current milestone

This is the Next.js foundation for the product:

- App Router project structure
- TypeScript domain models
- Onboarding flow for creating a business workspace
- Settings view for profile, AI mode, connectors, and reset controls
- Team access model with owner, manager, and staff roles
- Prototype signed-cookie login for testing user roles
- Billing view with SaaS plans, usage, and ROI signal
- Demo service-business workspace
- Command center dashboard
- Revenue leak, risk, knowledge, and approval views
- Impact ledger that tracks estimated revenue, protected revenue, invoice follow-up value, and time saved
- Execution queue that turns approved actions into trackable jobs
- Gmail-style inbox simulator for selecting and scanning messages
- Gmail connector foundation with connect/import APIs
- Manual ingestion workflow for pasted business signals
- API route stub for an AI scan
- Backend-backed workspace state for local development
- Optional PostgreSQL repository for persistent SaaS storage
- Approval decision API and audit event tracking
- Health check and runtime configuration diagnostics
- Database schema draft for the SaaS backend

## How the current architecture works

The browser renders the command center, but the workspace state now comes from API routes.

- `lib/types.ts` defines the business objects used across the app.
- `lib/demo-data.ts` provides seed data for a cleaning/service business.
- `lib/workspace-factory.ts` creates a personalized starter workspace from onboarding.
- `lib/server/workspace-store.ts` acts like a tiny local database during development.
- `lib/server/auth.ts` reads a signed session cookie or falls back to the current development session.
- `lib/server/permissions.ts` protects owner, manager, and staff actions on the server.
- `lib/server/database.ts` creates the PostgreSQL connection pool when database mode is enabled.
- `lib/server/workspace-repository.ts` defines the data access contract.
- `lib/server/repository.ts` chooses local JSON or PostgreSQL using `OPSPILOT_REPOSITORY`.
- `lib/server/postgres-repository.ts` implements the same repository contract against PostgreSQL.
- `app/api/onboarding/route.ts` validates setup data and saves the tenant workspace.
- `app/api/workspace/settings/route.ts` saves profile and operations-focus changes.
- `app/api/billing/plan/route.ts` stores the selected plan for the workspace.
- `app/api/connectors/gmail/connect/route.ts` connects the Gmail mock account.
- `app/api/connectors/gmail/import/route.ts` imports Gmail messages into the inbox queue.
- `app/api/team/invite/route.ts` records invited team members and their roles.
- `app/api/workspace/route.ts` loads the saved workspace.
- `app/api/inbox/scan/route.ts` scans selected mock Gmail messages through the ingestion pipeline.
- `app/api/ingestions/manual/route.ts` classifies pasted business context and saves the resulting records.
- `app/api/actions/scan/route.ts` simulates an AI scan and saves the new action.
- `app/api/actions/[id]/status/route.ts` saves approve/dismiss decisions and creates audit events.
- Approved actions also create impact ledger entries and queued execution jobs.
- `app/api/executions/[id]/status/route.ts` marks execution jobs completed or failed.
- `app/api/health/route.ts` reports runtime configuration and repository reachability.
- `database/schema.sql` shows the PostgreSQL tables this local store should become.

This lets the UI follow the same pattern a production SaaS will use: ask the backend for data, send changes through APIs, and render the saved result returned by the server.

## Roles and permissions

The app now has a small role model so the dashboard can behave more like a real SaaS product.

- Owner can approve actions, scan inbox messages, ingest manual signals, manage settings, manage billing, invite team members, and reset the workspace.
- Manager can approve actions, scan inbox messages, and ingest manual signals.
- Staff currently has read-only dashboard access.

For local testing, set the dev session role before starting the server:

```bash
OPSPILOT_DEV_ROLE=manager npm run dev
```

The UI disables controls based on the current role, but the API routes enforce the permission checks too. That backend enforcement is the important part because a real user could still call an API directly.

Open `/login` to switch between demo owner, manager, and staff users. The login creates a signed HTTP-only cookie using `OPSPILOT_SESSION_SECRET`; if no cookie exists, the app falls back to `OPSPILOT_DEV_ROLE`.

## Storage mode

OpsPilot defaults to the local JSON repository because it is fast for development and does not require a database.

```bash
OPSPILOT_REPOSITORY=file
```

To use PostgreSQL, create a database, run `database/schema.sql`, then start the app with:

```bash
OPSPILOT_REPOSITORY=postgres
DATABASE_URL=postgres://user:password@localhost:5432/opspilot
npm run db:schema
npm run db:check
npm run dev
```

Set `DATABASE_SSL=true` for hosted Postgres providers that require SSL. The API routes do not change when storage changes because both repositories implement the same contract.

## Ingestion flow

The manual ingestion screen is the first version of the future Gmail/QuickBooks pipeline.

```text
Pasted text -> classifier -> structured action/revenue/risk records -> repository -> workspace
```

By default the classifier is rule-based in `lib/ai/ingestion-engine.ts`, so local development does not require paid API calls. `lib/ai/openai-ingestion.ts` adds an OpenAI-backed classifier behind environment variables.

Use the local rules mode:

```bash
OPSPILOT_AI_PROVIDER=rules
```

Use the OpenAI mode:

```bash
OPSPILOT_AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

Both modes return the same structured shape, so the dashboard and repository do not need to know which classifier produced the result.

## Gmail connector

The Inbox tab is now backed by the first connector flow.

```text
Connect Gmail -> import messages -> selected IDs -> inbox scan API -> classifier -> saved actions
```

By default the connector uses mock imported messages so the product can be tested without Google OAuth credentials. If Google OAuth environment variables are present, the same Connect button starts the real Google consent flow and stores encrypted Gmail tokens locally.

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/connectors/gmail/callback
OPSPILOT_TOKEN_ENCRYPTION_KEY=replace-with-a-long-random-token-key
```

Use the Gmail API read-only scope in Google Cloud:

```text
https://www.googleapis.com/auth/gmail.readonly
```

The real connector fetches recent Gmail messages through `lib/connectors/gmail.ts`, maps them into the same inbox shape as mock messages, and keeps the scan/action pipeline unchanged. Refresh tokens are used when available so imports can recover after access tokens expire. No email sending is enabled.

## Impact ledger

The Impact tab turns approved work into business proof.

```text
Approved action -> impact entry -> ROI summary
```

Each approved action creates an estimated impact record with category, amount, customer, source, time saved, and confidence. This is intentionally tied to approval events because the product should count value only after a human accepts the recommendation.

## Execution queue

The Execution tab turns approved AI recommendations into accountable work.

```text
Approved action -> queued execution job -> completed or failed status
```

Jobs are typed as email drafts, follow-up tasks, invoice reminders, or customer recovery work. This keeps OpsPilot honest: approving an AI recommendation does not pretend work was done; it creates a trackable job the business can complete.

## Run locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

Check runtime configuration:

```bash
npm run check:config
```

Run the fast product-logic tests:

```bash
npm run test
```

Check the running app:

```text
http://localhost:3000/api/health
```

## Deployment checklist

Before deploying OpsPilot, decide whether the deployment is a demo or a real SaaS environment.

For a demo deployment:

- Keep `OPSPILOT_REPOSITORY=file` only if the host has writable local storage and data loss is acceptable.
- Keep `OPSPILOT_AI_PROVIDER=rules` to avoid API costs.
- Leave Google OAuth variables unset to use mock Gmail import.
- Set `OPSPILOT_SESSION_SECRET` anyway so signed demo sessions are not using the local fallback.

For a production-style deployment:

- Use `OPSPILOT_REPOSITORY=postgres`.
- Set `DATABASE_URL`.
- Set `DATABASE_SSL=true` when your hosted database requires SSL.
- Run `database/schema.sql` against the production database before first boot.
- Set a strong `OPSPILOT_SESSION_SECRET`.
- Set `OPSPILOT_TOKEN_ENCRYPTION_KEY` before enabling Gmail OAuth.
- Use `OPSPILOT_AI_PROVIDER=openai` only when `OPENAI_API_KEY` is configured and spend is expected.
- Configure Google OAuth with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.
- Use the Gmail read-only scope only: `https://www.googleapis.com/auth/gmail.readonly`.
- Keep email sending disabled until a separate approval/send safety review is added.
- Verify `/api/health` returns `ok: true`.

Minimal Vercel-style environment:

```text
OPSPILOT_REPOSITORY=postgres
DATABASE_URL=postgres://...
DATABASE_SSL=true
OPSPILOT_SESSION_SECRET=...
OPSPILOT_TOKEN_ENCRYPTION_KEY=...
OPSPILOT_AI_PROVIDER=rules
```

Optional real Gmail OAuth:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-domain.com/api/connectors/gmail/callback
```

## GitHub setup

Use GitHub for source control and CI, then connect that GitHub repository to Vercel for hosting.

This workspace includes a GitHub Actions workflow at `.github/workflows/ci.yml`. It runs:

```bash
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
```

Use the dedicated GitHub repository `AZ1600/opspilot-saas` for this project. If Vercel imports that repository directly, the project root is the repository root.

## Next backend steps

1. Add authentication and organization membership.
2. Connect PostgreSQL and replace demo data with persisted records.
3. Add Gmail import for the first real integration.
4. Add OpenAI-powered classification and draft generation.
5. Store approval events for audit history.
