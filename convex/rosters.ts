import { v } from "convex/values";
import { buildDemoRosterStudents } from "../lib/demo-data";
import type { Id } from "./model";
import { mutation, query, type MutationCtx } from "./server";

const importedStudentValidator = v.object({
  studentId: v.string(),
  rawName: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  displayName: v.string(),
  sortKey: v.string(),
});

async function loadRosterStudents(ctx: MutationCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("students")
    .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", rosterId))
    .collect();
}

function validateImportedStudents(
  students: Array<{
    studentId: string;
  }>,
) {
  if (students.length === 0) {
    throw new Error("At least one valid student is required.");
  }

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const student of students) {
    if (seenIds.has(student.studentId)) {
      duplicateIds.add(student.studentId);
    }
    seenIds.add(student.studentId);
  }

  if (duplicateIds.size > 0) {
    throw new Error("Duplicate student IDs were found in the import.");
  }
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("rosters"),
      name: v.string(),
      createdAt: v.number(),
      studentCount: v.number(),
      sessionCount: v.number(),
      latestSessionId: v.optional(v.id("sessions")),
    }),
  ),
  handler: async (ctx) => {
    const rosters = await ctx.db.query("rosters").order("desc").collect();

    return Promise.all(
      rosters.map(async (roster) => {
        const [students, sessions] = await Promise.all([
          ctx.db
            .query("students")
            .withIndex("by_rosterId_active_sortKey", (q) =>
              q.eq("rosterId", roster._id).eq("active", true),
            )
            .collect(),
          ctx.db
            .query("sessions")
            .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", roster._id))
            .collect(),
        ]);

        const latestSession = sessions.sort((left, right) => right.createdAt - left.createdAt)[0];

        return {
          _id: roster._id,
          name: roster.name,
          createdAt: roster.createdAt,
          studentCount: students.length,
          sessionCount: sessions.length,
          latestSessionId: latestSession?._id,
        };
      }),
    );
  },
});

export const getById = query({
  args: { rosterId: v.id("rosters") },
  returns: v.union(
    v.null(),
    v.object({
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
        createdAt: v.number(),
      }),
      students: v.array(
        v.object({
          _id: v.id("students"),
          studentId: v.string(),
          rawName: v.string(),
          firstName: v.string(),
          lastName: v.string(),
          displayName: v.string(),
          active: v.boolean(),
        }),
      ),
      sessions: v.array(
        v.object({
          _id: v.id("sessions"),
          title: v.string(),
          date: v.string(),
          isOpen: v.boolean(),
          editorToken: v.string(),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster) {
      return null;
    }

    const [students, sessions] = await Promise.all([
      ctx.db
        .query("students")
        .withIndex("by_rosterId_active_sortKey", (q) =>
          q.eq("rosterId", args.rosterId).eq("active", true),
        )
        .collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
    ]);

    return {
      roster: {
        _id: roster._id,
        name: roster.name,
        createdAt: roster.createdAt,
      },
      students: students.map((student) => ({
        _id: student._id,
        studentId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        active: student.active,
      })),
      sessions: sessions
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((session) => ({
          _id: session._id,
          title: session.title,
          date: session.date,
          isOpen: session.isOpen,
          editorToken: session.editorToken,
          createdAt: session.createdAt,
        })),
    };
  },
});

export const createEmpty = mutation({
  args: { name: v.string() },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    return ctx.db.insert("rosters", {
      name,
      createdAt: Date.now(),
    });
  },
});

export const importCsv = mutation({
  args: {
    name: v.string(),
    students: v.array(importedStudentValidator),
  },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const rosterId = await ctx.db.insert("rosters", {
      name,
      createdAt: Date.now(),
    });

    for (const student of args.students) {
      await ctx.db.insert("students", {
        rosterId,
        studentId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        active: true,
      });
    }

    return rosterId;
  },
});

export const rename = mutation({
  args: {
    rosterId: v.id("rosters"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster) {
      throw new Error("Roster not found.");
    }

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    await ctx.db.patch(args.rosterId, { name });
    return null;
  },
});

export const importIntoExisting = mutation({
  args: {
    rosterId: v.id("rosters"),
    name: v.string(),
    students: v.array(importedStudentValidator),
    deactivateMissing: v.optional(v.boolean()),
  },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster) {
      throw new Error("Roster not found.");
    }

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const existingStudents = await loadRosterStudents(ctx, args.rosterId);
    const existingByStudentId = new Map(
      existingStudents.map((student) => [student.studentId, student] as const),
    );

    await ctx.db.patch(args.rosterId, { name });

    if (args.deactivateMissing) {
      const incomingIds = new Set(args.students.map((student) => student.studentId));
      for (const existingStudent of existingStudents) {
        if (!incomingIds.has(existingStudent.studentId) && existingStudent.active) {
          await ctx.db.patch(existingStudent._id, { active: false });
        }
      }
    }

    for (const student of args.students) {
      const existingStudent = existingByStudentId.get(student.studentId);
      if (existingStudent) {
        await ctx.db.patch(existingStudent._id, {
          rawName: student.rawName,
          firstName: student.firstName,
          lastName: student.lastName,
          displayName: student.displayName,
          sortKey: student.sortKey,
          active: true,
        });
        continue;
      }

      await ctx.db.insert("students", {
        rosterId: args.rosterId,
        studentId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        active: true,
      });
    }

    return args.rosterId;
  },
});

export const seedDemo = mutation({
  args: {},
  returns: v.id("rosters"),
  handler: async (ctx) => {
    const rosterId = await ctx.db.insert("rosters", {
      name: "Grade 8 Homeroom Demo",
      createdAt: Date.now(),
    });

    for (const student of buildDemoRosterStudents()) {
      await ctx.db.insert("students", {
        rosterId,
        studentId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        active: true,
      });
    }

    return rosterId;
  },
});

export const remove = mutation({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster) {
      throw new Error("Roster not found.");
    }

    const [students, sessions] = await Promise.all([
      loadRosterStudents(ctx, args.rosterId),
      ctx.db
        .query("sessions")
        .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
    ]);

    for (const session of sessions) {
      const attendanceRows = await ctx.db
        .query("attendance")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .collect();

      for (const attendance of attendanceRows) {
        await ctx.db.delete(attendance._id);
      }

      await ctx.db.delete(session._id);
    }

    for (const student of students) {
      await ctx.db.delete(student._id);
    }

    await ctx.db.delete(args.rosterId);
    return null;
  },
});
