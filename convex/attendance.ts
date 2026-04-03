import { v } from "convex/values";
import { getCurrentAppUserWithIdentity, requireAccessibleRoster } from "./auth";
import type { Id } from "./model";
import type { QueryCtx } from "./server";
import { mutation, query } from "./server";

function isPresentStatus(status: "present" | "late" | "absent" | "excused") {
  return status === "present" || status === "late";
}

function isLegacyStudentRef(studentRef: Id<"participants"> | Id<"students">) {
  return String(studentRef).endsWith(";students");
}

async function loadActiveRosterParticipants(ctx: QueryCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("participants")
    .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", rosterId).eq("active", true))
    .collect();
}

type SessionParticipantRow = {
  studentRef: Id<"participants"> | Id<"students">;
  studentId: string;
  rawName: string;
  displayName: string;
  firstName: string;
  lastName: string;
  sortKey: string;
  present: boolean;
  markedAt: number | undefined;
  modifiedAt: number;
};

async function loadOpenSessionParticipants(
  ctx: QueryCtx,
  args: {
    rosterId: Id<"rosters">;
    createdAt: number;
    attendanceRecords: Array<{
      _id: Id<"attendance_records">;
      participantId: Id<"participants">;
      status: "present" | "late" | "absent" | "excused";
      markedAt?: number;
      modifiedAt: number;
    }>;
  },
) {
  const [attendanceParticipants, activeParticipants] = await Promise.all([
    Promise.all(args.attendanceRecords.map((record) => ctx.db.get(record.participantId))),
    loadActiveRosterParticipants(ctx, args.rosterId),
  ]);

  const participantsByRef = new Map<Id<"participants">, SessionParticipantRow>();

  for (const [index, record] of args.attendanceRecords.entries()) {
    const participant = attendanceParticipants[index];

    participantsByRef.set(record.participantId, {
      studentRef: record.participantId,
      studentId: participant?.externalId ?? "",
      rawName: participant?.rawName ?? "",
      displayName: participant?.displayName ?? participant?.rawName ?? "",
      firstName: participant?.firstName ?? "",
      lastName: participant?.lastName ?? "",
      sortKey: participant?.sortKey ?? `${participant?.externalId ?? ""}`,
      present: isPresentStatus(record.status),
      markedAt: isPresentStatus(record.status) ? record.markedAt : undefined,
      modifiedAt: record.modifiedAt,
    });
  }

  for (const participant of activeParticipants) {
    if (participantsByRef.has(participant._id)) {
      continue;
    }

    participantsByRef.set(participant._id, {
      studentRef: participant._id,
      studentId: participant.externalId ?? "",
      rawName: participant.rawName,
      displayName: participant.displayName || participant.rawName || participant.externalId || "",
      firstName: participant.firstName,
      lastName: participant.lastName,
      sortKey: participant.sortKey,
      present: false,
      markedAt: undefined,
      modifiedAt: args.createdAt,
    });
  }

  const participants = [...participantsByRef.values()];
  participants.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  return participants;
}

