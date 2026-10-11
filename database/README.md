# Database

OpsPilot has file and PostgreSQL implementations of the repository contract in `lib/server/workspace-repository.ts`. `getWorkspaceRepository()` selects PostgreSQL when `OPSPILOT_REPOSITORY=postgres`; otherwise it uses local JSON files.

`schema.sql` defines the PostgreSQL tables. Business-owned records use business IDs to scope reads and mutations. Production deployments should use persistent database storage.

## Approval identity

`updateActionDecision(businessId, actionId, status, { id: userId })` takes a user ID, not a display name. API routes supply the authenticated session's user ID. Each repository resolves the user within the selected business and requires an active membership. Route permission checks still determine whether that user may approve an action.

New approval events include `actorId` and the user's stored display name. PostgreSQL also records the user ID in the existing `approval_events.user_id` column. Different users may have identical names; the ID identifies the actor.

Repeated identical decisions preserve the original event, impact entry, and execution job. PostgreSQL serializes decisions on an action with a row lock. The file repository's retry protection covers sequential requests.

No schema migration is needed for this attribution change. Existing events are not rewritten. Older file-backed events may omit `actorId`, and older PostgreSQL events retain their previously recorded user IDs.

## Local integration tests

Start Docker Desktop, then run:

```bash
docker compose -f compose.test.yml up -d --wait
OPSPILOT_TEST_DATABASE_URL='postgresql://opspilot_test:opspilot_local_test@127.0.0.1:55432/opspilot_test' npm run test:postgres
```

The tests require the isolated database at `127.0.0.1:55432/opspilot_test` with the Compose test credentials. They apply the schema, create unique fixtures, and delete their own fixtures afterward. The Compose database uses temporary storage.

`npm run test` runs the unit/file tests separately. CI runs both suites.
