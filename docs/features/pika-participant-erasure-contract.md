# Participant erasure: Bara provider handoff

This implements only Bara's provider slice of [the Pika classroom Pal and cleanup roadmap](https://github.com/codepetca/pika/blob/main/docs/guidance/classroom-pal-and-student-cleanup-plan.md).
It is an undeployed contract, not end-to-end student cleanup or Phase 3 completion.
The short [feature brief](briefs/pika-participant-erasure.md) records scope and acceptance.

## Signed request and receipt

POST `/api/integrations/pika/participant-erasure/v1` using the existing attendance
HMAC envelope: installation header, timestamp within five minutes, fresh nonce,
JSON content type, and signature over method, exact path, timestamp, nonce and body.
Use the existing Pika-to-Bara integration secret, never a Pal secret. No query
parameters, contact details, names, raw Pika UUIDs or extra body fields.

```json
{
  "schema_version": 1,
  "message_type": "participant.erase",
  "action": "begin",
  "installation_ref": "installation_opaque",
  "roster_ref": "roster_opaque",
  "participant_ref": "participant_opaque_generation",
  "operation_ref": "erase_participant_0123456789abcdef0123456789abcdef",
  "actor_principal_ref": "principal_opaque_owner"
}
```

References use the existing URL-safe opaque format (1–128 characters). The caller
must supply existing privacy-safe mappings, not relabel a raw identifier as opaque.
Operation references are immutable `erase_participant_` plus 32–64 lowercase hex
characters. The operation itself provides idempotency; it does not use attendance
success caches. A retry keeps all references and the authorizing actor unchanged,
uses a fresh nonce/signature, and sets action to `begin`, `tick`, or `status`.

New begin requires `PIKA_PARTICIPANT_ERASURE_MODE=enabled`; missing or other values
are disabled and write nothing. Begin verifies roster ownership through the
existing Pika identity, active app user, organization membership and tenant binding.
It atomically persists a fence and deactivates the participant. It does not delete
the roster, session or shared identity. Existing exact-operation retries and status
remain available even when this flag or the general attendance flag is disabled.
The original actor digest binds continuation; another actor or operation cannot
take over a receipt. Installation configuration and HMAC authentication still apply.

Each tick is one Convex transaction, scanning at most 25 primary rows (plus bounded
scope lookups); it never schedules another tick. The caller bounds its request loop,
backs off transient failures and resumes the same operation after interruptions.
Begin and status do not advance deletion. A lost tick response may cause another
bounded tick, never a second operation. Nonce reuse is rejected.

Successful transport returns an exact-scope receipt containing `schema_version`,
`ok`, `installation_ref`, `roster_ref`, `participant_ref`, `operation_ref`, `state`,
`absence_verified`, and `deleted_count`. State is `deleting`, `blocked`, or `deleted`.
Only `deleted` has `absence_verified=true`. Use `parseParticipantErasureReceipt`
against all four requested references; HTTP 200 alone does not mean completion.
Timeouts, generic 404/503, wrong scope, missing mappings, or blocked receipts never
release Pika's re-add restriction. Completed receipts remain stable.

## Resource inventory and absence scope

| Resource | Exact treatment |
| --- | --- |
| `participants`, `pika_integrated_participants` | Delete the exact participant's name/link detail and mapping; retain opaque fence bindings |
| `pika_check_ins` | Delete both accepted and invalidated facts for the exact generation; reject inconsistent participant/occurrence bindings |
| `attendance_records` | Delete rows for the participant ID after verifying their sessions belong to this roster |
| `attendance_events` | Delete participant events and actor-only student failure/detail copies in this roster; reject ambiguous mixed identity history |
| `pika_idempotency` | Delete validated target student result copies; preserve classmate results and aggregate roster/schedule/command results; block on unscopable historical result JSON |
| `pika_outbox` | Delete target accepted/invalidated payloads in pending, leased, delivered, failed and superseded states; preserve session/classmate payloads; malformed scope blocks completion |
| Session snapshots and display results | Computed from participants/facts, not stored snapshots; reconciliation filters fenced facts immediately |
| Recovery audits, nonces, aggregate caches | No participant/name snapshots in current writers; retain their existing opaque operational metadata and retention behavior |
| `app_users`, `auth_identities`, organizations, memberships, roster access | Shared principals and access structure survive; this is not account erasure |
| Rosters, sessions, occurrences, schedules, classmates, other installations | Preserve them, including the erased actor's membership in other rosters |
| Export downloads, browser copies, external delivery, provider backups | Outside the live database receipt; no invented physical-erasure or expiry claim |

Deletion traverses outbox, caches, facts, native records, historical events, then
participant roots. It repeats all phases in verification mode under the fence
before committing `deleted`. The historical event traversal is a bounded global
scan, and legacy cache/outbox attribution scans an installation. Total work depends
on retained history, not just this participant's row count; there is no latency SLA.

