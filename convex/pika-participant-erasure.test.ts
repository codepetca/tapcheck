// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./api";
import schema from "./schema";
import { PARTICIPANT_ERASURE_PATH, parseParticipantErasureReceipt, parseParticipantErasureRequest, type ParticipantErasureRequest } from "../lib/attendance-contract/participant-erasure";
import { createV1RequestSignature } from "../lib/attendance-contract/v1/signing";
import { validateV1Message } from "../lib/attendance-contract/v1/validate";
import { studentCheckInAttendance, closeAttendanceSession } from "./attendanceEngine";
import { applyParticipantLink } from "./participantLinks";
import { queueAttendanceEvent } from "./pikaIntegrationEvents";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const makeTest = () => convexTest(schema, modules);
type Test = ReturnType<typeof makeTest>;
const secret = "synthetic-only-participant-erasure-secret-123456";
const request: ParticipantErasureRequest = {
  schema_version: 1, message_type: "participant.erase", action: "begin",
  installation_ref: "installation_one", roster_ref: "roster_one", participant_ref: "participant_one",
  operation_ref: "erase_participant_0123456789abcdef0123456789abcdef", actor_principal_ref: "principal_owner",
};
const nonce = () => `nonce_${crypto.randomUUID().replaceAll("-", "")}`;
function roster(rosterRef = request.roster_ref, installationRef = request.installation_ref) {
  return { schema_version: 1 as const, message_type: "roster.snapshot" as const,
    idempotency_key: `roster:${rosterRef}`, correlation_ref: "correlation_one", installation_ref: installationRef,
    roster_ref: rosterRef, tenant_ref: "tenant_one", revision: 1, owner_principal_ref: request.actor_principal_ref,
    owner_display_name: "Synthetic teacher", display_name: "Synthetic classroom",
    participants: [
      { participant_ref: "participant_one", display_name: "Synthetic target", active: true, principal_ref: "principal_student" },
      { participant_ref: "participant_peer", display_name: "Synthetic peer", active: true, principal_ref: "principal_peer" },
    ],
  };
}
async function snapshot(t: Test, payload = roster(), bodyDigest = JSON.stringify(payload)) {
  return t.mutation(internal.pikaIntegration.applyRosterSnapshot, { payload, bodyDigest, nonce: nonce(), requestTimestamp: Date.now() / 1000 });
}
async function advance(t: Test, changes: Partial<ParticipantErasureRequest> = {}) {
  return t.mutation(internal.pikaParticipantErasure.advance, { payload: { ...request, ...changes }, nonce: nonce(), requestTimestamp: Date.now() / 1000 });
}
async function finish(t: Test) {
  for (let i = 0; i < 200; i++) {
    const result = await advance(t, { action: "tick" });
    expect(result.ok).toBe(true);
    if (result.ok && result.state !== "deleting") return result;
  }
  throw new Error("Synthetic erasure exceeded bounded tick budget");
}
async function send(t: Test, payload: unknown = request, options: { nonce?: string; secret?: string; timestamp?: string } = {}) {
  const body = JSON.stringify(payload), timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000)), n = options.nonce ?? nonce();
  const signature = await createV1RequestSignature({ secret: options.secret ?? secret, method: "POST", path: PARTICIPANT_ERASURE_PATH, timestamp, nonce: n, body });
  return t.fetch(PARTICIPANT_ERASURE_PATH, { method: "POST", body, headers: {
    "Content-Type": "application/json", "X-Attendance-Installation-Ref": request.installation_ref,
    "X-Attendance-Timestamp": timestamp, "X-Attendance-Nonce": n, "X-Attendance-Signature": signature,
  } });
}
async function seed(t: Test) {
  expect((await snapshot(t)).ok).toBe(true);
  expect((await snapshot(t, roster("roster_other"))).ok).toBe(true);
  expect((await snapshot(t, roster("roster_one", "installation_other"))).ok).toBe(true);
  return t.run(async ctx => {
    const mapping = (await ctx.db.query("pika_integrated_rosters").withIndex("by_installationRef_and_rosterRef", q =>
      q.eq("installationRef", request.installation_ref).eq("rosterRef", request.roster_ref)).unique())!;
    const participants = await ctx.db.query("participants").withIndex("by_rosterId_sortKey", q => q.eq("rosterId", mapping.rosterId)).collect();
    const target = participants.find(p => p.displayName === "Synthetic target")!, peer = participants.find(p => p.displayName === "Synthetic peer")!;
    const now = Date.now();
    const sessionId = await ctx.db.insert("sessions", { rosterId: mapping.rosterId, title: "Synthetic session", date: "2026-09-12",
      sessionType: "recurring_class", participantMode: "verified", status: "open", createdByAppUserId: mapping.ownerAppUserId,
      checkInToken: "synthetic_history_token_123456789", createdAt: now, updatedAt: now });
    const occurrenceId = await ctx.db.insert("attendance_occurrences", { rosterId: mapping.rosterId, title: "Synthetic occurrence", date: "2026-09-12",
      opensAt: now - 60_000, closesAt: now + 3600_000, status: "open", sessionId, sessionRevision: 2,
      createdByAppUserId: mapping.ownerAppUserId, createdAt: now, updatedAt: now });
    await ctx.db.insert("pika_integrated_occurrences", { installationRef: request.installation_ref, rosterRef: request.roster_ref,
      occurrenceRef: "occurrence_one", occurrenceId, sourceRevision: 1, createdAt: now, updatedAt: now });
    for (const participant of [target, peer]) {
      await ctx.db.insert("attendance_records", { sessionId, participantId: participant._id, linkedAppUserId: participant.linkedAppUserId, status: "unmarked", modifiedAt: now });
      await ctx.db.insert("attendance_events", { sessionId, participantId: participant._id, actorAppUserId: participant.linkedAppUserId,
        actorType: "student", eventType: "student_check_in", result: "applied", createdAt: now });
    }
    await ctx.db.insert("attendance_events", { sessionId, actorAppUserId: target.linkedAppUserId,
      actorType: "student", eventType: "student_check_in", result: "blocked", metadata: { schoolEmail: "synthetic@example.invalid" }, createdAt: now });
    return { mapping, target, peer, sessionId, occurrenceId };
  });
}
function scan(participantRef?: string) {
  return { schema_version: 1 as const, message_type: "student_check_in" as const, installation_ref: request.installation_ref,
    roster_ref: request.roster_ref, occurrence_ref: "occurrence_one", idempotency_key: "scan_one", correlation_ref: "scan_correlation",
    check_in_token: "synthetic_history_token_123456789", actor_principal_ref: "principal_student", actor_display_name: "Synthetic target",
    ...(participantRef ? { participant_ref: participantRef } : {}) };
}
async function checkIn(t: Test, payload = scan()) {
  return t.mutation(internal.pikaIntegration.applyStudentCheckIn, { payload, bodyDigest: JSON.stringify(payload), nonce: nonce(), requestTimestamp: Date.now() / 1000 });
}
beforeEach(() => {
  vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "true"); vi.stubEnv("PIKA_INTEGRATION_REF", request.installation_ref);
  vi.stubEnv("PIKA_INTEGRATION_SECRET", secret); vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", "enabled");
});
afterEach(() => vi.unstubAllEnvs());

