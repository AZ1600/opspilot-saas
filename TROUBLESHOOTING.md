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