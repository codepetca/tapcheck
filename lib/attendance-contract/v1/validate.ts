import {
  SCHEMA_VERSION,
  V1_EVENT_TYPES,
  V1_MESSAGE_TYPES,
  type V1Error,
  type V1Event,
  type V1EventType,
  type V1Message,
  type V1MessageType,
  type V1ValidationResult,
} from "./types";

const URL_SAFE = /^[A-Za-z0-9._~-]+$/;
const IDEMPOTENCY_SAFE = /^[A-Za-z0-9._~:-]+$/;
const RFC_3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|\+00:00)$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/;
const MESSAGE_TYPES = new Set<string>(V1_MESSAGE_TYPES);
const EVENT_TYPES = new Set<string>(V1_EVENT_TYPES);

const MESSAGE_BASE_KEYS = [
  "schema_version",
  "message_type",
  "idempotency_key",
  "correlation_ref",
  "installation_ref",
  "roster_ref",
] as const;

const EVENT_KEYS = [
  "schema_version",
  "event_id",
  "idempotency_key",
  "correlation_ref",
  "event_type",
  "occurred_at",
  "installation_ref",
  "roster_ref",
  "occurrence_ref",
  "session_revision",
  "metadata",
] as const;

function fail<T>(error: V1Error, detail: string): V1ValidationResult<T> {
  return { ok: false, error, detail };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeProblem(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): string | null {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) return `unexpected fields: ${unexpected.join(", ")}`;
  const missing = required.filter((key) => !(key in value));
  return missing.length > 0 ? `missing fields: ${missing.join(", ")}` : null;
}

function isRef(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && URL_SAFE.test(value);
}

function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && IDEMPOTENCY_SAFE.test(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.length <= maxLength &&
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC_3339_UTC.exec(value);
  if (!match) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() + 1 === Number(match[2]) &&
    parsed.getUTCDate() === Number(match[3]) &&
    parsed.getUTCHours() === Number(match[4]) &&
    parsed.getUTCMinutes() === Number(match[5]) &&
    parsed.getUTCSeconds() === Number(match[6])
  );
}

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function baseMessageProblem(value: Record<string, unknown>): string | null {
  if (!isIdempotencyKey(value.idempotency_key)) return "invalid idempotency_key";
  if (!isRef(value.correlation_ref)) return "invalid correlation_ref";
  if (!isRef(value.installation_ref)) return "invalid installation_ref";
  if (!isRef(value.roster_ref)) return "invalid roster_ref";
  return null;
}

function validateRosterSnapshot(value: Record<string, unknown>): V1ValidationResult<V1Message> {
  const keys = [
    ...MESSAGE_BASE_KEYS,
    "revision",
    "owner_principal_ref",
    "owner_display_name",
    "tenant_ref",
    "display_name",
    "participants",
  ];
  const problem = shapeProblem(value, keys) ?? baseMessageProblem(value);
  if (problem) return fail("invalid_envelope", problem);
  if (!isPositiveRevision(value.revision)) return fail("invalid_payload", "revision must be an integer >= 1");
  if (!isRef(value.owner_principal_ref)) {
    return fail("invalid_payload", "invalid owner_principal_ref");
  }
  if (!isRef(value.tenant_ref)) return fail("invalid_payload", "invalid tenant_ref");
  if (!isBoundedText(value.owner_display_name, 200)) {
    return fail("invalid_payload", "invalid owner_display_name");
  }
  if (!isBoundedText(value.display_name, 200)) return fail("invalid_payload", "invalid display_name");
  if (!Array.isArray(value.participants) || value.participants.length > 500) {
    return fail("invalid_payload", "participants must be an array of at most 500 items");
  }

  const participants = [];
  const participantRefs = new Set<string>();
  for (const participant of value.participants) {
    if (!isPlainObject(participant)) return fail("invalid_payload", "participant must be an object");
    const participantProblem = shapeProblem(
      participant,
      ["participant_ref", "display_name", "active", "principal_ref"],
      ["participant_ref", "display_name", "active"],
    );
    if (participantProblem) return fail("invalid_payload", `participant ${participantProblem}`);
    if (!isRef(participant.participant_ref)) return fail("invalid_payload", "invalid participant_ref");
    if (participantRefs.has(participant.participant_ref)) {
      return fail("invalid_payload", "duplicate participant_ref");
    }
    if (!isBoundedText(participant.display_name, 200)) {
      return fail("invalid_payload", "invalid participant display_name");
    }
    if (typeof participant.active !== "boolean") return fail("invalid_payload", "invalid participant active");
    if (participant.principal_ref !== undefined && !isRef(participant.principal_ref)) {
      return fail("invalid_payload", "invalid principal_ref");
    }
    participantRefs.add(participant.participant_ref);
    participants.push({
      participant_ref: participant.participant_ref,
      display_name: participant.display_name.trim(),
      active: participant.active,
      ...(participant.principal_ref ? { principal_ref: participant.principal_ref } : {}),
    });
  }

  return {
    ok: true,
    value: {
      schema_version: SCHEMA_VERSION,
      message_type: "roster.snapshot",
      idempotency_key: value.idempotency_key as string,
      correlation_ref: value.correlation_ref as string,
      installation_ref: value.installation_ref as string,
      roster_ref: value.roster_ref as string,
      revision: value.revision,
      tenant_ref: value.tenant_ref,
      owner_principal_ref: value.owner_principal_ref,
      owner_display_name: (value.owner_display_name as string).trim(),
      display_name: (value.display_name as string).trim(),
      participants,
    },
  };
}

