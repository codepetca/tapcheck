export type ParticipantLinkStatus = "linked" | "unlinked" | "ambiguous" | "review_needed";
export type ParticipantLinkMethod = "student_id" | "school_email" | "manual_staff" | "self_check_in";
export type SessionStatus = "open" | "closed";
export type AttendanceStatus = "unmarked" | "present" | "late" | "absent";
export type AttendanceEventResult = "applied" | "duplicate" | "blocked" | "review_needed";

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeStudentId(value?: string | null) {
  const normalized = normalizeValue(value ?? "").toLocaleLowerCase();
  return normalized || undefined;
}

export function normalizeSchoolEmail(value?: string | null) {
  const normalized = normalizeValue(value ?? "").toLocaleLowerCase();
  return normalized || undefined;
}

export function getParticipantType(linkedAppUserId?: string | null) {
  return linkedAppUserId ? "identified_user" : "roster_only";
}

export function isPresentLikeStatus(status: AttendanceStatus) {
  return status === "present" || status === "late";
}
