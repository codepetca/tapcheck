import { sha256Hex } from "../lib/attendance-contract/v1/signing";
import type { V1Event } from "../lib/attendance-contract/v1/types";
import type { Id } from "./model";
import type { MutationCtx, QueryCtx } from "./server";

type Ctx = MutationCtx | QueryCtx;
export function participantFence(ctx: Ctx, installationRef: string, rosterRef: string, participantRef: string) {
  return ctx.db.query("pika_participant_erasures")
    .withIndex("by_installationRef_and_rosterRef_and_participantRef", q =>
      q.eq("installationRef", installationRef).eq("rosterRef", rosterRef).eq("participantRef", participantRef)).unique();
}
export async function rosterHasParticipantFences(ctx: Ctx, installationRef: string, rosterRef: string) {
  return Boolean(await ctx.db.query("pika_participant_erasures")
    .withIndex("by_installationRef_and_rosterRef_and_participantRef", q =>
      q.eq("installationRef", installationRef).eq("rosterRef", rosterRef)).first());
}
export function participantIdFence(ctx: Ctx, participantId: Id<"participants">) {
  return ctx.db.query("pika_participant_erasures")
    .withIndex("by_participantId", q => q.eq("participantId", participantId)).unique();
}
export async function assertParticipantNotErased(ctx: Ctx, participantId: Id<"participants">) {
  if (await participantIdFence(ctx, participantId)) throw new Error("Participant unavailable during permanent deletion.");
}
export function subjectDigest(rosterId: Id<"rosters">, appUserId: Id<"app_users">) {
  return sha256Hex(JSON.stringify(["participant.erase/subject/v1", rosterId, appUserId]));
}
export async function subjectFences(ctx: Ctx, rosterId: Id<"rosters">, appUserId: Id<"app_users">) {
  const digest = await subjectDigest(rosterId, appUserId);
  const rows = await Promise.all((["deleting", "blocked", "deleted"] as const).map(state =>
    ctx.db.query("pika_participant_erasures").withIndex("by_rosterId_and_subjectDigest_and_state", q =>
      q.eq("rosterId", rosterId).eq("subjectDigest", digest).eq("state", state)).first()));
  return rows.filter(row => row !== null);
}
export async function erasedEvent(ctx: Ctx, event: V1Event) {
  return "participant_ref" in event.metadata && typeof event.metadata.participant_ref === "string" && Boolean(await participantFence(
    ctx, event.installation_ref, event.roster_ref, event.metadata.participant_ref));
}
// Actor-only native scans cannot distinguish an old request from a fresh generation.
export async function assertNativeSubjectNotErased(ctx: Ctx, rosterId: Id<"rosters">, appUserId: Id<"app_users">) {
  if ((await subjectFences(ctx, rosterId, appUserId)).length) {
    throw new Error("Participant requires a generation-aware Pika check-in.");
  }
}
export async function assertNativeRosterImportAllowed(ctx: Ctx, rosterId: Id<"rosters">) {
  if (await ctx.db.query("pika_participant_erasures").withIndex("by_rosterId", q => q.eq("rosterId", rosterId)).first()) {
    throw new Error("Update this roster through Pika using participant generations.");
  }
}