function validateScheduleSnapshot(value: Record<string, unknown>): V1ValidationResult<V1Message> {
  const keys = [
    ...MESSAGE_BASE_KEYS,
    "revision",
    "timezone",
    "window_start",
    "window_end",
    "occurrences",
  ];
  const problem = shapeProblem(value, keys) ?? baseMessageProblem(value);
  if (problem) return fail("invalid_envelope", problem);
  if (!isPositiveRevision(value.revision)) return fail("invalid_payload", "revision must be an integer >= 1");
  if (typeof value.timezone !== "string" || value.timezone.length > 64 || !TIMEZONE.test(value.timezone)) {
    return fail("invalid_payload", "invalid timezone");
  }
  if (!isCalendarDay(value.window_start) || !isCalendarDay(value.window_end) || value.window_start > value.window_end) {
    return fail("invalid_payload", "invalid schedule window");
  }
  if (!Array.isArray(value.occurrences) || value.occurrences.length > 400) {
    return fail("invalid_payload", "occurrences must be an array of at most 400 items");
  }

  const occurrences = [];
  const occurrenceRefs = new Set<string>();
  for (const occurrence of value.occurrences) {
    if (!isPlainObject(occurrence)) return fail("invalid_payload", "occurrence must be an object");
    const occurrenceProblem = shapeProblem(
      occurrence,
      ["occurrence_ref", "date", "title", "accepts_at", "stops_accepting_at"],
    );
    if (occurrenceProblem) return fail("invalid_payload", `occurrence ${occurrenceProblem}`);
    if (!isRef(occurrence.occurrence_ref)) return fail("invalid_payload", "invalid occurrence_ref");
    if (occurrenceRefs.has(occurrence.occurrence_ref)) return fail("invalid_payload", "duplicate occurrence_ref");
    if (
      !isCalendarDay(occurrence.date) ||
      occurrence.date < value.window_start ||
      occurrence.date > value.window_end
    ) {
      return fail("invalid_payload", "occurrence date is outside the schedule window");
    }
    if (!isBoundedText(occurrence.title, 200)) return fail("invalid_payload", "invalid occurrence title");
    if (!isUtcInstant(occurrence.accepts_at) || !isUtcInstant(occurrence.stops_accepting_at)) {
      return fail("invalid_payload", "occurrence times must be UTC instants");
    }
    if (Date.parse(occurrence.accepts_at) >= Date.parse(occurrence.stops_accepting_at)) {
      return fail("invalid_payload", "occurrence stops_accepting_at must be after accepts_at");
    }
    occurrenceRefs.add(occurrence.occurrence_ref);
    occurrences.push({
      occurrence_ref: occurrence.occurrence_ref,
      date: occurrence.date,
      title: occurrence.title.trim(),
      accepts_at: occurrence.accepts_at,
      stops_accepting_at: occurrence.stops_accepting_at,
    });
  }

  return {
    ok: true,
    value: {
      schema_version: SCHEMA_VERSION,
      message_type: "schedule.snapshot",
      idempotency_key: value.idempotency_key as string,
      correlation_ref: value.correlation_ref as string,
      installation_ref: value.installation_ref as string,
      roster_ref: value.roster_ref as string,
      revision: value.revision,
      timezone: value.timezone,
      window_start: value.window_start,
      window_end: value.window_end,
      occurrences,
    },
  };
}

