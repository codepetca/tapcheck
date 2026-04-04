# Verified QR Attendance MVP

## User goal

Staff need to run a classroom attendance session where known students can self-check in with a shared QR code and staff can always fix attendance manually from the live roster.

## UX flow

Staff opens a roster, starts a session, shows the QR code, watches live attendance update, and uses one-tap manual controls for students who need help. Students scan the QR, sign in if needed, and get an immediate result on the same check-in page.

## Primary action

On the staff session screen, the obvious action is marking or correcting attendance quickly. On the student route, the obvious action is completing verified check-in.

## Architecture plan

- Extend Convex schema for participant linking, session lifecycle, current-state attendance, and attendance events.
- Add Convex participant-linking, session, and attendance mutations and queries.
- Replace the public editor collection flow with an authenticated staff session page.
- Add a public student `/check-in/[token]` route that returns through Clerk and writes attendance only after backend identity resolution.
- Update tests across Convex domain logic, roster/session pages, and the new student check-in flow.

## Risks

- Auth redirect behavior could strand students away from their check-in route.
- Session lifecycle changes could break current roster/session assumptions.
- Linking rules can create ambiguous matches if identifiers are incomplete or duplicated.
- Live manual and QR writes need to stay transactional and auditable.

## Simplification pass

- Keep lateness manual-only.
- Keep `participants.externalId` as the stored student ID for now.
- Skip reopen, guest flows, wallet, ticketing, and advanced review tooling.
- Keep display route optional unless implementation cost stays low.

## Acceptance criteria

- Staff can start and close sessions, mark attendance manually, and see live updates.
- Students can sign in from the QR flow and self-check in when uniquely matched.
- Duplicate, unmatched, ambiguous, invalid, and closed-session scans produce the expected result states.
- Authorization and roster/session rules are enforced in Convex.
