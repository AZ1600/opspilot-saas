# OpsPilot Troubleshooting

## Execution status API threw on invalid input

Date: 9 October 2026

### Symptoms

Direct route tests reproduced two failures:
- Malformed JSON threw a SyntaxError during request parsing.
- JSON null threw a TypeError when the route accessed body.status.

### Root cause

The handler parsed JSON without catching parsing failures.
A TypeScript type assertion assumed the body's shape but did not
validate it at runtime.

### Fix

Parse the body as unknown and catch parsing failures.
Validate that the body is a non-null, non-array object containing
a supported status before accessing the repository.

Keep authentication and permission checks before the update.

### Verification

All 14 route tests passed:
- Ten invalid-input cases return 400 without calling the update.
- Both supported statuses reach the update with the session business ID.
- Staff users receive 403 without calling the update.
- A null repository result produces 404.

TypeScript checking passed.

Authentication and storage are mocked in these route tests.
Permission rules are real. These tests do not verify database writes
or the complete authentication flow.

### Lessons

- Type assertions do not validate external input.
- Catch parsing errors without hiding unrelated storage failures.
- Tests check executed paths; type checking examines the wider code.
- Each parameterised test case must be a separate table row.

## Dependency security remediation

Date: 9 October 2026

Next.js was updated from 16.3.4 to 16.3.8. Additional dependency
updates were applied without using audit fix --force.

npm 10 crashed while resolving peer dependencies during audit fix.
A temporary npm 11 invocation completed the dependency updates.

The remaining five audit findings came from one development
dependency chain:
eslint-config-next -> @next/eslint-plugin-next -> fast-glob
-> micromatch -> braces.

The braces advisory had no published patched version at review time.
A scoped npm override replaces fast-glob with tinyglobby 0.2.17
only beneath @next/eslint-plugin-next.

### Compatibility and maintenance

The tested eslint-config-next version is pinned to 16.4.0.

Four tests exercise the actual Next.js plugin root-discovery helper:
default root, a single directory, wildcard directory matching that
excludes files, and an array of roots. Fixtures include spaces in paths.

This substitution is validated for that usage, not every fast-glob API.
Review the override and helper usage when upgrading the lint plugin.
Remove the override once the upstream dependency chain is repaired,
then rerun compatibility tests, lint and audits.

After a clean installation, all 39 tests, lint, type checking and
the production build passed. Both full and production-only audits
reported zero findings.

## Vitest module-format warning

The configuration used ES-module syntax but was loaded as CommonJS.
Renaming it to vitest.config.mts and replacing __dirname with
an import.meta.url-based path resolved the warning.

## JSON write endpoints threw on invalid body types

Date: 11 October 2026

Settings, onboarding, team invitations, manual ingestion, billing plan changes,
checkout, and inbox scan parsed external JSON with type assertions. Malformed
JSON and null bodies could throw. Numeric or object field values could reach
string methods such as trim or includes. Inbox scans also accepted a string
instead of an array of message IDs.

These seven routes now authenticate and check permissions first, then use
shared JSON-object and field validators. Invalid input returns HTTP 400 before
the route's business mutation, AI classification, or Stripe checkout operation.
Forbidden users receive HTTP 403 without parsing the body.

Valid profile, invitation, and manual-input text is trimmed. Existing field
minimums and allowed roles/plans/pain points are preserved. Inbox IDs must be
a non-empty array of non-empty strings; duplicate IDs scan each selected
message once. Unmatched selections still return HTTP 404.

The 93 new route cases cover invalid shapes/fields, permissions, normalized
valid arguments, inbox selection and checkout branches. Authentication,
repository methods, AI and Stripe calls are mocked; permission rules and
validators are real. They verify request boundaries, not live provider calls
or database persistence. Separate PostgreSQL suites cover repository behavior.

In an isolated project copy, all 172 unit tests, type checking and application
lint passed. Run the production build after applying the complete files. CI
also runs the existing PostgreSQL integration suites.

## Production billing bypasses and signature freshness

Date: 11 October 2026

The direct billing-plan endpoint could update a production business without
Stripe checkout. Checkout also changed the stored plan when Stripe was absent,
using the same demo fallback in every environment.

Direct plan selection is now limited to development/test demos with Stripe
disabled. Production and Stripe-enabled direct changes return HTTP 403.
Production checkout never falls back to a local plan update. Missing Stripe
API configuration, webhook secret or selected plan price returns HTTP 503
before starting checkout. Configured checkout returns a Stripe URL and leaves
the current stored plan unchanged.

Webhook verification previously checked the HMAC without checking its timestamp.
Correctly signed captured requests therefore did not expire. The verifier now
requires an integer Unix timestamp within 300 seconds of the server's current
time, in either direction. It still verifies the exact raw body with SHA-256
HMAC and constant-time signature comparison. Header parsing supports whitespace
and multiple v1 signatures.

Stripe documents a five-minute default tolerance and freshly signed delivery
attempts: https://docs.stripe.com/webhooks#preventing-replay-attacks
The check uses the signature header's delivery timestamp, not event.created,
so a legitimately retried older event with a fresh signature can still pass.

Nine billing-route cases and twenty webhook-signature cases were added.
The webhook cases use real Node crypto and the real webhook verifier; repository
mutations are mocked. Checkout creation is mocked and no live Stripe requests
or charges are made by these tests. All 201 unit tests, TypeScript and application
lint passed in an isolated project copy.