function validateSessionCommand(value: Record<string, unknown>): V1ValidationResult<V1Message> {
  const keys = [...MESSAGE_BASE_KEYS, "occurrence_ref", "command", "actor_principal_ref", "actor_display_name"];
  const problem = shapeProblem(value, keys) ?? baseMessageProblem(value);
  if (problem) return fail("invalid_envelope", problem);
  if (!isRef(value.occurrence_ref)) return fail("invalid_payload", "invalid occurrence_ref");
  if (value.command !== "open" && value.command !== "close") return fail("invalid_payload", "invalid command");
  if (!isRef(value.actor_principal_ref)) return fail("invalid_payload", "invalid actor_principal_ref");
  if (!isBoundedText(value.actor_display_name, 200)) return fail("invalid_payload", "invalid actor_display_name");
  return { ok: true, value: { ...value, actor_display_name: value.actor_display_name.trim() } as unknown as V1Message };
}

function validateCheckInInvalidate(value: Record<string, unknown>): V1ValidationResult<V1Message> {
  const keys = [
    ...MESSAGE_BASE_KEYS,
    "occurrence_ref",
    "actor_principal_ref",
    "actor_display_name",
    "invalidations",
  ];
  const problem = shapeProblem(value, keys) ?? baseMessageProblem(value);
  if (problem) return fail("invalid_envelope", problem);
  if (!isRef(value.occurrence_ref)) return fail("invalid_payload", "invalid occurrence_ref");
  if (!isRef(value.actor_principal_ref)) return fail("invalid_payload", "invalid actor_principal_ref");
  if (!isBoundedText(value.actor_display_name, 200)) return fail("invalid_payload", "invalid actor_display_name");
  if (!Array.isArray(value.invalidations) || value.invalidations.length < 1 || value.invalidations.length > 200) {
    return fail("invalid_payload", "invalidations must contain 1-200 items");
  }

  const invalidations = [];
  const commandRefs = new Set<string>();
  const checkInRefs = new Set<string>();
  for (const invalidation of value.invalidations) {
    if (!isPlainObject(invalidation)) {
      return fail("invalid_payload", "invalidation must be an object");
    }
    const invalidationProblem = shapeProblem(
      invalidation,
      ["command_ref", "check_in_ref", "reason_code"],
      ["command_ref", "check_in_ref"],
    );
    if (invalidationProblem) return fail("invalid_payload", `invalidation ${invalidationProblem}`);
    if (!isRef(invalidation.command_ref)) return fail("invalid_payload", "invalid command_ref");
    if (!isRef(invalidation.check_in_ref)) return fail("invalid_payload", "invalid check_in_ref");
    if (commandRefs.has(invalidation.command_ref)) return fail("invalid_payload", "duplicate command_ref");
    if (checkInRefs.has(invalidation.check_in_ref)) {
      return fail("invalid_payload", "duplicate check_in_ref in invalidations");
    }
    if (invalidation.reason_code !== undefined && !isRef(invalidation.reason_code)) {
      return fail("invalid_payload", "invalid reason_code");
    }
    commandRefs.add(invalidation.command_ref);
    checkInRefs.add(invalidation.check_in_ref);
    invalidations.push({
      command_ref: invalidation.command_ref,
      check_in_ref: invalidation.check_in_ref,
      ...(invalidation.reason_code ? { reason_code: invalidation.reason_code } : {}),
    });
  }

  return {
    ok: true,
    value: {
      schema_version: SCHEMA_VERSION,
      message_type: "check_in.invalidate",
      idempotency_key: value.idempotency_key as string,
      correlation_ref: value.correlation_ref as string,
      installation_ref: value.installation_ref as string,
      roster_ref: value.roster_ref as string,
      occurrence_ref: value.occurrence_ref,
      actor_principal_ref: value.actor_principal_ref,
      actor_display_name: (value.actor_display_name as string).trim(),
      invalidations,
    },
  };
}

