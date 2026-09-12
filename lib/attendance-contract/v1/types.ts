// Pure version 1 Pika-attendance integration contract.
//
// Pika owns attendance policy and status. Bara owns only QR acceptance gating
// and the immutable timestamps describing accepted or invalidated check-ins.
// This package deliberately imports no application, Convex, Supabase, WorkOS,
// or schema-library types. Applications translate at their adapters.

export const SCHEMA_VERSION = 1 as const;

export const V1_MESSAGE_TYPES = [
  "roster.snapshot",
  "schedule.snapshot",
  "session.command",
  "check_in.invalidate",
  "check_in.presentation",
  "student_check_in",
] as const;

export type V1MessageType = (typeof V1_MESSAGE_TYPES)[number];

export const V1_EVENT_TYPES = [
  "attendance.session.scheduled",
  "attendance.session.opened",
  "attendance.session.closed",
  "attendance.session.cancelled",
  "attendance.check_in.accepted",
  "attendance.check_in.invalidated",
] as const;

export type V1EventType = (typeof V1_EVENT_TYPES)[number];
export type OpaqueRef = string;

export interface V1ParticipantSnapshot {
  participant_ref: OpaqueRef;
  display_name: string;
  active: boolean;
  principal_ref?: OpaqueRef;
}

export interface V1OccurrenceSnapshot {
  occurrence_ref: OpaqueRef;
  date: string;
  title: string;
  accepts_at: string;
  stops_accepting_at: string;
}

export interface V1CheckInInvalidationCommand {
  command_ref: OpaqueRef;
  check_in_ref: OpaqueRef;
  reason_code?: OpaqueRef;
}

interface V1MessageBase<T extends V1MessageType> {
  schema_version: typeof SCHEMA_VERSION;
  message_type: T;
  idempotency_key: string;
  correlation_ref: OpaqueRef;
  installation_ref: OpaqueRef;
  roster_ref: OpaqueRef;
}

export interface V1RosterSnapshot extends V1MessageBase<"roster.snapshot"> {
  tenant_ref: OpaqueRef;
  revision: number;
  owner_principal_ref: OpaqueRef;
  owner_display_name: string;
  display_name: string;
  participants: V1ParticipantSnapshot[];
}

export interface V1ScheduleSnapshot extends V1MessageBase<"schedule.snapshot"> {
  revision: number;
  timezone: string;
  window_start: string;
  window_end: string;
  occurrences: V1OccurrenceSnapshot[];
}

export interface V1SessionCommand extends V1MessageBase<"session.command"> {
  occurrence_ref: OpaqueRef;
  command: "open" | "close";
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
}

export interface V1CheckInInvalidate extends V1MessageBase<"check_in.invalidate"> {
  occurrence_ref: OpaqueRef;
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
  invalidations: V1CheckInInvalidationCommand[];
}

export interface V1CheckInPresentationRequest
  extends V1MessageBase<"check_in.presentation"> {
  occurrence_ref: OpaqueRef;
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
}

export interface V1StudentCheckIn extends V1MessageBase<"student_check_in"> {
  participant_ref?: OpaqueRef;
  occurrence_ref: OpaqueRef;
  check_in_token: OpaqueRef;
  actor_principal_ref: OpaqueRef;
  actor_display_name: string;
}

export type V1Message =
  | V1RosterSnapshot
  | V1ScheduleSnapshot
  | V1SessionCommand
  | V1CheckInInvalidate
  | V1CheckInPresentationRequest
  | V1StudentCheckIn;

export interface V1CheckInFact {
  check_in_ref: OpaqueRef;
  participant_ref: OpaqueRef;
  check_in_revision: number;
  accepted_at: string;
  invalidated_at?: string;
  reason_code?: OpaqueRef;
}

export interface V1StudentCheckInResult {
  ok: true;
  schema_version: typeof SCHEMA_VERSION;
  outcome: "applied" | "duplicate" | "rejected";
  result_code:
    | "check_in_accepted"
    | "already_checked_in"
    | "not_on_roster"
    | "session_not_accepting"
    | "invalid_check_in_token"
    | "not_authorized";
  occurrence_ref: OpaqueRef;
  session_revision: number;
  check_in?: V1CheckInFact;
}

export interface V1CheckInPresentation {
  schema_version: typeof SCHEMA_VERSION;
  occurrence_ref: OpaqueRef;
  session_revision: number;
  check_in_path: string;
  valid_until: string;
}

export interface V1SessionSnapshot {
  schema_version: typeof SCHEMA_VERSION;
  occurrence_ref: OpaqueRef;
  roster_ref: OpaqueRef;
  session_revision: number;
  status: "scheduled" | "open" | "closed" | "cancelled";
  accepts_at: string;
  stops_accepting_at: string;
  check_ins: V1CheckInFact[];
}

export type V1EventMetadata = {
  "attendance.session.scheduled": {
    accepts_at: string;
    stops_accepting_at: string;
  };
  "attendance.session.opened": {
    opened_at: string;
    trigger: "schedule" | "staff";
  };
  "attendance.session.closed": {
    closed_at: string;
    trigger: "schedule" | "staff";
  };
  "attendance.session.cancelled": {
    cancelled_at: string;
    reason_code:
      | "schedule_removed"
      | "staff_cancelled"
      | "missed_window"
      | "automation_failed";
  };
  "attendance.check_in.accepted": {
    check_in_ref: OpaqueRef;
    participant_ref: OpaqueRef;
    check_in_revision: number;
    accepted_at: string;
  };
  "attendance.check_in.invalidated": {
    check_in_ref: OpaqueRef;
    participant_ref: OpaqueRef;
    check_in_revision: number;
    accepted_at: string;
    invalidated_at: string;
    reason_code?: OpaqueRef;
  };
};

export type V1Event<T extends V1EventType = V1EventType> = T extends V1EventType
  ? {
      schema_version: typeof SCHEMA_VERSION;
      event_id: OpaqueRef;
      idempotency_key: string;
      correlation_ref: OpaqueRef;
      event_type: T;
      occurred_at: string;
      installation_ref: OpaqueRef;
      roster_ref: OpaqueRef;
      occurrence_ref: OpaqueRef;
      session_revision: number;
      metadata: V1EventMetadata[T];
    }
  : never;

export const V1_ERRORS = [
  "unsupported_schema_version",
  "missing_required_fields",
  "unknown_message_type",
  "unknown_event_type",
  "invalid_envelope",
  "invalid_payload",
] as const;

export type V1Error = (typeof V1_ERRORS)[number];

export type V1ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: V1Error; detail: string };
