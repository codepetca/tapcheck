import { erasedEvent } from "./pikaParticipantFence";
import { v } from "convex/values";
import { internalMutation } from "./server";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import { isPikaRosterDecommissioned } from "./pikaDecommissionFence";

const LEASE_MS = 60_000;

const claimedEventValidator = v.object({
  eventId: v.string(),
  payloadJson: v.string(),
  attemptCount: v.number(),
  leaseToken: v.string(),
});

export const claim = internalMutation({
  args: { now: v.number(), limit: v.number() },
  returns: v.array(claimedEventValidator),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("pika_outbox")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", args.now),
      )
      .take(Math.min(Math.max(args.limit * 3, args.limit), 60));
    const claimable = candidates
      .filter((row) => !row.leaseUntil || row.leaseUntil <= args.now)
      .slice(0, Math.min(Math.max(args.limit, 1), 20));

    const claimed = [];
    for (const row of claimable) {
      let event;
      try { event = validateV1Event(JSON.parse(row.payloadJson)); } catch { event = null; }
      // Never dispatch a malformed payload or a fenced classroom, even if a
      // recovery sweep has requeued it. Already-in-flight bytes are fenced by Pika.
      const malformed = !event?.ok || event.value.installation_ref !== row.installationRef;
      const participantErased = event?.ok && await erasedEvent(ctx, event.value);
      const fenced = participantErased || (event?.ok && await isPikaRosterDecommissioned(ctx, row.installationRef, event.value.roster_ref));
      if (malformed || fenced) {
        await ctx.db.patch(row._id, { status: fenced ? "superseded" : "failed",
          leaseUntil: undefined, leaseToken: undefined, updatedAt: args.now,
          lastErrorCode: participantErased ? "participant_erased" : fenced ? "roster_decommissioned" : "invalid_event_payload" });
        continue;
      }
      const leaseToken = `lease_${args.now}_${row.eventId}`;
      const attemptCount = row.attemptCount + 1;
      await ctx.db.patch(row._id, {
        leaseUntil: args.now + LEASE_MS,
        leaseToken,
        attemptCount,
        updatedAt: args.now,
      });
      claimed.push({
        eventId: row.eventId,
        payloadJson: row.payloadJson,
        attemptCount,
        leaseToken,
      });
    }
    return claimed;
  },
});

export const complete = internalMutation({
  args: { eventId: v.string(), leaseToken: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pika_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!row || row.status !== "pending" || row.leaseToken !== args.leaseToken) return false;
    if (await suppressErased(ctx, row)) return false;
    await ctx.db.patch(row._id, {
      status: "delivered",
      leaseUntil: undefined,
      leaseToken: undefined,
      lastErrorCode: undefined,
      updatedAt: args.now,
    });
    return true;
  },
});

export const retry = internalMutation({
  args: {
    eventId: v.string(),
    leaseToken: v.string(),
    errorCode: v.string(),
    nextAttemptAt: v.number(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pika_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!row || row.status !== "pending" || row.leaseToken !== args.leaseToken) return false;
    if (await suppressErased(ctx, row)) return false;
    await ctx.db.patch(row._id, {
      nextAttemptAt: args.nextAttemptAt,
      leaseUntil: undefined,
      leaseToken: undefined,
      lastErrorCode: args.errorCode,
      updatedAt: args.now,
    });
    return true;
  },
});

export const fail = internalMutation({
  args: { eventId: v.string(), leaseToken: v.string(), errorCode: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pika_outbox")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (!row || row.status !== "pending" || row.leaseToken !== args.leaseToken) return false;
    if (await suppressErased(ctx, row)) return false;
    await ctx.db.patch(row._id, {
      status: "failed",
      leaseUntil: undefined,
      leaseToken: undefined,
      lastErrorCode: args.errorCode,
      updatedAt: args.now,
    });
    return true;
  },
});

async function suppressErased(ctx: import("./server").MutationCtx, row: import("./model").Doc<"pika_outbox">) {
  let parsed;
  try { parsed = validateV1Event(JSON.parse(row.payloadJson)); } catch { return false; }
  if (!parsed.ok || !await erasedEvent(ctx, parsed.value)) return false;
  await ctx.db.patch(row._id, { status: "superseded", leaseToken: undefined, leaseUntil: undefined, lastErrorCode: "participant_erased" });
  return true;
}
