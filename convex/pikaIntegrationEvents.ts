import { participantFence } from "./pikaParticipantFence";
import { validateV1Event } from "../lib/attendance-contract/v1/validate";
import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import { internal, internalActions } from "./api";
import type { Id } from "./model";
import type { MutationCtx } from "./server";
import { isPikaRosterDecommissioned } from "./pikaDecommissionFence";

export async function queueAttendanceEvent(
  ctx: MutationCtx,
  args: {
    installationRef: string;
    rosterRef: string;
    occurrenceRef: string;
    correlationRef: string;
    eventType:
      | "attendance.session.scheduled"
      | "attendance.session.opened"
      | "attendance.session.closed"
      | "attendance.session.cancelled"
      | "attendance.check_in.accepted"
      | "attendance.check_in.invalidated";
    sessionRevision: number;
    metadata: Record<string, unknown>;
    nonce: string;
    eventIndex: number;
    now: number;
  },
) {
  if (await isPikaRosterDecommissioned(ctx, args.installationRef, args.rosterRef)) {
    throw new Error("Attendance roster is being permanently deleted.");
  }
  if (typeof args.metadata.participant_ref === "string" && await participantFence(ctx, args.installationRef, args.rosterRef, args.metadata.participant_ref)) {
    throw new Error("Attendance participant is being permanently deleted.");
  }
  const eventDigest = await sha256Hex([
    args.installationRef,
    args.rosterRef,
    args.occurrenceRef,
    args.eventType,
    String(args.sessionRevision),
    args.nonce,
    String(args.eventIndex),
  ].join("\n"));
  const eventId = `event_${eventDigest}`;
  const event = validateV1Event({
    schema_version: 1,
    event_id: eventId,
    idempotency_key: `event:${eventDigest}`,
    correlation_ref: args.correlationRef,
    event_type: args.eventType,
    occurred_at: new Date(args.now).toISOString(),
    installation_ref: args.installationRef,
    roster_ref: args.rosterRef,
    occurrence_ref: args.occurrenceRef,
    session_revision: args.sessionRevision,
    metadata: args.metadata,
  });
  if (!event.ok) throw new Error("Attendance event could not be created.");

  await ctx.db.insert("pika_outbox", {
    installationRef: args.installationRef,
    eventId,
    eventType: args.eventType,
    correlationRef: args.correlationRef,
    payloadJson: JSON.stringify(event.value),
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  });
  // convex-test eagerly executes scheduled actions after its transaction has
  // closed; production Convex does not. Keep unit tests deterministic while
  // preserving immediate dispatch in every deployed runtime.
  if (
    args.eventIndex === 0 &&
    process.env.VITEST !== "true" &&
    process.env.PIKA_DISABLE_IMMEDIATE_DISPATCH !== "true"
  ) {
    await ctx.scheduler.runAfter(0, internalActions.pikaOutbox.deliver, { limit: 10 });
  }
}

export async function scheduleExactOccurrenceJobs(
  ctx: MutationCtx,
  occurrenceId: Id<"attendance_occurrences">,
  opensAt: number,
  closesAt: number,
) {
  if (process.env.VITEST === "true") return;
  await Promise.all([
    ctx.scheduler.runAt(opensAt, internal.pikaIntegration.processOccurrenceAutomation, {
      occurrenceId,
    }),
    ctx.scheduler.runAt(closesAt, internal.pikaIntegration.processOccurrenceAutomation, {
      occurrenceId,
    }),
  ]);
}