async function loadLegacyOpenSessionStudents(
  ctx: QueryCtx,
  args: {
    rosterId: Id<"rosters">;
    createdAt: number;
    attendanceRecords: Array<{
      _id: Id<"attendance">;
      studentRef: Id<"students">;
      studentId: string;
      present: boolean;
      markedAt?: number;
      modifiedAt: number;
      lastModifiedAt?: number;
    }>;
  },
) {
  const [attendanceStudents, activeStudents] = await Promise.all([
    Promise.all(args.attendanceRecords.map((record) => ctx.db.get(record.studentRef))),
    ctx.db
      .query("students")
      .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", args.rosterId).eq("active", true))
      .collect(),
  ]);

  const studentsByRef = new Map<Id<"students">, SessionParticipantRow>();

  for (const [index, record] of args.attendanceRecords.entries()) {
    const student = attendanceStudents[index];

    studentsByRef.set(record.studentRef, {
      studentRef: record.studentRef,
      studentId: record.studentId,
      rawName: student?.rawName ?? "",
      displayName: student?.displayName ?? student?.rawName ?? record.studentId,
      firstName: student?.firstName ?? "",
      lastName: student?.lastName ?? "",
      sortKey: student?.sortKey ?? `${record.studentId}`,
      present: record.present,
      markedAt: record.present ? record.markedAt : undefined,
      modifiedAt: record.modifiedAt,
    });
  }

  for (const student of activeStudents) {
    if (studentsByRef.has(student._id)) {
      continue;
    }

    studentsByRef.set(student._id, {
      studentRef: student._id,
      studentId: student.studentId,
      rawName: student.rawName,
      displayName: student.displayName || student.rawName || student.studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      sortKey: student.sortKey,
      present: false,
      markedAt: undefined,
      modifiedAt: args.createdAt,
    });
  }

  const students = [...studentsByRef.values()];
  students.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  return students;
}

async function loadLegacyEditorSessionSnapshot(
  ctx: QueryCtx,
  session: { _id: Id<"sessions">; rosterId: Id<"rosters">; title: string; date: string; isOpen: boolean; createdAt: number },
  roster: { _id: Id<"rosters">; name: string },
) {
  const attendanceRecords = await ctx.db
    .query("attendance")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
    .collect();

  const studentsWithAttendance = await loadLegacyOpenSessionStudents(ctx, {
    rosterId: session.rosterId,
    createdAt: session.createdAt,
    attendanceRecords,
  });

  return {
    session: {
      _id: session._id,
      title: session.title,
      date: session.date,
      isOpen: session.isOpen,
    },
    roster: {
      _id: roster._id,
      name: roster.name,
    },
    totalCount: studentsWithAttendance.length,
    presentCount: studentsWithAttendance.filter((student) => student.present).length,
    students: studentsWithAttendance.map((student) => ({
      studentRef: student.studentRef,
      studentId: student.studentId,
      rawName: student.rawName,
      displayName: student.displayName,
      firstName: student.firstName,
      lastName: student.lastName,
      present: student.present,
      markedAt: student.markedAt,
      modifiedAt: student.modifiedAt,
      lastModifiedAt: student.modifiedAt,
    })),
  };
}

async function shouldUseLegacySessionData(ctx: QueryCtx, rosterId: Id<"rosters">, sessionId: Id<"sessions">) {
  const [attendanceRecords, participants] = await Promise.all([
    ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(1),
    ctx.db
      .query("participants")
      .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", rosterId))
      .take(1),
  ]);

  return attendanceRecords.length === 0 && participants.length === 0;
}

async function loadEditorSessionSnapshot(ctx: QueryCtx, token: string) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_editorToken", (q) => q.eq("editorToken", token))
    .unique();

  if (!session || !session.isOpen) {
    return null;
  }

  const [roster, attendanceRecords] = await Promise.all([
    ctx.db.get(session.rosterId),
    ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect(),
  ]);

  if (!roster) {
    return null;
  }

  if (await shouldUseLegacySessionData(ctx, session.rosterId, session._id)) {
    return loadLegacyEditorSessionSnapshot(ctx, session, roster);
  }

  const participantsWithAttendance = await loadOpenSessionParticipants(ctx, {
    rosterId: session.rosterId,
    createdAt: session.createdAt,
    attendanceRecords,
  });

  return {
    session: {
      _id: session._id,
      title: session.title,
      date: session.date,
      isOpen: session.isOpen,
    },
    roster: {
      _id: roster._id,
      name: roster.name,
    },
    totalCount: participantsWithAttendance.length,
    presentCount: participantsWithAttendance.filter((participant) => participant.present).length,
    students: participantsWithAttendance.map((participant) => ({
      studentRef: participant.studentRef,
      studentId: participant.studentId,
      rawName: participant.rawName,
      displayName: participant.displayName,
      firstName: participant.firstName,
      lastName: participant.lastName,
      present: participant.present,
      markedAt: participant.markedAt,
      modifiedAt: participant.modifiedAt,
      lastModifiedAt: participant.modifiedAt,
    })),
  };
}

