import { v } from "convex/values";
import { buildDemoRosterStudents } from "../lib/demo-data";
import {
  ensureCurrentAppUser,
  getCurrentAppUserWithIdentity,
  listCurrentMemberships,
  requireAccessibleRoster,
  requireCurrentOrganizationMembership,
} from "./auth";
import { getParticipantType, normalizeSchoolEmail, normalizeStudentId } from "./domain";
import { autoLinkParticipant, syncParticipantAttendanceRecords } from "./participantLinks";
import type { Id } from "./model";
import { mutation, query, type MutationCtx, type QueryCtx } from "./server";

const importedStudentValidator = v.object({
  studentId: v.optional(v.string()),
  schoolEmail: v.optional(v.string()),
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

function mapParticipantsByIdentifiers(
  participants: Array<{
    _id: Id<"participants">;
    externalId?: string;
    schoolEmail?: string;
    linkedAppUserId?: Id<"app_users">;
  }>,
) {
  const duplicateStudentIds = new Set<string>();
  const duplicateSchoolEmails = new Set<string>();
  const participantsByStudentId = new Map<string, (typeof participants)[number]>();
  const participantsBySchoolEmail = new Map<string, (typeof participants)[number]>();

  for (const participant of participants) {
    if (!participant.externalId) {
      continue;
    }

    if (participantsByStudentId.has(participant.externalId)) {
      duplicateStudentIds.add(participant.externalId);
    } else {
      participantsByStudentId.set(participant.externalId, participant);
    }
  }

  for (const participant of participants) {
    if (!participant.schoolEmail) {
      continue;
    }

    if (participantsBySchoolEmail.has(participant.schoolEmail)) {
      duplicateSchoolEmails.add(participant.schoolEmail);
      continue;
    }

    participantsBySchoolEmail.set(participant.schoolEmail, participant);
  }

  if (duplicateStudentIds.size > 0) {
    const ids = [...duplicateStudentIds].sort().join(", ");
    throw new Error(`Roster already contains duplicate student IDs: ${ids}.`);
  }

  if (duplicateSchoolEmails.size > 0) {
    const emails = [...duplicateSchoolEmails].sort().join(", ");
    throw new Error(`Roster already contains duplicate school emails: ${emails}.`);
  }

  return {
    participantsByStudentId,
    participantsBySchoolEmail,
  };
}

function validateImportedStudents(students: Array<{ studentId?: string; schoolEmail?: string }>) {
  if (students.length === 0) {
    throw new Error("At least one valid student is required.");
  }

  const duplicateIds = new Set<string>();
  const duplicateEmails = new Set<string>();
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  for (const student of students) {
    const normalizedStudentId = normalizeStudentId(student.studentId);
    const normalizedSchoolEmail = normalizeSchoolEmail(student.schoolEmail);

    if (!normalizedStudentId && !normalizedSchoolEmail) {
      throw new Error("Each imported student must have a student ID or school email.");
    }

    if (normalizedStudentId) {
      if (seenIds.has(normalizedStudentId)) {
        duplicateIds.add(normalizedStudentId);
      }

      seenIds.add(normalizedStudentId);
    }

    if (normalizedSchoolEmail) {
      if (seenEmails.has(normalizedSchoolEmail)) {
        duplicateEmails.add(normalizedSchoolEmail);
      }

      seenEmails.add(normalizedSchoolEmail);
    }
  }

  if (duplicateIds.size > 0) {
    throw new Error("Duplicate student IDs were found in the import.");
  }

  if (duplicateEmails.size > 0) {
    throw new Error("Duplicate school emails were found in the import.");
  }
}

function findExistingParticipantForImport(
  identifierMaps: ReturnType<typeof mapParticipantsByIdentifiers>,
  student: { studentId?: string; schoolEmail?: string },
) {
  const normalizedStudentId = normalizeStudentId(student.studentId);
  const normalizedSchoolEmail = normalizeSchoolEmail(student.schoolEmail);
  const matchByStudentId = normalizedStudentId
    ? identifierMaps.participantsByStudentId.get(normalizedStudentId)
    : undefined;
  const matchBySchoolEmail = normalizedSchoolEmail
    ? identifierMaps.participantsBySchoolEmail.get(normalizedSchoolEmail)
    : undefined;

  if (matchByStudentId && matchBySchoolEmail && matchByStudentId._id !== matchBySchoolEmail._id) {
    throw new Error("Roster import identifiers conflict with existing participants.");
  }

  return matchByStudentId ?? matchBySchoolEmail ?? null;
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

async function createParticipant(
  ctx: MutationCtx,
  args: {
    rosterId: Id<"rosters">;
    studentId?: string;
    schoolEmail?: string;
    rawName: string;
    firstName: string;
    lastName: string;
    displayName: string;
    sortKey: string;
    now: number;
  },
) {
  return ctx.db.insert("participants", {
    rosterId: args.rosterId,
    externalId: normalizeStudentId(args.studentId),
    schoolEmail: normalizeSchoolEmail(args.schoolEmail),
    rawName: args.rawName,
    firstName: args.firstName,
    lastName: args.lastName,
    displayName: args.displayName,
    sortKey: args.sortKey,
    participantType: "roster_only",
    linkStatus: "unlinked",
    active: true,
    createdAt: args.now,
    updatedAt: args.now,
  });
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
          hasActiveSession: sessions.some((session) => session.status === "open"),
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
          schoolEmail: v.optional(v.string()),
          rawName: v.string(),
          firstName: v.string(),
          lastName: v.string(),
          displayName: v.string(),
          active: v.boolean(),
          linkStatus: v.union(
            v.literal("linked"),
            v.literal("unlinked"),
            v.literal("ambiguous"),
            v.literal("review_needed"),
          ),
          linkedAppUserId: v.optional(v.id("app_users")),
        }),
      ),
      sessions: v.array(
        v.object({
          _id: v.id("sessions"),
          title: v.string(),
          date: v.string(),
          status: v.union(v.literal("open"), v.literal("closed")),
          checkInToken: v.string(),
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
        schoolEmail: participant.schoolEmail,
        rawName: participant.rawName,
        firstName: participant.firstName,
        lastName: participant.lastName,
        displayName: participant.displayName,
        active: participant.active,
        linkStatus: participant.linkStatus,
        linkedAppUserId: participant.linkedAppUserId,
      })),
      sessions: sessions
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((session) => ({
          _id: session._id,
          title: session.title,
          date: session.date,
          status: session.status,
          checkInToken: session.checkInToken,
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
      const participantId = await createParticipant(ctx, {
        rosterId,
        studentId: student.studentId,
        schoolEmail: student.schoolEmail,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });

      const participant = await ctx.db.get(participantId);
      const roster = await ctx.db.get(rosterId);
      if (participant && roster) {
        await autoLinkParticipant(ctx, roster, participant, currentUser._id);
      }
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
    const { roster, appUser } = await requireAccessibleRoster(ctx, args.rosterId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Roster name is required.");
    }

    validateImportedStudents(args.students);

    const existingParticipants = await loadRosterParticipants(ctx, args.rosterId);
    const identifierMaps = mapParticipantsByIdentifiers(existingParticipants);
    const now = Date.now();
    const matchedParticipantIds = new Set<Id<"participants">>();

    await ctx.db.patch(args.rosterId, { name, updatedAt: now });

    for (const student of args.students) {
      const studentId = normalizeStudentId(student.studentId);
      const schoolEmail = normalizeSchoolEmail(student.schoolEmail);
      const existingParticipant = findExistingParticipantForImport(identifierMaps, {
        studentId,
        schoolEmail,
      });
      if (existingParticipant) {
        matchedParticipantIds.add(existingParticipant._id);
        await ctx.db.patch(existingParticipant._id, {
          externalId: studentId,
          schoolEmail,
          rawName: student.rawName,
          firstName: student.firstName,
          lastName: student.lastName,
          displayName: student.displayName,
          sortKey: student.sortKey,
          participantType: getParticipantType(existingParticipant.linkedAppUserId),
          active: true,
          updatedAt: now,
        });
        const refreshedParticipant = await ctx.db.get(existingParticipant._id);
        if (refreshedParticipant) {
          await autoLinkParticipant(ctx, roster, refreshedParticipant, appUser._id);
          await syncParticipantAttendanceRecords(ctx, refreshedParticipant);
        }
          continue;
      }

      const participantId = await createParticipant(ctx, {
        rosterId: args.rosterId,
        studentId,
        schoolEmail,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });

      const participant = await ctx.db.get(participantId);
      if (participant) {
        matchedParticipantIds.add(participant._id);
        await autoLinkParticipant(ctx, roster, participant, appUser._id);
      }
    }

    if (args.deactivateMissing) {
      for (const existingParticipant of existingParticipants) {
        if (matchedParticipantIds.has(existingParticipant._id) || !existingParticipant.active) {
          continue;
        }

        await ctx.db.patch(existingParticipant._id, {
          active: false,
          updatedAt: now,
        });
      }
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

    const roster = await ctx.db.get(rosterId);
    if (!roster) {
      throw new Error("Demo roster could not be created.");
    }

    for (const student of buildDemoRosterStudents()) {
      const participantId = await createParticipant(ctx, {
        rosterId,
        studentId: student.studentId,
        rawName: student.rawName,
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: student.displayName,
        sortKey: student.sortKey,
        now,
      });

      const participant = await ctx.db.get(participantId);
      if (participant) {
        await autoLinkParticipant(ctx, roster, participant, currentUser._id);
      }
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
      const [attendanceRows, attendanceEvents] = await Promise.all([
        ctx.db
          .query("attendance_records")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
          .collect(),
        ctx.db
          .query("attendance_events")
          .withIndex("by_sessionId_and_createdAt", (q) => q.eq("sessionId", session._id))
          .collect(),
      ]);

      for (const attendance of attendanceRows) {
        await ctx.db.delete(attendance._id);
      }

      for (const attendanceEvent of attendanceEvents) {
        await ctx.db.delete(attendanceEvent._id);
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
