import { v } from "convex/values";
import { ensureCurrentAppUser, getCurrentAppUserWithIdentity, requireAccessibleRoster } from "./auth";
import {
  applyParticipantLink,
  resolveParticipantLink,
  syncParticipantAttendanceRecords,
} from "./participantLinks";
import { isPresentLikeStatus, normalizeSchoolEmail, normalizeStudentId } from "./domain";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";
import { mutation, query } from "./server";

type AttendanceRecordDoc = Doc<"attendance_records">;
type ParticipantDoc = Doc<"participants">;

function serializeEventMetadata(metadata?: Record<string, string | undefined>) {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

async function insertAttendanceEvent(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"sessions">;
    participantId?: Id<"participants">;
    actorAppUserId?: Id<"app_users">;
    actorType: "student" | "staff" | "system";
    eventType: "student_check_in" | "manual_mark" | "session_finalize";
    fromStatus?: "unmarked" | "present" | "late" | "absent";
    toStatus?: "unmarked" | "present" | "late" | "absent";
    result: "applied" | "duplicate" | "blocked" | "review_needed";
    reasonCode?: string;
    metadata?: Record<string, string | undefined>;
  },
) {
  await ctx.db.insert("attendance_events", {
    sessionId: args.sessionId,
    participantId: args.participantId,
    actorAppUserId: args.actorAppUserId,
    actorType: args.actorType,
    eventType: args.eventType,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    result: args.result,
    reasonCode: args.reasonCode,
    metadata: serializeEventMetadata(args.metadata),
    createdAt: Date.now(),
  });
}

async function loadSessionParticipants(
  ctx: QueryCtx,
  session: Doc<"sessions">,
  participants: ParticipantDoc[],
  attendanceRecords: AttendanceRecordDoc[],
) {
  const attendanceByParticipantId = new Map<Id<"participants">, AttendanceRecordDoc>();
  for (const attendanceRecord of attendanceRecords) {
    attendanceByParticipantId.set(attendanceRecord.participantId, attendanceRecord);
  }

  return participants.map((participant) => {
    const attendanceRecord = attendanceByParticipantId.get(participant._id);
    return {
      participantId: participant._id,
      displayName: participant.displayName,
      firstName: participant.firstName,
      lastName: participant.lastName,
      studentId: participant.externalId ?? "",
      schoolEmail: participant.schoolEmail,
      status: attendanceRecord?.status ?? "unmarked",
      lastMarkedAt: attendanceRecord?.lastMarkedAt,
      modifiedAt: attendanceRecord?.modifiedAt ?? session.createdAt,
      linkStatus: participant.linkStatus,
      linkedAppUserId: participant.linkedAppUserId,
    };
  });
}

async function loadDisplayNameForParticipant(ctx: QueryCtx, participantId?: Id<"participants">) {
  if (!participantId) {
    return undefined;
  }

  const participant = await ctx.db.get(participantId);
  return participant?.displayName;
}

