// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const ownerIdentity = {
  tokenIdentifier: "user|owner-1",
  email: "owner1@example.com",
  emailVerified: true,
};

const otherIdentity = {
  tokenIdentifier: "user|owner-2",
  email: "owner2@example.com",
  emailVerified: true,
};

function makeStudent(studentId: string, displayName: string) {
  const [firstName, ...rest] = displayName.split(" ");
  const lastName = rest.join(" ");

  return {
    studentId,
    rawName: displayName,
    firstName,
    lastName,
    displayName,
    sortKey: `${lastName.toLocaleLowerCase()}|${firstName.toLocaleLowerCase()}|${studentId}`,
  };
}

describe("authenticated roster ownership boundary", () => {
  it("rejects protected queries without an authenticated user", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.rosters.list, {})).rejects.toThrow("Not authenticated.");
  });

  it("returns only rosters owned by the current account", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);
    const other = t.withIdentity(otherIdentity);

    const ownerRosterId = await owner.mutation(api.rosters.importCsv, {
      name: "Owner Roster",
      students: [makeStudent("1001", "Alice Able")],
    });
    await other.mutation(api.rosters.importCsv, {
      name: "Other Roster",
      students: [makeStudent("2001", "Bob Baker")],
    });

    await expect(owner.query(api.rosters.getById, { rosterId: ownerRosterId })).resolves.not.toBeNull();
    await expect(other.query(api.rosters.getById, { rosterId: ownerRosterId })).resolves.toBeNull();

    const ownerRosters = await owner.query(api.rosters.list, {});
    expect(ownerRosters).toHaveLength(1);
    expect(ownerRosters[0]?.name).toBe("Owner Roster");
  });

  it("keeps the editor token flow public while export stays admin-only", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);
    const other = t.withIdentity(otherIdentity);
    const rosterId = await owner.mutation(api.rosters.importCsv, {
      name: "Roster A",
      students: [makeStudent("1001", "Alice Able")],
    });
    const sessionId = await owner.mutation(api.sessions.create, {
      rosterId,
      date: "2026-03-27",
    });
    const editorShare = await owner.query(api.sessions.getEditorLink, { sessionId });

    if (!editorShare) {
      throw new Error("Expected editor share link to exist.");
    }

    const editorSession = await t.query(api.attendance.getEditorSessionByToken, {
      token: editorShare.editorToken,
    });

    if (!editorSession) {
      throw new Error("Expected editor session to exist.");
    }

    await expect(t.query(api.attendance.getSessionExport, { sessionId })).rejects.toThrow(
      "Not authenticated.",
    );

    await expect(other.query(api.attendance.getSessionExport, { sessionId })).rejects.toThrow(
      "Session not found.",
    );

    await expect(other.mutation(api.sessions.stop, { sessionId })).rejects.toThrow(
      "Session not found.",
    );

    await expect(
      t.mutation(api.attendance.toggleByEditorToken, {
        token: editorShare.editorToken,
        studentRef: editorSession.students[0]!.studentRef,
        clientNow: 1_742_000_000_000,
      }),
    ).resolves.toBeNull();
  });
});
