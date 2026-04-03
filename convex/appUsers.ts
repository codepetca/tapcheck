import { v } from "convex/values";
import { ensureCurrentAppUser, getCurrentAppUserResult, getCurrentAppUserWithIdentity } from "./auth";
import { mutation, query } from "./server";

const currentAppUserResult = v.object({
  _id: v.id("app_users"),
  displayName: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled"), v.literal("merged")),
  createdAt: v.number(),
  identity: v.optional(
    v.object({
      provider: v.literal("clerk"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
  ),
  defaultOrganization: v.optional(
    v.object({
      _id: v.id("organizations"),
      name: v.string(),
      role: v.union(v.literal("student"), v.literal("staff"), v.literal("admin")),
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

    return getCurrentAppUserResult(
      result.appUser,
      result.authIdentity,
      result.defaultOrganization,
      result.defaultMembership,
    );
  },
});

export const ensureCurrent = mutation({
  args: {},
  returns: currentAppUserResult,
  handler: async (ctx) => ensureCurrentAppUser(ctx),
});
