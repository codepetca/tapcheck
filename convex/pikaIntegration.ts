import { participantFence, participantIdFence, rosterHasParticipantFences, subjectFences } from "./pikaParticipantFence";
import { v } from "convex/values";
import { isPikaRosterDecommissioned, assertRosterNotDecommissioned } from "./pikaDecommissionFence";
import type {
  V1CheckInFact,
  V1StudentCheckInResult,
} from "../lib/attendance-contract/v1/types";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import {
  closeAttendanceSession,
  openAttendanceSession,
} from "./attendanceEngine";
import type { Doc, Id } from "./model";
import {
  ensurePikaPrincipal,
  ensurePikaRosterOwner,
} from "./pikaIdentity";
import { isPikaAttendanceIntegrationEnabled } from "./pikaConfiguration";
import { internalMutation, internalQuery, type MutationCtx } from "./server";
import {
  queueAttendanceEvent,
  scheduleExactOccurrenceJobs,
} from "./pikaIntegrationEvents";
import { internal } from "./api";

import {
  applyResultValidator,
  checkInInvalidateResultValidator,
  checkInInvalidateValidator,
  checkInPresentationResultValidator,
  rosterSnapshotValidator,
  scheduleApplyResultValidator,
  scheduleSnapshotValidator,
  sessionCommandResultValidator,
  sessionCommandValidator,
  sessionSnapshotValidator,
  studentCheckInResultValidator,
  studentCheckInValidator,
} from "./pikaIntegrationValidators";
type ParticipantLinkPatch = Partial<
  Pick<
    Doc<"participants">,
    | "linkedAppUserId"
    | "participantType"
    | "linkStatus"
    | "linkMethod"
    | "linkedAt"
    | "linkedByAppUserId"
  >
>;

function participantNameFields(displayName: string, participantRef: string) {
  const parts = displayName.trim().split(/\s+/);
  const firstName = parts.shift() ?? displayName.trim();
  const lastName = parts.join(" ");
  return {
    rawName: displayName.trim(),
    firstName,
    lastName,
    displayName: displayName.trim(),
    sortKey: `${lastName.toLocaleLowerCase()}|${firstName.toLocaleLowerCase()}|${participantRef}`,
  };
}

export const consumeSignedRequestNonce = internalMutation({
  args: {
    installationRef: v.string(),
    nonce: v.string(),
    requestTimestamp: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", args.installationRef).eq("nonce", args.nonce),
      )
      .unique();
    if (existing) return false;

    await ctx.db.insert("pika_request_nonces", {
      installationRef: args.installationRef,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: Date.now(),
    });
    return true;
  },
});

async function participantLinkPatch(
  ctx: MutationCtx,
  existing: Doc<"participants"> | null,
  principalRef: string | undefined,
  displayName: string,
  installationRef: string,
  tenantRef: string,
  ownerAppUserId: Id<"app_users">,
  now: number,
): Promise<ParticipantLinkPatch> {
  if (!principalRef) {
    if (!existing || existing.linkMethod === "integration_assertion") {
      return {
        linkedAppUserId: undefined,
        participantType: "roster_only",
        linkStatus: "unlinked",
        linkMethod: undefined,
        linkedAt: undefined,
        linkedByAppUserId: undefined,
      };
    }
    return {};
  }

  const principal = await ensurePikaPrincipal(ctx, {
    installationRef,
    tenantRef,
    principalRef,
    displayName,
    requestedRole: "student",
    now,
  });
  if (!principal.ok) {
    return existing?.linkMethod && existing.linkMethod !== "integration_assertion"
      ? { linkStatus: "review_needed" }
      : {
          linkedAppUserId: undefined,
          participantType: "roster_only",
          linkStatus: "review_needed",
          linkMethod: undefined,
          linkedAt: undefined,
          linkedByAppUserId: undefined,
        };
  }

  if (
    existing?.linkedAppUserId &&
    existing.linkedAppUserId !== principal.appUser._id
  ) {
    return { linkStatus: "review_needed" };
  }

  return {
    linkedAppUserId: principal.appUser._id,
    participantType: "identified_user",
    linkStatus: "linked",
    linkMethod: "integration_assertion",
    linkedAt: now,
    linkedByAppUserId: ownerAppUserId,
  };
}

async function ensurePikaStaffAccess(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    rosterRef: string;
    principalRef: string;
    displayName: string;
    now: number;
  },
) {
  const rosterMapping = await ctx.db
    .query("pika_integrated_rosters")
    .withIndex("by_installationRef_and_rosterRef", (q) =>
      q.eq("installationRef", args.installationRef).eq("rosterRef", args.rosterRef),
    )
    .unique();
  if (!rosterMapping?.tenantRef) {
    return { ok: false as const, code: "integration_state_invalid" as const };
  }
  const roster = await ctx.db.get(rosterMapping.rosterId);
  if (!roster) return { ok: false as const, code: "integration_state_invalid" as const };

  const principal = await ensurePikaPrincipal(ctx, {
    installationRef: args.installationRef,
    tenantRef: rosterMapping.tenantRef,
    principalRef: args.principalRef,
    displayName: args.displayName,
    requestedRole: "staff",
    now: args.now,
  });
  if (!principal.ok || principal.organization._id !== roster.organizationId) {
    return { ok: false as const, code: "actor_not_authorized" as const };
  }

  let access = await ctx.db
    .query("roster_access")
    .withIndex("by_rosterId_membershipId", (q) =>
      q.eq("rosterId", roster._id).eq("membershipId", principal.membership._id),
    )
    .unique();
  if (!access) {
    const accessId = await ctx.db.insert("roster_access", {
      rosterId: roster._id,
      membershipId: principal.membership._id,
      accessRole: principal.membership.role === "admin" ? "admin" : "staff",
      createdAt: args.now,
      updatedAt: args.now,
    });
    access = await ctx.db.get(accessId);
  }
  return access
    ? { ok: true as const, appUser: principal.appUser, roster, access }
    : { ok: false as const, code: "integration_state_invalid" as const };
}

