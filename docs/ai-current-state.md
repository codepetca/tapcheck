# AI Current State

## Purpose

Tapcheck is a mobile-first classroom attendance app. Authenticated staff users create and manage their own rosters, while live attendance collection still happens through editor token links.

## Auth Architecture

- Clerk is the authentication provider for the Next.js app.
- Tapcheck does not use Clerk user IDs as domain ownership IDs.
- Internal identity is modeled with Convex tables:
  - `app_users`
  - `auth_identities`
- `auth_identities` links the external Clerk identity to the internal `app_users` record.
- Resolve the current user in Convex from `ctx.auth.getUserIdentity()` and `tokenIdentifier`, not from any client-supplied user identifier.
- `email` is optional in auth-linked identity snapshots because Clerk claims reaching Convex may omit it.

## Authorization Boundaries

- Dashboard routes are authenticated.
- Public auth routes are `/sign-in` and `/sign-up`.
- Public attendance collection remains available at `/s/edit/[token]`.
- Roster ownership is enforced through `rosters.ownerAppUserId`.
- A signed-in user may only list, read, create, rename, import into, delete, or run sessions for their own rosters.
- There is no admin or support role in the current MVP auth model.

## Current Backend Conventions

- Keep the existing domain tables:
  - `rosters`
  - `students`
  - `sessions`
  - `attendance`
- Do not rename attendance tables or introduce a broader multi-provider abstraction unless the task explicitly requires it.
- Use shared Convex auth helpers for:
  - current app user bootstrap
  - current user lookup
  - roster ownership checks

## Current Frontend Conventions

- Clerk is wired through `proxy.ts`, `app/layout.tsx`, and the Convex client provider.
- Protected pages should wait for app-user bootstrap before issuing protected Convex queries.
- Auth UI should stay minimal and use the existing custom shell around Clerk components rather than a fully headless custom auth build.
- For UI/UX work, follow `docs/ai-ui-ux.md` as the design guidance source for primitives, composition, spacing, and visual tone.

## Testing Harness

- Treat the existing test setup as part of the architecture, not as optional cleanup.
- Convex behavior should be covered with `convex-test` tests in `convex/*.test.ts`.
- UI behavior should be covered with focused Vitest component/page tests where practical.
- Prefer extending existing tests when changing behavior instead of creating parallel test styles for the same surface.
- For auth and ownership work, add or update tests that prove:
  - user bootstrap behavior
  - owner-only access boundaries
  - public token routes remain public
- Before closing substantial work, run the relevant local checks, usually:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`

## Evidence-Based Change Rules

- Read the relevant implementation and existing tests before proposing or making structural changes.
- Use current repo evidence, local docs, and library guidance over memory when framework behavior may have changed.
- Do not introduce new abstractions, migrations, or architecture changes unless the current code or requirements justify them.
- When making a recommendation, tie it to concrete repo constraints such as current schema, current route model, or current test coverage.
- If a behavior is security-sensitive or access-sensitive, verify it with code inspection and tests rather than relying on intent.
