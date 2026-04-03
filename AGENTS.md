<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

Always preserve the internal auth model of `app_users` + `auth_identities` with roster ownership via `rosters.ownerAppUserId` unless the task explicitly changes auth architecture.
Prefer evidence-based implementations: inspect the existing code and tests before changing architecture, extend the current test harness with each substantive behavior change, and validate claims with local verification instead of assumptions.
For UI work, preserve the existing minimal Tapcheck aesthetic, prefer primitive components and composable layouts over bespoke one-off markup, and read `docs/ai-ui-ux.md` before making substantial visual changes.
Use `docs/system/testing-strategy.md` to decide the minimum expected test surface for a change.
When a behavior in that test surface changes, add or update the closest existing test instead of relying on manual verification alone.
Before closing substantial work, usually run `pnpm test`, `pnpm typecheck`, and `pnpm build`.

Use git worktrees for repo changes rather than working directly in the hub checkout. Create Tapcheck worktrees under `/Users/stew/Repos/.worktrees/tapcheck/`.
For each new worktree, replace the worktree-local `.env.local` with a symlink to the hub repo env file at `/Users/stew/Repos/tapcheck/.env.local` so local Clerk and Convex configuration stays shared across worktrees.

For non-trivial feature work, use `docs/workflow/feature-brief.md` before implementation and keep the brief short.
When working from GitHub issues, automatically create a lightweight brief for medium or large issues and skip briefs for trivial issues.
After meaningful milestones, run `docs/workflow/post-implementation-review.md` and `docs/system/screen-review-rubric.md` to capture improvements without reopening the whole feature.
Use `docs/system/app-dna.md`, `docs/system/product-principles.md`, `docs/system/ui-patterns.md`, and `docs/system/anti-patterns.md` as the lightweight product and UI consistency guardrails.
If a workflow repeats 3+ times, becomes a reusable multi-step pattern, or looks like a good automation candidate, suggest a skill per `docs/system/skill-creation.md` and ask for approval before creating it.