async function getSessionParticipantList(ctx: QueryCtx, session: Doc<"sessions">) {
  const [participants, attendanceRecords] = await Promise.all([
    ctx.db
      .query("participants")
      .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", session.rosterId))
      .collect(),
    ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect(),
  ]);
  const attendanceByParticipantId = new Set(attendanceRecords.map((record) => record.participantId));
  const visibleParticipants = participants.filter(
    (participant) => participant.active || attendanceByParticipantId.has(participant._id),
  );

  const rows = await loadSessionParticipants(ctx, session, visibleParticipants, attendanceRecords);
  rows.sort((left, right) => {
    return (
      left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) ||
      left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) ||
      left.studentId.localeCompare(right.studentId, undefined, { numeric: true, sensitivity: "base" })
    );
  });

  return {
    rows,
    counts: {
      total: rows.length,
      present: rows.filter((row) => row.status === "present").length,
      late: rows.filter((row) => row.status === "late").length,
      unmarked: rows.filter((row) => row.status === "unmarked").length,
      absent: rows.filter((row) => row.status === "absent").length,
    },
  };
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

  if (activeLinkedParticipants.length > 1) {
    return {
      kind: "review_needed" as const,
      reasonCode: "duplicate_linked_participants",
    };
  }

  if (activeLinkedParticipants.length === 1) {
    return {
      kind: "matched" as const,
      participant: activeLinkedParticipants[0]!,
    };
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

  if (candidates.size !== 1) {
    return {
      kind: "blocked" as const,
      reasonCode: "not_on_roster",
    };
  }

  const participant = [...candidates.values()][0]!;
  if (participant.linkedAppUserId && participant.linkedAppUserId !== args.appUserId) {
    return {
      kind: "review_needed" as const,
      reasonCode: "linked_to_other_user",
    };
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
  if (!refreshedParticipant) {
    return {
      kind: "blocked" as const,
      reasonCode: "not_on_roster",
    };
  }

  await syncParticipantAttendanceRecords(ctx, refreshedParticipant);

  return {
    kind: "matched" as const,
    participant: refreshedParticipant,
  };
}

function buildStudentResult(args: {
  tone: "green" | "yellow" | "red";
  code:
    | "present_marked"
    | "already_present"
    | "already_late"
    | "review_needed"
    | "not_on_roster"
    | "session_closed"
    | "invalid_token"
    | "not_authorized";
  title: string;
  description: string;
  attendanceStatus?: "unmarked" | "present" | "late" | "absent";
}) {
  return args;
}

const liveSessionResult = v.object({
  session: v.object({
    _id: v.id("sessions"),
    title: v.string(),
    date: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    checkInToken: v.string(),
  }),
  roster: v.object({
    _id: v.id("rosters"),
    name: v.string(),
  }),
  counts: v.object({
    total: v.number(),
    present: v.number(),
    late: v.number(),
    unmarked: v.number(),
    absent: v.number(),
  }),
  rows: v.array(
    v.object({
      participantId: v.id("participants"),
      displayName: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      studentId: v.string(),
      schoolEmail: v.optional(v.string()),
      status: v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
      lastMarkedAt: v.optional(v.number()),
      modifiedAt: v.number(),
      linkStatus: v.union(
        v.literal("linked"),
        v.literal("unlinked"),
        v.literal("ambiguous"),
        v.literal("review_needed"),
      ),
      linkedAppUserId: v.optional(v.id("app_users")),
    }),
  ),
  unresolvedEvents: v.array(
    v.object({
      participantId: v.optional(v.id("participants")),
      participantName: v.optional(v.string()),
      result: v.union(
        v.literal("applied"),
        v.literal("duplicate"),
        v.literal("blocked"),
        v.literal("review_needed"),
      ),
      reasonCode: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
});

const studentCheckInResult = v.object({
  tone: v.union(v.literal("green"), v.literal("yellow"), v.literal("red")),
  code: v.union(
    v.literal("present_marked"),
    v.literal("already_present"),
    v.literal("already_late"),
    v.literal("review_needed"),
    v.literal("not_on_roster"),
    v.literal("session_closed"),
    v.literal("invalid_token"),
    v.literal("not_authorized"),
  ),
  title: v.string(),
  description: v.string(),
  attendanceStatus: v.optional(
    v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
  ),
});

export const getLiveSessionRows = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(v.null(), liveSessionResult),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return null;
    }

    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    const sessionRows = await getSessionParticipantList(ctx, session);
    const unresolvedEvents = await ctx.db
      .query("attendance_events")
      .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", session._id).eq("result", "review_needed"))
      .collect();
    const blockedEvents = await ctx.db
      .query("attendance_events")
      .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", session._id).eq("result", "blocked"))
      .collect();

    const eventRows = await Promise.all(
      [...unresolvedEvents, ...blockedEvents]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 12)
        .map(async (event) => ({
          participantId: event.participantId,
          participantName: await loadDisplayNameForParticipant(ctx, event.participantId),
          result: event.result,
          reasonCode: event.reasonCode,
          createdAt: event.createdAt,
        })),
    );

    return {
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        status: session.status,
        checkInToken: session.checkInToken,
      },
      roster: {
        _id: roster._id,
        name: roster.name,
      },
      counts: sessionRows.counts,
      rows: sessionRows.rows,
      unresolvedEvents: eventRows,
    };
  },
});

