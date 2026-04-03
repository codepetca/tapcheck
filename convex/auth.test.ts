// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("shared identity bootstrap and roster authorization", () => {
  it("creates one app user, one auth identity, and a default organization membership on first authenticated bootstrap", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "clerk|teacher-1",
      tokenIdentifier: "token-teacher-1",
      email: "teacher@example.com",
      name: "Teacher One",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser.displayName).toBe("Teacher One");
    expect(currentUser.defaultOrganization?.role).toBe("admin");

    await t.run(async (ctx) => {
      const appUsers = await ctx.db.query("app_users").collect();
      const authIdentities = await ctx.db.query("auth_identities").collect();
      const organizations = await ctx.db.query("organizations").collect();
      const memberships = await ctx.db.query("organization_memberships").collect();

      expect(appUsers).toHaveLength(1);
      expect(authIdentities).toHaveLength(1);
      expect(organizations).toHaveLength(1);
      expect(memberships).toHaveLength(1);
      expect(appUsers[0]?.defaultOrganizationId).toBe(organizations[0]?._id);
      expect(authIdentities[0]).toMatchObject({
        appUserId: currentUser._id,
        provider: "clerk",
        providerSubject: "clerk|teacher-1",
        tokenIdentifier: "token-teacher-1",
        emailSnapshot: "teacher@example.com",
        nameSnapshot: "Teacher One",
      });
      expect(memberships[0]).toMatchObject({
        appUserId: currentUser._id,
        organizationId: organizations[0]?._id,
        role: "admin",
        status: "active",
      });
    });
  });

  it("scopes roster list and roster detail to explicit roster access, not just authentication", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({
      subject: "clerk|owner-1",
      tokenIdentifier: "token-owner-1",
      email: "owner@example.com",
      name: "Owner One",
    });
    const stranger = t.withIdentity({
      subject: "clerk|owner-2",
      tokenIdentifier: "token-owner-2",
      email: "other@example.com",
      name: "Owner Two",
    });

    const rosterId = await owner.mutation(api.rosters.createEmpty, {
      name: "Homeroom",
    });
    await stranger.mutation(api.appUsers.ensureCurrent, {});

    expect(await owner.query(api.rosters.list, {})).toHaveLength(1);
    expect(await stranger.query(api.rosters.list, {})).toHaveLength(0);
    expect(await owner.query(api.rosters.getById, { rosterId })).not.toBeNull();
    expect(await stranger.query(api.rosters.getById, { rosterId })).toBeNull();
  });

  it("allows the same canonical user to hold different roles across organizations", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "clerk|multi-role-1",
      tokenIdentifier: "token-multi-role-1",
      email: "multi@example.com",
      name: "Multi Role User",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const appUser = await ctx.db.get(currentUser._id);
      if (!appUser?.defaultOrganizationId) {
        throw new Error("Expected default organization.");
      }

      const secondOrganizationId = await ctx.db.insert("organizations", {
        name: "Second Org",
        slug: "second-org",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.insert("organization_memberships", {
        appUserId: currentUser._id,
        organizationId: secondOrganizationId,
        role: "student",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });

      const memberships = await ctx.db
        .query("organization_memberships")
        .withIndex("by_appUserId_status", (q) =>
          q.eq("appUserId", currentUser._id).eq("status", "active"),
        )
        .collect();

      const roles = memberships
        .map((membership) => membership.role)
        .sort((left, right) => left.localeCompare(right));

      expect(roles).toEqual(["admin", "student"]);
    });
  });

  it("allows identities without email claims to bootstrap successfully", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "clerk|teacher-no-email",
      tokenIdentifier: "token-teacher-no-email",
      name: "No Email Teacher",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser).toMatchObject({
      displayName: "No Email Teacher",
      identity: {
        provider: "clerk",
        name: "No Email Teacher",
      },
      defaultOrganization: {
        role: "admin",
      },
    });
    expect(currentUser.identity?.email).toBeUndefined();
  });

  it("returns null for legacy current users so bootstrap reruns and migrates their rosters", async () => {
    const t = convexTest(schema, modules);
    const legacyUser = t.withIdentity({
      subject: "clerk|legacy-user-1",
      tokenIdentifier: "token-legacy-user-1",
      email: "legacy@example.com",
      name: "Legacy User",
    });

    await t.run(async (ctx) => {
      const appUserId = await ctx.db.insert("app_users", {
        displayName: "Legacy User",
        createdAt: 1,
      });

      await ctx.db.insert("auth_identities", {
        appUserId,
        provider: "clerk",
        providerSubject: "clerk|legacy-user-1",
        tokenIdentifier: "token-legacy-user-1",
        email: "legacy@example.com",
        name: "Legacy User",
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.insert("rosters", {
        ownerAppUserId: appUserId,
        name: "Legacy Homeroom",
        createdAt: 1,
      });
    });

    expect(await legacyUser.query(api.appUsers.getCurrent, {})).toBeNull();

    const migrated = await legacyUser.mutation(api.appUsers.ensureCurrent, {});

    expect(migrated.defaultOrganization?.role).toBe("admin");
    expect(await legacyUser.query(api.rosters.list, {})).toHaveLength(1);

    await t.run(async (ctx) => {
      const appUser = await ctx.db.get(migrated._id);
      const memberships = await ctx.db
        .query("organization_memberships")
        .withIndex("by_appUserId_status", (q) =>
          q.eq("appUserId", migrated._id).eq("status", "active"),
        )
        .collect();
      const rosterAccess = await ctx.db.query("roster_access").collect();

      expect(appUser?.status).toBe("active");
      expect(appUser?.defaultOrganizationId).toBeDefined();
      expect(memberships).toHaveLength(1);
      expect(rosterAccess).toHaveLength(1);
    });
  });
});
