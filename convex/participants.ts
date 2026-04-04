import { v } from "convex/values";
import { requireAccessibleRoster } from "./auth";
import { autoLinkParticipant, resolveParticipantLink, applyParticipantLink } from "./participantLinks";
import { query, mutation } from "./server";

export const getRosterLinkSummary = query({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.union(
    v.null(),
    v.object({
      totalActiveParticipants: v.number(),
      linkedCount: v.number(),
      unlinkedCount: v.number(),
      ambiguousCount: v.number(),
      reviewNeededCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", roster._id).eq("active", true))
      .collect();

    return {
      totalActiveParticipants: participants.length,
      linkedCount: participants.filter((participant) => participant.linkStatus === "linked").length,
      unlinkedCount: participants.filter((participant) => participant.linkStatus === "unlinked").length,
      ambiguousCount: participants.filter((participant) => participant.linkStatus === "ambiguous").length,
      reviewNeededCount: participants.filter((participant) => participant.linkStatus === "review_needed").length,
    };
  },
});

export const listLinkIssues = query({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        participantId: v.id("participants"),
        displayName: v.string(),
        studentId: v.optional(v.string()),
        schoolEmail: v.optional(v.string()),
        linkStatus: v.union(
          v.literal("linked"),
          v.literal("unlinked"),
          v.literal("ambiguous"),
          v.literal("review_needed"),
        ),
        linkedAppUserId: v.optional(v.id("app_users")),
        candidates: v.array(
          v.object({
            appUserId: v.id("app_users"),
            displayName: v.string(),
            studentId: v.optional(v.string()),
            schoolEmail: v.optional(v.string()),
          }),
        ),
        suggestedReasonCode: v.optional(v.string()),
      }),
    ),
  ),
  handler: async (ctx, args) => {
    const { roster } = await requireAccessibleRoster(ctx, args.rosterId);

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", roster._id).eq("active", true))
      .collect();

    const issueRows = await Promise.all(
      participants.map(async (participant) => {
        const resolution = await resolveParticipantLink(ctx, roster.organizationId, {
          studentId: participant.externalId,
          schoolEmail: participant.schoolEmail,
        });

        if (participant.linkStatus === "linked" && resolution.kind === "matched") {
          return null;
        }

        return {
          participantId: participant._id,
          displayName: participant.displayName,
          studentId: participant.externalId,
          schoolEmail: participant.schoolEmail,
          linkStatus: participant.linkStatus,
          linkedAppUserId: participant.linkedAppUserId,
          candidates: resolution.candidates,
          suggestedReasonCode: resolution.kind === "matched" ? undefined : resolution.reasonCode,
        };
      }),
    );

    return issueRows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

export const autoLinkRosterParticipants = mutation({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.object({
    linkedCount: v.number(),
    ambiguousCount: v.number(),
    unmatchedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);

    const participants = await ctx.db
      .query("participants")
      .withIndex("by_rosterId_active_sortKey", (q) => q.eq("rosterId", roster._id).eq("active", true))
      .collect();

    let linkedCount = 0;
    let ambiguousCount = 0;
    let unmatchedCount = 0;

    for (const participant of participants) {
      const outcome = await autoLinkParticipant(ctx, roster, participant, appUser._id);
      if (outcome.kind === "matched") {
        linkedCount += 1;
      } else if (outcome.kind === "ambiguous") {
        ambiguousCount += 1;
      } else {
        unmatchedCount += 1;
      }
    }

    return {
      linkedCount,
      ambiguousCount,
      unmatchedCount,
    };
  },
});

export const linkParticipantToAppUser = mutation({
  args: {
    participantId: v.id("participants"),
    appUserId: v.id("app_users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) {
      throw new Error("Participant not found.");
    }

    const { roster, appUser } = await requireAccessibleRoster(ctx, participant.rosterId);
    const membership = await ctx.db
      .query("organization_memberships")
      .withIndex("by_appUserId_organizationId", (q) =>
        q.eq("appUserId", args.appUserId).eq("organizationId", roster.organizationId),
      )
      .unique();

    if (!membership || membership.status !== "active" || membership.role !== "student") {
      throw new Error("Selected user is not an active student in this organization.");
    }

    await applyParticipantLink(ctx, participant, {
      linkedAppUserId: args.appUserId,
      linkStatus: "linked",
      linkMethod: "manual_staff",
      linkedByAppUserId: appUser._id,
    });

    return null;
  },
});

export const unlinkParticipant = mutation({
  args: {
    participantId: v.id("participants"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId);
    if (!participant) {
      throw new Error("Participant not found.");
    }

    await requireAccessibleRoster(ctx, participant.rosterId);
    await applyParticipantLink(ctx, participant, {
      linkStatus: "unlinked",
    });
    return null;
  },
});
