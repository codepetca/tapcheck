import { v } from "convex/values";
import { ensureCurrentAppUser, getCurrentAppUserWithIdentity, requireAccessibleRoster } from "./auth";
import {
  applyAttendanceMark,
  studentCheckInAttendance,
  type VerifiedActorContext,
} from "./attendanceEngine";
import { isPresentLikeStatus } from "./domain";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";
import { mutation, query } from "./server";
import { participantIdFence, subjectFences } from "./pikaParticipantFence";

type AttendanceRecordDoc = Doc<"attendance_records">;
type ParticipantDoc = Doc<"participants">;

async function visibleParticipants(ctx: QueryCtx, participants: ParticipantDoc[]) {
  const visible = await Promise.all(participants.map(async participant =>
    await participantIdFence(ctx, participant._id) ? null : participant));
  return visible.filter(participant => participant !== null);
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

async function loadSessionByToken(ctx: QueryCtx | MutationCtx, token: string) {
  return await ctx.db
    .query("sessions")
    .withIndex("by_checkInToken", (q) => q.eq("checkInToken", token))
    .unique();
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
  const sessionParticipants = participants.filter(
    (participant) => participant.active || attendanceByParticipantId.has(participant._id),
  );

  const rows = await loadSessionParticipants(ctx, session, await visibleParticipants(ctx, sessionParticipants), attendanceRecords);
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

async function buildLiveSessionResult(
  ctx: QueryCtx,
  session: Doc<"sessions">,
  roster: Doc<"rosters">,
) {
  const sessionRows = await getSessionParticipantList(ctx, session);
  const unresolvedEvents = await ctx.db
    .query("attendance_events")
    .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", session._id).eq("result", "review_needed"))
    .collect();
  const blockedEvents = await ctx.db
    .query("attendance_events")
    .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", session._id).eq("result", "blocked"))
    .collect();

  const visibleEvents = [];
  for (const event of [...unresolvedEvents, ...blockedEvents]) {
    if (event.participantId && await participantIdFence(ctx, event.participantId)) continue;
    // Historical failed scans have only an actor; suppress those copies too.
    // Fresh-generation events with an explicit participant ID remain visible.
    if (!event.participantId && event.actorType === "student" && event.actorAppUserId &&
      (await subjectFences(ctx, roster._id, event.actorAppUserId)).length) continue;
    visibleEvents.push(event);
  }
  const eventRows = await Promise.all(
    visibleEvents
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
}

export async function applyManualAttendanceMark(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    participantId: Id<"participants">;
    nextStatus: "present" | "late" | "unmarked" | "absent";
    actorAppUserId?: Id<"app_users">;
    actor?: VerifiedActorContext;
    reasonCode?: string;
    now?: number;
  },
) {
  const actor =
    args.actor ??
    (args.actorAppUserId
      ? ({
          actorType: "staff",
          appUserId: args.actorAppUserId,
          source: "standalone_authkit",
        } as const)
      : ({ actorType: "staff", source: "standalone_share_token" } as const));
  return applyAttendanceMark(ctx, {
    session: args.session,
    participantId: args.participantId,
    nextStatus: args.nextStatus,
    actor,
    reasonCode: args.reasonCode,
    now: args.now,
  });
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
  checkedInAt?: number;
  student?: {
    displayName: string;
    studentId?: string;
  };
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
  checkedInAt: v.optional(v.number()),
  student: v.optional(
    v.object({
      displayName: v.string(),
      studentId: v.optional(v.string()),
    }),
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
    return await buildLiveSessionResult(ctx, session, roster);
  },
});

export const getLiveSessionRowsByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), liveSessionResult),
  handler: async (ctx, args) => {
    const session = await loadSessionByToken(ctx, args.token);
    if (!session) {
      return null;
    }

    const roster = await ctx.db.get(session.rosterId);
    if (!roster || roster.pikaDecommissioned) {
      return null;
    }

    return await buildLiveSessionResult(ctx, session, roster);
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
    if (!roster || roster.pikaDecommissioned) {
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

    const sortableRows = (await visibleParticipants(ctx, participants)).map((participant) => {
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

    const { appUser } = await requireAccessibleRoster(ctx, session.rosterId);

    await applyManualAttendanceMark(ctx, {
      session,
      participantId: args.participantId,
      nextStatus: args.nextStatus,
      actorAppUserId: appUser._id,
    });
    return null;
  },
});

export const markManualByToken = mutation({
  args: {
    token: v.string(),
    participantId: v.id("participants"),
    nextStatus: v.union(v.literal("present"), v.literal("late"), v.literal("unmarked")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await loadSessionByToken(ctx, args.token);
    if (!session) {
      throw new Error("Session not found.");
    }

    if (session.status !== "open") {
      throw new Error("This session is closed.");
    }

    await applyManualAttendanceMark(ctx, {
      session,
      participantId: args.participantId,
      nextStatus: args.nextStatus,
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
    const now = Date.now();
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
        checkedInAt: now,
      });
    }

    const appUser = await ensureCurrentAppUser(ctx);
    const result = await studentCheckInAttendance(ctx, {
      session,
      actor: {
        actorType: "student",
        appUserId: appUser._id,
        source: "standalone_authkit",
      },
      now,
    });
    const student = result.displayName
      ? { displayName: result.displayName, studentId: result.studentId }
      : undefined;

    switch (result.code) {
      case "present_marked":
        return buildStudentResult({
          tone: "green",
          code: result.code,
          title: "You are checked in",
          description: "Attendance recorded successfully.",
          attendanceStatus: result.attendanceStatus,
          checkedInAt: result.occurredAt,
          student,
        });
      case "already_present":
        return buildStudentResult({
          tone: "yellow",
          code: result.code,
          title: "You are already checked in",
          description: "No further action is needed.",
          attendanceStatus: result.attendanceStatus,
          checkedInAt: result.occurredAt,
          student,
        });
      case "already_late":
        return buildStudentResult({
          tone: "yellow",
          code: result.code,
          title: "You have already been marked late",
          description: "Please check with staff if this needs to change.",
          attendanceStatus: result.attendanceStatus,
          checkedInAt: result.occurredAt,
          student,
        });
      case "review_needed":
        return buildStudentResult({
          tone: "yellow",
          code: result.code,
          title: "Staff review is needed",
          description: result.attendanceStatus
            ? "Your attendance was already adjusted by staff. Ask them if this should change."
            : "Your account needs help matching this roster. Ask staff to tap you in.",
          attendanceStatus: result.attendanceStatus,
          checkedInAt: result.occurredAt,
          student,
        });
      case "not_on_roster":
        return buildStudentResult({
          tone: "red",
          code: result.code,
          title: "You are not on this roster",
          description: "Ask staff to check you in manually.",
          checkedInAt: result.occurredAt,
          student,
        });
      case "session_closed":
        return buildStudentResult({
          tone: "red",
          code: result.code,
          title: "This session is closed",
          description: "Ask staff to help you check in manually.",
          checkedInAt: result.occurredAt,
        });
      case "not_authorized":
        return buildStudentResult({
          tone: "red",
          code: result.code,
          title: "You cannot check in to this class",
          description: "Your account is not an active student for this roster.",
          checkedInAt: result.occurredAt,
        });
    }
  },
});
