import { assertParticipantNotErased, participantIdFence, assertNativeSubjectNotErased } from "./pikaParticipantFence";
import { createShareToken } from "../lib/session-links";
import { assertRosterNotDecommissioned } from "./pikaDecommissionFence";
import { normalizeSchoolEmail, normalizeStudentId } from "./domain";
import type { Doc, Id } from "./model";
import {
  applyParticipantLink,
  resolveParticipantLink,
  syncParticipantAttendanceRecords,
} from "./participantLinks";
import type { MutationCtx } from "./server";

export type VerifiedActorContext =
  | {
      actorType: "staff";
      appUserId: Id<"app_users">;
      source: "standalone_authkit" | "pika_integration";
    }
  | {
      actorType: "staff";
      source: "standalone_share_token";
      appUserId?: undefined;
    }
  | {
      actorType: "student";
      appUserId: Id<"app_users">;
      source: "standalone_authkit" | "pika_integration";
    }
  | {
      actorType: "system";
      appUserId: Id<"app_users">;
      source: "schedule" | "recovery";
    };

export type AttendanceStatus = "unmarked" | "present" | "late" | "absent";

export type StudentCheckInEngineResult = {
  code:
    | "present_marked"
    | "already_present"
    | "already_late"
    | "review_needed"
    | "not_on_roster"
    | "session_closed"
    | "not_authorized";
  occurredAt: number;
  attendanceStatus?: AttendanceStatus;
  participantId?: Id<"participants">;
  displayName?: string;
  studentId?: string;
  recordRevision?: number;
  fromStatus?: AttendanceStatus;
  changed: boolean;
};

type ParticipantDoc = Doc<"participants">;

function serializeEventMetadata(metadata?: Record<string, string | undefined>) {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length > 0
    ? (Object.fromEntries(entries) as Record<string, string>)
    : undefined;
}

async function insertAttendanceEvent(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"sessions">;
    participantId?: Id<"participants">;
    actor: VerifiedActorContext;
    auditActorType?: "student" | "staff" | "system";
    eventType: "student_check_in" | "manual_mark" | "session_finalize";
    fromStatus?: AttendanceStatus;
    toStatus?: AttendanceStatus;
    result: "applied" | "duplicate" | "blocked" | "review_needed";
    reasonCode?: string;
    metadata?: Record<string, string | undefined>;
    now: number;
  },
) {
  await ctx.db.insert("attendance_events", {
    sessionId: args.sessionId,
    participantId: args.participantId,
    actorAppUserId: args.actor.appUserId,
    actorType: args.auditActorType ?? args.actor.actorType,
    eventType: args.eventType,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    result: args.result,
    reasonCode: args.reasonCode,
    metadata: serializeEventMetadata(args.metadata),
    createdAt: args.now,
  });
}

async function tokenExists(ctx: MutationCtx, token: string) {
  return Boolean(
    await ctx.db
      .query("sessions")
      .withIndex("by_checkInToken", (q) => q.eq("checkInToken", token))
      .unique(),
  );
}

async function createUniqueCheckInToken(ctx: MutationCtx) {
  let checkInToken = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    checkInToken = createShareToken();
    if (!(await tokenExists(ctx, checkInToken))) return checkInToken;
  }
  if (!checkInToken || (await tokenExists(ctx, checkInToken))) {
    throw new Error("Could not generate check-in link. Please try again.");
  }
  return checkInToken;
}

function requireSessionManagerActor(
  actor: VerifiedActorContext,
): asserts actor is Exclude<VerifiedActorContext, { actorType: "student" } | { source: "standalone_share_token" }> {
  if (actor.actorType === "student" || actor.source === "standalone_share_token") {
    throw new Error("Students cannot manage attendance sessions.");
  }
}