export const getSessionExport = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed")),
      }),
      rows: v.array(
        v.object({
          studentId: v.string(),
          schoolEmail: v.optional(v.string()),
          rawName: v.string(),
          displayName: v.string(),
          firstName: v.string(),
          lastName: v.string(),
          status: v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
          present: v.boolean(),
          markedAt: v.optional(v.number()),
          modifiedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const [{ appUser }, session] = await Promise.all([
      getCurrentAppUserWithIdentity(ctx),
      ctx.db.get(args.sessionId),
    ]);

    if (!appUser || !session) {
      return null;
    }

    try {
      await requireAccessibleRoster(ctx, session.rosterId);
    } catch {
      return null;
    }

    const roster = await ctx.db.get(session.rosterId);
    if (!roster) {
      return null;
    }

    const [participants, attendanceRecords] = await Promise.all([
      ctx.db
        .query("participants")
        .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", session.rosterId))
        .collect(),
      ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .collect(),
    ]);

    const attendanceByParticipantId = new Map<Id<"participants">, AttendanceRecordDoc>();
    for (const attendanceRecord of attendanceRecords) {
      attendanceByParticipantId.set(attendanceRecord.participantId, attendanceRecord);
    }

    const sortableRows = participants.map((participant) => {
      const attendanceRecord = attendanceByParticipantId.get(participant._id);
      const status = attendanceRecord?.status ?? "unmarked";
      return {
        sortKey: participant.sortKey,
        row: {
          studentId: participant.externalId ?? "",
          schoolEmail: participant.schoolEmail,
          rawName: participant.rawName,
          displayName: participant.displayName,
          firstName: participant.firstName,
          lastName: participant.lastName,
          status,
          present: isPresentLikeStatus(status),
          markedAt: attendanceRecord?.lastMarkedAt,
          modifiedAt: attendanceRecord?.modifiedAt ?? session.createdAt,
        },
      };
    });

    sortableRows.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    const rows = sortableRows.map((entry) => entry.row);

    return {
      roster: {
        _id: roster._id,
        name: roster.name,
      },
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        status: session.status,
      },
      rows,
    };
  },
});

export const markManual = mutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    nextStatus: v.union(v.literal("present"), v.literal("late"), v.literal("unmarked")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    if (session.status !== "open") {
      throw new Error("This session is closed.");
    }

    const participant = await ctx.db.get(args.participantId);
    if (!participant || participant.rosterId !== session.rosterId) {
      throw new Error("Student not found in this session.");
    }

    const { appUser } = await requireAccessibleRoster(ctx, session.rosterId);

    const existingAttendance = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", session._id).eq("participantId", participant._id),
      )
      .unique();

    const now = Date.now();

    if (!existingAttendance) {
      await ctx.db.insert("attendance_records", {
        sessionId: session._id,
        participantId: participant._id,
        linkedAppUserId: participant.linkedAppUserId,
        status: args.nextStatus,
        source: "staff_manual",
        firstMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
        lastMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });

      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participant._id,
        actorAppUserId: appUser._id,
        actorType: "staff",
        eventType: "manual_mark",
        fromStatus: "unmarked",
        toStatus: args.nextStatus,
        result: "applied",
      });
      return null;
    }

    await ctx.db.patch(existingAttendance._id, {
      linkedAppUserId: participant.linkedAppUserId,
      status: args.nextStatus,
      source: "staff_manual",
      firstMarkedAt:
        args.nextStatus === "unmarked"
          ? existingAttendance.firstMarkedAt
          : existingAttendance.firstMarkedAt ?? now,
      lastMarkedAt: args.nextStatus === "unmarked" ? undefined : now,
      modifiedAt: now,
      modifiedByAppUserId: appUser._id,
    });

    await insertAttendanceEvent(ctx, {
      sessionId: session._id,
      participantId: participant._id,
      actorAppUserId: appUser._id,
      actorType: "staff",
      eventType: "manual_mark",
      fromStatus: existingAttendance.status,
      toStatus: args.nextStatus,
      result: "applied",
    });

    return null;
  },
});

