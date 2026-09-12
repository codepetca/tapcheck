import { v } from "convex/values";
import { parseDecommissionRequest, type DecommissionReceipt } from "../lib/attendance-contract/decommission";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import type { Doc } from "./model";
import { internalMutation, type MutationCtx } from "./server";

const BATCH = 50;
type Operation = Doc<"pika_decommissions">;

function enabled(rosterRef: string) {
  return process.env.PIKA_DECOMMISSION_MODE === "enabled" ||
    (process.env.PIKA_DECOMMISSION_MODE === "canary" &&
      process.env.PIKA_DECOMMISSION_CANARY_ROSTER_REF === rosterRef);
}

function receipt(op: Operation): DecommissionReceipt {
  return { schema_version: 1, ok: true, installation_ref: op.installationRef,
    roster_ref: op.rosterRef, operation_ref: op.operationRef, state: op.state,
    absence_verified: op.state === "deleted", deleted_count: op.deletedCount };
}

// Every tick is one transaction and has a fixed read/write bound. Parent rows
// remain until their children are gone; no in-memory job state is authoritative.
async function tick(ctx: MutationCtx, op: Operation) {
  const rosterId = op.rosterId;
  if (!rosterId) throw new Error("decommission_roster_binding_missing");
  let count = 0;
  let done = false;
  let cursor: string | null = null;
  if (op.phase === 0) {
    // Legacy outbox rows embed their scope inside the validated payload. Scan
    // bounded installation pages instead of guessing from correlation strings.
    const page = await ctx.db.query("pika_outbox")
      .withIndex("by_installationRef", q => q.eq("installationRef", op.installationRef))
      .paginate({ numItems: BATCH, cursor: op.cursor });
    for (const row of page.page) {
      const event = validateV1Event(JSON.parse(row.payloadJson));
      if (!event.ok || event.value.installation_ref !== op.installationRef) {
        throw new Error("decommission_outbox_scope_unverifiable");
      }
      if (event.value.roster_ref === op.rosterRef) { await ctx.db.delete(row._id); count++; }
    }
    done = page.isDone;
    cursor = page.continueCursor;
  } else if (op.phase === 1) {
    // Keep occurrence mappings until legacy response-cache attribution finishes.
    const page = await ctx.db.query("pika_idempotency")
      .withIndex("by_installationRef", q => q.eq("installationRef", op.installationRef))
      .paginate({ numItems: BATCH, cursor: op.cursor });
    for (const row of page.page) {
      let owned = false;
      if (row.messageType === "roster.snapshot" || row.messageType === "schedule.snapshot") {
        owned = row.resourceRef === op.rosterRef;
      } else {
        const mapping = await ctx.db.query("pika_integrated_occurrences")
          .withIndex("by_installationRef_and_occurrenceRef", q =>
            q.eq("installationRef", op.installationRef).eq("occurrenceRef", row.resourceRef)).unique();
        // An unattributable cached student result could contain deleted data.
        // Refuse an absence claim until an operator resolves the orphan.
        if (!mapping) throw new Error("decommission_cache_scope_unverifiable");
        owned = mapping.rosterRef === op.rosterRef;
      }
      if (owned) { await ctx.db.delete(row._id); count++; }
    }
    done = page.isDone;
    cursor = page.continueCursor;
  } else if (op.phase === 2) {
    const rows = await ctx.db.query("pika_check_ins")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    count = rows.length; done = count === 0;
  } else if (op.phase === 3) {
    const session = await ctx.db.query("sessions")
      .withIndex("by_rosterId_createdAt", q => q.eq("rosterId", rosterId)).first();
    if (!session) done = true;
    else {
      const records = await ctx.db.query("attendance_records")
        .withIndex("by_sessionId", q => q.eq("sessionId", session._id)).take(BATCH);
      for (const row of records) await ctx.db.delete(row._id);
      count = records.length;
      if (!count) {
        const events = await ctx.db.query("attendance_events")
          .withIndex("by_sessionId_and_createdAt", q => q.eq("sessionId", session._id)).take(BATCH);
        for (const row of events) await ctx.db.delete(row._id);
        count = events.length;
        if (!count) { await ctx.db.delete(session._id); count = 1; }
      }
    }
  } else if (op.phase === 4) {
    const rows = await ctx.db.query("attendance_occurrences")
      .withIndex("by_rosterId_and_date", q => q.eq("rosterId", rosterId)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    count = rows.length; done = count === 0;
  } else if (op.phase === 5) {
    const rows = await ctx.db.query("pika_integrated_occurrences")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).take(BATCH);
    for (const row of rows) {
      if (await ctx.db.get(row.occurrenceId)) throw new Error("decommission_occurrence_scope_invalid");
      await ctx.db.delete(row._id);
    }
    count = rows.length; done = count === 0;
  } else if (op.phase === 6) {
    const rows = await ctx.db.query("participants")
      .withIndex("by_rosterId_sortKey", q => q.eq("rosterId", rosterId)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    count = rows.length; done = count === 0;
  } else if (op.phase === 7) {
    const rows = await ctx.db.query("pika_integrated_participants")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).take(BATCH);
    for (const row of rows) {
      if (await ctx.db.get(row.participantId)) throw new Error("decommission_participant_scope_invalid");
      await ctx.db.delete(row._id);
    }
    count = rows.length; done = count === 0;
  } else if (op.phase === 8) {
    const rows = await ctx.db.query("roster_access")
      .withIndex("by_rosterId", q => q.eq("rosterId", rosterId)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    count = rows.length; done = count === 0;
  } else if (op.phase === 9) {
    const rows = await ctx.db.query("pika_schedule_windows")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).take(BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    count = rows.length; done = count === 0;
  } else if (op.phase === 10) {
    const mapping = await ctx.db.query("pika_integrated_rosters")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).unique();
    const roster = await ctx.db.get(rosterId);
    if (!mapping || mapping.rosterId !== rosterId || !roster?.pikaDecommissioned) {
      throw new Error("decommission_final_binding_invalid");
    }
    // Recheck the remaining authoritative roots. Prior phases established
    // child absence under a fence read by every supported writer.
    const remaining = await Promise.all([
      ctx.db.query("sessions").withIndex("by_rosterId_createdAt", q => q.eq("rosterId", rosterId)).first(),
      ctx.db.query("participants").withIndex("by_rosterId_sortKey", q => q.eq("rosterId", rosterId)).first(),
      ctx.db.query("attendance_occurrences").withIndex("by_rosterId_and_date", q => q.eq("rosterId", rosterId)).first(),
      ctx.db.query("roster_access").withIndex("by_rosterId", q => q.eq("rosterId", rosterId)).first(),
      ctx.db.query("pika_check_ins").withIndex("by_installationRef_and_rosterRef", q => q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).first(),
      ctx.db.query("pika_integrated_participants").withIndex("by_installationRef_and_rosterRef", q => q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).first(),
      ctx.db.query("pika_integrated_occurrences").withIndex("by_installationRef_and_rosterRef", q => q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).first(),
      ctx.db.query("pika_schedule_windows").withIndex("by_installationRef_and_rosterRef", q => q.eq("installationRef", op.installationRef).eq("rosterRef", op.rosterRef)).first(),
    ]);
    if (remaining.some(Boolean)) throw new Error("decommission_absence_not_verified");
    await ctx.db.delete(mapping._id);
    await ctx.db.delete(rosterId);
    await ctx.db.patch(op._id, { state: "deleted", rosterId: undefined, phase: 11,
      cursor: null, deletedCount: op.deletedCount + 2, updatedAt: Date.now() });
    return;
  } else throw new Error("decommission_phase_invalid");
  await ctx.db.patch(op._id, { phase: done ? op.phase + 1 : op.phase,
    cursor: done ? null : cursor, deletedCount: op.deletedCount + count, updatedAt: Date.now() });
}