export async function openAttendanceSession(
  ctx: MutationCtx,
  args: {
    roster: Doc<"rosters">;
    actor: VerifiedActorContext;
    date: string;
    title?: string;
    participantMode?: "verified" | "roster_only" | "mixed";
    createAttendanceRecords?: boolean;
    now?: number;
  },
) {
  requireSessionManagerActor(args.actor);
  await assertRosterNotDecommissioned(ctx, args.roster._id);
  const existingOpenSession = await ctx.db
    .query("sessions")
    .withIndex("by_rosterId_and_status", (q) =>
      q.eq("rosterId", args.roster._id).eq("status", "open"),
    )
    .unique();
  if (existingOpenSession) throw new Error("This roster already has an active session.");

  const participants = await ctx.db
    .query("participants")
    .withIndex("by_rosterId_active_sortKey", (q) =>
      q.eq("rosterId", args.roster._id).eq("active", true),
    )
    .collect();
  if (participants.length === 0) throw new Error("Roster has no active students.");

  const createdAt = args.now ?? Date.now();
  const sessionId = await ctx.db.insert("sessions", {
    rosterId: args.roster._id,
    title: args.title ?? args.roster.name,
    date: args.date,
    sessionType: "recurring_class",
    participantMode: args.participantMode ?? "verified",
    status: "open",
    createdByAppUserId: args.actor.appUserId,
    checkInToken: await createUniqueCheckInToken(ctx),
    createdAt,
    updatedAt: createdAt,
    openedAt: createdAt,
  });

  if (args.createAttendanceRecords !== false) {
    for (const participant of participants) {
      if (await participantIdFence(ctx, participant._id)) continue;
      await ctx.db.insert("attendance_records", {
        sessionId,
        participantId: participant._id,
        linkedAppUserId: participant.linkedAppUserId,
        status: "unmarked",
        recordRevision: 0,
        modifiedAt: createdAt,
      });
    }
  }
  return sessionId;
}

export async function closeAttendanceSession(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    actor: VerifiedActorContext;
    finalizeAttendanceRecords?: boolean;
    now?: number;
  },
) {
  requireSessionManagerActor(args.actor);
  await assertRosterNotDecommissioned(ctx, args.session.rosterId);
  if (args.session.status === "closed") return [];

  const attendanceRows = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", args.session._id))
    .collect();
  const now = args.now ?? Date.now();
  const changes: Array<{
    participantId: Id<"participants">;
    fromStatus: "unmarked";
    toStatus: "absent";
    recordRevision: number;
  }> = [];

  for (const attendanceRow of args.finalizeAttendanceRecords === false ? [] : attendanceRows) {
    if (attendanceRow.status !== "unmarked" || await participantIdFence(ctx, attendanceRow.participantId)) continue;
    const recordRevision = (attendanceRow.recordRevision ?? 0) + 1;
    await ctx.db.patch(attendanceRow._id, {
      status: "absent",
      recordRevision,
      source: "system_finalize",
      modifiedAt: now,
      modifiedByAppUserId: args.actor.appUserId,
    });
    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      participantId: attendanceRow.participantId,
      actor: args.actor,
      auditActorType: "system",
      eventType: "session_finalize",
      fromStatus: "unmarked",
      toStatus: "absent",
      result: "applied",
      now,
    });
    changes.push({
      participantId: attendanceRow.participantId,
      fromStatus: "unmarked",
      toStatus: "absent",
      recordRevision,
    });
  }

  await ctx.db.patch(args.session._id, {
    status: "closed",
    closedAt: now,
    closedByAppUserId: args.actor.appUserId,
    updatedAt: now,
  });
  return changes;
}

export async function applyAttendanceMark(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    participantId: Id<"participants">;
    nextStatus: AttendanceStatus;
    actor: VerifiedActorContext;
    reasonCode?: string;
    now?: number;
  },
) {
  if (args.actor.actorType !== "staff") throw new Error("Only staff can mark attendance.");
  await assertRosterNotDecommissioned(ctx, args.session.rosterId);
  await assertParticipantNotErased(ctx, args.participantId);
  const participant = await ctx.db.get(args.participantId);
  if (!participant || participant.rosterId !== args.session.rosterId) {
    throw new Error("Student not found in this session.");
  }
  const existingAttendance = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId_participantId", (q) =>
      q.eq("sessionId", args.session._id).eq("participantId", participant._id),
    )
    .unique();
  const now = args.now ?? Date.now();
  const fromStatus = existingAttendance?.status ?? "unmarked";
  const recordRevision = (existingAttendance?.recordRevision ?? 0) + 1;

  if (existingAttendance) {
    await ctx.db.patch(existingAttendance._id, {
      linkedAppUserId: participant.linkedAppUserId,
      status: args.nextStatus,
      recordRevision,
      source: "staff_manual",
      firstMarkedAt:
        args.nextStatus === "unmarked"
          ? existingAttendance.firstMarkedAt
          : existingAttendance.firstMarkedAt ?? now,
      lastMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
      modifiedAt: now,
      modifiedByAppUserId: args.actor.appUserId,
    });
  } else {
    await ctx.db.insert("attendance_records", {
      sessionId: args.session._id,
      participantId: participant._id,
      linkedAppUserId: participant.linkedAppUserId,
      status: args.nextStatus,
      recordRevision,
      source: "staff_manual",
      firstMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
      lastMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
      modifiedAt: now,
      modifiedByAppUserId: args.actor.appUserId,
    });
  }

  await insertAttendanceEvent(ctx, {
    sessionId: args.session._id,
    participantId: participant._id,
    actor: args.actor,
    eventType: "manual_mark",
    fromStatus,
    toStatus: args.nextStatus,
    result: "applied",
    reasonCode: args.reasonCode,
    now,
  });
  return { fromStatus, toStatus: args.nextStatus, recordRevision };
}

