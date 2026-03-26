import { v } from "convex/values";
import type { MutationCtx } from "./server";
import { mutation, query } from "./server";

async function tokenExists(ctx: MutationCtx, token: string) {
  const [editorMatch, viewerMatch] = await Promise.all([
    ctx.db
      .query("sessions")
      .withIndex("by_editorToken", (q) => q.eq("editorToken", token))
      .unique(),
    ctx.db
      .query("sessions")
      .withIndex("by_viewerToken", (q) => q.eq("viewerToken", token))
      .unique(),
  ]);

  return Boolean(editorMatch || viewerMatch);
}

export const create = mutation({
  args: {
    rosterId: v.id("rosters"),
    title: v.string(),
    date: v.string(),
    editorToken: v.string(),
    viewerToken: v.string(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster) {
      throw new Error("Roster not found.");
    }

    if (!args.title.trim()) {
      throw new Error("Session title is required.");
    }

    if (args.editorToken === args.viewerToken) {
      throw new Error("Editor and viewer tokens must be different.");
    }

    if ((await tokenExists(ctx, args.editorToken)) || (await tokenExists(ctx, args.viewerToken))) {
      throw new Error("Session token collision. Please try again.");
    }

    const students = await ctx.db
      .query("students")
      .withIndex("by_rosterId_active_sortKey", (q) =>
        q.eq("rosterId", args.rosterId).eq("active", true),
      )
      .collect();

    if (students.length === 0) {
      throw new Error("Roster has no active students.");
    }

    const createdAt = Date.now();

    const sessionId = await ctx.db.insert("sessions", {
      rosterId: args.rosterId,
      title: args.title.trim(),
      date: args.date,
      isOpen: true,
      editorToken: args.editorToken,
      viewerToken: args.viewerToken,
      createdAt,
    });

    for (const student of students) {
      await ctx.db.insert("attendance", {
        sessionId,
        studentRef: student._id,
        studentId: student.studentId,
        present: false,
        modifiedAt: createdAt,
      });
    }

    return sessionId;
  },
});

export const getSharePageData = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        editorToken: v.string(),
        viewerToken: v.string(),
        isOpen: v.boolean(),
      }),
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return null;
    }

    const roster = await ctx.db.get(session.rosterId);
    if (!roster) {
      return null;
    }

    return {
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        editorToken: session.editorToken,
        viewerToken: session.viewerToken,
        isOpen: session.isOpen,
      },
      roster: {
        _id: roster._id,
        name: roster.name,
      },
    };
  },
});
