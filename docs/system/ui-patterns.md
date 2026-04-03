# UI Patterns

## List / Detail

- Use for rosters, sessions, and similar browse-then-act flows.
- Keep the list scannable and make the detail view hold the primary action.

## Primary Action Placement

- Put the main action near the top on desktop and easy to reach on mobile.
- Do not hide the primary action inside menus when it is part of the normal flow.

## Empty States

- Explain what is missing in one sentence.
- Offer one obvious next step.

## Loading States

- Mirror the final layout with simple skeletons or reserved space.
- Avoid spinner-only screens unless the wait is truly brief.

## Inspector Panels

- Use when quick context supports a task without leaving the current screen.
- Keep the panel focused on supporting information, not a second workflow.

## Modals Vs Inline

- Use inline for short edits that benefit from page context.
- Use modals for confirmation, destructive actions, or tightly scoped forms.
- Avoid stacking modals or moving core workflows into modal chains.

## Teacher / Staff Workflows

- Optimize for quick repeat actions, especially attendance marking and roster setup.
- Keep admin-style metadata secondary to the teaching task in front of the user.
