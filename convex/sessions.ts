import { v } from "convex/values";
import { createShareToken } from "../lib/session-links";
import { requireOwnedRoster, requireOwnedSession } from "./auth";
import type { MutationCtx } from "./server";
import { mutation, query } from "./server";

async function tokenExists(ctx: MutationCtx, token: string) {
  const editorMatch = await ctx.db
    .query("sessions")
    .withIndex("by_editorToken", (q) => q.eq("editorToken", token))
    .unique();

  return Boolean(editorMatch);
}

export const create = mutation({
  args: {
    rosterId: v.id("rosters"),
    date: v.string(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    const roster = await requireOwnedRoster(ctx, args.rosterId);

    const existingSessions = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
      .collect();

    if (existingSessions.length > 0) {
      throw new Error("This roster already has a session.");
    }

    let editorToken = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      editorToken = createShareToken();
      if (!(await tokenExists(ctx, editorToken))) {
        break;
      }
    }

    if (!editorToken || (await tokenExists(ctx, editorToken))) {
      throw new Error("Could not generate editor link. Please try again.");
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
      title: roster.name,
      date: args.date,
      isOpen: true,
      editorToken,
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

export const stop = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { session } = await requireOwnedSession(ctx, args.sessionId);

    if (!session.isOpen) {
      return null;
    }

    await ctx.db.patch(args.sessionId, { isOpen: false });
    return null;
  },
});

export const resume = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { session } = await requireOwnedSession(ctx, args.sessionId);

    if (session.isOpen) {
      return null;
    }

    const rosterSessions = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", session.rosterId))
      .collect();

    if (rosterSessions.some((rosterSession) => rosterSession.isOpen)) {
      throw new Error("This roster already has an active session.");
    }

    await ctx.db.patch(args.sessionId, { isOpen: true });
    return null;
  },
});

export const getEditorLink = query({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    editorToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const ownedSession = await requireOwnedSession(ctx, args.sessionId);

    return {
      editorToken: ownedSession.session.editorToken,
    };
  },
});
