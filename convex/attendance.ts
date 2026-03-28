import { v } from "convex/values";
import { requireOwnedSession } from "./auth";
import type { Id } from "./model";
import type { QueryCtx } from "./server";
import { query, mutation } from "./server";

async function loadActiveRosterStudents(ctx: QueryCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("students")
    .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", rosterId).eq("active", true))
    .collect();
}

type SessionStudentRow = {
  studentRef: Id<"students">;
  studentId: string;
  rawName: string;
  displayName: string;
  firstName: string;
  lastName: string;
  sortKey: string;
  present: boolean;
  markedAt: number | undefined;
  modifiedAt: number;
  lastModifiedAt: number | undefined;
};

async function loadOpenSessionStudents(
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
    loadActiveRosterStudents(ctx, args.rosterId),
  ]);

  const studentsByRef = new Map<Id<"students">, SessionStudentRow>();

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
      markedAt: record.markedAt,
      modifiedAt: record.modifiedAt,
      lastModifiedAt: record.lastModifiedAt,
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
      lastModifiedAt: undefined,
    });
  }

  const students = [...studentsByRef.values()];
  students.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  return students;
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
      .query("attendance")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect(),
  ]);

  if (!roster) {
    return null;
  }

  const studentsWithAttendance = await loadOpenSessionStudents(ctx, {
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
      lastModifiedAt: student.lastModifiedAt,
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

  const attendanceRecords = await ctx.db
    .query("attendance")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .collect();

  const rows = session.isOpen
    ? loadOpenSessionStudents(ctx, {
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
            markedAt: record.markedAt,
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
      studentRef: v.id("students"),
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
  returns: sessionExportResult,
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const sessionExport = await loadSessionExport(ctx, args.sessionId);

    if (!sessionExport) {
      throw new Error("Session not found.");
    }

    return sessionExport;
  },
});

export const toggleByEditorToken = mutation({
  args: {
    token: v.string(),
    studentRef: v.id("students"),
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

    const student = await ctx.db.get(args.studentRef);
    if (!student || student.rosterId !== session.rosterId) {
      throw new Error("Student not found in this roster.");
    }

    const attendance = await ctx.db
      .query("attendance")
      .withIndex("by_sessionId_studentRef", (q) =>
        q.eq("sessionId", session._id).eq("studentRef", args.studentRef),
      )
      .unique();

    if (!attendance) {
      if (!student.active) {
        throw new Error("Student not found in this roster.");
      }

      await ctx.db.insert("attendance", {
        sessionId: session._id,
        studentRef: student._id,
        studentId: student.studentId,
        present: true,
        markedAt: args.clientNow,
        lastModifiedAt: args.clientNow,
        modifiedAt: args.clientNow,
        modifiedViaTokenType: "editor",
      });
      return null;
    }

    const now = args.clientNow;
    const nextPresent = !attendance.present;

    await ctx.db.patch(attendance._id, {
      present: nextPresent,
      markedAt: nextPresent ? now : undefined,
      lastModifiedAt: now,
      modifiedAt: now,
      modifiedViaTokenType: "editor",
    });

    return null;
  },
});
