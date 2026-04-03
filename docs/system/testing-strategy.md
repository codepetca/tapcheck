# Testing Strategy

Keep the testing bar practical. Cover the behaviors that protect auth boundaries, roster ownership, attendance collection, and high-frequency teacher workflows. Do not optimize for percentages.

## Minimum Test Surface

### Auth, Bootstrap, And Ownership

- Use `convex-test` for app-user bootstrap, identity linking, and roster ownership rules.
- Use focused route or middleware tests when changing protected vs public routes.
- Required when changing `app_users`, `auth_identities`, `proxy.ts`, or owner-only Convex access.

### Dashboard And Roster List

- Use page or component tests for loading, empty, and active-session states.
- Required when changing bootstrap gating, roster list rendering, or the primary dashboard action.

### Roster Import

- Use component tests for parsing flow, mapping controls, help text, and submit behavior.
- Use Convex tests for import-into-existing rules, duplicate handling, and data integrity.
- Required when changing CSV parsing, import UI flow, or import mutations.

### Roster Detail And Session Actions

- Use page or component tests for start, stop, share, copy, download, and table sorting behavior.
- Use Convex tests when session actions or exports change persisted behavior.
- Required when changing roster detail actions or session lifecycle rules.

### Collection Screen

- Use focused component tests for search, sort, mark present or absent, loading, invalid-link, and mutation error states.
- Add route-level tests when the editor token page contract changes.
- Required when changing `/s/edit/[token]`, token lookups, or attendance toggling UX.

### Shared Primitives

- Add targeted component tests when a primitive change affects multiple screens.
- Current examples include dialog behavior and page shell structure.

## Preferred Test Types

- Convex domain logic: `convex-test`
- Page and UI behavior: Vitest + Testing Library
- Shared helpers: small unit tests
- Browser automation: only when jsdom coverage is not enough for the behavior under change

## When A Change Requires A Test

- A user-visible behavior changes.
- An auth or ownership boundary changes.
- A shared primitive changes.
- A bug fix would be easy to regress.
- A new state is introduced such as loading, invalid, empty, or error.

If the behavior already has a nearby test, extend it instead of creating a parallel style of test.

## Local Validation

Run the relevant checks before closing substantial work:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Run `pnpm lint` when the touched files or workflow justify it.
