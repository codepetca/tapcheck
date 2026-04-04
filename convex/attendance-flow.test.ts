// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./api";
import { autoLinkParticipant } from "./participantLinks";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const ownerIdentity = {
  subject: "clerk|owner-1",
  tokenIdentifier: "token-owner-1",
  email: "owner@example.com",
  name: "Owner One",
};

const studentIdentity = {
  subject: "clerk|student-1",
  tokenIdentifier: "token-student-1",
  email: "student@example.edu",
  name: "Student One",
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

async function createRosterAndOpenSession() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(ownerIdentity);
  const rosterId = await owner.mutation(api.rosters.importCsv, {
    name: "Roster A",
    students: [makeStudent("1001", "Alice Able")],
  });
  const sessionId = await owner.mutation(api.sessions.start, {
    rosterId,
    date: "2026-04-04",
  });
  const roster = await owner.query(api.rosters.getById, { rosterId });

  if (!roster) {
    throw new Error("Expected roster to exist.");
  }

  return {
    t,
    owner,
    rosterId,
    sessionId,
    checkInToken: roster.sessions[0]?.checkInToken ?? "",
  };
}

describe("verified QR attendance flow", () => {
  it("starts sessions with unmarked attendance and closes them to absent", async () => {
    const { t, sessionId } = await createRosterAndOpenSession();

    await t.run(async (ctx) => {
      const attendanceRows = await ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();

      expect(attendanceRows).toHaveLength(1);
      expect(attendanceRows[0]?.status).toBe("unmarked");
    });

    const owner = t.withIdentity(ownerIdentity);
    await owner.mutation(api.sessions.close, { sessionId });

    await t.run(async (ctx) => {
      const attendanceRows = await ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();

      expect(attendanceRows[0]?.status).toBe("absent");
      expect(attendanceRows[0]?.source).toBe("system_finalize");
    });
  });

  it("marks a uniquely matched student present on self check-in", async () => {
    const { t, owner, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        schoolEmail: "student@example.edu",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(result).toMatchObject({
      tone: "green",
      code: "present_marked",
      attendanceStatus: "present",
    });

    const exportData = await owner.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows[0]).toMatchObject({
      studentId: "1001",
      status: "present",
      present: true,
    });
  });

  it("returns a duplicate result for a repeated student scan", async () => {
    const { t, rosterId, checkInToken } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    const duplicateResult = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(duplicateResult).toMatchObject({
      tone: "yellow",
      code: "already_present",
      attendanceStatus: "present",
    });
  });

  it("lets staff mark late and then reset back to unmarked", async () => {
    const { owner, rosterId, sessionId } = await createRosterAndOpenSession();
    const roster = await owner.query(api.rosters.getById, { rosterId });
    if (!roster) {
      throw new Error("Expected roster.");
    }

    const participantId = roster.students[0]!._id;

    await owner.mutation(api.attendance.markManual, {
      sessionId,
      participantId,
      nextStatus: "late",
    });

    await owner.mutation(api.attendance.markManual, {
      sessionId,
      participantId,
      nextStatus: "unmarked",
    });

    const exportData = await owner.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows[0]).toMatchObject({
      studentId: "1001",
      status: "unmarked",
      present: false,
    });
  });

  it("blocks unmatched students and records the failed attempt", async () => {
    const { t, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "9999",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(result).toMatchObject({
      tone: "red",
      code: "not_on_roster",
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("attendance_events")
        .withIndex("by_sessionId_and_result", (q) => q.eq("sessionId", sessionId).eq("result", "blocked"))
        .collect();

      expect(events).toHaveLength(1);
      expect(events[0]?.reasonCode).toBe("not_on_roster");
    });
  });

  it("ignores inactive linked participants during self check-in", async () => {
    const { t, owner, rosterId, checkInToken, sessionId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});
    const ownerAppUser = await owner.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        createdAt: 1,
        updatedAt: 1,
      });

      const activeParticipant = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_and_studentId", (q) => q.eq("rosterId", rosterId).eq("externalId", "1001"))
        .unique();

      if (!activeParticipant) {
        throw new Error("Expected active participant.");
      }

      await ctx.db.insert("participants", {
        rosterId,
        linkedAppUserId: currentStudent._id,
        externalId: "1001-old",
        schoolEmail: "old@example.edu",
        rawName: "Student One",
        firstName: "Student",
        lastName: "One",
        displayName: "Student One",
        sortKey: "one|student|1001-old",
        participantType: "identified_user",
        linkStatus: "linked",
        linkMethod: "manual_staff",
        linkedAt: 1,
        linkedByAppUserId: ownerAppUser._id,
        active: false,
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.patch(activeParticipant._id, {
        linkedAppUserId: undefined,
        participantType: "roster_only",
        linkStatus: "unlinked",
        linkMethod: undefined,
        linkedAt: undefined,
        linkedByAppUserId: undefined,
        updatedAt: 2,
      });
    });

    const result = await student.mutation(api.attendance.studentCheckIn, {
      token: checkInToken,
    });

    expect(result).toMatchObject({
      tone: "green",
      code: "present_marked",
      attendanceStatus: "present",
    });

    const exportData = await owner.query(api.attendance.getSessionExport, { sessionId });
    expect(exportData?.rows[0]).toMatchObject({
      studentId: "1001",
      status: "present",
      present: true,
    });
  });

  it("accepts email-only roster imports", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(ownerIdentity);

    const rosterId = await owner.mutation(api.rosters.importCsv, {
      name: "Email Roster",
      students: [
        {
          studentId: undefined,
          schoolEmail: "student@example.edu",
          rawName: "Student One",
          firstName: "Student",
          lastName: "One",
          displayName: "Student One",
          sortKey: "one|student|student@example.edu",
        },
      ],
    });

    const roster = await owner.query(api.rosters.getById, { rosterId });
    expect(roster?.students[0]).toMatchObject({
      studentId: "",
      schoolEmail: "student@example.edu",
    });
  });

  it("clears stale auto-links when roster identifiers no longer resolve cleanly", async () => {
    const { t, owner, rosterId } = await createRosterAndOpenSession();
    const student = t.withIdentity(studentIdentity);
    const currentStudent = await student.mutation(api.appUsers.ensureCurrent, {});
    const ownerAppUser = await owner.mutation(api.appUsers.ensureCurrent, {});

    await t.run(async (ctx) => {
      const roster = await ctx.db.get(rosterId);
      if (!roster) {
        throw new Error("Expected roster.");
      }

      await ctx.db.insert("organization_memberships", {
        appUserId: currentStudent._id,
        organizationId: roster.organizationId,
        role: "student",
        status: "active",
        studentId: "1001",
        createdAt: 1,
        updatedAt: 1,
      });

      const participant = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_and_studentId", (q) => q.eq("rosterId", rosterId).eq("externalId", "1001"))
        .unique();

      if (!participant) {
        throw new Error("Expected participant.");
      }

      await ctx.db.patch(participant._id, {
        linkedAppUserId: currentStudent._id,
        participantType: "identified_user",
        linkStatus: "linked",
        linkMethod: "student_id",
        linkedAt: 1,
        linkedByAppUserId: ownerAppUser._id,
        externalId: "9999",
        schoolEmail: undefined,
        updatedAt: 2,
      });

      const refreshedParticipant = await ctx.db.get(participant._id);
      if (!refreshedParticipant) {
        throw new Error("Expected refreshed participant.");
      }

      await autoLinkParticipant(ctx, roster, refreshedParticipant, ownerAppUser._id);
    });

    await t.run(async (ctx) => {
      const participants = await ctx.db
        .query("participants")
        .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", rosterId))
        .collect();
      const participant = participants.find((entry) => entry.externalId === "9999");

      expect(participant?.linkedAppUserId).toBeUndefined();
      expect(participant?.linkStatus).toBe("review_needed");
    });
  });

  it("keeps deactivated participants visible in an open session after roster re-import", async () => {
    const { owner, rosterId, sessionId } = await createRosterAndOpenSession();

    await owner.mutation(api.rosters.importIntoExisting, {
      rosterId,
      name: "Roster A",
      students: [makeStudent("1002", "Baker, Jamie")],
      deactivateMissing: true,
    });

    const liveSession = await owner.query(api.attendance.getLiveSessionRows, { sessionId });

    expect(liveSession?.rows.map((row) => row.studentId)).toEqual(["1001", "1002"]);
    expect(liveSession?.counts.total).toBe(2);
    expect(liveSession?.counts.unmarked).toBe(2);
  });
});
