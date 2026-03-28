import type { Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type AuthCtx = QueryCtx | MutationCtx;

export async function requireAuthenticatedIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Not authenticated.");
  }

  return identity;
}

export async function getAuthenticatedTokenIdentifier(ctx: AuthCtx) {
  const identity = await requireAuthenticatedIdentity(ctx);
  return identity.tokenIdentifier;
}

export async function getOwnedRoster(ctx: AuthCtx, rosterId: Id<"rosters">) {
  const ownerTokenIdentifier = await getAuthenticatedTokenIdentifier(ctx);
  const roster = await ctx.db.get(rosterId);

  if (!roster || roster.ownerTokenIdentifier !== ownerTokenIdentifier) {
    return null;
  }

  return roster;
}

export async function requireOwnedRoster(ctx: AuthCtx, rosterId: Id<"rosters">) {
  const roster = await getOwnedRoster(ctx, rosterId);

  if (!roster) {
    throw new Error("Roster not found.");
  }

  return roster;
}

export async function getOwnedSession(ctx: AuthCtx, sessionId: Id<"sessions">) {
  const ownerTokenIdentifier = await getAuthenticatedTokenIdentifier(ctx);
  const session = await ctx.db.get(sessionId);

  if (!session) {
    return null;
  }

  const roster = await ctx.db.get(session.rosterId);
  if (!roster || roster.ownerTokenIdentifier !== ownerTokenIdentifier) {
    return null;
  }

  return { roster, session };
}

export async function requireOwnedSession(ctx: AuthCtx, sessionId: Id<"sessions">) {
  const ownedSession = await getOwnedSession(ctx, sessionId);

  if (!ownedSession) {
    throw new Error("Session not found.");
  }

  return ownedSession;
}
