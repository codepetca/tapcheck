# Tapcheck

Realtime mobile attendance for teachers taking attendance at the classroom door.

## Stack

- Next.js 16 App Router
- TypeScript
- Convex for database, mutations, and live queries
- Tailwind CSS 4
- WorkOS AuthKit for account login

## MVP features

- Roster list and roster detail pages
- CSV import flow with:
  - file upload
  - column mapping for name and student ID
  - parsed preview before import
  - duplicate student ID warnings
- Demo roster seeding for quick testing
- Attendance sessions created from a roster
- Two share links per session:
  - editor link for live attendance updates
  - viewer link for readonly live view
- Mobile-first editor screen with:
  - full-row tap targets
  - search
  - hide-present toggle
  - split sections for `Not Yet Marked` and `Present`
  - optimistic UI feel
- Realtime viewer screen powered by Convex subscriptions

## Project structure

```text
app/
  page.tsx                           roster list
  rosters/import/page.tsx            CSV import
  rosters/[rosterId]/page.tsx        roster detail
  rosters/[rosterId]/sessions/new    session creation
  sessions/[sessionId]/share         share links
  s/edit/[token]/page.tsx            live editor screen
  s/view/[token]/page.tsx            readonly viewer screen
components/
  roster-import-form.tsx
  session-attendance-screen.tsx
convex/
  schema.ts
  rosters.ts
  sessions.ts
  attendance.ts
lib/
  students.ts                        CSV parsing + normalization rules
  demo-data.ts
  session-links.ts
```

## Data model

### `rosters`

- `name`
- `ownerTokenIdentifier`
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
- `viewerToken`
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

This MVP uses one attendance record per student per session.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure Convex

Start Convex development once and follow the CLI prompts to create or select a deployment:

```bash
pnpm convex:dev
```

In most setups, Convex writes the needed values into `.env.local`. If it does not, add at least:

```bash
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

You can use [.env.local.example](./.env.local.example) as a starting point.

### 3. Configure auth

Tapcheck uses WorkOS AuthKit for account login and keeps the live attendance editor token-based.

For local development, `pnpm convex:dev` uses [`convex.json`](./convex.json) to provision or sync the dev WorkOS app settings. You still need these environment variables locally:

```bash
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_...
WORKOS_COOKIE_PASSWORD=your-32-character-secret
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback
```

### 4. Run the app

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

### Quick demo

1. Open the home page and sign in with your account.
2. Create or import a roster.
3. Open the roster.
4. Start a live session.
5. Copy the editor link.
6. Open that link on another device or browser window to verify realtime updates.

### CSV import

1. Go to `Import SchoolCash CSV`.
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
pnpm typecheck
pnpm build
```

## Notes

- Roster management, imports, sessions, and exports require an authenticated account.
- Each roster belongs to one account and is only visible to its owner.
- The live editor route `/s/edit/[token]` remains token-based and does not require login.
- Invalid share links show a friendly invalid-link state.
- The app renders a setup screen until `NEXT_PUBLIC_CONVEX_URL` and the required WorkOS env vars are configured.
