/**
 * V2 Access Control helpers — based on the new typed roles in public.profiles.
 *
 * New roles: admin | moderator | prelims_expert | mains_expert | user
 * Old roles (quiz_master, provider, institute, mentor) are now replaced.
 *
 * Usage:
 *   import { useProfile } from "@/context/ProfileContext";
 *   const { isAdmin, isCreator, isPrelimsExpert } = useProfile();
 *
 * Or use these pure helpers when you have a role string:
 *   import { roleIsAdmin, canManagePrelims } from "@/lib/accessControl";
 */

import type { UserRole } from "@/types/db";

// ── Pure role checks (use when you have a role string) ────────────────────────

export function roleIsAdmin(role: UserRole | string | undefined): boolean {
  return role === "admin";
}

export function roleIsModerator(role: UserRole | string | undefined): boolean {
  return role === "admin" || role === "moderator";
}

export function roleIsPrelimsExpert(role: UserRole | string | undefined): boolean {
  return role === "admin" || role === "prelims_expert";
}

export function roleIsMainsExpert(role: UserRole | string | undefined): boolean {
  return role === "admin" || role === "mains_expert";
}

export function roleIsCreator(role: UserRole | string | undefined): boolean {
  return (
    role === "admin" ||
    role === "moderator" ||
    role === "prelims_expert" ||
    role === "mains_expert"
  );
}

export function roleIsUser(role: UserRole | string | undefined): boolean {
  return !roleIsCreator(role);
}

// ── Permission checks ─────────────────────────────────────────────────────────

export function canManagePrelims(role: UserRole | string | undefined): boolean {
  return roleIsAdmin(role) || roleIsModerator(role) || roleIsPrelimsExpert(role);
}

export function canManageMains(role: UserRole | string | undefined): boolean {
  return roleIsAdmin(role) || roleIsModerator(role) || roleIsMainsExpert(role);
}

export function canManageMentorship(role: UserRole | string | undefined): boolean {
  return roleIsAdmin(role) || roleIsModerator(role) || roleIsMainsExpert(role);
}

export function canAccessAdminPanel(role: UserRole | string | undefined): boolean {
  return roleIsModerator(role);
}

export function canCreateContent(role: UserRole | string | undefined): boolean {
  return roleIsCreator(role);
}

export function canGenerateAi(role: UserRole | string | undefined): boolean {
  // All authenticated users can generate — quota limits apply
  return !!role;
}

// ── Human-readable role labels ────────────────────────────────────────────────

export function getRoleLabel(role: UserRole | string | undefined): string {
  const labels: Record<string, string> = {
    admin: "Admin",
    moderator: "Moderator",
    prelims_expert: "Prelims Expert",
    mains_expert: "Mains Expert",
    user: "User",
  };
  return labels[role ?? ""] ?? "User";
}

export function getRoleBadgeColor(role: UserRole | string | undefined): string {
  const colors: Record<string, string> = {
    admin: "bg-red-100 text-red-700",
    moderator: "bg-orange-100 text-orange-700",
    prelims_expert: "bg-blue-100 text-blue-700",
    mains_expert: "bg-purple-100 text-purple-700",
    user: "bg-gray-100 text-gray-600",
  };
  return colors[role ?? ""] ?? "bg-gray-100 text-gray-600";
}

// ── Subscription plan checks ──────────────────────────────────────────────────

export type SubscriptionPlan = "free" | "pro" | "expert";

export function planCanAccessSubscribedContent(plan: SubscriptionPlan | string | undefined): boolean {
  return plan === "pro" || plan === "expert";
}

export function planHasPriorityAi(plan: SubscriptionPlan | string | undefined): boolean {
  return plan === "expert";
}

