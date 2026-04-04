import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  app_users: defineTable({
    displayName: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled"), v.literal("merged")),
    defaultOrganizationId: v.optional(v.id("organizations")),
    mergedIntoAppUserId: v.optional(v.id("app_users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  auth_identities: defineTable({
    appUserId: v.id("app_users"),
    provider: v.literal("clerk"),
    providerSubject: v.string(),
    tokenIdentifier: v.string(),
    emailSnapshot: v.optional(v.string()),
    nameSnapshot: v.optional(v.string()),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_provider_and_providerSubject", ["provider", "providerSubject"])
    .index("by_appUserId", ["appUserId"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_createdAt", ["createdAt"]),

  organization_memberships: defineTable({
    appUserId: v.id("app_users"),
    organizationId: v.id("organizations"),
    role: v.union(v.literal("student"), v.literal("staff"), v.literal("admin")),
    status: v.union(v.literal("active"), v.literal("disabled")),
    studentId: v.optional(v.string()),
    schoolEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_appUserId_status", ["appUserId", "status"])
    .index("by_appUserId_organizationId", ["appUserId", "organizationId"])
    .index("by_organizationId_status", ["organizationId", "status"])
    .index("by_organizationId_and_studentId", ["organizationId", "studentId"])
    .index("by_organizationId_and_schoolEmail", ["organizationId", "schoolEmail"]),

  rosters: defineTable({
    organizationId: v.id("organizations"),
    createdByAppUserId: v.id("app_users"),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId_createdAt", ["organizationId", "createdAt"])
    .index("by_createdByAppUserId_createdAt", ["createdByAppUserId", "createdAt"]),

  roster_access: defineTable({
    rosterId: v.id("rosters"),
    membershipId: v.id("organization_memberships"),
    accessRole: v.union(v.literal("staff"), v.literal("admin")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_rosterId_membershipId", ["rosterId", "membershipId"])
    .index("by_membershipId", ["membershipId"])
    .index("by_rosterId", ["rosterId"]),

  participants: defineTable({
    rosterId: v.id("rosters"),
    linkedAppUserId: v.optional(v.id("app_users")),
    externalId: v.optional(v.string()),
    schoolEmail: v.optional(v.string()),
    rawName: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    displayName: v.string(),
    sortKey: v.string(),
    participantType: v.union(v.literal("identified_user"), v.literal("roster_only")),
    linkStatus: v.union(
      v.literal("linked"),
      v.literal("unlinked"),
      v.literal("ambiguous"),
      v.literal("review_needed"),
    ),
    linkMethod: v.optional(
      v.union(
        v.literal("student_id"),
        v.literal("school_email"),
        v.literal("manual_staff"),
        v.literal("self_check_in"),
      ),
    ),
    linkedAt: v.optional(v.number()),
    linkedByAppUserId: v.optional(v.id("app_users")),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_rosterId_sortKey", ["rosterId", "sortKey"])
    .index("by_rosterId_and_studentId", ["rosterId", "externalId"])
    .index("by_rosterId_and_schoolEmail", ["rosterId", "schoolEmail"])
    .index("by_rosterId_active_sortKey", ["rosterId", "active", "sortKey"])
    .index("by_linkedAppUserId", ["linkedAppUserId"])
    .index("by_rosterId_and_linkedAppUserId", ["rosterId", "linkedAppUserId"]),

  sessions: defineTable({
    rosterId: v.id("rosters"),
    title: v.string(),
    date: v.string(),
    sessionType: v.union(v.literal("recurring_class"), v.literal("event")),
    participantMode: v.union(v.literal("verified"), v.literal("roster_only"), v.literal("mixed")),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdByAppUserId: v.id("app_users"),
    checkInToken: v.string(),
    openedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    closedByAppUserId: v.optional(v.id("app_users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_rosterId_createdAt", ["rosterId", "createdAt"])
    .index("by_rosterId_and_status", ["rosterId", "status"])
    .index("by_checkInToken", ["checkInToken"]),

  attendance_records: defineTable({
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    linkedAppUserId: v.optional(v.id("app_users")),
    status: v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
    source: v.optional(
      v.union(
        v.literal("student_qr"),
        v.literal("staff_manual"),
        v.literal("system_finalize"),
      ),
    ),
    firstMarkedAt: v.optional(v.number()),
    lastMarkedAt: v.optional(v.number()),
    modifiedAt: v.number(),
    modifiedByAppUserId: v.optional(v.id("app_users")),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_participantId", ["sessionId", "participantId"]),

  attendance_events: defineTable({
    sessionId: v.id("sessions"),
    participantId: v.optional(v.id("participants")),
    actorAppUserId: v.optional(v.id("app_users")),
    actorType: v.union(v.literal("student"), v.literal("staff"), v.literal("system")),
    eventType: v.union(
      v.literal("student_check_in"),
      v.literal("manual_mark"),
      v.literal("session_finalize"),
    ),
    fromStatus: v.optional(
      v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
    ),
    toStatus: v.optional(
      v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
    ),
    result: v.union(
      v.literal("applied"),
      v.literal("duplicate"),
      v.literal("blocked"),
      v.literal("review_needed"),
    ),
    reasonCode: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    createdAt: v.number(),
  })
    .index("by_sessionId_and_createdAt", ["sessionId", "createdAt"])
    .index("by_sessionId_and_result", ["sessionId", "result"]),
});
