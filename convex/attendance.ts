import { v } from "convex/values";
import type { Id } from "./model";
import type { QueryCtx } from "./server";
import { query, mutation } from "./server";

async function loadEditorSessionSnapshot(ctx: QueryCtx, token: string) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_editorToken", (q) => q.eq("editorToken", token))
    .unique();

  if (!session || !session.isOpen) {
    return null;
  }

  const [roster, students, attendanceRecords] = await Promise.all([
    ctx.db.get(session.rosterId),
    ctx.db
      .query("students")
      .withIndex("by_rosterId_active_sortKey", (q) =>
        q.eq("rosterId", session.rosterId).eq("active", true),
      )
      .collect(),
    ctx.db
      .query("attendance")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect(),
  ]);

  if (!roster) {
    return null;
  }

  const attendanceByStudent = new Map(
    attendanceRecords.map((record) => [record.studentRef, record] as const),
  );

  const studentsWithAttendance = students.map((student) => {
    const attendance = attendanceByStudent.get(student._id);
    return {
      studentRef: student._id,
      studentId: student.studentId,
      rawName: student.rawName,
      displayName: student.displayName,
      firstName: student.firstName,
      lastName: student.lastName,
      present: attendance?.present ?? false,
      markedAt: attendance?.markedAt,
      modifiedAt: attendance?.modifiedAt ?? session.createdAt,
      lastModifiedAt: attendance?.lastModifiedAt,
    };
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
    students: studentsWithAttendance,
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

  const rows = await Promise.all(
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

  rows.sort((left, right) => left.sortKey.localeCompare(right.sortKey));

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
    rows: rows.map((row) => ({
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
  returns: v.union(v.null(), sessionExportResult),
  handler: async (ctx, args) => loadSessionExport(ctx, args.sessionId),
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

    const attendance = await ctx.db
      .query("attendance")
      .withIndex("by_sessionId_studentRef", (q) =>
        q.eq("sessionId", session._id).eq("studentRef", args.studentRef),
      )
      .unique();

    if (!attendance) {
      throw new Error("Attendance record not found.");
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