function validateCheckInPresentation(
  value: Record<string, unknown>,
): V1ValidationResult<V1Message> {
  const keys = [...MESSAGE_BASE_KEYS, "occurrence_ref", "actor_principal_ref", "actor_display_name"];
  const problem = shapeProblem(value, keys) ?? baseMessageProblem(value);
  if (problem) return fail("invalid_envelope", problem);
  if (!isRef(value.occurrence_ref)) return fail("invalid_payload", "invalid occurrence_ref");
  if (!isRef(value.actor_principal_ref)) {
    return fail("invalid_payload", "invalid actor_principal_ref");
  }
  if (!isBoundedText(value.actor_display_name, 200)) {
    return fail("invalid_payload", "invalid actor_display_name");
  }
  return { ok: true, value: { ...value, actor_display_name: value.actor_display_name.trim() } as unknown as V1Message };
}

function validateStudentCheckIn(value: Record<string, unknown>): V1ValidationResult<V1Message> {
  const keys = [
    ...MESSAGE_BASE_KEYS,
    "occurrence_ref",
    "check_in_token",
    "actor_principal_ref",
    "actor_display_name",
  ];
  const problem = shapeProblem(value, [...keys, "participant_ref"], keys) ?? baseMessageProblem(value);
  if (problem) return fail("invalid_envelope", problem);
  if (value.participant_ref !== undefined && !isRef(value.participant_ref)) return fail("invalid_payload", "invalid participant_ref");
  if (!isRef(value.occurrence_ref)) return fail("invalid_payload", "invalid occurrence_ref");
  if (!isRef(value.check_in_token) || value.check_in_token.length < 20) {
    return fail("invalid_payload", "invalid check_in_token");
  }
  if (!isRef(value.actor_principal_ref)) return fail("invalid_payload", "invalid actor_principal_ref");
  if (!isBoundedText(value.actor_display_name, 200)) return fail("invalid_payload", "invalid actor_display_name");
  return {
    ok: true,
    value: { ...value, actor_display_name: value.actor_display_name.trim() } as unknown as V1Message,
  };
}

export function validateV1Message(value: unknown): V1ValidationResult<V1Message> {
  if (!isPlainObject(value)) return fail("missing_required_fields", "payload must be an object");
  if (value.schema_version !== SCHEMA_VERSION) {
    return fail("unsupported_schema_version", `schema_version must be ${SCHEMA_VERSION}`);
  }
  if (typeof value.message_type !== "string" || !MESSAGE_TYPES.has(value.message_type)) {
    return fail("unknown_message_type", `message_type must be one of: ${V1_MESSAGE_TYPES.join(", ")}`);
  }
  switch (value.message_type as V1MessageType) {
    case "roster.snapshot":
      return validateRosterSnapshot(value);
    case "schedule.snapshot":
      return validateScheduleSnapshot(value);
    case "session.command":
      return validateSessionCommand(value);
    case "check_in.invalidate":
      return validateCheckInInvalidate(value);
    case "check_in.presentation":
      return validateCheckInPresentation(value);
    case "student_check_in":
      return validateStudentCheckIn(value);
  }
}

