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

async function createRosterAndOpenSession() {
  const t = convexTest(schema, modules);
  const rosterId = await t.mutation(api.rosters.importCsv, {
    name: "Roster A",
    students: [makeStudent("1001", "Alice Able")],
  });
  const sessionId = await t.mutation(api.sessions.create, {
    rosterId,
    date: "2026-03-27",
  });
  const roster = await t.query(api.rosters.getById, { rosterId });

  if (!roster) {
    throw new Error("Expected roster to exist.");
  }

  return {
    t,
    rosterId,
    sessionId,
    editorToken: roster.sessions[0]?.editorToken ?? "",
  };
}

describe("attendance flow while editing an existing roster", () => {
  it("preserves attendance for an existing student when the roster is re-imported", async () => {
    const { t, rosterId, sessionId, editorToken } = await createRosterAndOpenSession();

    const rosterBeforeImport = await t.query(api.rosters.getById, { rosterId });
    if (!rosterBeforeImport) {
      throw new Error("Expected roster to exist.");
    }

    const alice = rosterBeforeImport.students.find((student) => student.studentId === "1001");
    if (!alice) {
      throw new Error("Expected Alice Able to exist in the roster.");
    }

    await t.mutation(api.attendance.toggleByEditorToken, {
      token: editorToken,
      studentRef: alice._id,
      clientNow: 1_742_000_000_000,
    });

    await t.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1001", "Alice Updated"), makeStudent("1002", "John Smith")],
      deactivateMissing: false,
    });

    const exportData = await t.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows.find((row) => row.studentId === "1001")).toMatchObject({
      studentId: "1001",
      displayName: "Alice Updated",
      present: true,
      markedAt: 1_742_000_000_000,
    });
  });

  it("keeps existing attendance visible when a student is deactivated during an open session", async () => {
    const { t, rosterId, sessionId, editorToken } = await createRosterAndOpenSession();

    const rosterBeforeImport = await t.query(api.rosters.getById, { rosterId });
    if (!rosterBeforeImport) {
      throw new Error("Expected roster to exist.");
    }

    const alice = rosterBeforeImport.students.find((student) => student.studentId === "1001");
    if (!alice) {
      throw new Error("Expected Alice Able to exist in the roster.");
    }

    await t.mutation(api.attendance.toggleByEditorToken, {
      token: editorToken,
      studentRef: alice._id,
      clientNow: 1_742_000_000_000,
    });

    await t.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1002", "John Smith")],
      deactivateMissing: true,
    });

    const editorSession = await t.query(api.attendance.getEditorSessionByToken, {
      token: editorToken,
    });
    const exportData = await t.query(api.attendance.getSessionExport, { sessionId });

    expect(editorSession?.students.map((student) => student.studentId)).toEqual(["1001", "1002"]);
    expect(editorSession?.students.find((student) => student.studentId === "1001")).toMatchObject({
      studentId: "1001",
      present: true,
      markedAt: 1_742_000_000_000,
    });

    expect(exportData?.rows.map((row) => row.studentId)).toEqual(["1001", "1002"]);
    expect(exportData?.rows.find((row) => row.studentId === "1001")).toMatchObject({
      studentId: "1001",
      present: true,
      markedAt: 1_742_000_000_000,
    });
  });

  it("includes a newly added student in the open session collection and export", async () => {
    const { t, rosterId, sessionId, editorToken } = await createRosterAndOpenSession();

    await t.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1001", "Alice Able"), makeStudent("1002", "John Smith")],
      deactivateMissing: false,
    });

    const editorSession = await t.query(api.attendance.getEditorSessionByToken, {
      token: editorToken,
    });
    const exportData = await t.query(api.attendance.getSessionExport, { sessionId });

    expect(editorSession).not.toBeNull();
    expect(editorSession?.totalCount).toBe(2);
    expect(editorSession?.students.map((student) => student.studentId)).toEqual([
      "1001",
      "1002",
    ]);

    const johnInCollection = editorSession?.students.find((student) => student.studentId === "1002");
    expect(johnInCollection).toMatchObject({
      studentId: "1002",
      displayName: "John Smith",
      present: false,
    });

    expect(exportData).not.toBeNull();
    expect(exportData?.rows.map((row) => row.studentId)).toEqual(["1001", "1002"]);
    expect(exportData?.rows.find((row) => row.studentId === "1002")).toMatchObject({
      studentId: "1002",
      displayName: "John Smith",
      present: false,
    });
  });

  it("creates a missing attendance record when the newly added student is first marked present", async () => {
    const { t, rosterId, sessionId, editorToken } = await createRosterAndOpenSession();

    await t.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1001", "Alice Able"), makeStudent("1002", "John Smith")],
      deactivateMissing: false,
    });

    const roster = await t.query(api.rosters.getById, { rosterId });
    if (!roster) {
      throw new Error("Expected roster to exist.");
    }

    const john = roster.students.find((student) => student.studentId === "1002");
    if (!john) {
      throw new Error("Expected John Smith to exist in the roster.");
    }

    await t.mutation(api.attendance.toggleByEditorToken, {
      token: editorToken,
      studentRef: john._id,
      clientNow: 1_742_000_000_000,
    });

    const exportData = await t.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows.find((row) => row.studentId === "1002")).toMatchObject({
      studentId: "1002",
      present: true,
      markedAt: 1_742_000_000_000,
    });
  });

  it("allows toggling an existing attendance row after the student is deactivated", async () => {
    const { t, rosterId, sessionId, editorToken } = await createRosterAndOpenSession();

    const rosterBeforeImport = await t.query(api.rosters.getById, { rosterId });
    if (!rosterBeforeImport) {
      throw new Error("Expected roster to exist.");
    }

    const alice = rosterBeforeImport.students.find((student) => student.studentId === "1001");
    if (!alice) {
      throw new Error("Expected Alice Able to exist in the roster.");
    }

    await t.mutation(api.attendance.toggleByEditorToken, {
      token: editorToken,
      studentRef: alice._id,
      clientNow: 1_742_000_000_000,
    });

    await t.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1002", "John Smith")],
      deactivateMissing: true,
    });

    await t.mutation(api.attendance.toggleByEditorToken, {
      token: editorToken,
      studentRef: alice._id,
      clientNow: 1_742_000_000_100,
    });

    const exportData = await t.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows.find((row) => row.studentId === "1001")).toMatchObject({
      studentId: "1001",
      present: false,
      modifiedAt: 1_742_000_000_100,
    });
  });

  it("rejects imports when the roster already contains duplicate student IDs", async () => {
    const t = convexTest(schema, modules);
    const rosterId = await t.mutation(api.rosters.importCsv, {
      name: "Roster A",
      students: [makeStudent("1001", "Alice Able")],
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("students", {
        rosterId,
        ...makeStudent("1001", "Alice Duplicate"),
        active: true,
      });
    });

    await expect(
      t.mutation(api.rosters.importIntoExisting, {
        rosterId,
        name: "Roster A",
        students: [makeStudent("1001", "Alice Able")],
        deactivateMissing: false,
      }),
    ).rejects.toThrow("Roster already contains duplicate student IDs: 1001.");
  });
});
