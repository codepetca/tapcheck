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
- Each roster is owned by one internal app user
- Dashboard and roster management routes require authentication
- Session editor token routes such as `/s/edit/[token]` stay public

## Features

- Roster list and roster detail pages
- Per-user roster isolation
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
- `createdAt`

### `auth_identities`

- `appUserId`
- `provider`
- `providerSubject`
- `tokenIdentifier`
- `email`
- `name`
- `createdAt`
- `updatedAt`

### `rosters`

- `ownerAppUserId`
- `name`
- `createdAt`

### `students`

- `rosterId`
- `studentId`
- `rawName`
- `firstName`
- `lastName`
- `displayName`
- `sortKey`
- `active`

### `sessions`

- `rosterId`
- `title`
- `date`
- `isOpen`
- `editorToken`
- `createdAt`

### `attendance`

- `sessionId`
- `studentRef`
- `studentId`
- `present`
- `markedAt`
- `lastModifiedAt`
- `modifiedAt`
- `modifiedViaTokenType`

This app uses one attendance record per student per session.

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
3. Return to the dashboard and confirm you can create a roster.
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

## AI Workflow

- Start with [docs/system/app-dna.md](docs/system/app-dna.md) and [docs/system/product-principles.md](docs/system/product-principles.md) for product and UI guardrails.
- Use [docs/workflow/feature-brief.md](docs/workflow/feature-brief.md) before non-trivial feature work.
- Use [docs/workflow/post-implementation-review.md](docs/workflow/post-implementation-review.md) after meaningful feature work.
- Reuse [docs/system/ui-patterns.md](docs/system/ui-patterns.md), [docs/system/anti-patterns.md](docs/system/anti-patterns.md), and [docs/system/screen-review-rubric.md](docs/system/screen-review-rubric.md) instead of inventing new rules each time.
- When a workflow repeats, follow [docs/system/skill-creation.md](docs/system/skill-creation.md): suggest a skill, ask for approval, then create it only if it is justified.

## Notes

- Dashboard access requires Clerk authentication.
- Public session editing still relies on unguessable editor tokens.
- Invalid share links show a friendly invalid-link state.
- The app renders a setup screen until `NEXT_PUBLIC_CONVEX_URL` is configured.