function eventMetadataProblem(eventType: V1EventType, metadata: Record<string, unknown>): string | null {
  if (eventType === "attendance.session.scheduled") {
    const problem = shapeProblem(metadata, ["accepts_at", "stops_accepting_at"]);
    if (problem) return problem;
    if (!isUtcInstant(metadata.accepts_at) || !isUtcInstant(metadata.stops_accepting_at)) {
      return "invalid scheduled times";
    }
    return Date.parse(metadata.accepts_at) < Date.parse(metadata.stops_accepting_at)
      ? null
      : "stops_accepting_at must be after accepts_at";
  }
  if (eventType === "attendance.session.opened") {
    const problem = shapeProblem(metadata, ["opened_at", "trigger"]);
    if (problem) return problem;
    if (!isUtcInstant(metadata.opened_at)) return "invalid opened_at";
    return metadata.trigger === "schedule" || metadata.trigger === "staff" ? null : "invalid open trigger";
  }
  if (eventType === "attendance.session.closed") {
    const problem = shapeProblem(metadata, ["closed_at", "trigger"]);
    if (problem) return problem;
    if (!isUtcInstant(metadata.closed_at)) return "invalid closed_at";
    return metadata.trigger === "schedule" || metadata.trigger === "staff" ? null : "invalid close trigger";
  }
  if (eventType === "attendance.session.cancelled") {
    const problem = shapeProblem(metadata, ["cancelled_at", "reason_code"]);
    if (problem) return problem;
    if (!isUtcInstant(metadata.cancelled_at)) return "invalid cancelled_at";
    return metadata.reason_code === "schedule_removed" ||
      metadata.reason_code === "staff_cancelled" ||
      metadata.reason_code === "missed_window" ||
      metadata.reason_code === "automation_failed"
      ? null
      : "invalid cancellation reason";
  }

  const accepted = eventType === "attendance.check_in.accepted";
  const problem = shapeProblem(
    metadata,
    [
      "check_in_ref",
      "participant_ref",
      "check_in_revision",
      "accepted_at",
      "invalidated_at",
      "reason_code",
    ],
    accepted
      ? ["check_in_ref", "participant_ref", "check_in_revision", "accepted_at"]
      : ["check_in_ref", "participant_ref", "check_in_revision", "accepted_at", "invalidated_at"],
  );
  if (problem) return problem;
  if (!isRef(metadata.check_in_ref)) return "invalid check_in_ref";
  if (!isRef(metadata.participant_ref)) return "invalid participant_ref";
  if (!isPositiveRevision(metadata.check_in_revision)) return "invalid check_in_revision";
  if (!isUtcInstant(metadata.accepted_at)) return "invalid accepted_at";
  if (accepted && (metadata.invalidated_at !== undefined || metadata.reason_code !== undefined)) {
    return "accepted events cannot contain invalidation fields";
  }
  if (!accepted && !isUtcInstant(metadata.invalidated_at)) return "invalid invalidated_at";
  if (
    !accepted &&
    Date.parse(metadata.invalidated_at as string) < Date.parse(metadata.accepted_at as string)
  ) {
    return "invalidated_at must not be before accepted_at";
  }
  return metadata.reason_code === undefined || isRef(metadata.reason_code)
    ? null
    : "invalid reason_code";
}

export function validateV1Event(value: unknown): V1ValidationResult<V1Event> {
  if (!isPlainObject(value)) return fail("missing_required_fields", "payload must be an object");
  if (value.schema_version !== SCHEMA_VERSION) {
    return fail("unsupported_schema_version", `schema_version must be ${SCHEMA_VERSION}`);
  }
  const shape = shapeProblem(value, EVENT_KEYS);
  if (shape) return fail("invalid_envelope", shape);
  if (typeof value.event_type !== "string" || !EVENT_TYPES.has(value.event_type)) {
    return fail("unknown_event_type", `event_type must be one of: ${V1_EVENT_TYPES.join(", ")}`);
  }
  if (!isRef(value.event_id)) return fail("invalid_envelope", "invalid event_id");
  if (!isIdempotencyKey(value.idempotency_key)) return fail("invalid_envelope", "invalid idempotency_key");
  if (!isRef(value.correlation_ref)) return fail("invalid_envelope", "invalid correlation_ref");
  if (!isUtcInstant(value.occurred_at)) return fail("invalid_envelope", "invalid occurred_at");
  if (!isRef(value.installation_ref)) return fail("invalid_envelope", "invalid installation_ref");
  if (!isRef(value.roster_ref)) return fail("invalid_envelope", "invalid roster_ref");
  if (!isRef(value.occurrence_ref)) return fail("invalid_envelope", "invalid occurrence_ref");
  if (!isPositiveRevision(value.session_revision)) return fail("invalid_envelope", "invalid session_revision");
  if (!isPlainObject(value.metadata)) return fail("invalid_payload", "metadata must be an object");
  const metadataProblem = eventMetadataProblem(value.event_type as V1EventType, value.metadata);
  if (metadataProblem) return fail("invalid_payload", metadataProblem);

  return {
    ok: true,
    value: {
      schema_version: SCHEMA_VERSION,
      event_id: value.event_id,
      idempotency_key: value.idempotency_key,
      correlation_ref: value.correlation_ref,
      event_type: value.event_type as V1EventType,
      occurred_at: value.occurred_at,
      installation_ref: value.installation_ref,
      roster_ref: value.roster_ref,
      occurrence_ref: value.occurrence_ref,
      session_revision: value.session_revision,
      metadata: value.metadata,
    } as V1Event,
  };
}