describe("participant erasure contract and authentication", () => {
  it("strictly binds receipts to all four scope references and verified state", () => {
    expect(parseParticipantErasureRequest(request)).toEqual(request);
    expect(parseParticipantErasureRequest({ ...request, email: "synthetic@example.invalid" })).toBeNull();
    expect(parseParticipantErasureRequest({ ...request, operation_ref: "raw-operation" })).toBeNull();
    const receipt = { schema_version: 1, ok: true, installation_ref: request.installation_ref, roster_ref: request.roster_ref,
      participant_ref: request.participant_ref, operation_ref: request.operation_ref, state: "deleted", absence_verified: true, deleted_count: 2 };
    expect(parseParticipantErasureReceipt(receipt, request)).toEqual(receipt);
    for (const field of ["installation_ref", "roster_ref", "participant_ref", "operation_ref"] as const) {
      expect(parseParticipantErasureReceipt({ ...receipt, [field]: "wrong" }, request)).toBeNull();
    }
    expect(parseParticipantErasureReceipt({ ...receipt, absence_verified: false }, request)).toBeNull();
    expect(parseParticipantErasureReceipt({ ...receipt, state: "blocked" }, request)).toBeNull();
    expect(parseParticipantErasureReceipt({ ok: false, code: "not_found" }, request)).toBeNull();
  });
  it("defaults disabled and validates signatures, owner, nonce, tenant and operation conflicts", async () => {
    const t = makeTest(); await seed(t);
    vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", "");
    expect((await send(t)).status).toBe(503);
    expect(await t.run(ctx => ctx.db.query("pika_participant_erasures").collect())).toEqual([]);
    vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", "enabled");
    expect((await send(t, request, { secret: "synthetic-wrong-signing-secret-123456789" })).status).toBe(401);
    expect((await send(t, request, { timestamp: "1000000000" })).status).toBe(401);
    expect((await send(t, { ...request, actor_principal_ref: "principal_student" })).status).toBe(403);
    expect((await send(t, { ...request, installation_ref: "installation_other" })).status).toBe(422);
    expect((await send(t, { ...request, participant_ref: "missing" })).status).toBe(404);
    const n = nonce(); expect((await send(t, request, { nonce: n })).status).toBe(200);
    expect((await send(t, request, { nonce: n })).status).toBe(409);
    expect((await send(t, { ...request, operation_ref: "erase_participant_ffffffffffffffffffffffffffffffff" })).status).toBe(409);
    expect((await send(t, { ...request, participant_ref: "participant_peer" })).status).toBe(409);
    expect((await send(t, { ...request, roster_ref: "roster_other" })).status).toBe(409);
  });
});