async function findParticipantForStudent(
  ctx: MutationCtx,
  args: {
    rosterId: Id<"rosters">;
    organizationId: Id<"organizations">;
    appUserId: Id<"app_users">;
    membership: Doc<"organization_memberships">;
  },
) {
  const linkedParticipants = await ctx.db
    .query("participants")
    .withIndex("by_rosterId_and_linkedAppUserId", (q) =>
      q.eq("rosterId", args.rosterId).eq("linkedAppUserId", args.appUserId),
    )
    .collect();
  const activeLinkedParticipants = linkedParticipants.filter((participant) => participant.active);
  if (activeLinkedParticipants.some((participant) => participant.linkStatus !== "linked")) {
    return { kind: "review_needed" as const, reasonCode: "participant_link_requires_review" };
  }
  if (activeLinkedParticipants.length > 1) {
    return { kind: "review_needed" as const, reasonCode: "duplicate_linked_participants" };
  }
  if (activeLinkedParticipants.length === 1) {
    return { kind: "matched" as const, participant: activeLinkedParticipants[0]! };
  }

  const normalizedStudentId = normalizeStudentId(args.membership.studentId);
  const normalizedSchoolEmail = normalizeSchoolEmail(args.membership.schoolEmail);
  const [studentIdMatches, schoolEmailMatches] = await Promise.all([
    normalizedStudentId
      ? ctx.db
          .query("participants")
          .withIndex("by_rosterId_and_studentId", (q) =>
            q.eq("rosterId", args.rosterId).eq("externalId", normalizedStudentId),
          )
          .collect()
      : Promise.resolve([] as ParticipantDoc[]),
    normalizedSchoolEmail
      ? ctx.db
          .query("participants")
          .withIndex("by_rosterId_and_schoolEmail", (q) =>
            q.eq("rosterId", args.rosterId).eq("schoolEmail", normalizedSchoolEmail),
          )
          .collect()
      : Promise.resolve([] as ParticipantDoc[]),
  ]);
  const activeStudentIdMatches = studentIdMatches.filter((participant) => participant.active);
  const activeSchoolEmailMatches = schoolEmailMatches.filter((participant) => participant.active);
  if (activeStudentIdMatches.length > 1 || activeSchoolEmailMatches.length > 1) {
    return {
      kind: "review_needed" as const,
      reasonCode:
        activeStudentIdMatches.length > 1 ? "duplicate_student_id" : "duplicate_school_email",
    };
  }

  const candidates = new Map<Id<"participants">, ParticipantDoc>();
  for (const candidate of [...activeStudentIdMatches, ...activeSchoolEmailMatches]) {
    candidates.set(candidate._id, candidate);
  }
  if (candidates.size !== 1) return { kind: "blocked" as const, reasonCode: "not_on_roster" };

  const participant = [...candidates.values()][0]!;
  if (participant.linkedAppUserId && participant.linkedAppUserId !== args.appUserId) {
    return { kind: "review_needed" as const, reasonCode: "linked_to_other_user" };
  }
  const resolution = await resolveParticipantLink(ctx, args.organizationId, {
    studentId: participant.externalId,
    schoolEmail: participant.schoolEmail,
  });
  if (resolution.kind !== "matched" || resolution.appUserId !== args.appUserId) {
    return {
      kind: "review_needed" as const,
      reasonCode: resolution.kind === "ambiguous" ? resolution.reasonCode : "not_on_roster",
    };
  }

  await applyParticipantLink(ctx, participant, {
    linkedAppUserId: args.appUserId,
    linkStatus: "linked",
    linkMethod: "self_check_in",
    linkedByAppUserId: args.appUserId,
  });
  const refreshedParticipant = await ctx.db.get(participant._id);
  if (!refreshedParticipant) return { kind: "blocked" as const, reasonCode: "not_on_roster" };
  await syncParticipantAttendanceRecords(ctx, refreshedParticipant);
  return { kind: "matched" as const, participant: refreshedParticipant };
}

