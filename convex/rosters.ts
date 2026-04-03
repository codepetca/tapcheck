import { v } from "convex/values";
import { buildDemoRosterStudents } from "../lib/demo-data";
import {
  ensureCurrentAppUser,
  getCurrentAppUserWithIdentity,
  listCurrentMemberships,
  requireAccessibleRoster,
  requireCurrentOrganizationMembership,
} from "./auth";
import type { Id } from "./model";
import { mutation, query, type MutationCtx, type QueryCtx } from "./server";

const importedStudentValidator = v.object({
  studentId: v.string(),
  rawName: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  displayName: v.string(),
  sortKey: v.string(),
});

function requireStaffAccessRole(role: "student" | "staff" | "admin") {
  if (role === "student") {
    throw new Error("Students cannot manage rosters.");
  }

  return role === "admin" ? "admin" : "staff";
}

async function loadRosterParticipants(ctx: QueryCtx | MutationCtx, rosterId: Id<"rosters">) {
  return ctx.db
    .query("participants")
    .withIndex("by_rosterId_sortKey", (q) => q.eq("rosterId", rosterId))
    .collect();
}

async function syncParticipantIntoOpenSessions(
  ctx: MutationCtx,
  rosterId: Id<"rosters">,
  participant: {
    _id: Id<"participants">;
    linkedAppUserId?: Id<"app_users">;
    externalId?: string;
  },
) {
  const rosterSessions = await ctx.db
    .query("sessions")
    .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", rosterId))
    .collect();

  const openSessions = rosterSessions.filter((session) => session.isOpen);
  if (openSessions.length === 0) {
    return;
  }

  const now = Date.now();

  for (const session of openSessions) {
    const existingAttendance = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", session._id).eq("participantId", participant._id),
      )
      .unique();

    if (existingAttendance) {
      continue;
    }

    await ctx.db.insert("attendance_records", {
      sessionId: session._id,
      participantId: participant._id,
      linkedAppUserId: participant.linkedAppUserId,
      status: "absent",
      source: "override",
      modifiedAt: now,
    });
  }
}

function mapParticipantsByExternalId(
  participants: Array<{
    _id: Id<"participants">;
    externalId?: string;
    linkedAppUserId?: Id<"app_users">;
  }>,
) {
  const duplicateExternalIds = new Set<string>();
  const participantsByExternalId = new Map<string, (typeof participants)[number]>();

  for (const participant of participants) {
    if (!participant.externalId) {
      continue;
    }

    if (participantsByExternalId.has(participant.externalId)) {
      duplicateExternalIds.add(participant.externalId);
      continue;
    }

    participantsByExternalId.set(participant.externalId, participant);
  }

  if (duplicateExternalIds.size > 0) {
    const ids = [...duplicateExternalIds].sort().join(", ");
    throw new Error(`Roster already contains duplicate student IDs: ${ids}.`);
  }

  return participantsByExternalId;
}

function validateImportedStudents(
  students: Array<{
    studentId: string;
  }>,
) {
  if (students.length === 0) {
    throw new Error("At least one valid student is required.");
  }

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const student of students) {
    if (seenIds.has(student.studentId)) {
      duplicateIds.add(student.studentId);
    }
    seenIds.add(student.studentId);
  }

  if (duplicateIds.size > 0) {
    throw new Error("Duplicate student IDs were found in the import.");
  }
}

async function findAccessibleRosterMembership(
  ctx: QueryCtx,
  appUserId: Id<"app_users">,
  roster: { _id: Id<"rosters">; organizationId: Id<"organizations"> },
) {
  const memberships = await listCurrentMemberships(ctx, appUserId);

  for (const { membership } of memberships) {
    if (membership.organizationId !== roster.organizationId) {
      continue;
    }

    const access = await ctx.db
      .query("roster_access")
      .withIndex("by_rosterId_membershipId", (q) =>
        q.eq("rosterId", roster._id).eq("membershipId", membership._id),
      )
      .unique();

    if (access) {
      return membership;
    }
  }

  return null;
}