describe("exact participant graph and permanent fences", () => {
  it("resumes lost responses and erases accepted/invalidated facts, every outbox state, caches and actor/detail events; preserves classmates and shared accounts", async () => {
    const t = makeTest(), fixture = await seed(t);
    expect((await checkIn(t)).ok).toBe(true);
    expect((await checkIn(t, { ...scan(), actor_principal_ref: "principal_peer", actor_display_name: "Synthetic peer", idempotency_key: "preserved-peer" })).ok).toBe(true);
    const facts = await t.run(ctx => ctx.db.query("pika_check_ins").collect());
    await t.run(async ctx => {
      await ctx.db.patch(facts[0]!._id, { invalidatedAt: Date.now() });
      // Force more than one page in both owned-data and installation scans.
      for (let i = 0; i < 61; i++) {
        await ctx.db.insert("pika_check_ins", { installationRef: request.installation_ref, rosterRef: request.roster_ref,
          occurrenceRef: "occurrence_one", occurrenceId: fixture.occurrenceId, participantRef: request.participant_ref, participantId: fixture.target._id,
          checkInRef: `check_in_history_${i}`, checkInRevision: 1, acceptedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
          ...(i % 2 ? { invalidatedAt: Date.now() } : {}) });
      }
      const original = (await ctx.db.query("pika_outbox").first())!;
      for (const status of ["pending", "delivered", "failed", "superseded"] as const) {
        const event = JSON.parse(original.payloadJson); event.event_id = `event_${status}`;
        await ctx.db.insert("pika_outbox", { installationRef: request.installation_ref, eventId: event.event_id, eventType: original.eventType,
          correlationRef: original.correlationRef, payloadJson: JSON.stringify(event), status, attemptCount: 1, nextAttemptAt: 0,
          leaseToken: "old_lease", leaseUntil: Date.now() + 60_000, createdAt: Date.now(), updatedAt: Date.now() });
        const invalidated = { ...event, event_id: `event_invalidated_${status}`, event_type: "attendance.check_in.invalidated",
          metadata: { ...event.metadata, invalidated_at: new Date().toISOString(), reason_code: "synthetic_correction" } };
        await ctx.db.insert("pika_outbox", { installationRef: request.installation_ref, eventId: invalidated.event_id,
          eventType: "attendance.check_in.invalidated", correlationRef: original.correlationRef, payloadJson: JSON.stringify(invalidated),
          status, attemptCount: 1, nextAttemptAt: 0, createdAt: Date.now(), updatedAt: Date.now() });
      }
    });
    const preserved = await t.run(async ctx => ({ users: await ctx.db.query("app_users").collect(), identities: await ctx.db.query("auth_identities").collect(),
      memberships: await ctx.db.query("organization_memberships").collect(), rosters: await ctx.db.query("rosters").collect(),
      sessions: await ctx.db.query("sessions").collect(), others: (await ctx.db.query("participants").collect()).filter(p => p._id !== fixture.target._id) }));
    const begin = await advance(t); expect(begin).toMatchObject({ state: "deleting", absence_verified: false });
    expect(await advance(t)).toEqual(begin); // Lost begin response.
    vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", "disabled");
    expect(await checkIn(t)).toMatchObject({ ok: false });
    expect((await snapshot(t)).ok).toBe(false); // Old cached snapshot.
    const partial = await advance(t, { action: "tick" }); expect(partial).toMatchObject({ state: "deleting" });
    expect(await advance(t, { action: "status" })).toEqual(partial);
    const receipt = await finish(t); expect(receipt).toMatchObject({ state: "deleted", absence_verified: true });
    expect(parseParticipantErasureReceipt(receipt, request)).toEqual(receipt);
    expect(await advance(t)).toEqual(receipt); expect(await advance(t, { action: "tick" })).toEqual(receipt);
    expect(await t.run(async ctx => ({ users: await ctx.db.query("app_users").collect(), identities: await ctx.db.query("auth_identities").collect(),
      memberships: await ctx.db.query("organization_memberships").collect(), rosters: await ctx.db.query("rosters").collect(),
      sessions: await ctx.db.query("sessions").collect(), others: await ctx.db.query("participants").collect() }))).toEqual(preserved);
    const remaining = await t.run(async ctx => ({ facts: await ctx.db.query("pika_check_ins").collect(), outbox: await ctx.db.query("pika_outbox").collect(),
      records: await ctx.db.query("attendance_records").collect(), events: await ctx.db.query("attendance_events").collect(), caches: await ctx.db.query("pika_idempotency").collect() }));
    expect(remaining.facts.map(f => f.participantRef)).toEqual(["participant_peer"]);
    expect(remaining.outbox.map(row => JSON.parse(row.payloadJson).metadata.participant_ref)).toEqual(["participant_peer"]);
    expect(remaining.records.map(r => r.participantId)).toEqual([fixture.peer._id]);
    expect(remaining.events.map(r => r.participantId)).toEqual([fixture.peer._id]);
    expect(remaining.caches.some(c => c.resultJson?.includes(request.participant_ref))).toBe(false);
    expect(remaining.caches.some(c => c.resultJson?.includes("participant_peer"))).toBe(true);
    expect(await t.mutation(internal.pikaOutboxModel.complete, { eventId: "event_pending", leaseToken: "old_lease", now: Date.now() })).toBe(false);
    expect(await t.mutation(internal.pikaOutboxModel.retry, { eventId: "event_pending", leaseToken: "old_lease", now: Date.now(), nextAttemptAt: 0, errorCode: "network_error" })).toBe(false);
  });

  it("blocks old and freshly signed legacy scans after a new generation while preserving unaffected actors and scopes", async () => {
    const t = makeTest(); await seed(t); await checkIn(t); await advance(t);
    expect(await finish(t)).toMatchObject({ state: "deleted" });
    const fresh = roster(); fresh.revision = 2; fresh.idempotency_key = "roster:fresh"; fresh.participants[0]!.participant_ref = "participant_fresh";
    expect((await snapshot(t, fresh)).ok).toBe(true);
    expect((await checkIn(t)).ok).toBe(false);
    expect((await checkIn(t, { ...scan(), idempotency_key: "new-legacy-scan" })).ok).toBe(false);
    expect((await checkIn(t, { ...scan("participant_one"), idempotency_key: "old-generation-scan" })).ok).toBe(false);
    expect(await checkIn(t, { ...scan("participant_fresh"), idempotency_key: "new-generation-scan" })).toMatchObject({ ok: true, result_code: "check_in_accepted", check_in: { participant_ref: "participant_fresh" } });
    expect(await checkIn(t, { ...scan(), actor_principal_ref: "principal_peer", actor_display_name: "Synthetic peer", idempotency_key: "peer-scan" })).toMatchObject({ ok: true, result_code: "check_in_accepted" });
    expect((await snapshot(t, roster("roster_other"))).ok).toBe(true);
    expect((await snapshot(t, roster("roster_one", "installation_other"))).ok).toBe(true);
    expect((await snapshot(t, { ...roster(), revision: 3, idempotency_key: "old-snapshot-new-key" })).ok).toBe(false);
    expect(validateV1Message(scan("participant_fresh")).ok).toBe(true);
    expect(validateV1Message({ ...scan(), participant_ref: "email@example.invalid" }).ok).toBe(false);
  });

  it("fences native scans, links, manual marks, scheduled finalization, queued events and snapshots transactionally", async () => {
    const t = makeTest(), f = await seed(t); await checkIn(t); await advance(t);
    await expect(t.mutation(api.attendance.markManualByToken, { token: "synthetic_history_token_123456789", participantId: f.target._id, nextStatus: "present" })).rejects.toThrow("permanent deletion");
    await expect(t.run(async ctx => studentCheckInAttendance(ctx, { session: (await ctx.db.get(f.sessionId))!, actor: { actorType: "student", source: "standalone_authkit", appUserId: f.target.linkedAppUserId! } }))).rejects.toThrow("generation-aware");
    await expect(t.run(ctx => applyParticipantLink(ctx, f.target, { linkStatus: "unlinked" }))).rejects.toThrow("permanent deletion");
    await expect(t.run(ctx => queueAttendanceEvent(ctx, { installationRef: request.installation_ref, rosterRef: request.roster_ref, occurrenceRef: "occurrence_one",
      correlationRef: "test", eventType: "attendance.check_in.accepted", sessionRevision: 2, metadata: { participant_ref: request.participant_ref }, nonce: nonce(), eventIndex: 0, now: Date.now() }))).rejects.toThrow("permanently deleted");
    const snapshotResult = await t.query(internal.pikaIntegration.getSessionSnapshot, { installationRef: request.installation_ref, occurrenceRef: "occurrence_one" });
    expect(snapshotResult?.check_ins).toEqual([]);
    expect(await t.mutation(internal.pikaOutboxModel.claim, { now: Date.now() + 60_001, limit: 10 })).toEqual([]);
    await t.run(async ctx => closeAttendanceSession(ctx, { session: (await ctx.db.get(f.sessionId))!, actor: { actorType: "system", source: "schedule", appUserId: f.mapping.ownerAppUserId } }));
    expect(await t.run(async ctx => (await ctx.db.query("attendance_records").withIndex("by_participantId", q => q.eq("participantId", f.target._id)).first())?.status)).toBe("unmarked");
    expect(await t.run(async ctx => (await ctx.db.query("attendance_records").withIndex("by_participantId", q => q.eq("participantId", f.peer._id)).first())?.status)).toBe("absent");
  });

  it("reports blocked for an unscopable retained payload and resumes the same operation after exact repair", async () => {
    const t = makeTest(); await seed(t);
    const id = await t.run(ctx => ctx.db.insert("pika_outbox", { installationRef: request.installation_ref, eventId: "malformed", eventType: "attendance.check_in.accepted",
      correlationRef: "test", payloadJson: "{bad", status: "failed", attemptCount: 1, nextAttemptAt: 0, createdAt: Date.now(), updatedAt: Date.now() }));
    await advance(t);
    expect(await finish(t)).toMatchObject({ state: "blocked", absence_verified: false });
    expect(await t.run(ctx => ctx.db.get(id))).not.toBeNull();
    expect(await advance(t, { action: "status" })).toMatchObject({ state: "blocked" });
    await t.run(ctx => ctx.db.delete(id)); // Synthetic operator repair, not a live workflow.
    expect(await finish(t)).toMatchObject({ state: "deleted", absence_verified: true });
  });
});