Unlinked/ambiguous subjects, historical subject rebinding, orphaned copies and
unexpected mixed snapshots remain blocked. The operation retains a sanitized
`blockedCode` for operator inspection, never the offending payload. Review and
repair only the exact attributed copy under separate authority, then retry the
same operation. Do not delete a whole-classroom backup to unblock one participant.
If a subject cannot be safely attributed, keep it blocked; no automatic override
or fence-clearing endpoint exists.

## Transactional fences and Pika activation dependencies

All supported participant writers read the permanent fence in their mutation:
signed snapshots/scans/invalidations, native marks/linking/scans, finalization,
outbox enqueue/claim/callback/recovery. These reads serialize with begin under
Convex transaction conflict handling. Replay checks precede cached student success.
Classmate and session work can continue. Native CSV import into a roster with an
erasure fence is rejected because it cannot express a Pika membership generation;
Pika remains its membership writer. No standalone roster behavior changes without
a persisted fence.

Whole-roster decommission cannot begin while this roster has a `deleting` or
`blocked` participant receipt: two bounded indexed reads return `operation_conflict`
before the roster fence is written. Conversely, the roster fence rejects new
participant begins. These transactional reads protect either concurrent commit
order. Disabling flags does not remove either fence. Finish or resolve the
participant operation first; a verified `deleted` receipt allows decommission
and remains retrievable after the roster is gone.

Current signed `student_check_in` gains an optional `participant_ref`, validated
against that actor's active membership before success replay. Legacy actor-only
scans remain supported for unaffected scopes. Once an actor has an erased generation
in this roster, both old cached scans and newly signed legacy scans fail closed,
including after re-add. Native actor-only self-scans also stay blocked there. The
same actor in another roster/installation is unaffected. Existing HTTP integration
errors remain generic non-success responses; they are not absence receipts.

Pika migrations 127/164 currently preserve `attendance_participant_mappings` refs
on removal. **Pika follow-up must allocate a fresh participant reference after
verified Pika cleanup and emit that reference on subsequent student scans.** Re-add
must never clear the old fence. Bara rejects old-ref snapshots permanently and
rejects new generations for a known subject until its current operation completes.
Pika must omit erased references from subsequent full roster snapshots, including
inactive entries; an old-ref snapshot is rejected as a unit without partial writes.
Deploy provider compatibility before switching Pika's emitter; no emitter change
or real cutover is part of this PR.

**Pika must fence incoming events, source writes, retries and restore before Bara
begin.** An action may have copied a claimed payload before begin and can transmit
those bytes afterward. Bara prevents its database/outbox resurrection and rejects
callbacks, but cannot retract an HTTP request already dispatched. Pika's ingest
fence is necessary end-to-end evidence, not something this receipt proves.

## Retention, restore and validation

The permanent table retains opaque installation/roster/participant/operation refs,
internal roster/participant IDs, a hashed subject binding, authorizer digest,
aggregate count and progress/timestamps. It stores no names, contact info, secrets
or raw Pika IDs. No TTL removes it; changing that policy requires an explicit
retention/restore design. Shared identity data remains by design.

Database rollback/backup restore must preserve or reapply all fences and resume
verification before serving reads/writes or dispatching events. A backup predating
the fence cannot safely resume ordinary service. There is no automatic backup
rewriter or approved backup expiry in this slice. Pika must disclose retained
external copies and keep affected cleanup pending until its approved strategy is
verified. A stable live-database receipt does not attest to physical backup erasure.

Synthetic `convex-test` tests cover exact scope, accepted/invalidated history,
all outbox statuses, cache replay, lost responses, bounded ticks, interruption,
wrong scope/actor/operation, disabled flags, blocked/mixed copies, verification
leftovers, HTTP generation handling and preserved classmates/accounts. Adversarial
tests cover malformed cache enums/facts, result/resource mismatch, peer/orphaned
outbox facts, wrong occurrence ownership and correlation. Native owner/token/export
reads exclude fenced rows and related audit details immediately after begin. The
overlap tests exercise both start orders, concurrent serialized starts, persisted
fences with flags disabled and decommission after verified participant completion.
The local harness serializes transactions; hosted OCC is not live-tested. Shared
attendance, auth, integration, outbox and decommission tests also run. No browser
UI or clipboard behavior changes; HTTP and mutation tests cover these boundaries.
The PR workflow runs the locked dependencies, tests, typecheck, lint and plain
Next build on the exact PR head with no secrets or deploy/codegen command.

Post-implementation review: the existing auth model remains intact; no UI screens
changed, so the screen rubric is not applicable. Reused the bounded provider
protocol without adding a generic workflow engine or scheduler. Release, schema
deployment, rollout, Pika adapter/coordinator, backups and complete Phase 3 exit
evidence require their own approvals and verification.

Merging to `main` currently triggers a Vercel Preview build whose `build:vercel`
command deploys Convex before building Next. Its preview key selects the Convex
preview identifier `main`. Merge approval must therefore also cover that automatic
hosted deployment and additive schema/index installation. It does not authorize
enabling participant erasure or running a live erase. The schema adds one empty
receipt table with six indexes, one participant index on `attendance_records`,
and two participant indexes on `pika_check_ins`; no existing field, default or
backfill changes.
