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
