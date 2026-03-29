import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  app_users: defineTable({
    displayName: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  auth_identities: defineTable({
    appUserId: v.id("app_users"),
    provider: v.literal("clerk"),
    providerSubject: v.string(),
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_provider_and_providerSubject", ["provider", "providerSubject"])
    .index("by_appUserId", ["appUserId"]),

  rosters: defineTable({
    ownerAppUserId: v.optional(v.id("app_users")),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_ownerAppUserId_createdAt", ["ownerAppUserId", "createdAt"]),

  students: defineTable({
    rosterId: v.id("rosters"),
    studentId: v.string(),
    rawName: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    displayName: v.string(),
    sortKey: v.string(),
    active: v.boolean(),
  })
    .index("by_rosterId_sortKey", ["rosterId", "sortKey"])
    .index("by_rosterId_studentId", ["rosterId", "studentId"])
    .index("by_rosterId_active_sortKey", ["rosterId", "active", "sortKey"]),

  sessions: defineTable({
    rosterId: v.id("rosters"),
    title: v.string(),
    date: v.string(),
    isOpen: v.boolean(),
    editorToken: v.string(),
    viewerToken: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_rosterId_createdAt", ["rosterId", "createdAt"])
    .index("by_editorToken", ["editorToken"]),

  attendance: defineTable({
    sessionId: v.id("sessions"),
    studentRef: v.id("students"),
    studentId: v.string(),
    present: v.boolean(),
    markedAt: v.optional(v.number()),
    lastModifiedAt: v.optional(v.number()),
    modifiedAt: v.number(),
    modifiedViaTokenType: v.optional(v.literal("editor")),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_studentRef", ["sessionId", "studentRef"]),
});
