# AI UI / UX Guidance

Guidance for keeping Tapcheck visually consistent as the UI grows.

This should preserve the current product feel: quiet, mobile-first, rounded, and lightweight. The goal is not novelty. The goal is confident restraint.

## Visual Direction

- Keep the UI minimal, soft, and calm.
- Prefer light surfaces, subtle borders, and low-contrast depth over heavy shadows or loud gradients.
- Use the existing palette family:
  - slate for primary text and controls
  - white and near-white surfaces
  - emerald for positive or active states
  - rose for destructive or error states
- Favor generous rounding and compact copy over decorative flourishes.
- Avoid dashboard clutter. Most screens should feel like one primary surface with one or two secondary sections.

## Core Aesthetic Cues

- Rounded containers are a core part of the visual language.
  - page-level cards generally use `rounded-[28px]`
  - nested interactive rows often use `rounded-[24px]`
  - buttons use rounded-full
- Surfaces should usually look like:
  - `border border-white/70`
  - `bg-white/90`
  - light ring or very subtle shadow
- Typography should remain clean and restrained:
  - `Geist` for body
  - `Sora` for headings
  - short headings with tight tracking
  - muted supporting copy in slate tones

## Layout Rules

- Build around the existing page shells instead of inventing new page scaffolds.
- Prefer a narrow, centered layout:
  - `max-w-3xl` for app pages
  - `max-w-md` for auth pages
- Keep section spacing moderate. Current UI works because it breathes without feeling sparse.
- Mobile-first is the default. Controls should still work comfortably on phones before expanding for desktop.
- Important actions should be obvious and easy to tap, often as full-width controls on mobile.

## Primitive Components First

Prefer composing from the existing primitives before writing bespoke Tailwind blocks.

Current primitives and shells:
- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/dialog.tsx`
- `components/confirm-dialog.tsx`
- `components/page-shell.tsx`
- `components/auth-shell.tsx`

Rules:
- If a new visual pattern is just a button, card, or page-section variant, extend the primitive instead of restyling from scratch in a page.
- If a pattern appears in more than one place, promote it into a composable component instead of duplicating class strings.
- Keep logic outside presentation components where possible. Pages should compose shells, sections, and behavior hooks rather than holding every UI concern inline.

## Composable UI Patterns

- Compose pages from a small number of clear sections:
  - shell
  - primary action block
  - content list or detail card
  - confirmation / modal flows
- Prefer a stack of simple sections over deeply nested cards inside cards.
- Lists should read as calm, tappable surfaces, not data-grid chrome.
- Status should be communicated with small badges, tint shifts, and concise labels rather than large alert banners unless the message is truly blocking.

## Interaction Style

- Interaction feedback should be subtle and immediate.
- Hover states should slightly deepen contrast, not dramatically transform the element.
- Loading states should use simple skeleton blocks that match the final layout.
- Empty and error states should use the same card language as the rest of the app.
- Destructive actions should be clearly separated and confirmed, but still fit the same visual system.

## Form Guidance

- Keep forms quiet and readable.
- Use a single strong primary action.
- Supporting instructions should be brief and close to the relevant control.
- Avoid dense control clusters when a vertical stack is clearer.
- Auth forms should stay minimal and use the custom auth shell around Clerk components.

## What To Avoid

- Do not introduce a second visual language for a single feature.
- Do not add component-library-style ornamentation or glossy marketing UI.
- Do not overuse bright accent colors, gradients, or heavy drop shadows.
- Do not switch between inconsistent radii, padding scales, or button shapes.
- Do not create bespoke layout wrappers when `PageShell`, `AuthShell`, `Card`, or `Button` can carry the pattern.
- Do not import ideas from other repos that conflict with Tapcheck’s lighter, simpler feel.

## When To Create A New Primitive

Create or extend a primitive when:
- the same styling pattern appears in at least two places
- a page starts carrying repeated structural Tailwind strings
- a new interaction pattern needs consistent variants

Do not create a primitive just because a component is large. Create one when it improves reuse and keeps the visual system coherent.

## UI Verification

- After meaningful UI changes, inspect the actual rendered result before considering the work done.
- Prefer browser-based verification over reasoning from JSX alone.
- Check both:
  - mobile-scale behavior
  - desktop spacing and hierarchy
- If a UI change feels visually louder or denser than the surrounding screens, it is probably off-pattern and should be simplified.