export const studentCheckIn = mutation({
  args: {
    token: v.string(),
  },
  returns: studentCheckInResult,
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_checkInToken", (q) => q.eq("checkInToken", args.token))
      .unique();

    if (!session) {
      return buildStudentResult({
        tone: "red",
        code: "invalid_token",
        title: "Check-in link is invalid",
        description: "Ask your teacher for the current classroom QR code.",
      });
    }

    const appUser = await ensureCurrentAppUser(ctx);
    const roster = await ctx.db.get(session.rosterId);
    if (!roster) {
      return buildStudentResult({
        tone: "red",
        code: "invalid_token",
        title: "Check-in link is invalid",
        description: "Ask your teacher for the current classroom QR code.",
      });
    }

    if (session.status !== "open") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "blocked",
        reasonCode: "session_closed",
      });

      return buildStudentResult({
        tone: "red",
        code: "session_closed",
        title: "This session is closed",
        description: "Ask staff to help you check in manually.",
      });
    }

    const membership = await ctx.db
      .query("organization_memberships")
      .withIndex("by_appUserId_organizationId", (q) =>
        q.eq("appUserId", appUser._id).eq("organizationId", roster.organizationId),
      )
      .unique();

    if (!membership || membership.status !== "active" || membership.role !== "student") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "blocked",
        reasonCode: "not_authorized",
      });

      return buildStudentResult({
        tone: "red",
        code: "not_authorized",
        title: "You cannot check in to this class",
        description: "Your account is not an active student for this roster.",
      });
    }

    const participantMatch = await findParticipantForStudent(ctx, {
      rosterId: roster._id,
      organizationId: roster.organizationId,
      appUserId: appUser._id,
      membership,
    });

    if (participantMatch.kind === "blocked") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "blocked",
        reasonCode: participantMatch.reasonCode,
        metadata: {
          studentId: membership.studentId,
          schoolEmail: membership.schoolEmail,
        },
      });

      return buildStudentResult({
        tone: "red",
        code: "not_on_roster",
        title: "You are not on this roster",
        description: "Ask staff to check you in manually.",
      });
    }

    if (participantMatch.kind === "review_needed") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        result: "review_needed",
        reasonCode: participantMatch.reasonCode,
        metadata: {
          studentId: membership.studentId,
          schoolEmail: membership.schoolEmail,
        },
      });

      return buildStudentResult({
        tone: "yellow",
        code: "review_needed",
        title: "Staff review is needed",
        description: "Your account needs help matching this roster. Ask staff to tap you in.",
      });
    }

    const attendanceRecord = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", session._id).eq("participantId", participantMatch.participant._id),
      )
      .unique();

    const now = Date.now();

    if (!attendanceRecord) {
      await ctx.db.insert("attendance_records", {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        linkedAppUserId: appUser._id,
        status: "present",
        source: "student_qr",
        firstMarkedAt: now,
        lastMarkedAt: now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });

      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "unmarked",
        toStatus: "present",
        result: "applied",
      });

      return buildStudentResult({
        tone: "green",
        code: "present_marked",
        title: "You are checked in",
        description: "Attendance recorded successfully.",
        attendanceStatus: "present",
      });
    }

    if (attendanceRecord.status === "unmarked") {
      await ctx.db.patch(attendanceRecord._id, {
        linkedAppUserId: appUser._id,
        status: "present",
        source: "student_qr",
        firstMarkedAt: attendanceRecord.firstMarkedAt ?? now,
        lastMarkedAt: now,
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });

      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "unmarked",
        toStatus: "present",
        result: "applied",
      });

      return buildStudentResult({
        tone: "green",
        code: "present_marked",
        title: "You are checked in",
        description: "Attendance recorded successfully.",
        attendanceStatus: "present",
      });
    }

    if (attendanceRecord.status === "present") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "present",
        toStatus: "present",
        result: "duplicate",
      });

      return buildStudentResult({
        tone: "yellow",
        code: "already_present",
        title: "You are already checked in",
        description: "No further action is needed.",
        attendanceStatus: "present",
      });
    }

    if (attendanceRecord.status === "late") {
      await insertAttendanceEvent(ctx, {
        sessionId: session._id,
        participantId: participantMatch.participant._id,
        actorAppUserId: appUser._id,
        actorType: "student",
        eventType: "student_check_in",
        fromStatus: "late",
        toStatus: "late",
        result: "duplicate",
      });

      return buildStudentResult({
        tone: "yellow",
        code: "already_late",
        title: "You have already been marked late",
        description: "Please check with staff if this needs to change.",
        attendanceStatus: "late",
      });
    }

    await insertAttendanceEvent(ctx, {
      sessionId: session._id,
      participantId: participantMatch.participant._id,
      actorAppUserId: appUser._id,
      actorType: "student",
      eventType: "student_check_in",
      fromStatus: attendanceRecord.status,
      toStatus: attendanceRecord.status,
      result: "review_needed",
      reasonCode: "manual_override_present",
    });

    return buildStudentResult({
      tone: "yellow",
      code: "review_needed",
      title: "Staff review is needed",
      description: "Your attendance was already adjusted by staff. Ask them if this should change.",
      attendanceStatus: attendanceRecord.status,
    });
  },
});
