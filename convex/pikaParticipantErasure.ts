import { v } from "convex/values";
import { parseParticipantErasureRequest, type ParticipantErasureReceipt } from "../lib/attendance-contract/participant-erasure";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import type { Doc } from "./model";
import { internalMutation, type MutationCtx } from "./server";
import { subjectDigest } from "./pikaParticipantFence";

// Each explicit tick scans at most 25 rows. No scheduler or caller-selected bound.
const BATCH = 25;
type Operation = Doc<"pika_participant_erasures">;
function receipt(op: Operation): ParticipantErasureReceipt {
  return { schema_version: 1, ok: true, installation_ref: op.installationRef,
    roster_ref: op.rosterRef, participant_ref: op.participantRef, operation_ref: op.operationRef,
    state: op.state, absence_verified: op.state === "deleted", deleted_count: op.deletedCount };
}
async function tick(ctx: MutationCtx, op: Operation) {
  if (op.blockedCode === "subject_scope_unverifiable") return;
  if (!op.subjectDigest) { await block(ctx, op, "subject_scope_unverifiable"); return; }
  const roster = await ctx.db.get(op.rosterId);
  const rosterMappings = await ctx.db.query("pika_integrated_rosters").withIndex("by_rosterId", q => q.eq("rosterId", op.rosterId)).take(2);
  if (!roster || roster.pikaDecommissioned || rosterMappings.length !== 1 ||
    rosterMappings[0]?.installationRef !== op.installationRef || rosterMappings[0]?.rosterRef !== op.rosterRef) {
    await block(ctx, op, "roster_binding_invalid"); return;
  }
  let count = 0;
  let done = false;
  let cursor: string | null = null;
  const removeRows = async (rows: Array<{ _id: Doc<"pika_outbox">["_id"] | Doc<"pika_idempotency">["_id"] | Doc<"pika_check_ins">["_id"] | Doc<"attendance_records">["_id"] | Doc<"attendance_events">["_id"] }>) => {
    if (op.verifying && rows.length) { await block(ctx, op, "absence_not_verified"); return false; }
    for (const row of rows) { await ctx.db.delete(row._id); count++; }
    return true;
  };
  // Validation failures must commit a blocked receipt, not roll back begin's fence.
  // Do all validation for a page before deleting any of it.
  if (op.phase === 0) {
    const page = await ctx.db.query("pika_outbox").withIndex("by_installationRef", q => q.eq("installationRef", op.installationRef))
      .paginate({ numItems: BATCH, cursor: op.cursor });
    const owned = [];
    for (const row of page.page) {
      let event;
      try { event = validateV1Event(JSON.parse(row.payloadJson)); } catch { event = null; }
      if (!event?.ok || event.value.installation_ref !== row.installationRef || event.value.event_id !== row.eventId || event.value.event_type !== row.eventType) {
        await block(ctx, op, "outbox_scope_unverifiable"); return;
      }
      if (event.value.roster_ref === op.rosterRef && "participant_ref" in event.value.metadata && event.value.metadata.participant_ref === op.participantRef) owned.push(row);
    }
    if (!await removeRows(owned)) return;
    done = page.isDone; cursor = page.continueCursor;
  } else if (op.phase === 1) {
    const page = await ctx.db.query("pika_idempotency").withIndex("by_installationRef", q => q.eq("installationRef", op.installationRef))
      .paginate({ numItems: BATCH, cursor: op.cursor });
    const owned = [];
    for (const row of page.page) {
      // Ordinary aggregate command caches contain no participant details. Unknown
      // result copies require attribution, including unexpected historical shapes.
      if (row.resultJson === undefined) continue;
      const mapping = await ctx.db.query("pika_integrated_occurrences")
        .withIndex("by_installationRef_and_occurrenceRef", q => q.eq("installationRef", op.installationRef).eq("occurrenceRef", row.resourceRef)).unique();
      if (!mapping) { await block(ctx, op, "cache_scope_unverifiable"); return; }
      if (mapping.rosterRef !== op.rosterRef) continue;
      let result;
      try { result = JSON.parse(row.resultJson); } catch { result = null; }
      if (!validStudentResult(result) || row.messageType !== "student_check_in") {
        await block(ctx, op, "cache_scope_unverifiable"); return;
      }
      if (result.check_in?.participant_ref === op.participantRef) owned.push(row);
    }
    if (!await removeRows(owned)) return;
    done = page.isDone; cursor = page.continueCursor;
  } else if (op.phase === 2) {
    const page = await ctx.db.query("pika_check_ins")
      .withIndex("by_installationRef_and_rosterRef_and_participantRef", q => q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef).eq("participantRef", op.participantRef))
      .paginate({ numItems: BATCH, cursor: op.cursor });
    for (const row of page.page) {
      const occurrence = await ctx.db.get(row.occurrenceId);
      if (row.participantId !== op.participantId || occurrence?.rosterId !== op.rosterId) {
        await block(ctx, op, "check_in_scope_unverifiable"); return;
      }
    }
    if (!await removeRows(page.page)) return;
    done = page.isDone; cursor = page.continueCursor;
  } else if (op.phase === 3) {
    const page = await ctx.db.query("attendance_records").withIndex("by_participantId", q => q.eq("participantId", op.participantId))
      .paginate({ numItems: BATCH, cursor: op.cursor });
    for (const row of page.page) {
      const session = await ctx.db.get(row.sessionId);
      if (!session || session.rosterId !== op.rosterId || (row.linkedAppUserId &&
        await subjectDigest(op.rosterId, row.linkedAppUserId) !== op.subjectDigest)) {
        await block(ctx, op, "record_scope_unverifiable"); return;
      }
    }
    if (!await removeRows(page.page)) return;
    done = page.isDone; cursor = page.continueCursor;
  } else if (op.phase === 4) {
    // Historical blocked scans have no participantId. A bounded table traversal
    // also finds actor/detail copies without guessing from display names.
    const page = await ctx.db.query("attendance_events").paginate({ numItems: BATCH, cursor: op.cursor });
    const owned = [];
    for (const row of page.page) {
      const session = await ctx.db.get(row.sessionId);
      if (row.participantId === op.participantId && session?.rosterId !== op.rosterId) {
        await block(ctx, op, "event_scope_unverifiable"); return;
      }
      if (row.participantId === op.participantId && row.actorType === "student" && row.actorAppUserId &&
        await subjectDigest(op.rosterId, row.actorAppUserId) !== op.subjectDigest) {
        await block(ctx, op, "historical_subject_unverifiable"); return;
      }
      if (session?.rosterId !== op.rosterId) continue;
      if (row.participantId === op.participantId || (row.actorType === "student" && row.actorAppUserId &&
        op.subjectDigest === await subjectDigest(op.rosterId, row.actorAppUserId))) {
        if (row.participantId && row.participantId !== op.participantId) {
          await block(ctx, op, "mixed_subject_event"); return;
        }
        owned.push(row);
      }
      else if (!row.participantId && row.metadata && !row.actorAppUserId) {
        await block(ctx, op, "event_scope_unverifiable"); return;
      }
    }
    if (!await removeRows(owned)) return;
    done = page.isDone; cursor = page.continueCursor;
  } else if (op.phase === 5) {
    const mapping = await ctx.db.query("pika_integrated_participants")
      .withIndex("by_installationRef_rosterRef_participantRef", q => q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef).eq("participantRef", op.participantRef)).unique();
    const participant = await ctx.db.get(op.participantId);
    if (await ctx.db.query("pika_check_ins").withIndex("by_participantId", q => q.eq("participantId", op.participantId)).first()) {
      await block(ctx, op, "check_in_scope_unverifiable"); return;
    }
    if (op.verifying) {
      if (mapping || participant) { await block(ctx, op, "absence_not_verified"); return; }
      await ctx.db.patch(op._id, { state: "deleted", phase: 6, cursor: null, blockedCode: undefined, updatedAt: Date.now() });
      return;
    }
    if (!mapping || mapping.participantId !== op.participantId || participant?.rosterId !== op.rosterId || participant.active) {
      await block(ctx, op, "participant_binding_invalid"); return;
    }
    await ctx.db.delete(mapping._id);
    await ctx.db.delete(participant._id);
    await ctx.db.patch(op._id, { phase: 0, cursor: null, verifying: true, deletedCount: op.deletedCount + 2, updatedAt: Date.now() });
    return;
  } else throw new Error("erasure_phase_invalid");
  await ctx.db.patch(op._id, { phase: done ? op.phase + 1 : op.phase,
    cursor: done ? null : cursor, deletedCount: op.deletedCount + count,
    state: "deleting", blockedCode: undefined, updatedAt: Date.now() });
}
async function block(ctx: MutationCtx, op: Operation, code: string) {
  await ctx.db.patch(op._id, { state: "blocked", blockedCode: code, updatedAt: Date.now() });
}
function validStudentResult(value: unknown): value is { check_in?: { participant_ref: string } } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !["ok", "schema_version", "outcome", "result_code", "occurrence_ref", "session_revision", "check_in"].includes(k)) ||
    r.ok !== true || r.schema_version !== 1 || typeof r.occurrence_ref !== "string" || typeof r.session_revision !== "number") return false;
  if (!r.check_in) return r.outcome === "rejected";
  if (typeof r.check_in !== "object" || Array.isArray(r.check_in)) return false;
  const fact = r.check_in as Record<string, unknown>;
  return typeof fact.participant_ref === "string" && Object.keys(fact).every(k =>
    ["check_in_ref", "participant_ref", "check_in_revision", "accepted_at", "invalidated_at", "reason_code"].includes(k));
}

