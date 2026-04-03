# Issue 11 Missing Test Checklist

High-value follow-up gaps after the testing strategy pass:

- [ ] Add page-level coverage for `app/rosters/import/page.tsx` so the shell and Suspense fallback stay stable.
- [ ] Add page-level coverage for `/s/edit/[token]` to keep the token handoff contract explicit.
- [ ] Add dashboard coverage for the bootstrap error state in `app/page.tsx`.
- [ ] Add roster detail coverage for rename and delete flows if those UI paths change again.
- [ ] Add collection-screen coverage for sort controls if the screen layout or column behavior changes.
- [ ] Add route-boundary coverage if new protected or public paths are introduced beyond `/`, `/rosters(.*)`, and `/s/edit/[token]`.
