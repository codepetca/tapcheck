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

describe("auth bootstrap and ownership", () => {
  it("creates one app user and one auth identity on first authenticated bootstrap", async () => {
    const t = convexTest(schema, modules);
    const teacher = t.withIdentity({
      subject: "clerk|teacher-1",
      tokenIdentifier: "token-teacher-1",
      email: "teacher@example.com",
      name: "Teacher One",
    });

    const currentUser = await teacher.mutation(api.appUsers.ensureCurrent, {});

    expect(currentUser.displayName).toBe("Teacher One");

    await t.run(async (ctx) => {
      const appUsers = await ctx.db.query("app_users").collect();
      const authIdentities = await ctx.db.query("auth_identities").collect();

      expect(appUsers).toHaveLength(1);
      expect(authIdentities).toHaveLength(1);
      expect(authIdentities[0]).toMatchObject({
        appUserId: currentUser._id,
        provider: "clerk",
        providerSubject: "clerk|teacher-1",
        tokenIdentifier: "token-teacher-1",
        email: "teacher@example.com",
        name: "Teacher One",
      });
    });
  });

  it("scopes roster list and roster detail to the owning app user", async () => {
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
    });
    expect(currentUser.identity?.email).toBeUndefined();
  });
});