export function getAiQuotaForPlan(
  plan: SubscriptionPlan | string | undefined,
  domain: "gk" | "maths" | "passage" | "mains",
): number {
  const quotas: Record<string, Record<string, number>> = {
    free:   { gk: 10, maths: 10, passage: 5, mains: 5 },
    pro:    { gk: 100, maths: 100, passage: 50, mains: 30 },
    expert: { gk: 999, maths: 999, passage: 999, mains: 200 },
  };
  return quotas[plan ?? "free"]?.[domain] ?? 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ALIASES — kept for backward compatibility with existing pages.
// These map old function names → new role-based equivalents.
// Do not remove until all pages are migrated to useProfile() hooks.
// ─────────────────────────────────────────────────────────────────────────────

type GenericUser = unknown | null | undefined;

function extractRole(user: GenericUser): string {
  if (!user || typeof user !== "object") return "user";
  const u = user as Record<string, unknown>;
  const app = (u.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  return String(u.role || app.role || meta.role || "user").toLowerCase();
}

/** @deprecated Use useProfile().isAdmin instead */
export function isAdminLike(user: GenericUser): boolean {
  const role = extractRole(user);
  return role === "admin";
}

/** @deprecated Use useProfile().isModerator instead */
export function isModeratorLike(user: GenericUser): boolean {
  const role = extractRole(user);
  return role === "admin" || role === "moderator";
}

/** @deprecated Use useProfile().isPrelimsExpert instead */
export function isQuizMasterLike(user: GenericUser): boolean {
  const role = extractRole(user);
  return (
    role === "admin" ||
    role === "moderator" ||
    role === "prelims_expert" ||
    // old role names
    role === "quiz_master" ||
    role === "quizmaster" ||
    role === "provider" ||
    role === "creator"
  );
}

/** @deprecated Use useProfile().isMainsExpert instead */
export function isMainsMentorLike(user: GenericUser): boolean {
  const role = extractRole(user);
  return (
    role === "admin" ||
    role === "moderator" ||
    role === "mains_expert" ||
    // old role names
    role === "mentor" ||
    role === "mains_mentor" ||
    role === "mainsmentor"
  );
}

/** @deprecated Use useProfile().isCreator instead */
export function isProviderLike(user: GenericUser): boolean {
  return isQuizMasterLike(user) || isMainsMentorLike(user);
}

/** @deprecated Use useProfile().isCreator instead */
export function isCreatorLike(user: GenericUser): boolean {
  return isProviderLike(user);
}

/** @deprecated Use useProfile().isModerator instead */
export function isSeriesOperatorLike(user: GenericUser): boolean {
  return isQuizMasterLike(user) || isMainsMentorLike(user);
}

/** @deprecated */
export function isMentorLike(user: GenericUser): boolean {
  return isMainsMentorLike(user);
}

/** @deprecated */
export function getUserRole(user: GenericUser): string {
  return extractRole(user);
}

/** @deprecated */
export function canManagePrelimsSeries(user: GenericUser): boolean {
  return isQuizMasterLike(user);
}

/** @deprecated */
export function canManageMainsSeries(user: GenericUser): boolean {
  return isMainsMentorLike(user);
}

/** @deprecated */
export function canAccessManualQuizBuilder(user: GenericUser): boolean {
  return isQuizMasterLike(user);
}

/** @deprecated */
export function canAccessStandaloneManualQuizBuilder(user: GenericUser): boolean {
  return isQuizMasterLike(user);
}

/** @deprecated */
export function canAccessMainsAuthoring(user: GenericUser): boolean {
  return isMainsMentorLike(user);
}

/** @deprecated */
export function getAccountRoleLabels(user: GenericUser): string[] {
  const role = extractRole(user);
  if (role === "admin") return ["Admin"];
  if (role === "moderator") return ["Moderator"];
  if (role === "prelims_expert") return ["Prelims Expert"];
  if (role === "mains_expert") return ["Mains Expert"];
  return ["User"];
}

/** @deprecated */
export function hasGenerationSubscription(_user: GenericUser): boolean {
  // In V2, quota is enforced by the backend — always return true here
  return true;
}

/** @deprecated */
export function hasQuizMasterGenerationSubscription(user: GenericUser): boolean {
  return isQuizMasterLike(user);
}

/** @deprecated */
export function hasMainsMentorGenerationSubscription(user: GenericUser): boolean {
  return isMainsMentorLike(user);
}

/** @deprecated */
export function canManageMentorshipLegacy(user: GenericUser): boolean {
  return isMainsMentorLike(user) || isModeratorLike(user);
}
