/**
 * V2 role label utilities — supports both old and new role names.
 * New roles: admin | moderator | prelims_expert | mains_expert | user
 */

export function toDisplayRoleLabel(role: string | null | undefined): string {
  const normalized = String(role || "").trim().toLowerCase();

  // V2 roles
  if (normalized === "admin") return "Admin";
  if (normalized === "moderator") return "Moderator";
  if (normalized === "prelims_expert") return "Prelims Expert";
  if (normalized === "mains_expert") return "Mains Expert";
  if (normalized === "user") return "User";

  // Legacy role aliases (backward compat)
  if (
    normalized === "creator" ||
    normalized === "provider" ||
    normalized === "institute" ||
    normalized === "quiz_master" ||
    normalized === "quizmaster"
  ) {
    return "Prelims Expert";
  }
  if (
    normalized === "mentor" ||
    normalized === "mains_mentor" ||
    normalized === "mainsmentor"
  ) {
    return "Mains Expert";
  }
  if (normalized === "subscriber") return "Subscriber";

  return "User";
}

/** Maps any role string to the canonical V2 role. */
export function toV2Role(role: string | null | undefined): string {
  const normalized = String(role || "").trim().toLowerCase();

  if (normalized === "admin") return "admin";
  if (normalized === "moderator") return "moderator";
  if (normalized === "prelims_expert") return "prelims_expert";
  if (normalized === "mains_expert") return "mains_expert";

  // Migrate old roles
  if (
    normalized === "creator" ||
    normalized === "provider" ||
    normalized === "institute" ||
    normalized === "quiz_master" ||
    normalized === "quizmaster"
  ) {
    return "prelims_expert";
  }
  if (
    normalized === "mentor" ||
    normalized === "mains_mentor" ||
    normalized === "mainsmentor"
  ) {
    return "mains_expert";
  }

  return "user";
}

/** @deprecated use toDisplayRoleLabel instead */
export function toProfileRoleLabel(role: string | null | undefined): string {
  return toV2Role(role);
}
