import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type AuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

type AuthIdentityDoc = Doc<"auth_identities">;
type AppUserDoc = Doc<"app_users">;
type MembershipDoc = Doc<"organization_memberships">;
type OrganizationDoc = Doc<"organizations">;

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

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildOrganizationName(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? `${trimmed}'s workspace` : "Tapcheck workspace";
}

function buildOrganizationSlug(displayName: string, appUserId: Id<"app_users">) {
  const base = slugify(displayName) || "tapcheck-workspace";
  return `${base}-${String(appUserId).slice(-8).toLocaleLowerCase()}`;
}

function getAppUserStatus(appUser: Pick<AppUserDoc, "status">) {
  return appUser.status ?? "active";
}

function toCurrentAppUserResult(
  appUser: AppUserDoc,
  authIdentity: AuthIdentityDoc | null,
  organization: OrganizationDoc | null,
  membership: MembershipDoc | null,
) {
  return {
    _id: appUser._id,
    displayName: appUser.displayName,
    status: getAppUserStatus(appUser),
    createdAt: appUser.createdAt,
    identity: authIdentity
      ? {
          provider: authIdentity.provider,
          email: authIdentity.emailSnapshot ?? authIdentity.email,
          name: authIdentity.nameSnapshot ?? authIdentity.name,
        }
      : undefined,
    defaultOrganization:
      organization && membership
        ? {
            _id: organization._id,
            name: organization.name,
            role: membership.role,
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

async function getActiveMembership(
  ctx: AuthCtx,
  appUserId: Id<"app_users">,
  organizationId: Id<"organizations">,
) {
  const membership = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_organizationId", (q) =>
      q.eq("appUserId", appUserId).eq("organizationId", organizationId),
    )
    .unique();

  if (!membership || membership.status !== "active") {
    return null;
  }

  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.status !== "active") {
    return null;
  }

  return {
    membership,
    organization,
  };
}

export async function listCurrentMemberships(ctx: AuthCtx, appUserId: Id<"app_users">) {
  const memberships = await ctx.db
    .query("organization_memberships")
    .withIndex("by_appUserId_status", (q) => q.eq("appUserId", appUserId).eq("status", "active"))
    .collect();

  const resolved = await Promise.all(
    memberships.map(async (membership) => {
      const organization = await ctx.db.get(membership.organizationId);
      if (!organization || organization.status !== "active") {
        return null;
      }

      return {
        membership,
        organization,
      };
    }),
  );

  return resolved.filter(
    (entry): entry is { membership: MembershipDoc; organization: OrganizationDoc } => entry !== null,
  );
}

async function getDefaultOrganizationMembership(ctx: AuthCtx, appUser: AppUserDoc) {
  if (appUser.defaultOrganizationId) {
    const existing = await getActiveMembership(ctx, appUser._id, appUser.defaultOrganizationId);
    if (existing) {
      return existing;
    }
  }

  const memberships = await listCurrentMemberships(ctx, appUser._id);
  return memberships[0] ?? null;
}

async function ensureDefaultOrganizationMembership(ctx: MutationCtx, appUser: AppUserDoc) {
  const existing = await getDefaultOrganizationMembership(ctx, appUser);
  if (existing) {
    if (appUser.defaultOrganizationId !== existing.organization._id) {
      await ctx.db.patch(appUser._id, {
        defaultOrganizationId: existing.organization._id,
        updatedAt: Date.now(),
      });
    }

    return existing;
  }

  const now = Date.now();
  const organizationId = await ctx.db.insert("organizations", {
    name: buildOrganizationName(appUser.displayName),
    slug: buildOrganizationSlug(appUser.displayName, appUser._id),
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const membershipId = await ctx.db.insert("organization_memberships", {
    appUserId: appUser._id,
    organizationId,
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(appUser._id, {
    defaultOrganizationId: organizationId,
    updatedAt: now,
  });

  const [organization, membership] = await Promise.all([
    ctx.db.get(organizationId),
    ctx.db.get(membershipId),
  ]);

  if (!organization || !membership) {
    throw new Error("Default organization could not be created.");
  }

  return {
    organization,
    membership,
  };
}

async function ensureLegacyRosterAccess(
  ctx: MutationCtx,
  args: {
    appUser: AppUserDoc;
    organization: OrganizationDoc;
    membership: MembershipDoc;
  },
) {
  const legacyRosters = await ctx.db
    .query("rosters")
    .withIndex("by_ownerAppUserId_createdAt", (q) => q.eq("ownerAppUserId", args.appUser._id))
    .collect();

  for (const roster of legacyRosters) {
    const rosterUpdatedAt = roster.updatedAt ?? roster.createdAt;
    if (!roster.organizationId || !roster.createdByAppUserId || !roster.updatedAt) {
      await ctx.db.patch(roster._id, {
        ownerAppUserId: roster.ownerAppUserId ?? args.appUser._id,
        organizationId: roster.organizationId ?? args.organization._id,
        createdByAppUserId: roster.createdByAppUserId ?? roster.ownerAppUserId ?? args.appUser._id,
        updatedAt: rosterUpdatedAt,
      });
    }

    const existingRosterAccess = await ctx.db
      .query("roster_access")
      .withIndex("by_rosterId_membershipId", (q) =>
        q.eq("rosterId", roster._id).eq("membershipId", args.membership._id),
      )
      .unique();

    if (!existingRosterAccess) {
      await ctx.db.insert("roster_access", {
        rosterId: roster._id,
        membershipId: args.membership._id,
        accessRole: args.membership.role === "admin" ? "admin" : "staff",
        createdAt: roster.createdAt,
        updatedAt: rosterUpdatedAt,
      });
    }

    const legacyStudents = await ctx.db
      .query("students")
      .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", roster._id))
      .collect();

    const participantIdsByStudentRef = new Map<Id<"students">, Id<"participants">>();

    for (const legacyStudent of legacyStudents) {
      let participant = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_externalId", (q) =>
          q.eq("rosterId", roster._id).eq("externalId", legacyStudent.studentId),
        )
        .unique();

      if (!participant) {
        const participantId = await ctx.db.insert("participants", {
          rosterId: roster._id,
          externalId: legacyStudent.studentId,
          rawName: legacyStudent.rawName,
          firstName: legacyStudent.firstName,
          lastName: legacyStudent.lastName,
          displayName: legacyStudent.displayName,
          sortKey: legacyStudent.sortKey,
          participantType: "roster_only",
          active: legacyStudent.active,
          createdAt: roster.createdAt,
          updatedAt: rosterUpdatedAt,
        });
        participant = await ctx.db.get(participantId);
      }

      if (participant) {
        participantIdsByStudentRef.set(legacyStudent._id, participant._id);
      }
    }

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", roster._id))
      .collect();

    for (const session of sessions) {
      if (!session.sessionType || !session.participantMode || !session.createdByAppUserId || !session.updatedAt) {
        await ctx.db.patch(session._id, {
          sessionType: session.sessionType ?? "recurring_class",
          participantMode: session.participantMode ?? "roster_only",
          createdByAppUserId: session.createdByAppUserId ?? roster.ownerAppUserId ?? args.appUser._id,
          openedAt: session.openedAt ?? session.createdAt,
          updatedAt: session.updatedAt ?? session.createdAt,
        });
      }

      const legacyAttendance = await ctx.db
        .query("attendance")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .collect();

      for (const row of legacyAttendance) {
        const participantId = participantIdsByStudentRef.get(row.studentRef);
        if (!participantId) {
          continue;
        }

        const existingRecord = await ctx.db
          .query("attendance_records")
          .withIndex("by_sessionId_participantId", (q) =>
            q.eq("sessionId", session._id).eq("participantId", participantId),
          )
          .unique();

        if (existingRecord) {
          continue;
        }

        await ctx.db.insert("attendance_records", {
          sessionId: session._id,
          participantId,
          status: row.present ? "present" : "absent",
          source: row.modifiedViaTokenType === "editor" ? "shared_editor" : "override",
          markedAt: row.present ? row.markedAt : undefined,
          modifiedAt: row.modifiedAt,
        });
      }
    }
  }
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
  const defaultMembership = appUser ? await getDefaultOrganizationMembership(ctx, appUser) : null;

  return {
    identity,
    authIdentity,
    appUser,
    defaultOrganization: defaultMembership?.organization ?? null,
    defaultMembership: defaultMembership?.membership ?? null,
  };
}

export async function requireCurrentAppUser(ctx: AuthCtx) {
  const result = await getCurrentAppUserWithIdentity(ctx);
  if (!result.appUser || !result.authIdentity) {
    throw new Error("User account has not been initialized.");
  }

  if (getAppUserStatus(result.appUser) !== "active") {
    throw new Error("User account is not active.");
  }

  return {
    identity: result.identity,
    authIdentity: result.authIdentity,
    appUser: result.appUser,
    defaultOrganization: result.defaultOrganization,
    defaultMembership: result.defaultMembership,
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

    const identityPatch: Partial<
      Pick<
        AuthIdentityDoc,
        | "tokenIdentifier"
        | "email"
        | "name"
        | "emailSnapshot"
        | "nameSnapshot"
        | "lastSeenAt"
        | "updatedAt"
      >
    > = {
      lastSeenAt: now,
    };

    if (existingIdentity.tokenIdentifier !== identity.tokenIdentifier) {
      identityPatch.tokenIdentifier = identity.tokenIdentifier;
    }
    if (existingIdentity.email !== normalizedEmail) {
      identityPatch.email = normalizedEmail;
    }
    if (existingIdentity.name !== identity.name) {
      identityPatch.name = identity.name;
    }
    if (existingIdentity.emailSnapshot !== normalizedEmail) {
      identityPatch.emailSnapshot = normalizedEmail;
    }
    if (existingIdentity.nameSnapshot !== identity.name) {
      identityPatch.nameSnapshot = identity.name;
    }
    if (
      existingIdentity.tokenIdentifier !== identity.tokenIdentifier ||
      existingIdentity.email !== normalizedEmail ||
      existingIdentity.name !== identity.name ||
      existingIdentity.emailSnapshot !== normalizedEmail ||
      existingIdentity.nameSnapshot !== identity.name ||
      existingIdentity.lastSeenAt !== now
    ) {
      identityPatch.updatedAt = now;
    }

    await ctx.db.patch(existingIdentity._id, identityPatch);

    const appUserPatch: Partial<Pick<AppUserDoc, "displayName" | "status" | "updatedAt">> = {};
    if (appUser.displayName !== displayName) {
      appUserPatch.displayName = displayName;
    }
    if (!appUser.status) {
      appUserPatch.status = "active";
    }
    if (!appUser.updatedAt || Object.keys(appUserPatch).length > 0) {
      appUserPatch.updatedAt = now;
    }
    if (Object.keys(appUserPatch).length > 0) {
      await ctx.db.patch(appUser._id, appUserPatch);
    }

    const refreshedAppUser = await ctx.db.get(appUser._id);
    const refreshedIdentity = await ctx.db.get(existingIdentity._id);
    if (!refreshedAppUser || !refreshedIdentity) {
      throw new Error("User account could not be loaded.");
    }

    const defaultMembership = await ensureDefaultOrganizationMembership(ctx, refreshedAppUser);
    await ensureLegacyRosterAccess(ctx, {
      appUser: refreshedAppUser,
      organization: defaultMembership.organization,
      membership: defaultMembership.membership,
    });
    const finalAppUser = (await ctx.db.get(refreshedAppUser._id)) ?? refreshedAppUser;

    return toCurrentAppUserResult(
      finalAppUser,
      refreshedIdentity,
      defaultMembership.organization,
      defaultMembership.membership,
    );
  }

  const appUserId = await ctx.db.insert("app_users", {
    displayName,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const authIdentityId = await ctx.db.insert("auth_identities", {
    appUserId,
    provider: "clerk",
    providerSubject: identity.subject,
    tokenIdentifier: identity.tokenIdentifier,
    email: normalizedEmail,
    name: identity.name,
    emailSnapshot: normalizedEmail,
    nameSnapshot: identity.name,
    lastSeenAt: now,
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

  const defaultMembership = await ensureDefaultOrganizationMembership(ctx, appUser);
  await ensureLegacyRosterAccess(ctx, {
    appUser,
    organization: defaultMembership.organization,
    membership: defaultMembership.membership,
  });
  const finalAppUser = (await ctx.db.get(appUser._id)) ?? appUser;

  return toCurrentAppUserResult(
    finalAppUser,
    authIdentity,
    defaultMembership.organization,
    defaultMembership.membership,
  );
}

export async function requireCurrentOrganizationMembership(
  ctx: AuthCtx,
  organizationId?: Id<"organizations">,
) {
  const { appUser } = await requireCurrentAppUser(ctx);

  const resolved =
    organizationId
      ? await getActiveMembership(ctx, appUser._id, organizationId)
      : await getDefaultOrganizationMembership(ctx, appUser);

  if (!resolved) {
    throw new Error("No active organization membership was found.");
  }

  return {
    appUser,
    membership: resolved.membership,
    organization: resolved.organization,
  };
}

export async function requireAccessibleRoster(ctx: AuthCtx, rosterId: Id<"rosters">) {
  const roster = await ctx.db.get(rosterId);
  if (!roster) {
    throw new Error("Roster not found.");
  }

  if (!roster.organizationId && roster.ownerAppUserId) {
    const { appUser } = await requireCurrentAppUser(ctx);
    if (roster.ownerAppUserId !== appUser._id) {
      throw new Error("Unauthorized.");
    }

    const defaultMembership = await getDefaultOrganizationMembership(ctx, appUser);
    if (!defaultMembership) {
      throw new Error("No active organization membership was found.");
    }

    return {
      roster,
      rosterAccess: null,
      appUser,
      membership: defaultMembership.membership,
      organization: defaultMembership.organization,
    };
  }

  if (!roster.organizationId) {
    throw new Error("Roster is missing an organization.");
  }

  const { appUser, membership, organization } = await requireCurrentOrganizationMembership(
    ctx,
    roster.organizationId,
  );

  const rosterAccess = await ctx.db
    .query("roster_access")
    .withIndex("by_rosterId_membershipId", (q) =>
      q.eq("rosterId", rosterId).eq("membershipId", membership._id),
    )
    .unique();

  if (!rosterAccess) {
    throw new Error("Unauthorized.");
  }

  return {
    roster,
    rosterAccess,
    appUser,
    membership,
    organization,
  };
}

export function getCurrentAppUserResult(
  appUser: AppUserDoc,
  authIdentity: AuthIdentityDoc | null,
  organization: OrganizationDoc | null,
  membership: MembershipDoc | null,
) {
  return toCurrentAppUserResult(appUser, authIdentity, organization, membership);
}
