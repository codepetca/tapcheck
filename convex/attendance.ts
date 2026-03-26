import { v } from "convex/values";
import type { QueryCtx } from "./server";
import { query, mutation } from "./server";

async function loadSessionSnapshot(
  ctx: QueryCtx,
  token: string,
  tokenType: "editor" | "viewer",
) {
  const session =
    tokenType === "editor"
      ? await ctx.db
          .query("sessions")
          .withIndex("by_editorToken", (q) => q.eq("editorToken", token))
          .unique()
      : await ctx.db
          .query("sessions")
          .withIndex("by_viewerToken", (q) => q.eq("viewerToken", token))
          .unique();

  if (!session) {
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
    tokenType,
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

const sessionResult = v.object({
  tokenType: v.union(v.literal("editor"), v.literal("viewer")),
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

export const getEditorSessionByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), sessionResult),
  handler: async (ctx, args) => loadSessionSnapshot(ctx, args.token, "editor"),
});

export const getViewerSessionByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), sessionResult),
  handler: async (ctx, args) => loadSessionSnapshot(ctx, args.token, "viewer"),
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
