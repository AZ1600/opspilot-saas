
# OpsPilot SaaS

[![CI](https://github.com/AZ1600/opspilot-saas/actions/workflows/ci.yml/badge.svg)](https://github.com/AZ1600/opspilot-saas/actions/workflows/ci.yml)

**An AI-assisted, multi-tenant SaaS operations platform that transforms fragmented business signals into structured recommendations, human-approved actions, execution records and impact tracking.**

OpsPilot helps small service businesses identify missed opportunities, investigate customer risks and manage operational workflows from a single workspace.

Built with **Next.js, React, TypeScript, Clerk, PostgreSQL, Stripe and optional OpenAI integration**, the project demonstrates practical full-stack SaaS engineering, tenant isolation, role-based authorization, transactional persistence, billing security and automated testing.

**Quick navigation:** [Technical Review](#technical-review--start-here) · [Architecture](#system-architecture) · [Security](#authentication-and-authorization) · [Testing](#testing-and-validation) · [Getting Started](#local-development) · [Limitations](#scope-and-limitations)

> [!IMPORTANT]
> OpsPilot is a production-style engineering portfolio project, not a claim of production customer adoption. It provides an authenticated SaaS workflow, PostgreSQL persistence and third-party integration foundations. Business execution remains controlled by human approval, and impact figures are estimates rather than independently verified financial outcomes.

---

## Technical Review — Start Here

For engineers reviewing the implementation, these links provide direct access to the most important architectural and security decisions.

| Engineering Area | What to Review | Evidence |
| --- | --- | --- |
| Multi-tenant architecture | Business-scoped repository operations | [Repository contract](lib/server/workspace-repository.ts) |
| PostgreSQL persistence | Tenant-scoped queries and transactional updates | [PostgreSQL repository](lib/server/postgres-repository.ts) |
| Authentication | Clerk identity and development session separation | [Authentication implementation](lib/server/auth.ts) |
| Identity security | Verified identities and conflict handling | [Identity resolution](lib/server/authenticated-identity.ts) |
| Authorization | Owner, manager and staff permissions | [Permission enforcement](lib/server/permissions.ts) |
| Approval safety | Decision attribution and duplicate-decision protection | [Approval tests](tests/approval-idempotency.test.ts) |
| Billing security | Stripe Checkout, Customer Portal and webhook verification | [Stripe implementation](lib/server/stripe.ts) |
| AI integration | Structured classification with deterministic fallback | [OpenAI ingestion](lib/ai/openai-ingestion.ts) |
| Deployment readiness | Production storage validation and health checks | [Runtime configuration](lib/server/config.ts) |
| CI/CD | Tests, audit, lint, typecheck, build and PostgreSQL integration | [GitHub Actions](.github/workflows/ci.yml) |

### Verification Summary

| Check | Recorded result |
| --- | --- |
| Application tests | **304 passed across 21 files** |
| ESLint | Passed |
| TypeScript | Passed |
| Next.js production build | Passed |
| Fresh npm installation | Passed |
| npm dependency audit | **0 reported vulnerabilities** |
| Next.js | Updated to 16.4.3 |
| Vitest | Updated to 4.1.12 |
| Zod | Resolved to patched version 4.6.7 |
| PostgreSQL integration | Separate test suite configured in GitHub Actions |

These local results were recorded on 30 October 2026. The PostgreSQL integration suite is separate from the 304 application tests and must be validated independently.

A clean dependency audit does not guarantee the absence of application-level security defects.

---

## The Problem

Small service businesses often work across disconnected systems:

- Customer emails
- Invoices
- Business notes
- Sales enquiries
- Booking requests
- Internal operational tools
- Customer support conversations

Important signals can be missed when information remains scattered.

Examples include:

- An unanswered lead that may represent lost revenue.
- An overdue invoice requiring a follow-up.
- A customer complaint that may indicate churn risk.
- A booking request needing urgent attention.
- An operational task with no assigned owner.

Identifying these signals is useful, but they must also be classified, prioritized, reviewed and tracked through resolution.

## The Solution

OpsPilot converts business information into a structured operational workflow.

```text
Business Signal
      |
      v
Ingestion and Validation
      |
      v
Classification and Business Rules
      |
      +----------------------+
      |                      |
      v                      v
Revenue Opportunity     Customer Risk
      |                      |
      +-----------+----------+
                  |
                  v
         Recommended Action
                  |
                  v
          Human Review
                  |
             +----+----+
             |         |
             v         v
          Approve    Dismiss
             |
             v
        Execution Queue
             |
             v
         Audit Record
             |
             v
         Impact Ledger
```

The platform separates identifying a potential business action from authorizing that action.

**AI-generated recommendations do not automatically become external business actions.**

---

## System Architecture

OpsPilot uses Next.js App Router for frontend rendering and server-side API endpoints.

```mermaid
flowchart TD
    USER[Business Owner or Team Member]
    UI[Next.js and React Workspace]
    AUTH[Clerk Authentication]
    RBAC[Workspace Resolution and RBAC]
    API[Next.js API Routes]
    CLASSIFIER[Rules / Optional OpenAI]
    REPO[Workspace Repository]
    FILE[Local JSON Development Store]
    PG[(PostgreSQL)]
    APPROVAL[Human Approval]
    EXEC[Execution Queue]
    IMPACT[Impact Ledger]
    STRIPE[Stripe Billing]
    GMAIL[Gmail Read-only Import]

    USER --> UI
    UI --> AUTH
    AUTH --> RBAC
    RBAC --> API

    API --> CLASSIFIER
    API --> REPO

    REPO --> FILE
    REPO --> PG

    CLASSIFIER --> REPO
    REPO --> APPROVAL
    APPROVAL --> EXEC
    EXEC --> IMPACT

    API --> STRIPE
    API --> GMAIL
```

### Architecture Components

| Component | Responsibility |
| --- | --- |
| Next.js frontend | Dashboard, inbox, onboarding, approvals and reports |
| API routes | Validate and process authenticated requests |
| Authentication | Verify Clerk identities or supported local demo sessions |
| Authorization | Enforce business membership and role permissions |
| Classification engine | Generate structured operational recommendations |
| Repository abstraction | Separate business logic from persistence |
| Local JSON repository | Support development and demonstration workflows |
| PostgreSQL repository | Provide persistent tenant-scoped storage |
| Approval workflow | Record authorized human decisions |
| Execution queue | Track approved operational jobs |
| Impact ledger | Record estimated operational outcomes |
| Stripe integration | Manage billing foundation and webhook synchronization |
| Gmail connector | Support read-only message import |
| Runtime health | Report configuration and storage readiness |

### Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16.4.3, React, TypeScript |
| Backend | Next.js API routes, Node.js |
| Authentication | Clerk |
| Database | PostgreSQL / Neon |
| Development storage | Local JSON |
| AI integration | OpenAI Responses API, deterministic rules |
| Payments | Stripe |
| Email integration | Google OAuth / Gmail API |
| Tests | Vitest |
| Code quality | ESLint, TypeScript |
| CI/CD | GitHub Actions |
| Hosting | Vercel |

---

## Core Engineering Capabilities

### 1. Multi-Tenant Workspaces

OpsPilot is organized around business workspaces.

Users operate within their assigned business context instead of accessing a shared global dataset.

Key behaviours include:

- Workspace membership resolution
- Business-scoped database operations
- Tenant-scoped reads and mutations
- Separate team members and roles
- Workspace-specific business records
- Isolation checks across different businesses

The repository implementation provides both local JSON and PostgreSQL backends.

[Workspace repository](lib/server/workspace-repository.ts) · [Tenant isolation tests](tests/tenant-isolation.test.ts) · [PostgreSQL isolation tests](tests/integration/tenant-isolation.postgres.ts)

### 2. Authentication and Authorization

OpsPilot supports three application roles.

| Capability | Owner | Manager | Staff |
| --- | --- | --- | --- |
| View authorized workspace data | Yes | Yes | Yes |
| Create manual ingestions | Yes | Yes | No |
| Scan inbox messages | Yes | Yes | No |
| Approve business actions | Yes | Yes | No |
| Manage billing | Yes | No | No |
| Manage workspace settings | Yes | No | No |
| Manage team members | Yes | No | No |
| Reset workspace | Yes | No | No |

These are application permission assignments. Individual routes enforce their own authentication and authorization requirements.

### Authentication Boundaries

Production uses Clerk authentication with server-side identity resolution.

The application checks the authenticated identity, including a verified primary email, before resolving the appropriate workspace.

Local development can use controlled demonstration sessions.

Demo authentication is disabled in production.

Relevant implementation:

- [Authentication](lib/server/auth.ts)
- [Identity resolution](lib/server/authenticated-identity.ts)
- [Authorization](lib/server/permissions.ts)
- [Identity tests](tests/auth-identity.test.ts)

---

## 3. Business Signal Ingestion

OpsPilot supports manual business notes and inbox-based signal processing.

Example input:

```text
Customer: Northline Offices

Our invoice is overdue because the payment
link was missing. Please follow up today.
```

The classification engine can generate:

- A categorized ingestion record
- A recommended action
- A priority level
- A customer reference
- A potential revenue-leak record
- A customer-risk record
- Supporting reason codes

The resulting records are stored in the selected workspace.

### Deterministic and AI-Assisted Modes

OpsPilot supports two classification paths.

**Rules mode**

A deterministic classifier processes supported patterns without requiring a paid AI service.

**OpenAI mode**

When configured, the application uses the OpenAI Responses API with a structured output schema.

If provider classification fails, the implementation falls back to its deterministic rule-based classifier.

AI outputs remain recommendations requiring human review where the workflow demands approval.

[Ingestion engine](lib/ai/ingestion-engine.ts) · [OpenAI integration](lib/ai/openai-ingestion.ts)

---

## 4. Human Approval Workflow

One of the central design decisions is to keep recommended actions behind an explicit authorization boundary.

```text
Pending Recommendation
         |
         v
Authenticated Reviewer
         |
         v
Permission Validation
         |
         v
Approve or Dismiss
         |
         v
Audit Event
         |
         v
Approved Execution Record
```

The application records the authenticated actor's identity rather than relying only on a display name.

### Approval Idempotency

Repeated identical approval decisions should not generate duplicate business events.

The repository implementations include protections against duplicate processing:

- PostgreSQL uses transaction and locking behaviour.
- The file-backed repository handles sequential duplicate decisions.
- Existing approval, execution and impact records are preserved on repeated identical decisions.

The protections have different concurrency characteristics; the file-backed repository is not a substitute for transactional production storage.

[Approval attribution tests](tests/approval-attribution.test.ts) · [Approval idempotency tests](tests/approval-idempotency.test.ts) · [Database behaviour](database/README.md)

---

## 5. Execution Queue

Approved actions can create execution-job records.

The queue represents workflow progress through states such as:

```text
Queued
   |
   +------> Completed
   |
   +------> Failed
```

This separates the following concepts:

1. An action was recommended.
2. A person authorized the action.
3. An execution job was recorded.
4. The job's outcome was updated.

The queue and audit records do not establish that an external email, payment or other real-world action was automatically completed.

[Execution status tests](tests/execution-status-route.test.ts)

---

## 6. Revenue and Customer Risk

### Revenue Leak Detection

The platform can identify potential business opportunities from supported signals, including:

- Overdue invoices
- Unanswered enquiries
- Missed customer follow-ups
- Unresolved requests

### Customer Risk Detection

Customer messages can produce structured risk records based on complaints, urgency or other supported patterns.

### Impact Ledger

OpsPilot tracks estimated operational impact, including possible revenue value, completed work and workflow outcomes.

**Estimated impact is not the same as verified recovered revenue.**

Financial claims require independent confirmation from actual customer and payment records.

---

## 7. Stripe Billing Integration

OpsPilot includes billing foundations for subscription workflows.

Implemented integration paths include:

- Stripe Checkout session creation
- Stripe Customer Portal sessions
- Subscription-related webhook processing
- Plan configuration
- Server-side billing permissions

### Webhook Security

Webhook requests are validated using an HMAC-SHA256 signature and a timestamp tolerance.

The implementation uses timing-safe signature comparison.

Unverified webhook payloads must not be treated as authenticated Stripe events.

Billing configuration is supplied through server-side environment variables.

[Stripe implementation](lib/server/stripe.ts) · [Webhook signature tests](tests/stripe-webhook-signatures.test.ts) · [Billing tests](tests/billing-production-routes.test.ts)

---

## 8. Gmail Integration

OpsPilot includes a Gmail connector with both demonstration and OAuth-backed paths.

The OAuth integration requests the read-only scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Features include:

- OAuth authorization flow
- OAuth state validation
- Access-token exchange
- Encrypted token storage
- Message retrieval and import
- Mock Gmail records for local demonstration

The connector does not provide unrestricted Gmail access or automatic outbound email sending.

Real OAuth integration requires Google credentials, suitable token encryption and deployment configuration.

[Gmail connector](lib/connectors/gmail.ts)

---

## Public Demo and Authenticated Application

OpsPilot separates public portfolio exploration from authenticated business workspaces.

| Route | Purpose |
| --- | --- |
| `/` | Public product overview |
| `/demo` | Read-only demonstration workspace |
| `/login` | Authentication entry point |
| `/app` | Authenticated business workspace |
| `/account` | Account-related access and identity information |
| `/api/health` | Runtime configuration and storage health |

The public demonstration uses bundled sample data and does not expose private tenant data.

Mutation actions such as approvals, execution updates, billing changes and workspace resets are disabled in the public demo.

---

## Database Design

OpsPilot uses a repository abstraction to support separate development and production persistence strategies.

### Local JSON Storage

The local file repository is intended for development and demonstration purposes.

It allows the application to operate without a hosted database.

It is not appropriate for production environments requiring transactional multi-tenant persistence.

### PostgreSQL Storage

The PostgreSQL repository supports persistent business-scoped records.

The schema includes entities such as:

```text
businesses
users
connected_accounts
customers
business_actions
revenue_leaks
customer_risks
inbox_messages
ingestions
knowledge_documents
timeline_events
approval_events
impact_entries
execution_jobs
```

The data model supports signal ingestion, team membership, approval attribution, execution status and impact tracking.

### Production Storage Guard

Production workspace operations require:

```env
OPSPILOT_REPOSITORY=postgres
DATABASE_URL=postgres://...
```

The application refuses production file-backed workspace storage.

PostgreSQL schema initialization is a separate deployment step. A production database must be provisioned and prepared before enabling application traffic.

[Database schema](database/schema.sql) · [Database guide](database/README.md) · [PostgreSQL repository](lib/server/postgres-repository.ts)

---

## Testing and Validation

OpsPilot uses automated unit tests, route tests, security tests and separate PostgreSQL integration tests.

### Application Tests

Run:

```bash
npm run test
```

Recorded local baseline, 30 October 2026:

```text
Test Files  21 passed (21)
Tests       304 passed (304)
```

The application tests include:

- Authentication and identity resolution
- Tenant isolation
- Workspace membership
- Permissions
- Approval attribution
- Approval idempotency
- Execution status
- Stripe webhook signatures
- Billing route security
- Runtime configuration
- Production storage restrictions
- Demo-session safeguards
- Onboarding safety
- JSON write routes

### Code Quality and Production Build

```bash
npm run lint
npm run typecheck
npm run build
```

All three checks passed locally after the dependency security updates.

### Dependency Security

The original audit on 30 October 2026 reported:

- One critical vulnerability
- One high-severity vulnerability
- Two moderate vulnerabilities

The remediation updated Next.js, Vitest and transitive dependencies, including Zod.

Subsequent checks reported zero known vulnerabilities:

```bash
npm audit --omit=dev
npm audit
```

The result reflects the dependency versions and advisory database at the time of testing.

New advisories may be published in the future.

### PostgreSQL Integration Tests

A separate Vitest suite validates repository behaviour against PostgreSQL.

The tests cover areas including:

- Tenant isolation
- Authentication identity handling
- Approval attribution
- Approval idempotency
- Onboarding safety
- Demo-session isolation
- Storage health
- Workspace profile handling

Start the disposable PostgreSQL test database:

```bash
docker compose -f compose.test.yml up -d --wait
```

Run the integration suite:

```bash
OPSPILOT_TEST_DATABASE_URL='postgresql://opspilot_test:opspilot_local_test@127.0.0.1:55432/opspilot_test' npm run test:postgres
```

Stop the test container:

```bash
docker compose -f compose.test.yml down
```

These commands use the dedicated local test database rather than a production database.

The PostgreSQL suite is also configured in CI.

### Continuous Integration

[GitHub Actions workflow](.github/workflows/ci.yml)

GitHub Actions runs on pushes and pull requests.

The pipeline includes:

1. Node.js 22 setup
2. Locked dependency installation using `npm ci`
3. Dependency security auditing
4. Vitest application tests
5. PostgreSQL integration tests
6. ESLint
7. TypeScript typecheck
8. Next.js production build

The workflow uses a PostgreSQL 17 service container for database tests.

This provides repeatable validation of code changes, but does not replace production integration testing or external security assessment.

---

## Runtime Health and Configuration

OpsPilot provides:

```text
GET /api/health
```

The endpoint reports runtime configuration and storage dependency health.

For example, a healthy PostgreSQL-backed environment can report:

```json
{
  "ok": true,
  "dependencies": {
    "repository": {
      "reachable": true,
      "latencyMs": 12,
      "mode": "postgres"
    }
  }
}
```

This is an illustrative response; latency varies.

The endpoint returns HTTP 503 when a required configuration or storage readiness check fails.

Responses use `Cache-Control: no-store`.

The health check verifies defined dependency readiness conditions, not full business functionality, backups, recovery or every possible production failure.

[Health endpoint](app/api/health/route.ts)

---

## Local Development

### Requirements

- Node.js 22
- npm
- Optional Docker Desktop for PostgreSQL integration tests
- Optional PostgreSQL for persistent local development
- Optional Clerk, Stripe, Google and OpenAI credentials

### Clone and Install

```bash
git clone https://github.com/AZ1600/opspilot-saas.git
cd opspilot-saas

npm ci
```

### Configure Local Development

Copy the environment template:

```bash
cp .env.example .env.local
```

The default local development mode can use:

```env
OPSPILOT_AI_PROVIDER=rules
OPSPILOT_REPOSITORY=file
OPSPILOT_DEV_ROLE=owner
OPSPILOT_SESSION_SECRET=replace-with-a-long-random-secret
```

This configuration supports development without paid AI services or a hosted PostgreSQL database.

Never commit `.env.local` or real credentials.

### Start the Application

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

To check runtime health:

```text
http://localhost:3000/api/health
```

### Validate Configuration

```bash
npm run check:config
```

This checks supported runtime configuration requirements.

---

## Optional Production Integrations

### PostgreSQL

```env
OPSPILOT_REPOSITORY=postgres
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_SSL=true
```

Provision the database, configure TLS as required by your provider and apply the schema before enabling production workspace traffic.

```bash
npm run db:schema
npm run db:check
```

**Do not run schema initialization against an existing production database without reviewing the schema, existing data and deployment plan.**

### Clerk Authentication

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

Both credentials must belong to the intended Clerk environment.

### OpenAI Classification

```env
OPSPILOT_AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

When enabled, the application calls the OpenAI Responses API for supported structured classification.

The deterministic rules engine remains available as a fallback.

### Gmail OAuth

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-domain.com/api/connectors/gmail/callback
OPSPILOT_TOKEN_ENCRYPTION_KEY=replace-with-secure-key
```

Use an appropriately protected encryption key and the minimum required Google OAuth scopes.

### Stripe

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_PRO=price_...
```

Real billing requires valid Stripe configuration and verification of the subscription lifecycle.

These values are placeholders and should not be used as real credentials.

---

## Deployment Architecture

OpsPilot supports a GitHub-to-Vercel deployment model backed by PostgreSQL.

```text
GitHub Repository
       |
       v
GitHub Actions
       |
       v
Vercel Deployment
       |
       v
Next.js Application
       |
       +------> Clerk Authentication
       |
       +------> PostgreSQL / Neon
       |
       +------> Stripe
       |
       +------> Optional OpenAI / Gmail
```

### Production Readiness Requirements

Before operating a production deployment:

- Configure persistent PostgreSQL storage.
- Apply the expected database schema.
- Configure Clerk authentication.
- Set strong application secrets.
- Validate workspace permissions and tenant isolation.
- Verify Stripe webhook signatures.
- Protect OAuth credentials and encryption keys.
- Check `/api/health`.
- Run automated tests and review CI results.
- Establish operational monitoring, backups and recovery procedures.

A successful Vercel deployment or CI build does not independently prove production readiness.

---

## Project Screenshots

### Workspace Onboarding

![Workspace Setup](docs/screenshots/workspace-setup.png)

### Dashboard and Daily Brief

![Daily Brief](docs/screenshots/dashboard-daily-brief.png)

### Action Approval

![Action Center](docs/screenshots/action-center-approval-flow.png)

### Restricted Staff Access

![Staff Access](docs/screenshots/staff-role-limited-access.png)

### Inbox

![Inbox](docs/screenshots/inbox.png)

### Manual Signal Ingestion

![Manual Ingestion](docs/screenshots/manual-ingest.png)

### Customer Risk

![Customer Risk](docs/screenshots/customer-risk.png)

### Impact Ledger

![Impact Ledger](docs/screenshots/impact-ledger.png)

### Execution Queue

![Execution Queue](docs/screenshots/execution-queue.png)

### GitHub Actions

![CI Results](docs/screenshots/github-actions-ci.png)

### Vercel Deployment

![Deployment](docs/screenshots/vercel-deployment-success.png)

---

## Repository Structure

```text
opspilot-saas/
├── app/
│   ├── api/
│   ├── app/
│   ├── demo/
│   ├── login/
│   └── account/
├── components/
├── lib/
│   ├── ai/
│   ├── connectors/
│   └── server/
├── database/
│   ├── schema.sql
│   └── README.md
├── scripts/
├── tests/
│   └── integration/
├── docs/
│   └── screenshots/
├── .github/
│   └── workflows/
│       └── ci.yml
├── compose.test.yml
├── package.json
├── package-lock.json
├── eslint.config.mjs
├── vitest.config.mts
├── vitest.postgres.config.mts
└── README.md
```

---

## Scope and Limitations

OpsPilot is a production-style SaaS implementation with important intentionally bounded capabilities.

**Authentication:** Production uses Clerk. Local demonstration sessions do not represent a production identity system.

**Storage:** File-backed persistence is intended for development. PostgreSQL is required for production workspace storage.

**Multi-tenancy:** Business-scoped access is enforced in application and repository code. Production authorization and database security still require operational review.

**AI:** Classification uses deterministic rules or optional model-generated structured output. Recommendations can be incorrect and require human verification.

**Execution:** The platform records approval and execution workflow state. It does not claim autonomous completion of external business tasks.

**Impact:** Revenue and time-savings figures are estimates unless validated against real business records.

**Billing:** Stripe integration foundations are implemented, but production payment handling requires correct credentials, webhook configuration and operational verification.

**Gmail:** OAuth-backed read-only import is available when configured. Automatic outbound email execution is not part of the demonstrated workflow.

**Testing:** Automated tests cover important application and database paths but do not replace browser end-to-end, penetration or production operational testing.

**Adoption:** No production customer adoption, financial savings or enterprise SLA is claimed.

---

## Future Engineering Improvements

Potential next steps include:

- Stronger production organization membership management
- Expanded end-to-end browser tests
- Production observability and error monitoring
- Dedicated background job processing
- Additional notification workflows
- Calendar and accounting integrations
- Slack and Microsoft Teams integrations
- Confirmed revenue reconciliation
- Additional external execution connectors
- Improved operational recovery and deployment safeguards
- Expanded automated security testing

These items are proposed improvements rather than currently delivered capabilities.

---

## Engineering Skills Demonstrated

**Full-Stack Engineering**
- Next.js, React and TypeScript
- Application architecture
- Server-side APIs
- Structured data modeling

**SaaS Engineering**
- Multi-tenant workspaces
- Identity and role-based authorization
- Subscription billing foundations
- Business workflow modeling

**Backend Engineering**
- PostgreSQL persistence
- Repository abstraction
- Transactional approval operations
- Idempotency and audit attribution
- Runtime configuration validation

**AI Engineering**
- Structured classification
- OpenAI integration
- Deterministic fallback
- Human-in-the-loop approval

**DevOps and Security**
- GitHub Actions CI
- Automated regression tests
- Dependency security updates
- PostgreSQL integration testing
- Vercel deployment
- Credential separation
- Production storage safeguards

---

## Engineering Principles

1. **AI assists, humans decide.** Recommendations do not automatically authorize action.
2. **Tenant boundaries matter.** Workspace access must be verified server-side.
3. **Approvals must be traceable.** Record the actor, decision and resulting workflow.
4. **Production storage must be persistent.** Local file storage remains a development tool.
5. **Security claims require evidence.** Tests and audits support specific claims, not blanket certification.
6. **Operational impact must be measurable.** Separate estimated outcomes from verified business results.

---

## Author

**Olawale Azeez**

AWS Certified Developer – Associate
AWS Certified Solutions Architect – Associate
AWS Certified Cloud Practitioner

Cloud Engineer | Platform Engineer | DevOps Engineer | Software Engineer

[GitHub](https://github.com/AZ1600) · [Portfolio](https://az1600.github.io/)
