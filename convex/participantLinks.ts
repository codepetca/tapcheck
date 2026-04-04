import type { Doc, Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";
import {
  getParticipantType,
  normalizeSchoolEmail,
  normalizeStudentId,
  type ParticipantLinkMethod,
  type ParticipantLinkStatus,
} from "./domain";

type AnyCtx = QueryCtx | MutationCtx;

type MatchCandidate = {
  appUserId: Id<"app_users">;
  displayName: string;
  studentId?: string;
  schoolEmail?: string;
};

export type ParticipantLinkResolution =
  | {
      kind: "matched";
      appUserId: Id<"app_users">;
      method: Extract<ParticipantLinkMethod, "student_id" | "school_email">;
      candidates: MatchCandidate[];
    }
  | {
      kind: "ambiguous";
      reasonCode: "duplicate_student_id" | "duplicate_school_email" | "conflicting_identifiers";
      candidates: MatchCandidate[];
    }
  | {
      kind: "unmatched";
      reasonCode: "no_match";
      candidates: MatchCandidate[];
    };

function uniqueCandidateList(candidates: MatchCandidate[]) {
  const seen = new Set<Id<"app_users">>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.appUserId)) {
      return false;
    }

    seen.add(candidate.appUserId);
    return true;
  });
}

async function buildCandidates(
  ctx: AnyCtx,
  memberships: Doc<"organization_memberships">[],
) {
  const rawCandidates = await Promise.all(
    memberships.map(async (membership) => {
      const appUser = await ctx.db.get(membership.appUserId);
      if (!appUser || appUser.status !== "active") {
        return null;
      }

      return {
        appUserId: appUser._id,
        displayName: appUser.displayName,
        studentId: membership.studentId,
        schoolEmail: membership.schoolEmail,
      } satisfies MatchCandidate;
    }),
  );

  const candidates: MatchCandidate[] = [];
  for (const candidate of rawCandidates) {
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return uniqueCandidateList(candidates);
}

async function getMembershipCandidatesByStudentId(
  ctx: AnyCtx,
  organizationId: Id<"organizations">,
  studentId?: string,
) {
  if (!studentId) {
    return [] as MatchCandidate[];
  }

  const memberships = await ctx.db
    .query("organization_memberships")
    .withIndex("by_organizationId_and_studentId", (q) =>
      q.eq("organizationId", organizationId).eq("studentId", studentId),
    )
    .collect();

  return buildCandidates(
    ctx,
    memberships.filter(
      (membership) => membership.status === "active" && membership.role === "student",
    ),
  );
}

async function getMembershipCandidatesBySchoolEmail(
  ctx: AnyCtx,
  organizationId: Id<"organizations">,
  schoolEmail?: string,
) {
  if (!schoolEmail) {
    return [] as MatchCandidate[];
  }

  const memberships = await ctx.db
    .query("organization_memberships")
    .withIndex("by_organizationId_and_schoolEmail", (q) =>
      q.eq("organizationId", organizationId).eq("schoolEmail", schoolEmail),
    )
    .collect();

  return buildCandidates(
    ctx,
    memberships.filter(
      (membership) => membership.status === "active" && membership.role === "student",
    ),
  );
}

export async function resolveParticipantLink(
  ctx: AnyCtx,
  organizationId: Id<"organizations">,
  identifiers: {
    studentId?: string;
    schoolEmail?: string;
  },
): Promise<ParticipantLinkResolution> {
  const normalizedStudentId = normalizeStudentId(identifiers.studentId);
  const normalizedSchoolEmail = normalizeSchoolEmail(identifiers.schoolEmail);

  const [studentIdCandidates, schoolEmailCandidates] = await Promise.all([
    getMembershipCandidatesByStudentId(ctx, organizationId, normalizedStudentId),
    getMembershipCandidatesBySchoolEmail(ctx, organizationId, normalizedSchoolEmail),
  ]);

  if (studentIdCandidates.length > 1) {
    return {
      kind: "ambiguous",
      reasonCode: "duplicate_student_id",
      candidates: studentIdCandidates,
    };
  }

  if (studentIdCandidates.length === 1 && schoolEmailCandidates.length === 1) {
    if (studentIdCandidates[0]?.appUserId !== schoolEmailCandidates[0]?.appUserId) {
      return {
        kind: "ambiguous",
        reasonCode: "conflicting_identifiers",
        candidates: uniqueCandidateList([...studentIdCandidates, ...schoolEmailCandidates]),
      };
    }
  }

  if (studentIdCandidates.length === 1) {
    return {
      kind: "matched",
      appUserId: studentIdCandidates[0]!.appUserId,
      method: "student_id",
      candidates: studentIdCandidates,
    };
  }

  if (schoolEmailCandidates.length > 1) {
    return {
      kind: "ambiguous",
      reasonCode: "duplicate_school_email",
      candidates: schoolEmailCandidates,
    };
  }

  if (schoolEmailCandidates.length === 1) {
    return {
      kind: "matched",
      appUserId: schoolEmailCandidates[0]!.appUserId,
      method: "school_email",
      candidates: schoolEmailCandidates,
    };
  }

  return {
    kind: "unmatched",
    reasonCode: "no_match",
    candidates: [],
  };
}

export async function syncParticipantAttendanceRecords(
  ctx: MutationCtx,
  participant: Pick<Doc<"participants">, "_id" | "rosterId" | "linkedAppUserId" | "active">,
) {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_rosterId_createdAt", (q) => q.eq("rosterId", participant.rosterId))
    .collect();

  for (const session of sessions) {
    const attendanceRecord = await ctx.db
      .query("attendance_records")
      .withIndex("by_sessionId_participantId", (q) =>
        q.eq("sessionId", session._id).eq("participantId", participant._id),
      )
      .unique();

    if (!attendanceRecord) {
      if (!participant.active || session.status !== "open") {
        continue;
      }

      await ctx.db.insert("attendance_records", {
        sessionId: session._id,
        participantId: participant._id,
        linkedAppUserId: participant.linkedAppUserId,
        status: "unmarked",
        modifiedAt: session.createdAt,
      });
      continue;
    }

    if (attendanceRecord.linkedAppUserId === participant.linkedAppUserId) {
      continue;
    }

    await ctx.db.patch(attendanceRecord._id, {
      linkedAppUserId: participant.linkedAppUserId,
      modifiedAt: Date.now(),
    });
  }
}

export async function applyParticipantLink(
  ctx: MutationCtx,
  participant: Doc<"participants">,
  args: {
    linkedAppUserId?: Id<"app_users">;
    linkStatus: ParticipantLinkStatus;
    linkMethod?: ParticipantLinkMethod;
    linkedByAppUserId?: Id<"app_users">;
  },
) {
  const now = Date.now();
  await ctx.db.patch(participant._id, {
    linkedAppUserId: args.linkedAppUserId,
    participantType: getParticipantType(args.linkedAppUserId),
    linkStatus: args.linkStatus,
    linkMethod: args.linkMethod,
    linkedAt: args.linkedAppUserId ? now : undefined,
    linkedByAppUserId: args.linkedByAppUserId,
    updatedAt: now,
  });

  await syncParticipantAttendanceRecords(ctx, {
    _id: participant._id,
    rosterId: participant.rosterId,
    linkedAppUserId: args.linkedAppUserId,
    active: participant.active,
  });
}

export async function autoLinkParticipant(
  ctx: MutationCtx,
  roster: Pick<Doc<"rosters">, "organizationId">,
  participant: Doc<"participants">,
  linkedByAppUserId?: Id<"app_users">,
) {
  if (participant.linkedAppUserId && participant.linkMethod === "manual_staff") {
    return {
      kind: "matched" as const,
      appUserId: participant.linkedAppUserId,
      method: "student_id" as const,
      candidates: [],
    };
  }

  const resolution = await resolveParticipantLink(ctx, roster.organizationId, {
    studentId: participant.externalId,
    schoolEmail: participant.schoolEmail,
  });

  if (resolution.kind === "matched") {
    await applyParticipantLink(ctx, participant, {
      linkedAppUserId: resolution.appUserId,
      linkStatus: "linked",
      linkMethod: resolution.method,
      linkedByAppUserId,
    });
    return resolution;
  }

  if (participant.linkedAppUserId) {
    await applyParticipantLink(ctx, participant, {
      linkedAppUserId: participant.linkedAppUserId,
      linkStatus: resolution.kind === "ambiguous" ? "review_needed" : "linked",
      linkMethod: participant.linkMethod,
      linkedByAppUserId: participant.linkedByAppUserId,
    });
    return resolution;
  }

  await applyParticipantLink(ctx, participant, {
    linkStatus: resolution.kind === "ambiguous" ? "ambiguous" : "unlinked",
  });

  return resolution;
}