async function listAccessibleRosters(ctx: QueryCtx, appUserId: Id<"app_users">) {
  const memberships = await listCurrentMemberships(ctx, appUserId);
  const accessibleRosterIds = new Set<Id<"rosters">>();

  for (const { membership } of memberships) {
    const rosterAccessRows = await ctx.db
      .query("roster_access")
      .withIndex("by_membershipId", (q) => q.eq("membershipId", membership._id))
      .collect();

    for (const rosterAccess of rosterAccessRows) {
      accessibleRosterIds.add(rosterAccess.rosterId);
    }
  }

  const rosters = await Promise.all([...accessibleRosterIds].map((rosterId) => ctx.db.get(rosterId)));

  return rosters
    .filter((roster): roster is NonNullable<typeof roster> => roster !== null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("rosters"),
      name: v.string(),
      createdAt: v.number(),
      studentCount: v.number(),
      sessionCount: v.number(),
      hasActiveSession: v.boolean(),
      latestSessionId: v.optional(v.id("sessions")),
    }),
  ),
  handler: async (ctx) => {
    const { appUser } = await getCurrentAppUserWithIdentity(ctx);
    if (!appUser) {
      return [];
    }

    const rosters = await listAccessibleRosters(ctx, appUser._id);

    return Promise.all(
      rosters.map(async (roster) => {
        const [participants, sessions] = await Promise.all([
          ctx.db
            .query("participants")
            .withIndex("by_rosterId_active_sortKey", (q) =>
              q.eq("rosterId", roster._id).eq("active", true),
            )
            .collect(),
          ctx.db
            .query("sessions")
            .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", roster._id))
            .collect(),
        ]);

        const latestSession = sessions.sort((left, right) => right.createdAt - left.createdAt)[0];

        return {
          _id: roster._id,
          name: roster.name,
          createdAt: roster.createdAt,
          studentCount: participants.length,
          sessionCount: sessions.length,
          hasActiveSession: sessions.some((session) => session.isOpen),
          latestSessionId: latestSession?._id,
        };
      }),
    );
  },
});

