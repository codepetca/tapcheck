# Pika participant erasure provider

Bara-owned Phase 3 slice of the single [Pika roadmap](https://github.com/codepetca/pika/blob/main/docs/guidance/classroom-pal-and-student-cleanup-plan.md). Implementation only; deployment, Pika adapter/coordinator, rollout and complete Phase 3 evidence are separate gates.

Goal: erase exactly one installation/roster/participant generation while preserving its classroom, classmates, other installations and shared app_users/auth_identities. No UI changes.

Flow: signed participant.erase v1 begin commits a permanent fence; explicit bounded ticks resume the same operation; status returns an exact-scope receipt. Missing resources, timeouts and blocked verification are never completion. The new flag defaults off; an existing fence and its operation remain usable after disabling it.

Graph: participant names/link detail and integration mapping; accepted and invalidated pika_check_ins; native attendance_records; attendance_events including student actor-only failure/detail copies in the roster; student response caches; participant-bearing outbox payloads in every status. Session snapshots are computed from check-ins, not stored. Roster/schedule command caches hold only aggregate counts/digests. Recovery audits hold opaque operation refs and counts. Shared identities, memberships, sessions, rosters, occurrence mappings and classmates survive. Unknown/unattributable retained payloads block verified completion; no mixed classroom backup is deleted.

Architecture: separate receipt/fence table, additive indexes, shared transactional fence helpers, existing HMAC/timestamp/nonce authentication and owner/tenant checks. No cron, dependencies or hosted code generation. Test synthetic convex-test fixtures and HTTP/contract boundaries, including bounded resumption, all payload states and shared writer paths.

Risks: stale success caches, native actor-only scans, mixed snapshots, in-flight delivery, restore and re-add. Once a participant generation is erased it is never unfenced. Pika currently retains participant refs on removal (127/164); follow-up must allocate a fresh ref after verified cleanup and send explicit generation on subsequent scans. Previously dispatched network bytes cannot be recalled: Pika must fence ingest before provider begin. Provider receipts attest to the live Bara database, not Pika, exported files or historical backups. No backup expiry policy is invented; restore must preserve/reapply fences and rerun scoped verification before service resumes.

Acceptance: required local tests/typecheck/build/lint; high-risk independent security/concurrency and compatibility reviews; fixed-head PR checks; request merge approval. No hosted calls, data tests, deploy or rollout as part of validation.
