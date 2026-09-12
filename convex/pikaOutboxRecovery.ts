import { erasedEvent } from "./pikaParticipantFence";
import { v } from "convex/values";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import type { Doc } from "./model";
import { internalMutation, type MutationCtx } from "./server";

const ELIGIBLE_ERROR_CODES = ["http_401", "http_403"] as const;
const MAX_LIMIT = 50;
const MAX_DELIVERY_ATTEMPTS = 20;
const MAX_RECOVERY_ATTEMPTS = 3;
const OPAQUE_REF = /^[A-Za-z0-9._~:-]{1,128}$/;

const recoveryResultValidator = v.object({
  inspected: v.number(),
  requeued: v.number(),
  superseded: v.number(),
  ineligible: v.number(),
  exhausted: v.number(),
  nextCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

type RecoveryResult = {
  inspected: number;
  requeued: number;
  superseded: number;
  ineligible: number;
  exhausted: number;
  nextCursor: string | null;
  isDone: boolean;
};

function configuredInstallationRef() {
  const installationRef = process.env.PIKA_INTEGRATION_REF?.trim() ?? "";
  if (!OPAQUE_REF.test(installationRef)) {
    throw new Error("Attendance recovery is not configured.");
  }
  return installationRef;
}

async function currentDisposition(
  ctx: MutationCtx,
  row: Doc<"pika_outbox">,
): Promise<"requeue" | "supersede" | "ineligible"> {
  const parsed = validateV1Event(JSON.parse(row.payloadJson) as unknown);
  if (
    !parsed.ok ||
    parsed.value.installation_ref !== row.installationRef ||
    parsed.value.event_id !== row.eventId ||
    parsed.value.event_type !== row.eventType ||
    parsed.value.correlation_ref !== row.correlationRef
  ) return "ineligible";
  const event = parsed.value;
  if (await erasedEvent(ctx, event)) return "supersede";
  const mapping = await ctx.db
    .query("pika_integrated_occurrences")
    .withIndex("by_installationRef_and_occurrenceRef", (q) =>
      q.eq("installationRef", row.installationRef).eq("occurrenceRef", event.occurrence_ref),
    )
    .unique();
  if (!mapping) return "ineligible";
  if (mapping.rosterRef !== event.roster_ref) return "ineligible";
  const occurrence = await ctx.db.get(mapping.occurrenceId);
  if (!occurrence) return "ineligible";

  if (
    event.event_type !== "attendance.check_in.accepted" &&
    event.event_type !== "attendance.check_in.invalidated"
  ) {
    if (event.session_revision < occurrence.sessionRevision) return "supersede";
    return event.session_revision === occurrence.sessionRevision ? "requeue" : "ineligible";
  }

  const checkInRef = event.metadata.check_in_ref;
  const checkInRevision = event.metadata.check_in_revision;
  if (typeof checkInRef !== "string" || typeof checkInRevision !== "number") {
    return "ineligible";
  }
  const checkIn = await ctx.db
    .query("pika_check_ins")
    .withIndex("by_installationRef_and_checkInRef", (q) =>
      q
        .eq("installationRef", row.installationRef)
        .eq("checkInRef", checkInRef),
    )
    .unique();
  if (!checkIn || checkIn.occurrenceId !== occurrence._id) return "ineligible";
  if (checkInRevision < checkIn.checkInRevision) return "supersede";
  return checkInRevision === checkIn.checkInRevision ? "requeue" : "ineligible";
}

export const recoverFailedEvents = internalMutation({
  args: {
    installationRef: v.string(),
    requestId: v.string(),
    operatorRef: v.string(),
    reasonCode: v.string(),
    limit: v.number(),
    maxDeliveryAttempts: v.number(),
    maxRecoveryAttempts: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: recoveryResultValidator,
  handler: async (ctx, args): Promise<RecoveryResult> => {
    if (
      args.installationRef !== configuredInstallationRef() ||
      !OPAQUE_REF.test(args.requestId) ||
      !OPAQUE_REF.test(args.operatorRef) ||
      !OPAQUE_REF.test(args.reasonCode) ||
      !Number.isSafeInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > MAX_LIMIT ||
      !Number.isSafeInteger(args.maxDeliveryAttempts) ||
      args.maxDeliveryAttempts < 1 ||
      args.maxDeliveryAttempts > MAX_DELIVERY_ATTEMPTS ||
      !Number.isSafeInteger(args.maxRecoveryAttempts) ||
      args.maxRecoveryAttempts < 1 ||
      args.maxRecoveryAttempts > MAX_RECOVERY_ATTEMPTS
    ) {
      throw new Error("Attendance recovery request is invalid.");
    }

    const prior = await ctx.db
      .query("pika_outbox_recovery_audits")
      .withIndex("by_installationRef_and_requestId", (q) =>
        q.eq("installationRef", args.installationRef).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (
        prior.operatorRef !== args.operatorRef ||
        prior.reasonCode !== args.reasonCode ||
        prior.limit !== args.limit ||
        prior.maxDeliveryAttempts !== args.maxDeliveryAttempts ||
        prior.maxRecoveryAttempts !== args.maxRecoveryAttempts ||
        prior.cursor !== args.cursor
      ) {
        throw new Error("Attendance recovery request conflicts with its prior audit.");
      }
      return {
        inspected: prior.inspected,
        requeued: prior.requeued,
        superseded: prior.superseded,
        ineligible: prior.ineligible,
        exhausted: prior.exhausted,
        nextCursor: prior.nextCursor,
        isDone: prior.isDone,
      };
    }

    const now = Date.now();

    const page = await ctx.db
      .query("pika_outbox")
      .withIndex("by_installationRef_and_status_and_updatedAt", (q) =>
        q.eq("installationRef", args.installationRef).eq("status", "failed"),
      )
      .paginate({ cursor: args.cursor, numItems: args.limit });
    const rows = page.page;
    const result: RecoveryResult = {
      inspected: rows.length,
      requeued: 0,
      superseded: 0,
      ineligible: 0,
      exhausted: 0,
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };

    for (const row of rows) {
      const recoveryCount = row.recoveryCount ?? 0;
      if (
        row.attemptCount >= args.maxDeliveryAttempts ||
        recoveryCount >= args.maxRecoveryAttempts
      ) {
        result.exhausted += 1;
        continue;
      }
      if (!ELIGIBLE_ERROR_CODES.includes(row.lastErrorCode as (typeof ELIGIBLE_ERROR_CODES)[number])) {
        result.ineligible += 1;
        continue;
      }

      let disposition: "requeue" | "supersede" | "ineligible";
      try {
        disposition = await currentDisposition(ctx, row);
      } catch {
        disposition = "ineligible";
      }
      if (disposition === "ineligible") {
        result.ineligible += 1;
        continue;
      }
      await ctx.db.patch(row._id, {
        status: disposition === "requeue" ? "pending" : "superseded",
        nextAttemptAt: disposition === "requeue" ? now : row.nextAttemptAt,
        leaseUntil: undefined,
        leaseToken: undefined,
        recoveryCount: recoveryCount + 1,
        lastRecoveryRequestId: args.requestId,
        lastRecoveryReasonCode: args.reasonCode,
        lastRecoveredAt: now,
        updatedAt: now,
      });
      result[disposition === "requeue" ? "requeued" : "superseded"] += 1;
    }

    await ctx.db.insert("pika_outbox_recovery_audits", {
      installationRef: args.installationRef,
      requestId: args.requestId,
      operatorRef: args.operatorRef,
      reasonCode: args.reasonCode,
      eligibleErrorCodes: [...ELIGIBLE_ERROR_CODES],
      limit: args.limit,
      maxDeliveryAttempts: args.maxDeliveryAttempts,
      maxRecoveryAttempts: args.maxRecoveryAttempts,
      cursor: args.cursor,
      ...result,
      createdAt: now,
    });
    return result;
  },
});
