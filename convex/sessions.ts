import { v } from "convex/values";
import { createShareToken } from "../lib/session-links";
import { requireAccessibleRoster } from "./auth";
import type { MutationCtx } from "./server";
import { mutation, query } from "./server";

async function tokenExists(ctx: MutationCtx, token: string) {
  const sessionMatch = await ctx.db
    .query("sessions")
    .withIndex("by_checkInToken", (q) => q.eq("checkInToken", token))
    .unique();

  return Boolean(sessionMatch);
}

async function createUniqueCheckInToken(ctx: MutationCtx) {
  let checkInToken = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    checkInToken = createShareToken();
    if (!(await tokenExists(ctx, checkInToken))) {
      return checkInToken;
    }
  }

  if (!checkInToken || (await tokenExists(ctx, checkInToken))) {
    throw new Error("Could not generate check-in link. Please try again.");
  }

  return checkInToken;
}

export const getByIdForStaff = query({
  args: {
    sessionId: v.id("sessions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed")),
        checkInToken: v.string(),
        createdAt: v.number(),
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

    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    return {
      session: {
        _id: session._id,
        title: session.title,
        date: session.date,
        status: session.status,
        checkInToken: session.checkInToken,
        createdAt: session.createdAt,
      },
      roster: {
        _id: roster._id,
        name: roster.name,
      },
    };
  },
});

export const getActiveForRoster = query({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("sessions"),
      status: v.union(v.literal("open"), v.literal("closed")),
      checkInToken: v.string(),
      date: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const activeSession = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_and_status", (q) => q.eq("rosterId", args.rosterId).eq("status", "open"))
      .unique();

    if (!activeSession) {
      return null;
    }

    return {
      _id: activeSession._id,
      status: activeSession.status,
      checkInToken: activeSession.checkInToken,
      date: activeSession.date,
    };
  },
});

export const getCheckInContext = query({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      session: v.object({
        _id: v.id("sessions"),
        title: v.string(),
        date: v.string(),
        status: v.union(v.literal("open"), v.literal("closed")),
      }),
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_checkInToken", (q) => q.eq("checkInToken", args.token))
      .unique();

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
        status: session.status,
      },
      roster: {
        _id: roster._id,
        name: roster.name,
      },
    };
  },
});

export const getDisplayContext = query({
  args: {
    sessionId: v.id("sessions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      rosterName: v.string(),
      checkInToken: v.string(),
      status: v.union(v.literal("open"), v.literal("closed")),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return null;
    }

    const { roster } = await requireAccessibleRoster(ctx, session.rosterId);
    return {
      title: session.title,
      rosterName: roster.name,
      checkInToken: session.checkInToken,
      status: session.status,
    };
  },
});

export const start = mutation({
  args: {
    rosterId: v.id("rosters"),
    date: v.string(),
  },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);

    const existingOpenSession = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_and_status", (q) => q.eq("rosterId", args.rosterId).eq("status", "open"))
      .unique();

    if (existingOpenSession) {
      throw new Error("This roster already has an active session.");
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
    const checkInToken = await createUniqueCheckInToken(ctx);

    const sessionId = await ctx.db.insert("sessions", {
      rosterId: args.rosterId,
      title: roster.name,
      date: args.date,
      sessionType: "recurring_class",
      participantMode: "verified",
      status: "open",
      createdByAppUserId: appUser._id,
      checkInToken,
      createdAt,
      updatedAt: createdAt,
      openedAt: createdAt,
    });

    for (const participant of participants) {
      await ctx.db.insert("attendance_records", {
        sessionId,
        participantId: participant._id,
        linkedAppUserId: participant.linkedAppUserId,
        status: "unmarked",
        modifiedAt: createdAt,
      });
    }

    return sessionId;
  },
});

export const create = start;

export const close = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }

    const { appUser } = await requireAccessibleRoster(ctx, session.rosterId);

    if (session.status === "closed") {
      return null;
    }

    const attendanceRows = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .collect();

    const now = Date.now();

    for (const attendanceRow of attendanceRows) {
      if (attendanceRow.status !== "unmarked") {
        continue;
      }

      await ctx.db.patch(attendanceRow._id, {
        status: "absent",
        source: "system_finalize",
        modifiedAt: now,
        modifiedByAppUserId: appUser._id,
      });

      await ctx.db.insert("attendance_events", {
        sessionId: session._id,
        participantId: attendanceRow.participantId,
        actorAppUserId: appUser._id,
        actorType: "system",
        eventType: "session_finalize",
        fromStatus: "unmarked",
        toStatus: "absent",
        result: "applied",
        createdAt: now,
      });
    }

    await ctx.db.patch(args.sessionId, {
      status: "closed",
      closedAt: now,
      closedByAppUserId: appUser._id,
      updatedAt: now,
    });
    return null;
  },
});

export const stop = close;