export async function studentCheckInAttendance(
  ctx: MutationCtx,
  args: { session: Doc<"sessions">; actor: VerifiedActorContext; now?: number },
): Promise<StudentCheckInEngineResult> {
  if (args.actor.actorType !== "student") throw new Error("Only students can self check in.");
  await assertRosterNotDecommissioned(ctx, args.session.rosterId);
  await assertNativeSubjectNotErased(ctx, args.session.rosterId, args.actor.appUserId);
  const now = args.now ?? Date.now();
  const [appUser, roster] = await Promise.all([
    ctx.db.get(args.actor.appUserId),
    ctx.db.get(args.session.rosterId),
  ]);
  if (!appUser || appUser.status !== "active" || !roster) {
    throw new Error("Attendance identity or roster state is invalid.");
  }
  if (args.session.status !== "open") {
    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      actor: args.actor,
      eventType: "student_check_in",
      result: "blocked",
      reasonCode: "session_closed",
      now,
    });
    return { code: "session_closed", occurredAt: now, changed: false };
  }

  const membership = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", appUser._id).eq("organizationId", roster.organizationId),
    )
    .unique();
  if (!membership || membership.status !== "active" || membership.role !== "student") {
    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      actor: args.actor,
      eventType: "student_check_in",
      result: "blocked",
      reasonCode: "not_authorized",
      now,
    });
    return { code: "not_authorized", occurredAt: now, changed: false };
  }

  const participantMatch = await findParticipantForStudent(ctx, {
    rosterId: roster._id,
    organizationId: roster.organizationId,
    appUserId: appUser._id,
    membership,
  });
  if (participantMatch.kind !== "matched") {
    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      actor: args.actor,
      eventType: "student_check_in",
      result: participantMatch.kind,
      reasonCode: participantMatch.reasonCode,
      metadata: { studentId: membership.studentId, schoolEmail: membership.schoolEmail },
      now,
    });
    return {
      code: participantMatch.kind === "blocked" ? "not_on_roster" : "review_needed",
      occurredAt: now,
      displayName: appUser.displayName,
      studentId: membership.studentId,
      changed: false,
    };
  }

  const participant = participantMatch.participant;
  await assertParticipantNotErased(ctx, participant._id);
  const record = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId_participantId", (q) =>
      q.eq("sessionId", args.session._id).eq("participantId", participant._id),
    )
    .unique();
  const student = {
    participantId: participant._id,
    displayName: participant.displayName,
    studentId: participant.externalId || membership.studentId || undefined,
  };

  if (!record || record.status === "unmarked") {
    const recordRevision = (record?.recordRevision ?? 0) + 1;
    if (record) {
      await ctx.db.patch(record._id, {
        linkedAppUserId: appUser._id,
        status: "present",
        recordRevision,
        source: "student_qr",
        firstMarkedAt: record.firstMarkedAt ?? now,
        lastMarkedAt: now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });
    } else {
      await ctx.db.insert("attendance_records", {
        sessionId: args.session._id,
        participantId: participant._id,
        linkedAppUserId: appUser._id,
        status: "present",
        recordRevision,
        source: "student_qr",
        firstMarkedAt: now,
        lastMarkedAt: now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });
    }
    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      participantId: participant._id,
      actor: args.actor,
      eventType: "student_check_in",
      fromStatus: "unmarked",
      toStatus: "present",
      result: "applied",
      now,
    });
    return {
      code: "present_marked",
      occurredAt: now,
      attendanceStatus: "present",
      recordRevision,
      fromStatus: "unmarked",
      changed: true,
      ...student,
    };
  }

  if (record.status === "present" || record.status === "late") {
    await insertAttendanceEvent(ctx, {
      sessionId: args.session._id,
      participantId: participant._id,
      actor: args.actor,
      eventType: "student_check_in",
      fromStatus: record.status,
      toStatus: record.status,
      result: "duplicate",
      now,
    });
    return {
      code: record.status === "present" ? "already_present" : "already_late",
      occurredAt: record.lastMarkedAt ?? record.modifiedAt,
      attendanceStatus: record.status,
      recordRevision: record.recordRevision ?? 0,
      changed: false,
      ...student,
    };
  }

  await insertAttendanceEvent(ctx, {
    sessionId: args.session._id,
    participantId: participant._id,
    actor: args.actor,
    eventType: "student_check_in",
    fromStatus: record.status,
    toStatus: record.status,
    result: "review_needed",
    reasonCode: "manual_override_present",
    now,
  });
  return {
    code: "review_needed",
    occurredAt: now,
    attendanceStatus: record.status,
    recordRevision: record.recordRevision ?? 0,
    changed: false,
    ...student,
  };
}
