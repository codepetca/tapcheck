# Tapcheck

Realtime mobile attendance for teachers taking attendance at the classroom door.

## Stack

- Next.js 16 App Router
- TypeScript
- Convex for database, mutations, and live queries
- Clerk for authentication
- Tailwind CSS 4

## Auth model

- Clerk handles sign-in, sign-up, password auth, and Google OAuth
- Tapcheck keeps internal `app_users` and `auth_identities` tables
- Convex stores canonical organizations, memberships, and roster access
- Rosters are organization-owned and access is granted through `roster_access`
- Dashboard and roster management routes require authentication
- Session editor token routes such as `/s/edit/[token]` stay public

## Features

- Roster list and roster detail pages
- Organization-scoped roster access
- CSV import flow with:
  - file upload
  - column mapping for name and student ID
  - parsed preview before import
  - duplicate student ID warnings
- Demo roster seeding for quick testing
- Attendance sessions created from a roster
- One session editor link per roster session for live attendance updates
- Mobile-first editor screen with:
  - full-row tap targets
  - search
  - hide-present toggle
  - split sections for `Not Yet Marked` and `Present`

## Project structure

```text
app/
  sign-in/[[...sign-in]]/page.tsx    Clerk sign-in
  sign-up/[[...sign-up]]/page.tsx    Clerk sign-up
  page.tsx                           roster list
  rosters/import/page.tsx            CSV import
  rosters/[rosterId]/page.tsx        roster detail
  s/edit/[token]/page.tsx            live editor screen
components/
  auth-shell.tsx
  clerk-header-controls.tsx
  roster-import-form.tsx
  session-attendance-screen.tsx
  use-current-app-user.ts
convex/
  appUsers.ts
  auth.config.ts
  auth.ts
  attendance.ts
  rosters.ts
  schema.ts
  sessions.ts
lib/
  students.ts                        CSV parsing + normalization rules
  demo-data.ts
  session-links.ts
```

## Data model

### `app_users`

- `displayName`
- `status`
- `defaultOrganizationId`
- `createdAt`
- `updatedAt`

### `auth_identities`

- `appUserId`
- `provider`
- `providerSubject`
- `tokenIdentifier`
- `emailSnapshot`
- `nameSnapshot`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

### `organizations`

- `name`
- `slug`
- `status`
- `createdAt`
- `updatedAt`

### `organization_memberships`

- `appUserId`
- `organizationId`
- `role`
- `status`
- `createdAt`
- `updatedAt`

### `roster_access`

- `rosterId`
- `membershipId`
- `accessRole`
- `createdAt`
- `updatedAt`

### `rosters`

- `organizationId`
- `createdByAppUserId`
- `name`
- `createdAt`
- `updatedAt`

### `participants`

- `rosterId`
- `linkedAppUserId`
- `externalId`
- `rawName`
- `firstName`
- `lastName`
- `displayName`
- `sortKey`
- `participantType`
- `active`
- `createdAt`
- `updatedAt`

### `sessions`

- `rosterId`
- `title`
- `date`
- `sessionType`
- `participantMode`
- `isOpen`
- `createdByAppUserId`
- `editorToken`
- `openedAt`
- `closedAt`
- `createdAt`
- `updatedAt`

### `attendance_records`

- `sessionId`
- `participantId`
- `linkedAppUserId`
- `status`
- `source`
- `markedAt`
- `modifiedAt`
- `modifiedByAppUserId`

This app uses one attendance record per participant per session.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure Clerk and Convex

Start Convex development once and follow the CLI prompts to create or select a deployment:

```bash
pnpm convex:dev
```

Add these values to `.env.local` if the CLIs do not write them for you:

```bash
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key
CLERK_SECRET_KEY=sk_test_your_secret_key
CLERK_JWT_ISSUER_DOMAIN=https://your-instance.clerk.accounts.dev
```

You can use [.env.local.example](./.env.local.example) as a starting point.

Set `CLERK_JWT_ISSUER_DOMAIN` in the Convex deployment environment as well so Convex can validate Clerk-issued JWTs.
The app auth routes are defined in code as `/sign-in` and `/sign-up`; they do not need environment variables.

### 3. Run the app

In one terminal:

```bash
pnpm convex:dev
```

In another terminal:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

### First sign-in

1. Open `/sign-up`.
2. Create a Clerk account.
3. Return to the dashboard and confirm the app creates your internal user, default organization, and membership.
4. Open another browser profile or incognito window with a different account to verify the first roster is hidden there.

### CSV import

1. Sign in and go to `Import roster`.
2. Upload the exported CSV.
3. Choose the name column and student ID column.
4. Review the preview.
5. Fix any duplicate student IDs before importing.
6. Create the roster.

## Name parsing rules

- Preserve the original imported name in `rawName`
- If the raw name contains a comma, split on the first comma
- Left side becomes `lastName`
- Right side becomes `firstName`
- `displayName` becomes `First Last`
- `sortKey` sorts by last name, then first name

## Validation

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

## Manual smoke test

Use this after resetting the dev deployment or changing auth/bootstrap logic.

1. Start Convex and Next.js:

```bash
pnpm convex:dev
pnpm dev
```

2. Open `http://localhost:3000` in a fresh browser profile or incognito window.
3. Sign up or sign in through Clerk.
4. Confirm you land on the dashboard without a bootstrap error.
5. In another terminal, verify the canonical identity rows exist:

```bash
npx convex data app_users --limit 5 --format pretty
npx convex data organizations --limit 5 --format pretty
npx convex data organization_memberships --limit 5 --format pretty
```

6. Create a roster and confirm it appears in the dashboard.
7. Verify the roster created the expected access row:

```bash
npx convex data rosters --limit 5 --format pretty
npx convex data roster_access --limit 5 --format pretty
```

8. Open the roster, start a session, and confirm the editor link loads.
9. Mark one participant present and verify attendance was written:

```bash
npx convex data attendance_records --limit 10 --format pretty
```

10. Open a second browser profile with a different Clerk account and confirm the first roster is not visible there.

## AI Workflow

- Start with [docs/system/app-dna.md](docs/system/app-dna.md) and [docs/system/product-principles.md](docs/system/product-principles.md) for product and UI guardrails.
- Use [docs/system/testing-strategy.md](docs/system/testing-strategy.md) to decide what test surface and validation are expected for a change.
- Use [docs/workflow/feature-brief.md](docs/workflow/feature-brief.md) before non-trivial feature work.
- Use [docs/workflow/post-implementation-review.md](docs/workflow/post-implementation-review.md) after meaningful feature work.
- Reuse [docs/system/ui-patterns.md](docs/system/ui-patterns.md), [docs/system/anti-patterns.md](docs/system/anti-patterns.md), and [docs/system/screen-review-rubric.md](docs/system/screen-review-rubric.md) instead of inventing new rules each time.
- When a workflow repeats, follow [docs/system/skill-creation.md](docs/system/skill-creation.md): suggest a skill, ask for approval, then create it only if it is justified.

## Notes

- Dashboard access requires Clerk authentication.
- Authorization lives in Convex, not in Clerk role claims.
- Public session editing still relies on unguessable editor tokens.
- Invalid share links show a friendly invalid-link state.
- The app renders a setup screen until `NEXT_PUBLIC_CONVEX_URL` is configured.