describe("failure, replay and compatibility boundaries", () => {
  async function signedScan(t: Test, payload = scan()) {
    const path = "/api/integrations/pika/v1/sessions/occurrence_one/student-check-ins";
    const body = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000)), n = nonce();
    const signature = await createV1RequestSignature({ secret, method: "POST", path, timestamp, nonce: n, body });
    return t.fetch(path, { method: "POST", body, headers: { "Content-Type": "application/json",
      "X-Attendance-Installation-Ref": request.installation_ref, "X-Attendance-Timestamp": timestamp,
      "X-Attendance-Nonce": n, "X-Attendance-Signature": signature } });
  }
  it("enforces generation fences at the real signed HTTP boundary after re-add", async () => {
    const t = makeTest(); await seed(t);
    expect((await signedScan(t)).status).toBe(200);
    await advance(t); await finish(t);
    const fresh = roster(); fresh.revision = 2; fresh.idempotency_key = "fresh-http"; fresh.participants[0]!.participant_ref = "participant_fresh";
    await snapshot(t, fresh);
    expect((await signedScan(t)).status).toBe(503);
    expect((await signedScan(t, { ...scan(), idempotency_key: "fresh-legacy-http" })).status).toBe(503);
    expect((await signedScan(t, { ...scan("participant_fresh"), idempotency_key: "fresh-scoped-http" })).status).toBe(200);
  });
  it("commits no state at all on disabled begin, but keeps exact-operation status/ticks available when both flags turn off", async () => {
    const t = makeTest(); await seed(t);
    const before = await t.run(ctx => ctx.db.query("pika_request_nonces").collect());
    vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", "");
    expect(await advance(t)).toEqual({ ok: false, code: "disabled" });
    expect(await t.run(ctx => ctx.db.query("pika_request_nonces").collect())).toEqual(before);
    vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", "enabled"); await advance(t);
    vi.stubEnv("PIKA_PARTICIPANT_ERASURE_MODE", ""); vi.stubEnv("PIKA_ATTENDANCE_INTEGRATION", "false");
    expect((await send(t, { ...request, action: "status" })).status).toBe(200);
    expect(await finish(t)).toMatchObject({ state: "deleted" });
    expect((await send(t, { ...request, action: "tick" })).status).toBe(200);
  });
  it("does not replay or requeue an in-flight participant event after begin", async () => {
    const t = makeTest(); await seed(t); await checkIn(t);
    const claimed = await t.mutation(internal.pikaOutboxModel.claim, { now: Date.now(), limit: 10 });
    expect(claimed).toHaveLength(1); await advance(t);
    const row = claimed[0]!;
    expect(await t.mutation(internal.pikaOutboxModel.complete, { eventId: row.eventId, leaseToken: row.leaseToken, now: Date.now() })).toBe(false);
    expect(await t.run(async ctx => (await ctx.db.query("pika_outbox").first())?.status)).toBe("superseded");
    await t.run(async ctx => { const event = (await ctx.db.query("pika_outbox").first())!;
      await ctx.db.patch(event._id, { status: "failed", lastErrorCode: "http_401" }); });
    const recovered = await t.mutation(internal.pikaOutboxRecovery.recoverFailedEvents, {
      installationRef: request.installation_ref, requestId: "recovery_erased", operatorRef: "synthetic_operator",
      reasonCode: "synthetic_retry", limit: 10, maxDeliveryAttempts: 20,
      maxRecoveryAttempts: 3, cursor: null,
    });
    expect(recovered).toMatchObject({ requeued: 0, superseded: 1 });
  });
  it("retains a mixed display-name snapshot and reports blocked instead of deleting classmates' copies", async () => {
    const t = makeTest(); await seed(t);
    const id = await t.run(ctx => ctx.db.insert("pika_idempotency", { installationRef: request.installation_ref,
      idempotencyKey: "legacy-mixed", correlationRef: "legacy", messageType: "roster.snapshot", bodyDigest: "opaque",
      resourceRef: request.roster_ref, sourceRevision: 1, createdCount: 2, updatedCount: 0, deactivatedCount: 0,
      resultJson: JSON.stringify({ participants: roster().participants }), createdAt: Date.now() }));
    await advance(t); expect(await finish(t)).toMatchObject({ state: "blocked", absence_verified: false });
    expect((await t.run(ctx => ctx.db.get(id)))?.resultJson).toContain("Synthetic peer");
  });
  it("detects a leftover introduced before the second verification pass and never issues a deleted receipt", async () => {
    const t = makeTest(), f = await seed(t); await advance(t);
    for (let i = 0; i < 100; i++) {
      const op = await t.run(ctx => ctx.db.query("pika_participant_erasures").first());
      if (op?.verifying) break;
      await advance(t, { action: "tick" });
    }
    await t.run(ctx => ctx.db.insert("attendance_records", { sessionId: f.sessionId, participantId: f.target._id, status: "present", modifiedAt: Date.now() }));
    expect(await finish(t)).toMatchObject({ state: "blocked", absence_verified: false });
  });
  it("bounds each deletion tick and retries without creating a second operation", async () => {
    const t = makeTest(), f = await seed(t);
    await t.run(async ctx => { for (let i = 0; i < 76; i++) await ctx.db.insert("attendance_records", {
      sessionId: f.sessionId, participantId: f.target._id, status: "present", modifiedAt: Date.now() }); });
    await Promise.all([advance(t), advance(t)]);
    expect(await t.run(ctx => ctx.db.query("pika_participant_erasures").collect())).toHaveLength(1);
    let previous = 0, ticks = 0;
    for (; ticks < 100; ticks++) {
      const r = await advance(t, { action: "tick" }); expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("unexpected failure");
      expect(r.deleted_count - previous).toBeLessThanOrEqual(25); previous = r.deleted_count;
      if (r.state === "deleted") break;
    }
    expect(ticks).toBeGreaterThan(12); expect(ticks).toBeLessThan(100);
  });
  it("blocks ambiguous or unlinked subject scope without erasing mixed history", async () => {
    const t = makeTest(), f = await seed(t);
    await t.run(ctx => ctx.db.patch(f.peer._id, { linkedAppUserId: f.target.linkedAppUserId }));
    expect(await advance(t)).toMatchObject({ state: "blocked", absence_verified: false });
    expect(await finish(t)).toMatchObject({ state: "blocked" });
    expect(await t.run(ctx => ctx.db.get(f.peer._id))).not.toBeNull();
  });
  it("rejects cross-actor generation selection and premature re-add; preserves peer scans", async () => {
    const t = makeTest(); await seed(t); await advance(t);
    const fresh = roster(); fresh.revision = 2; fresh.idempotency_key = "too-early"; fresh.participants[0]!.participant_ref = "participant_fresh";
    expect((await snapshot(t, fresh)).ok).toBe(false);
    expect((await checkIn(t, scan("participant_peer"))).ok).toBe(false);
    expect(await checkIn(t, { ...scan(), actor_principal_ref: "principal_peer", actor_display_name: "Synthetic peer", idempotency_key: "peer-while-erasing" })).toMatchObject({ ok: true, result_code: "check_in_accepted" });
  });

  it("hides fenced rows and audit details from owner, shared-token and export reads immediately", async () => {
    const t = makeTest(), f = await seed(t);
    vi.stubEnv("WORKOS_CLIENT_ID", "client_synthetic_erasure");
    const identity = await t.run(async ctx => (await ctx.db.query("auth_identities")
      .withIndex("by_appUserId", q => q.eq("appUserId", f.mapping.ownerAppUserId)).first())!);
    const owner = t.withIdentity({ subject: identity.providerSubject, tokenIdentifier: identity.tokenIdentifier, client_id: "client_synthetic_erasure" });
    await t.run(ctx => ctx.db.insert("attendance_events", { sessionId: f.sessionId, participantId: f.target._id,
      actorType: "student", eventType: "student_check_in", result: "review_needed", createdAt: Date.now() }));
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: f.sessionId }))?.rows).toHaveLength(2);
    await advance(t);
    const staffRows = await owner.query(api.attendance.getLiveSessionRows, { sessionId: f.sessionId });
    const sharedRows = await t.query(api.attendance.getLiveSessionRowsByToken, { token: "synthetic_history_token_123456789" });
    for (const result of [staffRows, sharedRows]) {
      expect(result?.rows.map(row => row.participantId)).toEqual([f.peer._id]);
      expect(result?.counts.total).toBe(1);
      expect(result?.unresolvedEvents).toEqual([]);
    }
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: f.sessionId }))?.rows.map(row => row.displayName)).toEqual(["Synthetic peer"]);
    expect((await owner.query(api.rosters.getById, { rosterId: f.mapping.rosterId }))?.students.map(p => p._id)).toEqual([f.peer._id]);
    await finish(t);
    const fresh = roster(); fresh.revision = 2; fresh.idempotency_key = "read-fresh"; fresh.participants[0]!.participant_ref = "participant_fresh";
    await snapshot(t, fresh);
    expect((await owner.query(api.attendance.getSessionExport, { sessionId: f.sessionId }))?.rows).toHaveLength(2);
  });

  it.each(["invalid_enum", "wrong_occurrence", "wrong_resource", "malformed_fact"])("blocks under-validated or inconsistent cache shape: %s", async kind => {
    const t = makeTest(); await seed(t); await checkIn(t);
    const id = await t.run(async ctx => {
      const row = (await ctx.db.query("pika_idempotency").withIndex("by_installationRef_and_idempotencyKey", q =>
        q.eq("installationRef", request.installation_ref).eq("idempotencyKey", "scan_one")).unique())!;
      const result = JSON.parse(row.resultJson!);
      if (kind === "invalid_enum") {
        delete result.check_in; result.outcome = "rejected"; result.result_code = "Synthetic target / target@example.invalid";
      } else if (kind === "wrong_occurrence") result.occurrence_ref = "wrong_occurrence";
      else if (kind === "wrong_resource") {
        const otherRoster = (await ctx.db.query("pika_integrated_rosters").withIndex("by_installationRef_and_rosterRef", q =>
          q.eq("installationRef", request.installation_ref).eq("rosterRef", "roster_other")).unique())!;
        const occurrence = (await ctx.db.query("attendance_occurrences").first())!;
        const occurrenceId = await ctx.db.insert("attendance_occurrences", { rosterId: otherRoster.rosterId, title: "Other occurrence", date: "2026-09-12",
          opensAt: occurrence.opensAt, closesAt: occurrence.closesAt, status: "scheduled", sessionRevision: 1,
          createdByAppUserId: otherRoster.ownerAppUserId, createdAt: Date.now(), updatedAt: Date.now() });
        await ctx.db.insert("pika_integrated_occurrences", { installationRef: request.installation_ref, rosterRef: "roster_other", occurrenceRef: "occurrence_other",
          occurrenceId, sourceRevision: 1, createdAt: Date.now(), updatedAt: Date.now() });
        await ctx.db.patch(row._id, { resourceRef: "occurrence_other" });
      } else result.check_in.check_in_revision = -1;
      await ctx.db.patch(row._id, { resultJson: JSON.stringify(result) });
      return row._id;
    });
    await advance(t); expect(await finish(t)).toMatchObject({ state: "blocked", absence_verified: false });
    expect(await t.run(ctx => ctx.db.get(id))).not.toBeNull();
  });

  it.each(["peer_fact", "orphan_fact", "wrong_roster", "wrong_correlation"])("preserves unscopable outbox copy instead of deleting it: %s", async kind => {
    const t = makeTest(), f = await seed(t); await checkIn(t);
    const peer = await checkIn(t, { ...scan(), actor_principal_ref: "principal_peer", actor_display_name: "Synthetic peer", idempotency_key: "mixed-peer" });
    if (!peer.ok || !peer.check_in) throw new Error("Expected peer fixture");
    const id = await t.run(async ctx => {
      const row = (await ctx.db.query("pika_outbox").first())!;
      const event = JSON.parse(row.payloadJson);
      if (kind === "peer_fact") event.metadata.check_in_ref = peer.check_in!.check_in_ref;
      else if (kind === "orphan_fact") event.metadata.check_in_ref = "orphan_check_in";
      else if (kind === "wrong_roster") {
        const mapping = (await ctx.db.query("pika_integrated_occurrences").withIndex("by_occurrenceId", q => q.eq("occurrenceId", f.occurrenceId)).unique())!;
        await ctx.db.patch(mapping._id, { rosterRef: "roster_other" });
      } else event.correlation_ref = "wrong_correlation";
      await ctx.db.patch(row._id, { payloadJson: JSON.stringify(event) });
      return row._id;
    });
    await advance(t); expect(await finish(t)).toMatchObject({ state: "blocked", absence_verified: false, deleted_count: 0 });
    expect(await t.run(ctx => ctx.db.get(id))).not.toBeNull();
    expect(await t.run(ctx => ctx.db.get(f.peer._id))).not.toBeNull();
  });
});
