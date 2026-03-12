export function toDisplayRoleLabel(role: string | null | undefined): string {
  const normalized = String(role || "").trim().toLowerCase();
  if (
    normalized === "creator" ||
    normalized === "provider" ||
    normalized === "institute" ||
    normalized === "quiz_master" ||
    normalized === "quizmaster"
  ) {
    return "Quiz Master";
  }
  if (normalized === "mentor" || normalized === "mains_mentor" || normalized === "mainsmentor") {
    return "Mains Mentor";
  }
  if (normalized === "moderator") {
    return "Moderator";
  }
  if (normalized === "admin") {
    return "Admin";
  }
  if (normalized === "subscriber") {
    return "Subscriber";
  }
  if (normalized === "user") {
    return "User";
  }
  return "Professional";
}

export function toProfileRoleLabel(role: string | null | undefined): string {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "creator" || normalized === "provider" || normalized === "institute") {
    return "quiz_master";
  }
  if (normalized === "mentor") {
    return "mains_mentor";
  }
  return normalized || "professional";
}
