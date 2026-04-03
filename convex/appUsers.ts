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

function needsSharedIdentityBootstrap(result: Awaited<ReturnType<typeof getCurrentAppUserWithIdentity>>) {
  if (!result.appUser || !result.authIdentity) {
    return true;
  }

  if (!result.appUser.status || !result.appUser.updatedAt) {
    return true;
  }

  if (!result.defaultOrganization || !result.defaultMembership) {
    return true;
  }

  if (!result.authIdentity.emailSnapshot && result.authIdentity.email) {
    return true;
  }

  if (!result.authIdentity.nameSnapshot && result.authIdentity.name) {
    return true;
  }

  if (!result.authIdentity.lastSeenAt) {
    return true;
  }

  return false;
}

export const getCurrent = query({
  args: {},
  returns: v.union(v.null(), currentAppUserResult),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const result = await getCurrentAppUserWithIdentity(ctx);
    if (needsSharedIdentityBootstrap(result)) {
      return null;
    }

    if (!result.appUser || !result.authIdentity) {
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