export const advance = internalMutation({
  args: { payload: v.object({
    schema_version: v.literal(1), message_type: v.literal("roster.decommission"),
    action: v.union(v.literal("begin"), v.literal("tick"), v.literal("status")),
    installation_ref: v.string(), roster_ref: v.string(), operation_ref: v.string(),
    actor_principal_ref: v.string(),
  }), nonce: v.string(), requestTimestamp: v.number() },
  handler: async (ctx, args) => {
    const payload = parseDecommissionRequest(args.payload);
    if (!payload) return { ok: false as const, code: "invalid_request" };
    if (payload.installation_ref !== process.env.PIKA_INTEGRATION_REF?.trim()) {
      return { ok: false as const, code: "resource_mismatch" };
    }
    if (!enabled(payload.roster_ref)) return { ok: false as const, code: "disabled" };
    const nonce = await ctx.db.query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", q =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce)).unique();
    if (nonce) return { ok: false as const, code: "replayed_request" };
    await ctx.db.insert("pika_request_nonces", { installationRef: payload.installation_ref,
      nonce: args.nonce, requestTimestamp: args.requestTimestamp, createdAt: Date.now() });
    const actorDigest = await sha256Hex(JSON.stringify([
      "roster.decommission/v1", payload.installation_ref, payload.operation_ref, payload.actor_principal_ref,
    ]));
    const existing = await ctx.db.query("pika_decommissions")
      .withIndex("by_installationRef_and_rosterRef", q =>
        q.eq("installationRef", payload.installation_ref).eq("rosterRef", payload.roster_ref)).unique();
    if (existing) {
      if (existing.operationRef !== payload.operation_ref) return { ok: false as const, code: "operation_conflict" };
      if (existing.actorDigest !== actorDigest) return { ok: false as const, code: "owner_not_authorized" };
      if (payload.action === "tick" && existing.state === "deleting") {
        await tick(ctx, existing);
        return receipt((await ctx.db.get(existing._id))!);
      }
      return receipt(existing);
    }
    if (payload.action !== "begin") return { ok: false as const, code: "operation_not_found" };
    const collision = await ctx.db.query("pika_decommissions")
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
    // Keep the roster available until each participant operation has verified
    // absence. These indexed reads conflict with a concurrent participant begin;
    // its roster read likewise conflicts with this mutation's roster fence.
    for (const state of ["deleting", "blocked"] as const) {
      const pending = await ctx.db.query("pika_participant_erasures")
        .withIndex("by_rosterId_and_state", q => q.eq("rosterId", roster._id).eq("state", state)).first();
      if (pending) return { ok: false as const, code: "operation_conflict" };
    }
    const now = Date.now();
    const id = await ctx.db.insert("pika_decommissions", {
      installationRef: payload.installation_ref, rosterRef: payload.roster_ref,
      operationRef: payload.operation_ref, actorDigest, rosterId: roster._id,
      phase: 0, cursor: null, state: "deleting", deletedCount: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(roster._id, { pikaDecommissioned: true, updatedAt: now });
    return receipt((await ctx.db.get(id))!);
  },
});
