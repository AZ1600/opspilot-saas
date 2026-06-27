# Database

`schema.sql` is the PostgreSQL shape for OpsPilot.

The app currently uses a local JSON file through the repository interface in `lib/server/workspace-repository.ts`. That is deliberate: it lets the UI and API routes behave like a real backend while we build quickly.

When we connect PostgreSQL, the API routes should not change much. We will add a PostgreSQL implementation of the same repository methods:

- `read(businessId)`
- `reset(businessId)`
- `addScan(businessId, scan)`
- `updateActionDecision(businessId, actionId, status, actor)`

That is the value of the repository layer: the product logic depends on a contract, not on where the data is physically stored.