async function loadSessionExport(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) {
    return null;
  }

  const roster = await ctx.db.get(session.rosterId);
  if (!roster) {
    return null;
  }

  if (await shouldUseLegacySessionData(ctx, session.rosterId, session._id)) {
    const attendanceRecords = await ctx.db
      .query("attendance")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .collect();

    const rows = session.isOpen
      ? loadLegacyOpenSessionStudents(ctx, {
          rosterId: session.rosterId,
          createdAt: session.createdAt,
          attendanceRecords,
        })
      : Promise.all(
          attendanceRecords.map(async (record) => {
            const student = await ctx.db.get(record.studentRef);
            return {
              studentId: record.studentId,
              rawName: student?.rawName ?? "",
              displayName: student?.displayName ?? "",
              firstName: student?.firstName ?? "",
              lastName: student?.lastName ?? "",
              sortKey: student?.sortKey ?? `${record.studentId}`,
              present: record.present,
              markedAt: record.present ? record.markedAt : undefined,
              modifiedAt: record.modifiedAt,
            };
          }),
        );

    const resolvedRows = await rows;
    resolvedRows.sort((left, right) => left.sortKey.localeCompare(right.sortKey));

    return {
      roster: {
        _id: roster._id,
        name: roster.name,
      },
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        isOpen: session.isOpen,
      },
      rows: resolvedRows.map((row) => ({
        studentId: row.studentId,
        rawName: row.rawName,
        displayName: row.displayName,
        firstName: row.firstName,
        lastName: row.lastName,
        present: row.present,
        markedAt: row.markedAt,
        modifiedAt: row.modifiedAt,
      })),
    };
  }

  const attendanceRecords = await ctx.db
    .query("attendance_records")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .collect();

  const rows = session.isOpen
    ? loadOpenSessionParticipants(ctx, {
        rosterId: session.rosterId,
        createdAt: session.createdAt,
        attendanceRecords,
      })
    : Promise.all(
        attendanceRecords.map(async (record) => {
          const participant = await ctx.db.get(record.participantId);
          return {
            studentId: participant?.externalId ?? "",
            rawName: participant?.rawName ?? "",
            displayName: participant?.displayName ?? "",
            firstName: participant?.firstName ?? "",
            lastName: participant?.lastName ?? "",
            sortKey: participant?.sortKey ?? `${participant?.externalId ?? ""}`,
            present: isPresentStatus(record.status),
            markedAt: isPresentStatus(record.status) ? record.markedAt : undefined,
            modifiedAt: record.modifiedAt,
          };
        }),
      );

  const resolvedRows = await rows;
  resolvedRows.sort((left, right) => left.sortKey.localeCompare(right.sortKey));

  return {
    roster: {
      _id: roster._id,
      name: roster.name,
    },
    session: {
      _id: session._id,
      title: session.title,
      date: session.date,
      isOpen: session.isOpen,
    },
    rows: resolvedRows.map((row) => ({
      studentId: row.studentId,
      rawName: row.rawName,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      present: row.present,
      markedAt: row.markedAt,
      modifiedAt: row.modifiedAt,
    })),
  };
}

const sessionResult = v.object({
  session: v.object({
    _id: v.id("sessions"),
    title: v.string(),
    date: v.string(),
    isOpen: v.boolean(),
  }),
  roster: v.object({
    _id: v.id("rosters"),
    name: v.string(),
  }),
  totalCount: v.number(),
  presentCount: v.number(),
  students: v.array(
    v.object({
      studentRef: v.union(v.id("participants"), v.id("students")),
      studentId: v.string(),
      rawName: v.string(),
      displayName: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      present: v.boolean(),
      markedAt: v.optional(v.number()),
      modifiedAt: v.number(),
      lastModifiedAt: v.optional(v.number()),
    }),
  ),
});

