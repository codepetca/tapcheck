import { v } from "convex/values";
import { ensureCurrentAppUser, getCurrentAppUserResult, getCurrentAppUserWithIdentity } from "./auth";
import { mutation, query } from "./server";

const currentAppUserResult = v.object({
  _id: v.id("app_users"),
  displayName: v.string(),
  createdAt: v.number(),
  identity: v.optional(
    v.object({
      provider: v.literal("clerk"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
  ),
});

export const getCurrent = query({
  args: {},
  returns: v.union(v.null(), currentAppUserResult),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const result = await getCurrentAppUserWithIdentity(ctx);
    if (!result.appUser) {
      return null;
    }

    return getCurrentAppUserResult(result.appUser, result.authIdentity);
  },
});

export const ensureCurrent = mutation({
  args: {},
  returns: currentAppUserResult,
  handler: async (ctx) => ensureCurrentAppUser(ctx),
});
