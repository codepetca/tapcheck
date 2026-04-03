import { v } from "convex/values";
import { createShareToken } from "../lib/session-links";
import { requireAccessibleRoster } from "./auth";
import type { MutationCtx } from "./server";
import { mutation } from "./server";

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
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);

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

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) =>
        q.eq("rosterId", args.rosterId).eq("active", true),
      )
      .collect();

    if (participants.length === 0) {
      throw new Error("Roster has no active students.");
    }

    const createdAt = Date.now();

    const sessionId = await ctx.db.insert("sessions", {
      rosterId: args.rosterId,
      title: roster.name,
      date: args.date,
      sessionType: "recurring_class",
      participantMode: "roster_only",
      isOpen: true,
      createdByAppUserId: appUser._id,
      editorToken,
      createdAt,
      updatedAt: createdAt,
      openedAt: createdAt,
    });

    for (const participant of participants) {
      await ctx.db.insert("attendance_records", {
        sessionId,
        participantId: participant._id,
        linkedAppUserId: participant.linkedAppUserId,
        status: "absent",
        source: "override",
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
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    await requireAccessibleRoster(ctx, session.rosterId);

    if (!session.isOpen) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      isOpen: false,
      closedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const resume = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    await requireAccessibleRoster(ctx, session.rosterId);

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

    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      isOpen: true,
      openedAt: now,
      updatedAt: now,
    });
    return null;
  },
});
