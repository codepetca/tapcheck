import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rosters: defineTable({
    name: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

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