const sessionExportResult = v.object({
  roster: v.object({
    _id: v.id("rosters"),
    name: v.string(),
  }),
  session: v.object({
    _id: v.id("sessions"),
    title: v.string(),
    date: v.string(),
    isOpen: v.boolean(),
  }),
  rows: v.array(
    v.object({
      studentId: v.string(),
      rawName: v.string(),
      displayName: v.string(),
      firstName: v.string(),
      lastName: v.string(),
      present: v.boolean(),
      markedAt: v.optional(v.number()),
      modifiedAt: v.number(),
    }),
  ),
});

export const getEditorSessionByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), sessionResult),
  handler: async (ctx, args) => loadEditorSessionSnapshot(ctx, args.token),
});

export const getSessionExport = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(v.null(), sessionExportResult),
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

    return loadSessionExport(ctx, args.sessionId);
  },
});

export const toggleByEditorToken = mutation({
  args: {
    token: v.string(),
    studentRef: v.union(v.id("participants"), v.id("students")),
    clientNow: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_editorToken", (q) => q.eq("editorToken", args.token))
      .unique();

    if (!session) {
      throw new Error("Invalid editor link.");
    }

    if (!session.isOpen) {
      throw new Error("This session has ended.");
    }

    if (isLegacyStudentRef(args.studentRef)) {
      const legacyStudent = await ctx.db.get(args.studentRef as Id<"students">);
      if (!legacyStudent || legacyStudent.rosterId !== session.rosterId) {
        throw new Error("Student not found in this roster.");
      }

      const legacyAttendance = await ctx.db
        .query("attendance")
        .withIndex("by_sessionId_studentRef", (q) =>
          q.eq("sessionId", session._id).eq("studentRef", legacyStudent._id),
        )
        .unique();

      if (!legacyAttendance) {
        if (!legacyStudent.active) {
          throw new Error("Student not found in this roster.");
        }

        await ctx.db.insert("attendance", {
          sessionId: session._id,
          studentRef: legacyStudent._id,
          studentId: legacyStudent.studentId,
          present: true,
          markedAt: args.clientNow,
          lastModifiedAt: args.clientNow,
          modifiedAt: args.clientNow,
          modifiedViaTokenType: "editor",
        });
        return null;
      }

      const now = args.clientNow;
      const nextPresent = !legacyAttendance.present;

      await ctx.db.patch(legacyAttendance._id, {
        present: nextPresent,
        markedAt: nextPresent ? now : legacyAttendance.markedAt,
        lastModifiedAt: now,
        modifiedAt: now,
        modifiedViaTokenType: "editor",
      });
      return null;
    }

    const participant = await ctx.db.get(args.studentRef as Id<"participants">);
    if (!participant || participant.rosterId !== session.rosterId) {
      throw new Error("Student not found in this roster.");
    }

    const attendance = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", session._id).eq("participantId", participant._id),
      )
      .unique();

    if (!attendance) {
      if (!participant.active) {
        throw new Error("Student not found in this roster.");
      }

      await ctx.db.insert("attendance_records", {
        sessionId: session._id,
        participantId: participant._id,
        linkedAppUserId: participant.linkedAppUserId,
        status: "present",
        source: "shared_editor",
        markedAt: args.clientNow,
        modifiedAt: args.clientNow,
      });
      return null;
    }

    const now = args.clientNow;
    const nextPresent = !isPresentStatus(attendance.status);

    await ctx.db.patch(attendance._id, {
      linkedAppUserId: participant.linkedAppUserId,
      status: nextPresent ? "present" : "absent",
      markedAt: nextPresent ? now : attendance.markedAt,
      modifiedAt: now,
      source: "shared_editor",
    });

    return null;
  },
});
