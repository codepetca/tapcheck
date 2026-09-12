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
    provider: v.union(v.literal("workos"), v.literal("pika")),
    providerSubject: v.string(),
    tokenIdentifier: v.string(),
    emailSnapshot: v.optional(v.string()),
    nameSnapshot: v.optional(v.string()),
    provisionedByInstallationRef: v.optional(v.string()),
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
    pikaDecommissioned: v.optional(v.boolean()),
    organizationId: v.id("organizations"),
    // Widened for the roster ownership migration. New writes populate this;
    // make it required only after the backfill is verified in every deployment.
    ownerAppUserId: v.optional(v.id("app_users")),
    createdByAppUserId: v.id("app_users"),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId_createdAt", ["organizationId", "createdAt"])
    .index("by_ownerAppUserId_createdAt", ["ownerAppUserId", "createdAt"])
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
        v.literal("integration_assertion"),
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

  attendance_occurrences: defineTable({
    rosterId: v.id("rosters"),
    title: v.string(),
    date: v.string(),
    opensAt: v.number(),
    closesAt: v.number(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("open"),
      v.literal("closed"),
      v.literal("cancelled"),
    ),
    sessionId: v.optional(v.id("sessions")),
    sessionRevision: v.number(),
    automationPaused: v.optional(v.boolean()),
    lastAutomationAttemptAt: v.optional(v.number()),
    lastAutomationErrorCode: v.optional(v.string()),
    createdByAppUserId: v.id("app_users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_rosterId_and_date", ["rosterId", "date"])
    .index("by_status_and_opensAt", ["status", "opensAt"])
    .index("by_status_and_closesAt", ["status", "closesAt"])
    .index("by_status_and_automationPaused_and_opensAt", [
      "status",
      "automationPaused",
      "opensAt",
    ])
    .index("by_status_and_automationPaused_and_closesAt", [
      "status",
      "automationPaused",
      "closesAt",
    ]),

  attendance_records: defineTable({
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    linkedAppUserId: v.optional(v.id("app_users")),
    status: v.union(v.literal("unmarked"), v.literal("present"), v.literal("late"), v.literal("absent")),
    recordRevision: v.optional(v.number()),
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
    .index("by_sessionId_participantId", ["sessionId", "participantId"])
    .index("by_participantId", ["participantId"]),

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

  pika_integrated_rosters: defineTable({
    installationRef: v.string(),
    tenantRef: v.optional(v.string()),
    rosterRef: v.string(),
    rosterId: v.id("rosters"),
    ownerAppUserId: v.id("app_users"),
    sourceRevision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationRef_and_rosterRef", ["installationRef", "rosterRef"])
    .index("by_rosterId", ["rosterId"]),

  // Permanent opaque fence, not an attendance/person audit log. Never TTL-delete.
  pika_decommissions: defineTable({
    installationRef: v.string(),
    rosterRef: v.string(),
    operationRef: v.string(),
    actorDigest: v.string(),
    rosterId: v.optional(v.id("rosters")),
    phase: v.number(),
    cursor: v.union(v.string(), v.null()),
    state: v.union(v.literal("deleting"), v.literal("deleted")),
    deletedCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationRef_and_rosterRef", ["installationRef", "rosterRef"])
    .index("by_installationRef_and_operationRef", ["installationRef", "operationRef"]),

  // Permanent generation fence and exact-operation receipt; never TTL-delete.
  pika_participant_erasures: defineTable({
    installationRef: v.string(), rosterRef: v.string(), participantRef: v.string(),
    operationRef: v.string(), actorDigest: v.string(),
    rosterId: v.id("rosters"), participantId: v.id("participants"),
    subjectDigest: v.optional(v.string()),
    phase: v.number(), cursor: v.union(v.string(), v.null()), verifying: v.boolean(),
    state: v.union(v.literal("deleting"), v.literal("blocked"), v.literal("deleted")),
    blockedCode: v.optional(v.string()), deletedCount: v.number(),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_installationRef_and_rosterRef_and_participantRef", ["installationRef", "rosterRef", "participantRef"])
    .index("by_installationRef_and_operationRef", ["installationRef", "operationRef"])
    .index("by_participantId", ["participantId"])
    .index("by_rosterId", ["rosterId"])
    .index("by_rosterId_and_subjectDigest_and_state", ["rosterId", "subjectDigest", "state"]),

  pika_installation_tenants: defineTable({
    installationRef: v.string(),
    tenantRef: v.string(),
    organizationId: v.id("organizations"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationRef_and_tenantRef", ["installationRef", "tenantRef"])
    .index("by_organizationId", ["organizationId"]),

  pika_tenant_recovery_audits: defineTable({
    installationRef: v.string(),
    tenantRef: v.string(),
    organizationId: v.id("organizations"),
    requestId: v.string(),
    operatorRef: v.string(),
    reasonCode: v.string(),
    evidenceRef: v.string(),
    backupRef: v.string(),
    planDigest: v.string(),
    memberCount: v.number(),
    staffCount: v.number(),
    restoredAt: v.number(),
  })
    .index("by_installationRef_and_requestId", ["installationRef", "requestId"])
    .index("by_organizationId", ["organizationId"]),

  pika_integrated_participants: defineTable({
    installationRef: v.string(),
    rosterRef: v.string(),
    participantRef: v.string(),
    participantId: v.id("participants"),
    sourceRevision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationRef_rosterRef_participantRef", [
      "installationRef",
      "rosterRef",
      "participantRef",
    ])
    .index("by_installationRef_and_rosterRef", ["installationRef", "rosterRef"])
    .index("by_participantId", ["participantId"]),

  pika_schedule_windows: defineTable({
    installationRef: v.string(),
    rosterRef: v.string(),
    sourceRevision: v.number(),
    timezone: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_installationRef_and_rosterRef", ["installationRef", "rosterRef"]),

  pika_integrated_occurrences: defineTable({
    installationRef: v.string(),
    rosterRef: v.string(),
    occurrenceRef: v.string(),
    occurrenceId: v.id("attendance_occurrences"),
    sourceRevision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationRef_rosterRef_occurrenceRef", [
      "installationRef",
      "rosterRef",
      "occurrenceRef",
    ])
    .index("by_installationRef_and_rosterRef", ["installationRef", "rosterRef"])
    .index("by_installationRef_and_occurrenceRef", ["installationRef", "occurrenceRef"])
    .index("by_occurrenceId", ["occurrenceId"]),

  pika_check_ins: defineTable({
    installationRef: v.string(),
    rosterRef: v.string(),
    occurrenceRef: v.string(),
    occurrenceId: v.id("attendance_occurrences"),
    participantRef: v.string(),
    participantId: v.id("participants"),
    checkInRef: v.string(),
    checkInRevision: v.number(),
    acceptedAt: v.number(),
    invalidatedAt: v.optional(v.number()),
    invalidatedByAppUserId: v.optional(v.id("app_users")),
    reasonCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationRef_and_checkInRef", ["installationRef", "checkInRef"])
    .index("by_installationRef_and_rosterRef", ["installationRef", "rosterRef"])
    .index("by_occurrenceId", ["occurrenceId"])
    .index("by_occurrenceId_and_participantId", ["occurrenceId", "participantId"])
    .index("by_participantId", ["participantId"])
    .index("by_installationRef_and_rosterRef_and_participantRef", ["installationRef", "rosterRef", "participantRef"]),

  pika_request_nonces: defineTable({
    installationRef: v.string(),
    nonce: v.string(),
    requestTimestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_installationRef_and_nonce", ["installationRef", "nonce"])
    .index("by_createdAt", ["createdAt"]),

  pika_smoke_nonces: defineTable({
    installationRef: v.string(),
    nonce: v.string(),
    requestTimestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_installationRef_and_nonce", ["installationRef", "nonce"])
    .index("by_installationRef_and_createdAt", ["installationRef", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  pika_idempotency: defineTable({
    installationRef: v.string(),
    idempotencyKey: v.string(),
    correlationRef: v.string(),
    messageType: v.union(
      v.literal("roster.snapshot"),
      v.literal("schedule.snapshot"),
      v.literal("session.command"),
      v.literal("check_in.invalidate"),
      v.literal("student_check_in"),
    ),
    bodyDigest: v.string(),
    resourceRef: v.string(),
    sourceRevision: v.number(),
    createdCount: v.number(),
    updatedCount: v.number(),
    deactivatedCount: v.number(),
    preservedCount: v.optional(v.number()),
    commandOutcome: v.optional(v.union(v.literal("applied"), v.literal("unchanged"))),
    sessionStatus: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    sessionRevision: v.optional(v.number()),
    resultJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_installationRef_and_idempotencyKey", ["installationRef", "idempotencyKey"])
    .index("by_installationRef", ["installationRef"])
    .index("by_createdAt", ["createdAt"]),

  pika_outbox: defineTable({
    installationRef: v.string(),
    eventId: v.string(),
    eventType: v.union(
      v.literal("attendance.session.scheduled"),
      v.literal("attendance.session.opened"),
      v.literal("attendance.session.closed"),
      v.literal("attendance.session.cancelled"),
      v.literal("attendance.check_in.accepted"),
      v.literal("attendance.check_in.invalidated"),
    ),
    correlationRef: v.string(),
    payloadJson: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("superseded"),
    ),
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    leaseUntil: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    lastErrorCode: v.optional(v.string()),
    recoveryCount: v.optional(v.number()),
    lastRecoveryRequestId: v.optional(v.string()),
    lastRecoveryReasonCode: v.optional(v.string()),
    lastRecoveredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_installationRef", ["installationRef"])
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_installationRef_and_status_and_updatedAt", [
      "installationRef",
      "status",
      "updatedAt",
    ]),

  pika_outbox_recovery_audits: defineTable({
    installationRef: v.string(),
    requestId: v.string(),
    operatorRef: v.string(),
    reasonCode: v.string(),
    eligibleErrorCodes: v.array(v.string()),
    limit: v.number(),
    maxDeliveryAttempts: v.number(),
    maxRecoveryAttempts: v.number(),
    cursor: v.union(v.string(), v.null()),
    inspected: v.number(),
    requeued: v.number(),
    superseded: v.number(),
    ineligible: v.number(),
    exhausted: v.number(),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_installationRef_and_requestId", ["installationRef", "requestId"])
    .index("by_createdAt", ["createdAt"]),

  workos_magic_email_outbox: defineTable({
    eventId: v.string(),
    magicAuthId: v.string(),
    clientId: v.string(),
    expiresAt: v.number(),
    brevoIdempotencyKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    leaseUntil: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    brevoFirstAttemptAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
});
