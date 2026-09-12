// Bara provider contract; Pika consumer adoption is a separate gated change.
// This operation has its own versioned namespace, outside attendance command caches.
export const PARTICIPANT_ERASURE_PATH = "/api/integrations/pika/participant-erasure/v1";
export interface ParticipantErasureRequest {
  schema_version: 1;
  message_type: "participant.erase";
  action: "begin" | "tick" | "status";
  installation_ref: string;
  roster_ref: string;
  participant_ref: string;
  operation_ref: string;
  actor_principal_ref: string;
}
export interface ParticipantErasureReceipt {
  schema_version: 1;
  ok: true;
  installation_ref: string;
  roster_ref: string;
  participant_ref: string;
  operation_ref: string;
  state: "deleting" | "blocked" | "deleted";
  absence_verified: boolean;
  deleted_count: number;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function ref(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{1,128}$/.test(value);
}
export function parseParticipantErasureRequest(value: unknown): ParticipantErasureRequest | null {
  if (!object(value) || Object.keys(value).length !== 8 ||
    value.schema_version !== 1 || value.message_type !== "participant.erase" ||
    !["begin", "tick", "status"].includes(String(value.action)) ||
    !ref(value.participant_ref) || !ref(value.installation_ref) || !ref(value.roster_ref) || !ref(value.actor_principal_ref) ||
    typeof value.operation_ref !== "string" || !/^erase_participant_[a-f0-9]{32,64}$/.test(value.operation_ref)) return null;
  return value as unknown as ParticipantErasureRequest;
}
export function parseParticipantErasureReceipt(
  value: unknown,
  request: Pick<ParticipantErasureRequest, "installation_ref" | "roster_ref" | "participant_ref" | "operation_ref">,
): ParticipantErasureReceipt | null {
  if (!object(value) || Object.keys(value).length !== 9 ||
    value.schema_version !== 1 || value.ok !== true ||
    value.installation_ref !== request.installation_ref || value.roster_ref !== request.roster_ref ||
    value.participant_ref !== request.participant_ref || value.operation_ref !== request.operation_ref ||
    (value.state !== "deleting" && value.state !== "blocked" && value.state !== "deleted") ||
    value.absence_verified !== (value.state === "deleted") ||
    typeof value.deleted_count !== "number" || !Number.isSafeInteger(value.deleted_count) ||
    value.deleted_count < 0) return null;
  return value as unknown as ParticipantErasureReceipt;
}