export const advance = internalMutation({
  args: { payload: v.object({
    schema_version: v.literal(1), message_type: v.literal("participant.erase"),
    action: v.union(v.literal("begin"), v.literal("tick"), v.literal("status")),
    installation_ref: v.string(), roster_ref: v.string(), operation_ref: v.string(),
    actor_principal_ref: v.string(), participant_ref: v.string(),
  }), nonce: v.string(), requestTimestamp: v.number() },
  handler: async (ctx, args) => {
    const payload = parseParticipantErasureRequest(args.payload);
    if (!payload) return { ok: false as const, code: "invalid_request" };
    if (payload.installation_ref !== process.env.PIKA_INTEGRATION_REF?.trim()) {
      return { ok: false as const, code: "resource_mismatch" };
    }
    const existing = await ctx.db.query("pika_participant_erasures")
      .withIndex("by_installationRef_and_rosterRef_and_participantRef", q =>
        q.eq("installationRef", payload.installation_ref).eq("rosterRef", payload.roster_ref).eq("participantRef", payload.participant_ref)).unique();
    if (!existing && process.env.PIKA_PARTICIPANT_ERASURE_MODE !== "enabled") {
      return { ok: false as const, code: "disabled" };
    }
    const nonce = await ctx.db.query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", q =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce)).unique();
    if (nonce) return { ok: false as const, code: "replayed_request" };
    await ctx.db.insert("pika_request_nonces", { installationRef: payload.installation_ref,
      nonce: args.nonce, requestTimestamp: args.requestTimestamp, createdAt: Date.now() });
    const actorDigest = await sha256Hex(JSON.stringify([
      "participant.erase/v1", payload.installation_ref, payload.operation_ref, payload.actor_principal_ref,
    ]));
    if (existing) {
      if (existing.operationRef !== payload.operation_ref) return { ok: false as const, code: "operation_conflict" };
      if (existing.actorDigest !== actorDigest) return { ok: false as const, code: "owner_not_authorized" };
      if (payload.action === "tick" && existing.state !== "deleted") {
        await tick(ctx, existing);
        return receipt((await ctx.db.get(existing._id))!);
      }
      return receipt(existing);
    }
    if (payload.action !== "begin") return { ok: false as const, code: "operation_not_found" };
    const collision = await ctx.db.query("pika_participant_erasures")
      .withIndex("by_installationRef_and_operationRef", q =>
        q.eq("installationRef", payload.installation_ref).eq("operationRef", payload.operation_ref)).unique();
    if (collision) return { ok: false as const, code: "operation_conflict" };
    const mapping = await ctx.db.query("pika_integrated_rosters")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", payload.installation_ref).eq("rosterRef", payload.roster_ref)).unique();
    // Missing is not proof of erasure: it could be a broken integration link.
    if (!mapping?.tenantRef) return { ok: false as const, code: "roster_not_found" };
    const [identity, owner, roster] = await Promise.all([
      ctx.db.query("auth_identities").withIndex("by_provider_and_providerSubject", q =>
        q.eq("provider", "pika").eq("providerSubject", `pika:${payload.installation_ref}:${payload.actor_principal_ref}`)).unique(),
      ctx.db.get(mapping.ownerAppUserId), ctx.db.get(mapping.rosterId),
    ]);
    if (!owner || owner.status !== "active" || identity?.appUserId !== owner._id ||
      !roster || roster.ownerAppUserId !== owner._id || roster.pikaDecommissioned) {
      return { ok: false as const, code: "owner_not_authorized" };
    }
    const membership = await ctx.db.query("organization_memberships")
      .withIndex("by_appUserId_organizationId", q => q.eq("appUserId", owner._id).eq("organizationId", roster.organizationId)).unique();
    if (!membership || membership.status !== "active" || membership.role === "student") {
      return { ok: false as const, code: "owner_not_authorized" };
    }
    const tenant = await ctx.db.query("pika_installation_tenants")
      .withIndex("by_installationRef_and_tenantRef", q =>
        q.eq("installationRef", payload.installation_ref).eq("tenantRef", mapping.tenantRef!)).unique();
    const organization = await ctx.db.get(roster.organizationId);
    if (!tenant || tenant.organizationId !== roster.organizationId || organization?.status !== "active") {
      return { ok: false as const, code: "owner_not_authorized" };
    }
    const participantMapping = await ctx.db.query("pika_integrated_participants")
      .withIndex("by_installationRef_rosterRef_participantRef", q => q.eq("installationRef", payload.installation_ref)
        .eq("rosterRef", payload.roster_ref).eq("participantRef", payload.participant_ref)).unique();
    if (!participantMapping) return { ok: false as const, code: "participant_not_found" };
    const participant = await ctx.db.get(participantMapping.participantId);
    const aliases = await ctx.db.query("pika_integrated_participants")
      .withIndex("by_participantId", q => q.eq("participantId", participantMapping.participantId)).take(2);
    if (!participant || participant.rosterId !== roster._id || aliases.length !== 1) {
      return { ok: false as const, code: "resource_mismatch" };
    }
    const sameSubject = participant.linkedAppUserId ? await ctx.db.query("participants")
      .withIndex("by_rosterId_and_linkedAppUserId", q => q.eq("rosterId", roster._id).eq("linkedAppUserId", participant.linkedAppUserId)).take(2) : [];
    const ambiguousSubject = !participant.linkedAppUserId || sameSubject.length !== 1;
    const now = Date.now();
    const id = await ctx.db.insert("pika_participant_erasures", {
      installationRef: payload.installation_ref, rosterRef: payload.roster_ref,
      participantRef: payload.participant_ref, participantId: participant._id,
      subjectDigest: participant.linkedAppUserId ? await subjectDigest(roster._id, participant.linkedAppUserId) : undefined,
      operationRef: payload.operation_ref, actorDigest, rosterId: roster._id,
      phase: 0, cursor: null, verifying: false, state: ambiguousSubject ? "blocked" : "deleting",
      blockedCode: ambiguousSubject ? "subject_scope_unverifiable" : undefined, deletedCount: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(participant._id, { active: false, updatedAt: now });
    return receipt((await ctx.db.get(id))!);
  },
});
