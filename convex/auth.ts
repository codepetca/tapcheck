import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type AuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase();
}

function getDisplayName(identity: UserIdentity) {
  const name = identity.name?.trim();
  if (name && name.length > 0) {
    return name;
  }

  if (identity.email) {
    return normalizeEmail(identity.email);
  }

  return identity.subject;
}

type AuthIdentityDoc = Doc<"auth_identities">;
type AppUserDoc = Doc<"app_users">;

function toCurrentAppUserResult(appUser: AppUserDoc, authIdentity: AuthIdentityDoc | null) {
  return {
    _id: appUser._id,
    displayName: appUser.displayName,
    createdAt: appUser.createdAt,
    identity: authIdentity
      ? {
          provider: authIdentity.provider,
          email: authIdentity.email,
          name: authIdentity.name,
        }
      : undefined,
  };
}

async function getAuthIdentityByProviderSubject(ctx: AuthCtx, providerSubject: string) {
  return ctx.db
    .query("auth_identities")
    .withIndex("by_provider_and_providerSubject", (q) =>
      q.eq("provider", "clerk").eq("providerSubject", providerSubject),
    )
    .unique();
}

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated.");
  }

  return identity;
}

export async function getCurrentAppUserWithIdentity(ctx: AuthCtx) {
  const identity = await requireIdentity(ctx);

  const authIdentity = await ctx.db
    .query("auth_identities")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  const appUser = authIdentity ? await ctx.db.get(authIdentity.appUserId) : null;

  return {
    identity,
    authIdentity,
    appUser,
  };
}

export async function requireCurrentAppUser(ctx: AuthCtx) {
  const result = await getCurrentAppUserWithIdentity(ctx);
  if (!result.appUser || !result.authIdentity) {
    throw new Error("User account has not been initialized.");
  }

  return {
    identity: result.identity,
    authIdentity: result.authIdentity,
    appUser: result.appUser,
  };
}

export async function ensureCurrentAppUser(ctx: MutationCtx) {
  const identity = await requireIdentity(ctx);
  const normalizedEmail = identity.email ? normalizeEmail(identity.email) : undefined;
  const displayName = getDisplayName(identity);
  const now = Date.now();

  const existingByTokenIdentifier = await ctx.db
    .query("auth_identities")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  const existingIdentity =
    existingByTokenIdentifier ?? (await getAuthIdentityByProviderSubject(ctx, identity.subject));

  if (existingIdentity) {
    const appUser = await ctx.db.get(existingIdentity.appUserId);
    if (!appUser) {
      throw new Error("Linked app user was not found.");
    }

    const identityPatch: Partial<AuthIdentityDoc> = {};
    if (existingIdentity.tokenIdentifier !== identity.tokenIdentifier) {
      identityPatch.tokenIdentifier = identity.tokenIdentifier;
    }
    if (existingIdentity.email !== normalizedEmail) {
      identityPatch.email = normalizedEmail;
    }
    if (existingIdentity.name !== identity.name) {
      identityPatch.name = identity.name;
    }
    if (Object.keys(identityPatch).length > 0) {
      identityPatch.updatedAt = now;
      await ctx.db.patch(existingIdentity._id, identityPatch);
    }

    if (appUser.displayName !== displayName) {
      await ctx.db.patch(appUser._id, {
        displayName,
      });
    }

    const refreshedAppUser = await ctx.db.get(appUser._id);
    const refreshedIdentity = await ctx.db.get(existingIdentity._id);
    if (!refreshedAppUser || !refreshedIdentity) {
      throw new Error("User account could not be loaded.");
    }

    return toCurrentAppUserResult(refreshedAppUser, refreshedIdentity);
  }

  const appUserId = await ctx.db.insert("app_users", {
    displayName,
    createdAt: now,
  });

  const authIdentityId = await ctx.db.insert("auth_identities", {
    appUserId,
    provider: "clerk",
    providerSubject: identity.subject,
    tokenIdentifier: identity.tokenIdentifier,
    email: normalizedEmail,
    name: identity.name,
    createdAt: now,
    updatedAt: now,
  });

  const [appUser, authIdentity] = await Promise.all([
    ctx.db.get(appUserId),
    ctx.db.get(authIdentityId),
  ]);

  if (!appUser || !authIdentity) {
    throw new Error("User account could not be created.");
  }

  return toCurrentAppUserResult(appUser, authIdentity);
}

export async function requireOwnedRoster(ctx: AuthCtx, rosterId: Id<"rosters">) {
  const [roster, { appUser }] = await Promise.all([ctx.db.get(rosterId), requireCurrentAppUser(ctx)]);

  if (!roster) {
    throw new Error("Roster not found.");
  }

  if (!roster.ownerAppUserId || roster.ownerAppUserId !== appUser._id) {
    throw new Error("Unauthorized.");
  }

  return {
    roster,
    appUser,
  };
}

export function getCurrentAppUserResult(appUser: AppUserDoc, authIdentity: AuthIdentityDoc | null) {
  return toCurrentAppUserResult(appUser, authIdentity);
}
