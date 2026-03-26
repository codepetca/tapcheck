import { v } from "convex/values";
import { buildDemoRosterStudents } from "../lib/demo-data";
import { mutation, query } from "./server";

const importedStudentValidator = v.object({
  studentId: v.string(),
  rawName: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  displayName: v.string(),
  sortKey: v.string(),
});

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
            .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", roster._id))
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
        .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", args.rosterId))
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

    if (args.students.length === 0) {
      throw new Error("At least one valid student is required.");
    }

    const duplicateIds = new Set<string>();
    const seenIds = new Set<string>();
    for (const student of args.students) {
      if (seenIds.has(student.studentId)) {
        duplicateIds.add(student.studentId);
      }
      seenIds.add(student.studentId);
    }

    if (duplicateIds.size > 0) {
      throw new Error("Duplicate student IDs were found in the import.");
    }

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