export const getById = query({
  args: { rosterId: v.id("rosters") },
  returns: v.union(
    v.null(),
    v.object({
      roster: v.object({
        _id: v.id("rosters"),
        name: v.string(),
        createdAt: v.number(),
      }),
      students: v.array(
        v.object({
          _id: v.id("participants"),
          studentId: v.string(),
          rawName: v.string(),
          firstName: v.string(),
          lastName: v.string(),
          displayName: v.string(),
          active: v.boolean(),
        }),
      ),
      sessions: v.array(
        v.object({
          _id: v.id("sessions"),
          title: v.string(),
          date: v.string(),
          isOpen: v.boolean(),
          editorToken: v.string(),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const [{ appUser }, roster] = await Promise.all([
      getCurrentAppUserWithIdentity(ctx),
      ctx.db.get(args.rosterId),
    ]);

    if (!appUser || !roster) {
      return null;
    }

    const membership = await findAccessibleRosterMembership(ctx, appUser._id, roster);
    if (!membership) {
      return null;
    }

    const [participants, sessions] = await Promise.all([
      ctx.db
        .query("participants")
        .withIndex("by_rosterId_active_sortKey", (q) =>
          q.eq("rosterId", args.rosterId).eq("active", true),
        )
        .collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
    ]);

    return {
      roster: {
        _id: roster._id,
        name: roster.name,
        createdAt: roster.createdAt,
      },
      students: participants.map((participant) => ({
        _id: participant._id,
        studentId: participant.externalId ?? "",
        rawName: participant.rawName,
        firstName: participant.firstName,
        lastName: participant.lastName,
        displayName: participant.displayName,
        active: participant.active,
      })),
      sessions: sessions
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((session) => ({
          _id: session._id,
          title: session.title,
          date: session.date,
          isOpen: session.isOpen,
          editorToken: session.editorToken,
          createdAt: session.createdAt,
        })),
    };
  },
});

export const createEmpty = mutation({
  args: { name: v.string() },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    const now = Date.now();
    const rosterId = await ctx.db.insert("rosters", {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      name,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roster_access", {
      rosterId,
      membershipId: membership._id,
      accessRole: requireStaffAccessRole(membership.role),
      createdAt: now,
      updatedAt: now,
    });

    return rosterId;
  },
});

export const importCsv = mutation({
  args: {
    name: v.string(),
    students: v.array(importedStudentValidator),
  },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const now = Date.now();
    const rosterId = await ctx.db.insert("rosters", {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      name,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roster_access", {
      rosterId,
      membershipId: membership._id,
      accessRole: requireStaffAccessRole(membership.role),
      createdAt: now,
      updatedAt: now,
    });

    for (const student of args.students) {
      await ctx.db.insert("participants", {
        rosterId,
        externalId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        participantType: "roster_only",
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return rosterId;
  },
});

export const rename = mutation({
  args: {
    rosterId: v.id("rosters"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    await ctx.db.patch(args.rosterId, { name, updatedAt: Date.now() });
    return null;
  },
});

export const importIntoExisting = mutation({
  args: {
    rosterId: v.id("rosters"),
    name: v.string(),
    students: v.array(importedStudentValidator),
    deactivateMissing: v.optional(v.boolean()),
  },
  returns: v.id("rosters"),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const existingParticipants = await loadRosterParticipants(ctx, args.rosterId);
    const existingByExternalId = mapParticipantsByExternalId(existingParticipants);
    const now = Date.now();

    await ctx.db.patch(args.rosterId, { name, updatedAt: now });

    if (args.deactivateMissing) {
      const incomingIds = new Set(args.students.map((student) => student.studentId));
      for (const existingParticipant of existingParticipants) {
        if (
          existingParticipant.externalId &&
          !incomingIds.has(existingParticipant.externalId) &&
          existingParticipant.active
        ) {
          await ctx.db.patch(existingParticipant._id, {
            active: false,
            updatedAt: now,
          });
        }
      }
    }

    for (const student of args.students) {
      const existingParticipant = existingByExternalId.get(student.studentId);
      if (existingParticipant) {
        await ctx.db.patch(existingParticipant._id, {
          externalId: student.studentId,
          rawName: student.rawName,
          firstName: student.firstName,
          lastName: student.lastName,
          displayName: student.displayName,
          sortKey: student.sortKey,
          participantType: existingParticipant.linkedAppUserId ? "identified_user" : "roster_only",
          active: true,
          updatedAt: now,
        });
        await syncParticipantIntoOpenSessions(ctx, args.rosterId, {
          _id: existingParticipant._id,
          linkedAppUserId: existingParticipant.linkedAppUserId,
          externalId: student.studentId,
        });
        continue;
      }

      const participantId = await ctx.db.insert("participants", {
        rosterId: args.rosterId,
        externalId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        participantType: "roster_only",
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await syncParticipantIntoOpenSessions(ctx, args.rosterId, {
        _id: participantId,
        externalId: student.studentId,
      });
    }

    return args.rosterId;
  },
});

export const seedDemo = mutation({
  args: {},
  returns: v.id("rosters"),
  handler: async (ctx) => {
    const currentUser = await ensureCurrentAppUser(ctx);
    const { membership, organization } = await requireCurrentOrganizationMembership(ctx);
    const now = Date.now();
    const rosterId = await ctx.db.insert("rosters", {
      organizationId: organization._id,
      createdByAppUserId: currentUser._id,
      name: "Grade 8 Homeroom Demo",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roster_access", {
      rosterId,
      membershipId: membership._id,
      accessRole: requireStaffAccessRole(membership.role),
      createdAt: now,
      updatedAt: now,
    });

    for (const student of buildDemoRosterStudents()) {
      await ctx.db.insert("participants", {
        rosterId,
        externalId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        participantType: "roster_only",
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return rosterId;
  },
});

export const remove = mutation({
  args: {
    rosterId: v.id("rosters"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAccessibleRoster(ctx, args.rosterId);

    const [participants, sessions, rosterAccessRows] = await Promise.all([
      loadRosterParticipants(ctx, args.rosterId),
      ctx.db
        .query("sessions")
        .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
      ctx.db
        .query("roster_access")
        .withIndex("by_rosterId", (q) => q.eq("rosterId", args.rosterId))
        .collect(),
    ]);

    for (const session of sessions) {
      const attendanceRows = await ctx.db
        .query("attendance_records")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
        .collect();

      for (const attendance of attendanceRows) {
        await ctx.db.delete(attendance._id);
      }

      await ctx.db.delete(session._id);
    }

    for (const participant of participants) {
      await ctx.db.delete(participant._id);
    }

    for (const rosterAccess of rosterAccessRows) {
      await ctx.db.delete(rosterAccess._id);
    }

    await ctx.db.delete(args.rosterId);
    return null;
  },
});