Signature freshness does not track processed event IDs or resolve the ordering
of distinct subscription events. Subscription entitlement policy and event
deduplication/order handling remain separate work. Verify the production build
after copying; existing PostgreSQL suites continue to run in CI.

## Verified email and account binding

Clerk workspace access now requires a verified primary email. Accounts without one are sent to `/account` to add or verify their email using Clerk's account component. A shared placeholder email is never used for workspace linking.

PostgreSQL resolves an existing provider ID before considering email. A verified email may activate an unbound legacy member or invitation, preserving its business and role. A member already bound to another provider ID cannot be rebound by an email match. Partially bound rows and inactive bound members fail closed. Account conflicts lead to a recovery message without exposing the other account's details.

New workspaces use lowercase SHA-256 IDs derived from the provider and exact provider user ID. Existing PostgreSQL bindings retain their workspace IDs. Existing file workspaces are reused only when their stored member ID exactly matches the provider identity. A colliding legacy filename is never claimed or overwritten. New file workspaces are published atomically without replacing a concurrent sign-in's file.

Validation: 228 unit tests, 34 real PostgreSQL tests, TypeScript and application lint passed in an isolated source copy. The added tests comprise 27 unit cases and 13 database cases, including unverified and phone-only accounts, immutable bindings, legacy access, workspace ID collisions, email changes and concurrent first sign-ins. Run the production build after applying the files.

This change retains the existing one-workspace-per-account model and stored profile fields. It does not automatically synchronize changed Clerk email addresses into existing workspace profiles, merge accounts, or repair bindings created before this guard. Existing suspicious bindings need explicit review.

Clerk reference: [Email verification state](https://clerk.com/docs/js-frontend/reference/types/email-address).

## Profile names after onboarding and settings changes

Saved owner names now appear in the mutation response and remain stored across subsequent requests. Workspace presentation uses the current user's refreshed profile name while keeping authenticated IDs, business scope and roles from the session. It does not substitute the workspace owner's name for a manager or staff member.

Demo session resolution keeps existing stored names by default. An explicit new demo login passes the internal `updateName` option, registers the chosen name before issuing its signed cookie, and can intentionally change it. Development fallback names are used for missing members rather than overwriting existing profiles on every request.

File settings writes update the owner's team-member name as well as `currentUser`. Older files whose settings write updated only `currentUser` retain that saved owner name and synchronize it into the member record when resolving the demo session. PostgreSQL upserts retain stored names unless the explicit login requests a name change, and refuse reserved demo IDs with complete or partial provider bindings.

Validation: 239 unit tests and 39 real PostgreSQL integration tests passed, along with TypeScript checking and application lint, in an isolated source copy. Eleven new unit cases exercise real login, session, settings, onboarding and workspace routes with Clerk/cookie adapters mocked. Five new PostgreSQL cases cover persisted names, explicit login updates and partial provider-binding protection. Run the production build after applying the replacements.

## Local demo reset boundary

`POST /api/workspace/reset` still requires an authenticated owner with reset permission. It now additionally requires a non-production environment, no Clerk keys (including partial configuration), the canonical demo business ID on both session and user, and the canonical demo owner ID. Other requests return 403 before accessing reset storage.

The authenticated workspace page derives reset eligibility on the server and passes it to the command center. Reset controls are hidden when unavailable, including Clerk accounts and the public demo. The eligible local demo owner retains both reset controls, with the settings control labeled `Reset demo workspace`.

The existing repository reset methods are unchanged and remain usable by trusted internal fixtures. This guard applies to the exposed API and product controls; it does not introduce a production data-deletion or account-deletion feature.

Validation: 256 unit tests and 44 real PostgreSQL integration tests passed, plus TypeScript and application lint, in an isolated source copy. The 17 new unit cases exercise the real file reset path and rendered command-center controls; only authentication and Clerk UI adapters are mocked. Five database cases prove that denied resets preserve workspace data, account bindings and billing identifiers, and that a local demo reset still works after approvals while leaving another business's records intact. Run the production build after applying the replacements.

## Onboarding without replacing workspace data

Onboarding updates an existing workspace in place rather than deleting its business row. First setup changes the business profile, active owner's display name, setup flag and built-in owner/focus documents. It keeps the existing plan, Stripe identifiers, team members and provider bindings, connectors, inbox, actions, approvals, jobs and other work history. Existing demo records also remain; onboarding is not a reset operation. A genuinely absent workspace still uses the initial onboarding templates.

An identical retry returns the stored workspace without rewriting records. A different profile after setup returns 409 and directs the owner to Settings. The command center handles this conflict by loading the current workspace and opening Settings. Stored membership is checked before setup or retry: the actor must be an active owner of the same business.

PostgreSQL serializes onboarding with a transaction-scoped advisory lock plus a business-row lock. The file repository serializes onboarding for a business within one process; it does not provide cross-process or general file-write transaction guarantees. PostgreSQL remains the production repository.

Validation: 268 unit tests and 52 real PostgreSQL integration tests passed, plus TypeScript and application lint, in an isolated copy. Twelve new unit cases exercise the real file repository and onboarding route. Eight database cases cover first setup with paid billing and existing approvals, retained account bindings, harmless retries, conflicts, concurrent submissions, foreign-owner rejection and absent-business initialization. The production build and browser behavior for a stale onboarding form remain to be checked after applying.
