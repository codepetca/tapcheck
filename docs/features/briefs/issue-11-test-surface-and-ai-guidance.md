# Issue 11 Feature Brief

## User Goal

Contributors should be able to answer "what tests should exist for this change?" from repo docs alone and know the minimum validation expected before a PR is considered complete.

## UX Flow

- Open one repo doc that explains the app-wide test surface.
- Check the preferred test type for the affected area.
- Run the expected local validation commands.
- Use a follow-up checklist to target the highest-value missing tests.

## Primary Action

Define a practical minimum testing bar for the current app without turning the repo into a process-heavy test program.

## Architecture Plan

- Audit the current Vitest and `convex-test` suite across auth, rosters, roster import, roster detail/session actions, collection screen, middleware, and shared primitives.
- Add a concise testing strategy doc that maps app areas to expected coverage and preferred test type.
- Extend AI contributor guidance so behavior changes add or update tests when the affected surface is part of the required bar.
- Add a lightweight missing-tests checklist for follow-up implementation work.
- Keep the first PR docs-first; add missing tests in a follow-up PR after the bar is agreed.

## Risks

- Writing a testing policy that promises more than the current tooling supports.
- Mixing docs, large audits, and many new tests into one hard-to-review PR.
- Making the guidance too vague to change behavior or too heavy to be followed.

## Simplification Pass

- Do not define percentage-based coverage goals.
- Do not require browser automation in the first pass; the repo currently uses Vitest, jsdom, and `convex-test`.
- Do not try to close every coverage gap in the same PR.

## Acceptance Criteria

- Repo docs define the minimum expected test surface for the current app.
- AI guidance states when a behavior change requires a test and what local validation is expected.
- A follow-up checklist identifies the highest-value missing tests.
- The first PR stays concise and docs-first.