export const applyRosterSnapshot = internalMutation({
  args: {
    nonce: v.string(),
    requestTimestamp: v.number(),
    bodyDigest: v.string(),
    payload: rosterSnapshotValidator,
  },
  returns: applyResultValidator,
  handler: async (ctx, args) => {
    const { payload } = args;
    if (await isPikaRosterDecommissioned(ctx, payload.installation_ref, payload.roster_ref)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    // Read generation fences before any cached success or identity/name write.
    const hasParticipantFences = await rosterHasParticipantFences(ctx, payload.installation_ref, payload.roster_ref);
    for (const incoming of hasParticipantFences ? payload.participants : []) {
      if (await participantFence(ctx, payload.installation_ref, payload.roster_ref, incoming.participant_ref)) {
        return { ok: false as const, code: "integration_state_invalid" as const };
      }
    }
    const now = Date.now();
    const existingNonce = await ctx.db
      .query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce),
      )
      .unique();
    if (existingNonce) return { ok: false as const, code: "replayed_request" as const };

    await ctx.db.insert("pika_request_nonces", {
      installationRef: payload.installation_ref,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: now,
    });

    const idempotency = await ctx.db
      .query("pika_idempotency")
      .withIndex("by_installationRef_and_idempotencyKey", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("idempotencyKey", payload.idempotency_key),
      )
      .unique();
    if (idempotency) {
      if (idempotency.messageType !== "roster.snapshot" || idempotency.bodyDigest !== args.bodyDigest) {
        return { ok: false as const, code: "idempotency_conflict" as const };
      }
      return {
        ok: true as const,
        outcome: "duplicate" as const,
        roster_ref: idempotency.resourceRef,
        revision: idempotency.sourceRevision,
        created_count: idempotency.createdCount,
        updated_count: idempotency.updatedCount,
        deactivated_count: idempotency.deactivatedCount,
      };
    }

    const existingRosterMapping = await ctx.db
      .query("pika_integrated_rosters")
      .withIndex("by_installationRef_and_rosterRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref),
      )
      .unique();
    if (existingRosterMapping?.tenantRef !== undefined &&
      existingRosterMapping.tenantRef !== payload.tenant_ref) {
      return { ok: false as const, code: "owner_mismatch" as const };
    }
    if (existingRosterMapping && payload.revision <= existingRosterMapping.sourceRevision) {
      return { ok: false as const, code: "stale_revision" as const };
    }

    if (existingRosterMapping && hasParticipantFences) {
      for (const incoming of payload.participants) {
        if (!incoming.principal_ref) continue;
        const identity = await ctx.db.query("auth_identities")
          .withIndex("by_provider_and_providerSubject", q => q.eq("provider", "pika").eq("providerSubject", `pika:${payload.installation_ref}:${incoming.principal_ref}`)).unique();
        if (identity && (await subjectFences(ctx, existingRosterMapping.rosterId, identity.appUserId)).some(f => f.state !== "deleted")) {
          return { ok: false as const, code: "integration_state_invalid" as const };
        }
      }
    }
    const owner = await ensurePikaRosterOwner(ctx, {
      installationRef: payload.installation_ref,
      tenantRef: payload.tenant_ref,
      principalRef: payload.owner_principal_ref,
      displayName: payload.owner_display_name,
      now,
    });
    if (!owner.ok) {
      return { ok: false as const, code: "owner_not_authorized" as const };
    }
    if (existingRosterMapping?.ownerAppUserId !== undefined &&
      existingRosterMapping.ownerAppUserId !== owner.appUser._id) {
      return { ok: false as const, code: "owner_mismatch" as const };
    }

    const existingParticipantMappings = existingRosterMapping
      ? await ctx.db
          .query("pika_integrated_participants")
          .withIndex("by_installationRef_and_rosterRef", (q) =>
            q
              .eq("installationRef", payload.installation_ref)
              .eq("rosterRef", payload.roster_ref),
          )
          .collect()
      : [];
    const existingParticipantDocs = await Promise.all(
      existingParticipantMappings.map((mapping) => ctx.db.get(mapping.participantId)),
    );
    if (existingParticipantDocs.some((participant) => participant === null)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }

    let rosterId = existingRosterMapping?.rosterId;
    if (rosterId && !(await ctx.db.get(rosterId))) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    if (!rosterId) {
      rosterId = await ctx.db.insert("rosters", {
        organizationId: owner.organization._id,
        ownerAppUserId: owner.appUser._id,
        createdByAppUserId: owner.appUser._id,
        name: payload.display_name,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("roster_access", {
        rosterId,
        membershipId: owner.membership._id,
        accessRole: owner.membership.role === "admin" ? "admin" : "staff",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("pika_integrated_rosters", {
        installationRef: payload.installation_ref,
        tenantRef: payload.tenant_ref,
        rosterRef: payload.roster_ref,
        rosterId,
        ownerAppUserId: owner.appUser._id,
        sourceRevision: payload.revision,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(rosterId, { name: payload.display_name, updatedAt: now });
      await ctx.db.patch(existingRosterMapping!._id, {
        tenantRef: payload.tenant_ref,
        sourceRevision: payload.revision,
        updatedAt: now,
      });
    }

    const mappingByRef = new Map(
      existingParticipantMappings.map((mapping, index) => [
        mapping.participantRef,
        { mapping, participant: existingParticipantDocs[index]! },
      ]),
    );
    const incomingRefs = new Set(payload.participants.map((participant) => participant.participant_ref));
    let createdCount = 0;
    let updatedCount = 0;
    let deactivatedCount = 0;

    for (const participant of payload.participants) {
      const existing = mappingByRef.get(participant.participant_ref);
      const linkPatch = await participantLinkPatch(
        ctx,
        existing?.participant ?? null,
        participant.principal_ref,
        participant.display_name,
        payload.installation_ref,
        payload.tenant_ref,
        owner.appUser._id,
        now,
      );
      const nameFields = participantNameFields(participant.display_name, participant.participant_ref);

      if (existing) {
        await ctx.db.patch(existing.participant._id, {
          ...nameFields,
          ...linkPatch,
          active: participant.active,
          updatedAt: now,
        });
        await ctx.db.patch(existing.mapping._id, {
          sourceRevision: payload.revision,
          updatedAt: now,
        });
        updatedCount += 1;
      } else {
        const participantId = await ctx.db.insert("participants", {
          rosterId,
          ...nameFields,
          ...linkPatch,
          participantType: linkPatch.participantType ?? "roster_only",
          linkStatus: linkPatch.linkStatus ?? "unlinked",
          active: participant.active,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("pika_integrated_participants", {
          installationRef: payload.installation_ref,
          rosterRef: payload.roster_ref,
          participantRef: participant.participant_ref,
          participantId,
          sourceRevision: payload.revision,
          createdAt: now,
          updatedAt: now,
        });
        createdCount += 1;
      }
    }

    for (const { mapping, participant } of mappingByRef.values()) {
      if (await participantIdFence(ctx, participant._id)) continue;
      if (incomingRefs.has(mapping.participantRef) || !participant.active) continue;
      await ctx.db.patch(participant._id, { active: false, updatedAt: now });
      await ctx.db.patch(mapping._id, { sourceRevision: payload.revision, updatedAt: now });
      deactivatedCount += 1;
    }

    await ctx.db.insert("pika_idempotency", {
      installationRef: payload.installation_ref,
      idempotencyKey: payload.idempotency_key,
      correlationRef: payload.correlation_ref,
      messageType: "roster.snapshot",
      bodyDigest: args.bodyDigest,
      resourceRef: payload.roster_ref,
      sourceRevision: payload.revision,
      createdCount,
      updatedCount,
      deactivatedCount,
      createdAt: now,
    });

    return {
      ok: true as const,
      outcome: "applied" as const,
      roster_ref: payload.roster_ref,
      revision: payload.revision,
      created_count: createdCount,
      updated_count: updatedCount,
      deactivated_count: deactivatedCount,
    };
  },
});

export const applyScheduleSnapshot = internalMutation({
  args: {
    nonce: v.string(),
    requestTimestamp: v.number(),
    bodyDigest: v.string(),
    payload: scheduleSnapshotValidator,
  },
  returns: scheduleApplyResultValidator,
  handler: async (ctx, args) => {
    const { payload } = args;
    if (await isPikaRosterDecommissioned(ctx, payload.installation_ref, payload.roster_ref)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const now = Date.now();
    const existingNonce = await ctx.db
      .query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce),
      )
      .unique();
    if (existingNonce) return { ok: false as const, code: "replayed_request" as const };

    await ctx.db.insert("pika_request_nonces", {
      installationRef: payload.installation_ref,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: now,
    });

    const idempotency = await ctx.db
      .query("pika_idempotency")
      .withIndex("by_installationRef_and_idempotencyKey", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("idempotencyKey", payload.idempotency_key),
      )
      .unique();
    if (idempotency) {
      if (
        idempotency.messageType !== "schedule.snapshot" ||
        idempotency.bodyDigest !== args.bodyDigest
      ) {
        return { ok: false as const, code: "idempotency_conflict" as const };
      }
      return {
        ok: true as const,
        outcome: "duplicate" as const,
        roster_ref: idempotency.resourceRef,
        revision: idempotency.sourceRevision,
        scheduled_count: idempotency.createdCount,
        updated_count: idempotency.updatedCount,
        cancelled_count: idempotency.deactivatedCount,
        preserved_count: idempotency.preservedCount ?? 0,
      };
    }

    const rosterMapping = await ctx.db
      .query("pika_integrated_rosters")
      .withIndex("by_installationRef_and_rosterRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref),
      )
      .unique();
    if (!rosterMapping) return { ok: false as const, code: "roster_not_found" as const };

    const [roster, owner] = await Promise.all([
      ctx.db.get(rosterMapping.rosterId),
      ctx.db.get(rosterMapping.ownerAppUserId),
    ]);
    if (!roster) return { ok: false as const, code: "integration_state_invalid" as const };
    if (!owner || owner.status !== "active") {
      return { ok: false as const, code: "owner_not_authorized" as const };
    }

    const scheduleWindow = await ctx.db
      .query("pika_schedule_windows")
      .withIndex("by_installationRef_and_rosterRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref),
      )
      .unique();
    if (scheduleWindow && payload.revision <= scheduleWindow.sourceRevision) {
      return { ok: false as const, code: "stale_revision" as const };
    }

    const existingMappings = await ctx.db
      .query("pika_integrated_occurrences")
      .withIndex("by_installationRef_and_rosterRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref),
      )
      .collect();
    const existingOccurrences = await Promise.all(
      existingMappings.map((mapping) => ctx.db.get(mapping.occurrenceId)),
    );
    if (existingOccurrences.some((occurrence) => occurrence === null)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }

    if (scheduleWindow) {
      await ctx.db.patch(scheduleWindow._id, {
        sourceRevision: payload.revision,
        timezone: payload.timezone,
        windowStart: payload.window_start,
        windowEnd: payload.window_end,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("pika_schedule_windows", {
        installationRef: payload.installation_ref,
        rosterRef: payload.roster_ref,
        sourceRevision: payload.revision,
        timezone: payload.timezone,
        windowStart: payload.window_start,
        windowEnd: payload.window_end,
        createdAt: now,
        updatedAt: now,
      });
    }

    const mappingByRef = new Map(
      existingMappings.map((mapping, index) => [
        mapping.occurrenceRef,
        { mapping, occurrence: existingOccurrences[index]! },
      ]),
    );
    const incomingRefs = new Set(payload.occurrences.map((occurrence) => occurrence.occurrence_ref));
    let scheduledCount = 0;
    let updatedCount = 0;
    let cancelledCount = 0;
    let preservedCount = 0;
    let eventIndex = 0;

    for (const occurrence of payload.occurrences) {
      const existing = mappingByRef.get(occurrence.occurrence_ref);
      const opensAt = Date.parse(occurrence.accepts_at);
      const closesAt = Date.parse(occurrence.stops_accepting_at);
      if (!existing) {
        const occurrenceId = await ctx.db.insert("attendance_occurrences", {
          rosterId: roster._id,
          title: occurrence.title,
          date: occurrence.date,
          opensAt,
          closesAt,
          status: "scheduled",
          sessionRevision: 1,
          createdByAppUserId: owner._id,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("pika_integrated_occurrences", {
          installationRef: payload.installation_ref,
          rosterRef: payload.roster_ref,
          occurrenceRef: occurrence.occurrence_ref,
          occurrenceId,
          sourceRevision: payload.revision,
          createdAt: now,
          updatedAt: now,
        });
        await queueAttendanceEvent(ctx, {
          installationRef: payload.installation_ref,
          rosterRef: payload.roster_ref,
          occurrenceRef: occurrence.occurrence_ref,
          correlationRef: payload.correlation_ref,
          eventType: "attendance.session.scheduled",
          sessionRevision: 1,
          metadata: {
            accepts_at: occurrence.accepts_at,
            stops_accepting_at: occurrence.stops_accepting_at,
          },
          nonce: args.nonce,
          eventIndex: eventIndex++,
          now,
        });
        await scheduleExactOccurrenceJobs(ctx, occurrenceId, opensAt, closesAt);
        scheduledCount += 1;
        continue;
      }

      await ctx.db.patch(existing.mapping._id, {
        sourceRevision: payload.revision,
        updatedAt: now,
      });
      if (existing.occurrence.status !== "scheduled") {
        preservedCount += 1;
        continue;
      }

      const changed =
        existing.occurrence.title !== occurrence.title ||
        existing.occurrence.date !== occurrence.date ||
        existing.occurrence.opensAt !== opensAt ||
        existing.occurrence.closesAt !== closesAt;
      if (!changed) {
        preservedCount += 1;
        continue;
      }

      const sessionRevision = existing.occurrence.sessionRevision + 1;
      await ctx.db.patch(existing.occurrence._id, {
        title: occurrence.title,
        date: occurrence.date,
        opensAt,
        closesAt,
        sessionRevision,
        automationPaused: undefined,
        lastAutomationErrorCode: undefined,
        updatedAt: now,
      });
      await queueAttendanceEvent(ctx, {
        installationRef: payload.installation_ref,
        rosterRef: payload.roster_ref,
        occurrenceRef: occurrence.occurrence_ref,
        correlationRef: payload.correlation_ref,
        eventType: "attendance.session.scheduled",
        sessionRevision,
        metadata: {
          accepts_at: occurrence.accepts_at,
          stops_accepting_at: occurrence.stops_accepting_at,
        },
        nonce: args.nonce,
        eventIndex: eventIndex++,
        now,
      });
      await scheduleExactOccurrenceJobs(ctx, existing.occurrence._id, opensAt, closesAt);
      updatedCount += 1;
    }

    for (const { mapping, occurrence } of mappingByRef.values()) {
      const insideWindow =
        occurrence.date >= payload.window_start && occurrence.date <= payload.window_end;
      if (incomingRefs.has(mapping.occurrenceRef) || !insideWindow) continue;

      await ctx.db.patch(mapping._id, {
        sourceRevision: payload.revision,
        updatedAt: now,
      });
      if (occurrence.status !== "scheduled") {
        preservedCount += 1;
        continue;
      }
      // Once the inclusive acceptance boundary has arrived, this occurrence
      // represents a live class even if the exact-time worker has not run yet.
      // Pika freezes the same occurrence before sending an updated snapshot.
      if (occurrence.opensAt <= now) {
        preservedCount += 1;
        continue;
      }

      const sessionRevision = occurrence.sessionRevision + 1;
      await ctx.db.patch(occurrence._id, {
        status: "cancelled",
        sessionRevision,
        automationPaused: undefined,
        updatedAt: now,
      });
      await queueAttendanceEvent(ctx, {
        installationRef: payload.installation_ref,
        rosterRef: payload.roster_ref,
        occurrenceRef: mapping.occurrenceRef,
        correlationRef: payload.correlation_ref,
        eventType: "attendance.session.cancelled",
        sessionRevision,
        metadata: { cancelled_at: new Date(now).toISOString(), reason_code: "schedule_removed" },
        nonce: args.nonce,
        eventIndex: eventIndex++,
        now,
      });
      cancelledCount += 1;
    }

    await ctx.db.insert("pika_idempotency", {
      installationRef: payload.installation_ref,
      idempotencyKey: payload.idempotency_key,
      correlationRef: payload.correlation_ref,
      messageType: "schedule.snapshot",
      bodyDigest: args.bodyDigest,
      resourceRef: payload.roster_ref,
      sourceRevision: payload.revision,
      createdCount: scheduledCount,
      updatedCount,
      deactivatedCount: cancelledCount,
      preservedCount,
      createdAt: now,
    });

    return {
      ok: true as const,
      outcome: "applied" as const,
      roster_ref: payload.roster_ref,
      revision: payload.revision,
      scheduled_count: scheduledCount,
      updated_count: updatedCount,
      cancelled_count: cancelledCount,
      preserved_count: preservedCount,
    };
  },
});

export const applySessionCommand = internalMutation({
  args: {
    nonce: v.string(),
    requestTimestamp: v.number(),
    bodyDigest: v.string(),
    payload: sessionCommandValidator,
  },
  returns: sessionCommandResultValidator,
  handler: async (ctx, args) => {
    const { payload } = args;
    if (await isPikaRosterDecommissioned(ctx, payload.installation_ref, payload.roster_ref)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const now = Date.now();
    const existingNonce = await ctx.db
      .query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce),
      )
      .unique();
    if (existingNonce) return { ok: false as const, code: "replayed_request" as const };

    await ctx.db.insert("pika_request_nonces", {
      installationRef: payload.installation_ref,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: now,
    });

    const idempotency = await ctx.db
      .query("pika_idempotency")
      .withIndex("by_installationRef_and_idempotencyKey", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("idempotencyKey", payload.idempotency_key),
      )
      .unique();
    if (idempotency) {
      if (
        idempotency.messageType !== "session.command" ||
        idempotency.bodyDigest !== args.bodyDigest
      ) {
        return { ok: false as const, code: "idempotency_conflict" as const };
      }
      if (!idempotency.sessionStatus || !idempotency.sessionRevision) {
        return { ok: false as const, code: "integration_state_invalid" as const };
      }
      return {
        ok: true as const,
        outcome: "duplicate" as const,
        occurrence_ref: idempotency.resourceRef,
        status: idempotency.sessionStatus,
        session_revision: idempotency.sessionRevision,
      };
    }

    const occurrenceMapping = await ctx.db
      .query("pika_integrated_occurrences")
      .withIndex("by_installationRef_rosterRef_occurrenceRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref)
          .eq("occurrenceRef", payload.occurrence_ref),
      )
      .unique();
    if (!occurrenceMapping) {
      return { ok: false as const, code: "occurrence_not_found" as const };
    }

    const occurrence = await ctx.db.get(occurrenceMapping.occurrenceId);
    if (!occurrence) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const actorAccess = await ensurePikaStaffAccess(ctx, {
      installationRef: payload.installation_ref,
      rosterRef: payload.roster_ref,
      principalRef: payload.actor_principal_ref,
      displayName: payload.actor_display_name,
      now,
    });
    if (!actorAccess.ok) return actorAccess;
    const actor = actorAccess.appUser;
    const access = actorAccess;

    let outcome: "applied" | "unchanged" = "applied";
    let status: "open" | "closed";
    let sessionRevision = occurrence.sessionRevision;
    if (payload.command === "open") {
      if (occurrence.closesAt <= now) {
        return { ok: false as const, code: "invalid_session_state" as const };
      }
      if (occurrence.status === "open") {
        if (!occurrence.sessionId || !(await ctx.db.get(occurrence.sessionId))) {
          return { ok: false as const, code: "integration_state_invalid" as const };
        }
        outcome = "unchanged";
        status = "open";
      } else {
        if (occurrence.status !== "scheduled") {
          return { ok: false as const, code: "invalid_session_state" as const };
        }
        const existingOpenSession = await ctx.db
          .query("sessions")
          .withIndex("by_rosterId_and_status", (q) =>
            q.eq("rosterId", occurrence.rosterId).eq("status", "open"),
          )
          .unique();
        if (existingOpenSession) {
          return { ok: false as const, code: "active_session_conflict" as const };
        }
        const participants = await ctx.db
          .query("participants")
          .withIndex("by_rosterId_active_sortKey", (q) =>
            q.eq("rosterId", occurrence.rosterId).eq("active", true),
          )
          .collect();
        if (participants.length === 0) {
          return { ok: false as const, code: "roster_empty" as const };
        }
        const linkedCount = participants.filter((participant) => participant.linkedAppUserId).length;
        const participantMode =
          linkedCount === participants.length
            ? "verified"
            : linkedCount === 0
              ? "roster_only"
              : "mixed";
        const sessionId = await openAttendanceSession(ctx, {
          roster: access.roster,
          actor: {
            actorType: "staff",
            appUserId: actor._id,
            source: "pika_integration",
          },
          date: occurrence.date,
          title: occurrence.title,
          participantMode,
          createAttendanceRecords: false,
          now,
        });
        sessionRevision += 1;
        await ctx.db.patch(occurrence._id, {
          status: "open",
          sessionId,
          sessionRevision,
          automationPaused: undefined,
          lastAutomationErrorCode: undefined,
          updatedAt: now,
        });
        await queueAttendanceEvent(ctx, {
          installationRef: payload.installation_ref,
          rosterRef: payload.roster_ref,
          occurrenceRef: payload.occurrence_ref,
          correlationRef: payload.correlation_ref,
          eventType: "attendance.session.opened",
          sessionRevision,
          metadata: { opened_at: new Date(now).toISOString(), trigger: "staff" },
          nonce: args.nonce,
          eventIndex: 0,
          now,
        });
        status = "open";
      }
    } else {
      if (occurrence.status === "closed") {
        if (!occurrence.sessionId || !(await ctx.db.get(occurrence.sessionId))) {
          return { ok: false as const, code: "integration_state_invalid" as const };
        }
        outcome = "unchanged";
        status = "closed";
      } else {
        if (occurrence.status !== "open" || !occurrence.sessionId) {
          return { ok: false as const, code: "invalid_session_state" as const };
        }
        const session = await ctx.db.get(occurrence.sessionId);
        if (!session) {
          return { ok: false as const, code: "integration_state_invalid" as const };
        }
        const finalizedChanges = await closeAttendanceSession(ctx, {
          session,
          actor: {
            actorType: "staff",
            appUserId: actor._id,
            source: "pika_integration",
          },
          finalizeAttendanceRecords: false,
          now,
        });
        sessionRevision += 1;
        await ctx.db.patch(occurrence._id, {
          status: "closed",
          sessionRevision,
          automationPaused: undefined,
          lastAutomationErrorCode: undefined,
          updatedAt: now,
        });
        await queueAttendanceEvent(ctx, {
          installationRef: payload.installation_ref,
          rosterRef: payload.roster_ref,
          occurrenceRef: payload.occurrence_ref,
          correlationRef: payload.correlation_ref,
          eventType: "attendance.session.closed",
          sessionRevision,
          metadata: { closed_at: new Date(now).toISOString(), trigger: "staff" },
          nonce: args.nonce,
          eventIndex: 0,
          now,
        });
        void finalizedChanges;
        status = "closed";
      }
    }

    await ctx.db.insert("pika_idempotency", {
      installationRef: payload.installation_ref,
      idempotencyKey: payload.idempotency_key,
      correlationRef: payload.correlation_ref,
      messageType: "session.command",
      bodyDigest: args.bodyDigest,
      resourceRef: payload.occurrence_ref,
      sourceRevision: sessionRevision,
      createdCount: 0,
      updatedCount: 0,
      deactivatedCount: 0,
      commandOutcome: outcome,
      sessionStatus: status,
      sessionRevision,
      createdAt: now,
    });

    return {
      ok: true as const,
      outcome,
      occurrence_ref: payload.occurrence_ref,
      status,
      session_revision: sessionRevision,
    };
  },
});

export const applyCheckInInvalidations = internalMutation({
  args: {
    nonce: v.string(),
    requestTimestamp: v.number(),
    bodyDigest: v.string(),
    payload: checkInInvalidateValidator,
  },
  returns: checkInInvalidateResultValidator,
  handler: async (ctx, args) => {
    const { payload } = args;
    if (await isPikaRosterDecommissioned(ctx, payload.installation_ref, payload.roster_ref)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const hasParticipantFences = await rosterHasParticipantFences(ctx, payload.installation_ref, payload.roster_ref);
    for (const invalidation of hasParticipantFences ? payload.invalidations : []) {
      const fact = await ctx.db.query("pika_check_ins").withIndex("by_installationRef_and_checkInRef", q =>
        q.eq("installationRef", payload.installation_ref).eq("checkInRef", invalidation.check_in_ref)).unique();
      if (!fact || await participantFence(ctx, payload.installation_ref, payload.roster_ref, fact.participantRef)) {
        return { ok: false as const, code: "check_in_not_found" as const };
      }
    }
    const now = Date.now();
    const existingNonce = await ctx.db
      .query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce),
      )
      .unique();
    if (existingNonce) return { ok: false as const, code: "replayed_request" as const };

    await ctx.db.insert("pika_request_nonces", {
      installationRef: payload.installation_ref,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: now,
    });

    const idempotency = await ctx.db
      .query("pika_idempotency")
      .withIndex("by_installationRef_and_idempotencyKey", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("idempotencyKey", payload.idempotency_key),
      )
      .unique();
    if (idempotency) {
      if (
        idempotency.messageType !== "check_in.invalidate" ||
        idempotency.bodyDigest !== args.bodyDigest
      ) {
        return { ok: false as const, code: "idempotency_conflict" as const };
      }
      return {
        ok: true as const,
        outcome: "duplicate" as const,
        occurrence_ref: idempotency.resourceRef,
        session_revision: idempotency.sourceRevision,
        applied_count: idempotency.createdCount,
        unchanged_count: idempotency.updatedCount,
      };
    }

    const occurrenceMapping = await ctx.db
      .query("pika_integrated_occurrences")
      .withIndex("by_installationRef_rosterRef_occurrenceRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref)
          .eq("occurrenceRef", payload.occurrence_ref),
      )
      .unique();
    if (!occurrenceMapping) {
      return { ok: false as const, code: "occurrence_not_found" as const };
    }

    const occurrence = await ctx.db.get(occurrenceMapping.occurrenceId);
    if (!occurrence) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    if (occurrence.status !== "open" && occurrence.status !== "closed") {
      return { ok: false as const, code: "invalid_session_state" as const };
    }

    const actorAccess = await ensurePikaStaffAccess(ctx, {
      installationRef: payload.installation_ref,
      rosterRef: payload.roster_ref,
      principalRef: payload.actor_principal_ref,
      displayName: payload.actor_display_name,
      now,
    });
    if (!actorAccess.ok) return actorAccess;
    const actor = actorAccess.appUser;

    const resolvedInvalidations = await Promise.all(
      payload.invalidations.map(async (invalidation) => {
        const checkIn = await ctx.db
          .query("pika_check_ins")
          .withIndex("by_installationRef_and_checkInRef", (q) =>
            q
              .eq("installationRef", payload.installation_ref)
              .eq("checkInRef", invalidation.check_in_ref),
          )
          .unique();
        return checkIn?.occurrenceId === occurrence._id &&
          checkIn.rosterRef === payload.roster_ref
          ? { invalidation, checkIn }
          : null;
      }),
    );
    if (resolvedInvalidations.some((resolved) => resolved === null)) {
      return { ok: false as const, code: "check_in_not_found" as const };
    }

    let appliedCount = 0;
    let unchangedCount = 0;
    let eventIndex = 0;
    for (const resolved of resolvedInvalidations) {
      if (!resolved) continue;
      if (resolved.checkIn.invalidatedAt !== undefined) {
        unchangedCount += 1;
        continue;
      }
      const checkInRevision = resolved.checkIn.checkInRevision + 1;
      await ctx.db.patch(resolved.checkIn._id, {
        checkInRevision,
        invalidatedAt: now,
        invalidatedByAppUserId: actor._id,
        reasonCode: resolved.invalidation.reason_code,
        updatedAt: now,
      });
      await queueAttendanceEvent(ctx, {
        installationRef: payload.installation_ref,
        rosterRef: payload.roster_ref,
        occurrenceRef: payload.occurrence_ref,
        correlationRef: payload.correlation_ref,
        eventType: "attendance.check_in.invalidated",
        sessionRevision: occurrence.sessionRevision,
        metadata: {
          check_in_ref: resolved.checkIn.checkInRef,
          participant_ref: resolved.checkIn.participantRef,
          check_in_revision: checkInRevision,
          accepted_at: new Date(resolved.checkIn.acceptedAt).toISOString(),
          invalidated_at: new Date(now).toISOString(),
          ...(resolved.invalidation.reason_code
            ? { reason_code: resolved.invalidation.reason_code }
            : {}),
        },
        nonce: args.nonce,
        eventIndex: eventIndex++,
        now,
      });
      appliedCount += 1;
    }

    await ctx.db.insert("pika_idempotency", {
      installationRef: payload.installation_ref,
      idempotencyKey: payload.idempotency_key,
      correlationRef: payload.correlation_ref,
      messageType: "check_in.invalidate",
      bodyDigest: args.bodyDigest,
      resourceRef: payload.occurrence_ref,
      sourceRevision: occurrence.sessionRevision,
      createdCount: appliedCount,
      updatedCount: unchangedCount,
      deactivatedCount: 0,
      createdAt: now,
    });

    return {
      ok: true as const,
      outcome: "applied" as const,
      occurrence_ref: payload.occurrence_ref,
      session_revision: occurrence.sessionRevision,
      applied_count: appliedCount,
      unchanged_count: unchangedCount,
    };
  },
});

export const applyStudentCheckIn = internalMutation({
  args: {
    nonce: v.string(),
    requestTimestamp: v.number(),
    bodyDigest: v.string(),
    payload: studentCheckInValidator,
  },
  returns: studentCheckInResultValidator,
  handler: async (ctx, args) => {
    const { payload } = args;
    if (await isPikaRosterDecommissioned(ctx, payload.installation_ref, payload.roster_ref)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const rosterScope = await ctx.db.query("pika_integrated_rosters")
      .withIndex("by_installationRef_and_rosterRef", q => q.eq("installationRef", payload.installation_ref).eq("rosterRef", payload.roster_ref)).unique();
    const actorIdentity = await ctx.db.query("auth_identities")
      .withIndex("by_provider_and_providerSubject", q => q.eq("provider", "pika").eq("providerSubject", `pika:${payload.installation_ref}:${payload.actor_principal_ref}`)).unique();
    if (payload.participant_ref && await participantFence(ctx, payload.installation_ref, payload.roster_ref, payload.participant_ref)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    if (actorIdentity && rosterScope) {
      const fences = await subjectFences(ctx, rosterScope.rosterId, actorIdentity.appUserId);
      if (fences.some(f => f.state !== "deleted") || (fences.length && !payload.participant_ref)) {
        return { ok: false as const, code: "integration_state_invalid" as const };
      }
    }
    // Generation binding also precedes cache replay. An opaque ref cannot select
    // another actor's membership, even with a previously valid idempotency key.
    if (payload.participant_ref) {
      const mapping = await ctx.db.query("pika_integrated_participants")
        .withIndex("by_installationRef_rosterRef_participantRef", q => q.eq("installationRef", payload.installation_ref).eq("rosterRef", payload.roster_ref).eq("participantRef", payload.participant_ref!)).unique();
      const participant = mapping ? await ctx.db.get(mapping.participantId) : null;
      if (!participant || !participant.active || participant.linkedAppUserId !== actorIdentity?.appUserId || !actorIdentity) {
        return { ok: false as const, code: "integration_state_invalid" as const };
      }
    }
    const now = Date.now();
    const existingNonce = await ctx.db
      .query("pika_request_nonces")
      .withIndex("by_installationRef_and_nonce", (q) =>
        q.eq("installationRef", payload.installation_ref).eq("nonce", args.nonce),
      )
      .unique();
    if (existingNonce) return { ok: false as const, code: "replayed_request" as const };
    await ctx.db.insert("pika_request_nonces", {
      installationRef: payload.installation_ref,
      nonce: args.nonce,
      requestTimestamp: args.requestTimestamp,
      createdAt: now,
    });

    const idempotency = await ctx.db
      .query("pika_idempotency")
      .withIndex("by_installationRef_and_idempotencyKey", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("idempotencyKey", payload.idempotency_key),
      )
      .unique();
    if (idempotency) {
      if (
        idempotency.messageType !== "student_check_in" ||
        idempotency.bodyDigest !== args.bodyDigest ||
        !idempotency.resultJson
      ) {
        return { ok: false as const, code: "idempotency_conflict" as const };
      }
      const stored = JSON.parse(idempotency.resultJson) as V1StudentCheckInResult;
      if (stored.check_in && await participantFence(ctx, payload.installation_ref, payload.roster_ref, stored.check_in.participant_ref)) {
        return { ok: false as const, code: "integration_state_invalid" as const };
      }
      return { ...stored, outcome: "duplicate" as const };
    }

    const occurrenceMapping = await ctx.db
      .query("pika_integrated_occurrences")
      .withIndex("by_installationRef_rosterRef_occurrenceRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref)
          .eq("occurrenceRef", payload.occurrence_ref),
      )
      .unique();
    if (!occurrenceMapping) {
      return { ok: false as const, code: "occurrence_not_found" as const };
    }
    let occurrence = await ctx.db.get(occurrenceMapping.occurrenceId);
    if (!occurrence) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    if (occurrence.status === "scheduled" && occurrence.opensAt <= now) {
      const opening = await openDuePikaOccurrence(ctx, occurrence, occurrenceMapping, now);
      occurrence = opening.occurrence;
    }
    if (!occurrence.sessionId || (occurrence.status !== "open" && occurrence.status !== "closed")) {
      return { ok: false as const, code: "invalid_session_state" as const };
    }
    const session = await ctx.db.get(occurrence.sessionId);
    if (!session || session.rosterId !== occurrence.rosterId) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }

    const rosterMapping = await ctx.db
      .query("pika_integrated_rosters")
      .withIndex("by_installationRef_and_rosterRef", (q) =>
        q
          .eq("installationRef", payload.installation_ref)
          .eq("rosterRef", payload.roster_ref),
      )
      .unique();
    if (!rosterMapping?.tenantRef || rosterMapping.rosterId !== occurrence.rosterId) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }

    let result: V1StudentCheckInResult;
    if (payload.check_in_token !== session.checkInToken) {
      result = {
        ok: true,
        schema_version: 1,
        outcome: "rejected",
        result_code: "invalid_check_in_token",
        occurrence_ref: payload.occurrence_ref,
        session_revision: occurrence.sessionRevision,
      };
    } else if (occurrence.status !== "open" || occurrence.closesAt <= now) {
      result = {
        ok: true,
        schema_version: 1,
        outcome: "rejected",
        result_code: "session_not_accepting",
        occurrence_ref: payload.occurrence_ref,
        session_revision: occurrence.sessionRevision,
      };
    } else {
      const principal = await ensurePikaPrincipal(ctx, {
        installationRef: payload.installation_ref,
        tenantRef: rosterMapping.tenantRef,
        principalRef: payload.actor_principal_ref,
        displayName: payload.actor_display_name,
        requestedRole: "student",
        now,
      });
      if (!principal.ok) {
        result = {
          ok: true,
          schema_version: 1,
          outcome: "rejected",
          result_code: "not_authorized",
          occurrence_ref: payload.occurrence_ref,
          session_revision: occurrence.sessionRevision,
        };
      } else {
        const participants = await ctx.db
          .query("participants")
          .withIndex("by_rosterId_and_linkedAppUserId", (q) =>
            q
              .eq("rosterId", occurrence.rosterId)
              .eq("linkedAppUserId", principal.appUser._id),
          )
          .collect();
        const activeParticipants = participants.filter(
          (participant) => participant.active && participant.linkStatus === "linked",
        );
        if (activeParticipants.length > 1) {
          return { ok: false as const, code: "integration_state_invalid" as const };
        }
        const participant = activeParticipants[0];
        if (!participant) {
          result = {
            ok: true,
            schema_version: 1,
            outcome: "rejected",
            result_code: "not_on_roster",
            occurrence_ref: payload.occurrence_ref,
            session_revision: occurrence.sessionRevision,
          };
        } else {
          const participantMapping = await ctx.db
            .query("pika_integrated_participants")
            .withIndex("by_participantId", (q) => q.eq("participantId", participant._id))
            .unique();
          if (
            !participantMapping ||
            participantMapping.installationRef !== payload.installation_ref ||
            participantMapping.rosterRef !== payload.roster_ref
          ) {
            return { ok: false as const, code: "integration_state_invalid" as const };
          }

          if (await participantIdFence(ctx, participant._id) ||
            (payload.participant_ref && payload.participant_ref !== participantMapping.participantRef)) {
            return { ok: false as const, code: "integration_state_invalid" as const };
          }
          const checkIns = await ctx.db
            .query("pika_check_ins")
            .withIndex("by_occurrenceId_and_participantId", (q) =>
              q.eq("occurrenceId", occurrence._id).eq("participantId", participant._id),
            )
            .collect();
          const activeCheckIns = checkIns.filter((checkIn) => checkIn.invalidatedAt === undefined);
          if (activeCheckIns.length > 1) {
            return { ok: false as const, code: "integration_state_invalid" as const };
          }
          const existingCheckIn = activeCheckIns[0];
          if (existingCheckIn) {
            const checkIn: V1CheckInFact = {
              check_in_ref: existingCheckIn.checkInRef,
              participant_ref: existingCheckIn.participantRef,
              check_in_revision: existingCheckIn.checkInRevision,
              accepted_at: new Date(existingCheckIn.acceptedAt).toISOString(),
            };
            result = {
              ok: true,
              schema_version: 1,
              outcome: "duplicate",
              result_code: "already_checked_in",
              occurrence_ref: payload.occurrence_ref,
              session_revision: occurrence.sessionRevision,
              check_in: checkIn,
            };
          } else {
            const digest = await sha256Hex([
              payload.installation_ref,
              payload.occurrence_ref,
              participantMapping.participantRef,
              payload.idempotency_key,
            ].join("\n"));
            const checkInRef = `check_in_${digest}`;
            const checkIn: V1CheckInFact = {
              check_in_ref: checkInRef,
              participant_ref: participantMapping.participantRef,
              check_in_revision: 1,
              accepted_at: new Date(now).toISOString(),
            };
            await ctx.db.insert("pika_check_ins", {
              installationRef: payload.installation_ref,
              rosterRef: payload.roster_ref,
              occurrenceRef: payload.occurrence_ref,
              occurrenceId: occurrence._id,
              participantRef: participantMapping.participantRef,
              participantId: participant._id,
              checkInRef,
              checkInRevision: 1,
              acceptedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            await queueAttendanceEvent(ctx, {
              installationRef: payload.installation_ref,
              rosterRef: payload.roster_ref,
              occurrenceRef: payload.occurrence_ref,
              correlationRef: payload.correlation_ref,
              eventType: "attendance.check_in.accepted",
              sessionRevision: occurrence.sessionRevision,
              metadata: {
                check_in_ref: checkInRef,
                participant_ref: participantMapping.participantRef,
                check_in_revision: 1,
                accepted_at: checkIn.accepted_at,
              },
              nonce: args.nonce,
              eventIndex: 0,
              now,
            });
            result = {
              ok: true,
              schema_version: 1,
              outcome: "applied",
              result_code: "check_in_accepted",
              occurrence_ref: payload.occurrence_ref,
              session_revision: occurrence.sessionRevision,
              check_in: checkIn,
            };
          }
        }
      }
    }

    await ctx.db.insert("pika_idempotency", {
      installationRef: payload.installation_ref,
      idempotencyKey: payload.idempotency_key,
      correlationRef: payload.correlation_ref,
      messageType: "student_check_in",
      bodyDigest: args.bodyDigest,
      resourceRef: payload.occurrence_ref,
      sourceRevision: occurrence.sessionRevision,
      createdCount: result.outcome === "applied" ? 1 : 0,
      updatedCount: 0,
      deactivatedCount: 0,
      sessionStatus: session.status,
      sessionRevision: occurrence.sessionRevision,
      resultJson: JSON.stringify(result),
      createdAt: now,
    });
    return result;
  },
});

export const getSessionSnapshot = internalQuery({
  args: {
    installationRef: v.string(),
    occurrenceRef: v.string(),
  },
  returns: sessionSnapshotValidator,
  handler: async (ctx, args) => {
    const occurrenceMapping = await ctx.db
      .query("pika_integrated_occurrences")
      .withIndex("by_installationRef_and_occurrenceRef", (q) =>
        q
          .eq("installationRef", args.installationRef)
          .eq("occurrenceRef", args.occurrenceRef),
      )
      .unique();
    if (!occurrenceMapping) return null;
    if (await isPikaRosterDecommissioned(ctx, args.installationRef, occurrenceMapping.rosterRef)) return null;
    const occurrence = await ctx.db.get(occurrenceMapping.occurrenceId);
    if (!occurrence) throw new Error("Attendance integration state is invalid.");

    const storedCheckIns = await ctx.db
      .query("pika_check_ins")
      .withIndex("by_occurrenceId", (q) => q.eq("occurrenceId", occurrence._id))
      .collect();
    const visibleCheckIns = [];
    for (const checkIn of storedCheckIns) {
      if (!await participantFence(ctx, args.installationRef, occurrenceMapping.rosterRef, checkIn.participantRef)) visibleCheckIns.push(checkIn);
    }
    const checkIns = visibleCheckIns
      .sort((left, right) =>
        left.acceptedAt - right.acceptedAt || left.checkInRef.localeCompare(right.checkInRef),
      )
      .map((checkIn) => ({
        check_in_ref: checkIn.checkInRef,
        participant_ref: checkIn.participantRef,
        check_in_revision: checkIn.checkInRevision,
        accepted_at: new Date(checkIn.acceptedAt).toISOString(),
        ...(checkIn.invalidatedAt !== undefined
          ? { invalidated_at: new Date(checkIn.invalidatedAt).toISOString() }
          : {}),
        ...(checkIn.reasonCode ? { reason_code: checkIn.reasonCode } : {}),
      }));

    return {
      schema_version: 1 as const,
      occurrence_ref: args.occurrenceRef,
      roster_ref: occurrenceMapping.rosterRef,
      session_revision: occurrence.sessionRevision,
      status: occurrence.status,
      accepts_at: new Date(occurrence.opensAt).toISOString(),
      stops_accepting_at: new Date(occurrence.closesAt).toISOString(),
      check_ins: checkIns,
    };
  },
});

export const getCheckInPresentation = internalMutation({
  args: {
    installationRef: v.string(),
    rosterRef: v.string(),
    occurrenceRef: v.string(),
    actorPrincipalRef: v.string(),
    actorDisplayName: v.string(),
    now: v.number(),
  },
  returns: checkInPresentationResultValidator,
  handler: async (ctx, args) => {
    if (await isPikaRosterDecommissioned(ctx, args.installationRef, args.rosterRef)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const occurrenceMapping = await ctx.db
      .query("pika_integrated_occurrences")
      .withIndex("by_installationRef_and_occurrenceRef", (q) =>
        q
          .eq("installationRef", args.installationRef)
          .eq("occurrenceRef", args.occurrenceRef),
      )
      .unique();
    if (!occurrenceMapping || occurrenceMapping.rosterRef !== args.rosterRef) {
      return { ok: false as const, code: "occurrence_not_found" as const };
    }

    let occurrence = await ctx.db.get(occurrenceMapping.occurrenceId);
    if (!occurrence) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    const actorAccess = await ensurePikaStaffAccess(ctx, {
      installationRef: args.installationRef,
      rosterRef: args.rosterRef,
      principalRef: args.actorPrincipalRef,
      displayName: args.actorDisplayName,
      now: args.now,
    });
    if (!actorAccess.ok) return actorAccess;
    if (occurrence.status === "scheduled" && occurrence.opensAt <= args.now) {
      const opening = await openDuePikaOccurrence(ctx, occurrence, occurrenceMapping, args.now);
      occurrence = opening.occurrence;
    }
    if (
      occurrence.status !== "open" ||
      !occurrence.sessionId ||
      occurrence.closesAt <= args.now
    ) {
      return { ok: false as const, code: "invalid_session_state" as const };
    }

    const session = await ctx.db.get(occurrence.sessionId);
    if (!session || session.rosterId !== occurrence.rosterId) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }
    if (session.status !== "open") {
      return { ok: false as const, code: "invalid_session_state" as const };
    }
    if (!/^[A-Za-z0-9._~-]{20,128}$/.test(session.checkInToken)) {
      return { ok: false as const, code: "integration_state_invalid" as const };
    }

    return {
      ok: true as const,
      schema_version: 1 as const,
      occurrence_ref: args.occurrenceRef,
      session_revision: occurrence.sessionRevision,
      check_in_path: `/check-in/${session.checkInToken}`,
      valid_until: new Date(occurrence.closesAt).toISOString(),
    };
  },
});

const emptyAutomationResult = () => ({
  opened: 0,
  closed: 0,
  cancelled: 0,
  deferred: 0,
});

const automationResultValidator = v.object({
  opened: v.number(),
  closed: v.number(),
  cancelled: v.number(),
  deferred: v.number(),
});

async function openDuePikaOccurrence(
  ctx: MutationCtx,
  occurrence: Doc<"attendance_occurrences">,
  mapping: Doc<"pika_integrated_occurrences">,
  now: number,
) {
  await assertRosterNotDecommissioned(ctx, occurrence.rosterId);
  if (occurrence.status !== "scheduled" || occurrence.opensAt > now) {
    return { outcome: "not_due" as const, occurrence };
  }
  const correlationRef =
    `automation_${mapping.occurrenceRef.slice(0, 90)}_${occurrence.sessionRevision}`;
  const automationNonce =
    `automation_${mapping.occurrenceRef}_${occurrence.sessionRevision}`;
  if (occurrence.closesAt <= now) {
    const sessionRevision = occurrence.sessionRevision + 1;
    const cancelledOccurrence = {
      ...occurrence,
      status: "cancelled" as const,
      sessionRevision,
      lastAutomationAttemptAt: now,
      lastAutomationErrorCode: undefined,
      updatedAt: now,
    };
    await ctx.db.patch(occurrence._id, cancelledOccurrence);
    await queueAttendanceEvent(ctx, {
      installationRef: mapping.installationRef,
      rosterRef: mapping.rosterRef,
      occurrenceRef: mapping.occurrenceRef,
      correlationRef,
      eventType: "attendance.session.cancelled",
      sessionRevision,
      metadata: { cancelled_at: new Date(now).toISOString(), reason_code: "missed_window" },
      nonce: automationNonce,
      eventIndex: 0,
      now,
    });
    return { outcome: "cancelled" as const, occurrence: cancelledOccurrence };
  }

  const [roster, owner, participants, existingOpenSession] = await Promise.all([
    ctx.db.get(occurrence.rosterId),
    ctx.db.get(occurrence.createdByAppUserId),
    ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) =>
        q.eq("rosterId", occurrence.rosterId).eq("active", true),
      )
      .collect(),
    ctx.db
      .query("sessions")
      .withIndex("by_rosterId_and_status", (q) =>
        q.eq("rosterId", occurrence.rosterId).eq("status", "open"),
      )
      .unique(),
  ]);
  const errorCode =
    !roster || !owner || owner.status !== "active"
      ? "owner_unavailable"
      : participants.length === 0
        ? "roster_empty"
        : existingOpenSession
          ? "active_session_conflict"
          : null;
  if (errorCode || !roster || !owner) {
    await ctx.db.patch(occurrence._id, {
      lastAutomationAttemptAt: now,
      lastAutomationErrorCode: errorCode ?? "automation_failed",
      updatedAt: now,
    });
    return { outcome: "deferred" as const, occurrence };
  }

  const linkedCount = participants.filter((participant) => participant.linkedAppUserId).length;
  const participantMode =
    linkedCount === participants.length
      ? "verified"
      : linkedCount === 0
        ? "roster_only"
        : "mixed";
  const sessionId = await openAttendanceSession(ctx, {
    roster,
    actor: {
      actorType: "system",
      appUserId: owner._id,
      source: "recovery",
    },
    date: occurrence.date,
    title: occurrence.title,
    participantMode,
    createAttendanceRecords: false,
    now,
  });
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Opened attendance session is unavailable.");
  const sessionRevision = occurrence.sessionRevision + 1;
  const openedOccurrence = {
    ...occurrence,
    status: "open" as const,
    sessionId,
    sessionRevision,
    lastAutomationAttemptAt: now,
    lastAutomationErrorCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(occurrence._id, openedOccurrence);
  await queueAttendanceEvent(ctx, {
    installationRef: mapping.installationRef,
    rosterRef: mapping.rosterRef,
    occurrenceRef: mapping.occurrenceRef,
    correlationRef,
    eventType: "attendance.session.opened",
    sessionRevision,
    metadata: { opened_at: new Date(now).toISOString(), trigger: "schedule" },
    nonce: automationNonce,
    eventIndex: 0,
    now,
  });
  return { outcome: "opened" as const, occurrence: openedOccurrence, session };
}

export const processOccurrenceAutomation = internalMutation({
  args: {
    occurrenceId: v.id("attendance_occurrences"),
    now: v.optional(v.number()),
  },
  returns: automationResultValidator,
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const occurrence = await ctx.db.get(args.occurrenceId);
    if (!occurrence || occurrence.automationPaused) return emptyAutomationResult();
    const roster = await ctx.db.get(occurrence.rosterId);
    if (!roster || roster.pikaDecommissioned) return emptyAutomationResult();

    const dueToOpen = occurrence.status === "scheduled" && occurrence.opensAt <= now;
    const dueToClose = occurrence.status === "open" && occurrence.closesAt <= now;
    if (!dueToOpen && !dueToClose) return emptyAutomationResult();

    if (!isPikaAttendanceIntegrationEnabled()) {
      await ctx.db.patch(occurrence._id, {
        automationPaused: true,
        lastAutomationAttemptAt: now,
        lastAutomationErrorCode: "integration_paused",
        updatedAt: now,
      });
      return { ...emptyAutomationResult(), deferred: 1 };
    }

    if (dueToOpen) {
      const mapping = await ctx.db
        .query("pika_integrated_occurrences")
        .withIndex("by_occurrenceId", (q) => q.eq("occurrenceId", occurrence._id))
        .unique();
      if (!mapping) {
        await ctx.db.patch(occurrence._id, {
          lastAutomationAttemptAt: now,
          lastAutomationErrorCode: "integration_mapping_missing",
          updatedAt: now,
        });
        return { ...emptyAutomationResult(), deferred: 1 };
      }
      const result = await openDuePikaOccurrence(ctx, occurrence, mapping, now);
      if (result.outcome === "opened") return { ...emptyAutomationResult(), opened: 1 };
      if (result.outcome === "cancelled") return { ...emptyAutomationResult(), cancelled: 1 };
      return { ...emptyAutomationResult(), deferred: 1 };
    }

    const [mapping, session] = await Promise.all([
      ctx.db
        .query("pika_integrated_occurrences")
        .withIndex("by_occurrenceId", (q) => q.eq("occurrenceId", occurrence._id))
        .unique(),
      occurrence.sessionId ? ctx.db.get(occurrence.sessionId) : Promise.resolve(null),
    ]);
    if (!session) {
      await ctx.db.patch(occurrence._id, {
        lastAutomationAttemptAt: now,
        lastAutomationErrorCode: "session_missing",
        updatedAt: now,
      });
      return { ...emptyAutomationResult(), deferred: 1 };
    }

    const finalizedChanges = await closeAttendanceSession(ctx, {
      session,
      actor: {
        actorType: "system",
        appUserId: occurrence.createdByAppUserId,
        source: "recovery",
      },
      finalizeAttendanceRecords: false,
      now,
    });
    const sessionRevision = occurrence.sessionRevision + 1;
    await ctx.db.patch(occurrence._id, {
      status: "closed",
      sessionRevision,
      lastAutomationAttemptAt: now,
      lastAutomationErrorCode: mapping ? undefined : "integration_mapping_missing",
      updatedAt: now,
    });
    if (mapping) {
      const correlationRef =
        `automation_${mapping.occurrenceRef.slice(0, 90)}_${occurrence.sessionRevision}`;
      const automationNonce =
        `automation_${mapping.occurrenceRef}_${occurrence.sessionRevision}`;
      await queueAttendanceEvent(ctx, {
        installationRef: mapping.installationRef,
        rosterRef: mapping.rosterRef,
        occurrenceRef: mapping.occurrenceRef,
        correlationRef,
        eventType: "attendance.session.closed",
        sessionRevision,
        metadata: { closed_at: new Date(now).toISOString(), trigger: "schedule" },
        nonce: automationNonce,
        eventIndex: 0,
        now,
      });
      void finalizedChanges;
    }
    return { ...emptyAutomationResult(), closed: 1 };
  },
});

const automationPhaseValidator = v.union(v.literal("open"), v.literal("close"));

async function dispatchDueOccurrencePage(
  ctx: MutationCtx,
  args: { now: number; phase: "open" | "close"; cursor: string | null },
) {
  const page = args.phase === "open"
    ? await ctx.db
      .query("attendance_occurrences")
      .withIndex("by_status_and_automationPaused_and_opensAt", (q) =>
        q.eq("status", "scheduled").eq("automationPaused", undefined).lte("opensAt", args.now),
      )
      .paginate({ cursor: args.cursor, numItems: 20 })
    : await ctx.db
      .query("attendance_occurrences")
      .withIndex("by_status_and_automationPaused_and_closesAt", (q) =>
        q.eq("status", "open").eq("automationPaused", undefined).lte("closesAt", args.now),
      )
      .paginate({ cursor: args.cursor, numItems: 20 });

  // Enqueue the continuation before workers can move documents out of this
  // index range. Duplicate recovery sweeps are safe because each worker
  // re-reads and validates the occurrence state in its own transaction.
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.pikaIntegration.processDueOccurrencePage, {
      now: args.now,
      phase: args.phase,
      cursor: page.continueCursor,
    });
  }
  for (const occurrence of page.page) {
    await ctx.scheduler.runAfter(0, internal.pikaIntegration.processOccurrenceAutomation, {
      occurrenceId: occurrence._id,
      now: args.now,
    });
  }
  return { queued: page.page.length, hasMore: !page.isDone };
}

export const processDueOccurrencePage = internalMutation({
  args: {
    now: v.number(),
    phase: automationPhaseValidator,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    queued: v.number(),
    hasMore: v.boolean(),
  }),
  handler: (ctx, args) => dispatchDueOccurrencePage(ctx, args),
});
