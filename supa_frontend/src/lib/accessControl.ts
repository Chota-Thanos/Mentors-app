type GenericUser = unknown | null | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "yes", "active", "paid", "premium"].includes(normalized);
  }
  if (typeof value === "number") return value > 0;
  return false;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isGenerationSubscriptionEnforced(): boolean {
  const flag = asString(process.env.NEXT_PUBLIC_REQUIRE_GENERATION_SUBSCRIPTION ?? "false");
  return flag === "true" || flag === "1" || flag === "yes";
}

function isQuizMasterGenerationSubscriptionEnforced(): boolean {
  const flag = asString(process.env.NEXT_PUBLIC_REQUIRE_QUIZ_MASTER_GENERATION_SUBSCRIPTION ?? "false");
  return flag === "true" || flag === "1" || flag === "yes";
}

function isMainsMentorGenerationSubscriptionEnforced(): boolean {
  const flag = asString(process.env.NEXT_PUBLIC_REQUIRE_MAINS_MENTOR_GENERATION_SUBSCRIPTION ?? "false");
  return flag === "true" || flag === "1" || flag === "yes";
}

export function getUserRole(user: GenericUser): string {
  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);
  return asString(record.role || app.role || meta.role);
}

export function isAdminLike(user: GenericUser): boolean {
  const role = getUserRole(user);
  if (role === "admin") return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);
  return asBoolean(app.admin) || asBoolean(meta.admin);
}

export function isModeratorLike(user: GenericUser): boolean {
  if (isAdminLike(user)) return true;
  const role = getUserRole(user);
  if (role === "moderator") return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);
  return asBoolean(app.moderator) || asBoolean(meta.moderator);
}

export function isProviderLike(user: GenericUser): boolean {
  if (isAdminLike(user)) return true;
  const role = getUserRole(user);
  if (role === "provider" || role === "institute" || role === "creator" || role === "quiz_master" || role === "quizmaster") return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);
  return (
    asBoolean(app.provider) ||
    asBoolean(meta.provider) ||
    asBoolean(app.institute) ||
    asBoolean(meta.institute) ||
    asBoolean(app.creator) ||
    asBoolean(meta.creator) ||
    asBoolean(app.quiz_master) ||
    asBoolean(meta.quiz_master) ||
    asBoolean(app.quizmaster) ||
    asBoolean(meta.quizmaster)
  );
}

export function isCreatorLike(user: GenericUser): boolean {
  if (isAdminLike(user)) return true;
  const role = getUserRole(user);
  if (role === "creator") return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);
  return asBoolean(app.creator) || asBoolean(meta.creator);
}

export function isMentorLike(user: GenericUser): boolean {
  if (isAdminLike(user)) return true;
  const role = getUserRole(user);
  if (role === "mentor" || role === "mains_mentor" || role === "mainsmentor") return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);
  return (
    asBoolean(app.mentor) ||
    asBoolean(meta.mentor) ||
    asBoolean(app.mains_mentor) ||
    asBoolean(meta.mains_mentor) ||
    asBoolean(app.mainsmentor) ||
    asBoolean(meta.mainsmentor)
  );
}

export function isQuizMasterLike(user: GenericUser): boolean {
  return isProviderLike(user) || isCreatorLike(user);
}

export function isMainsMentorLike(user: GenericUser): boolean {
  return isMentorLike(user);
}

export function canManagePrelimsSeries(user: GenericUser): boolean {
  return isAdminLike(user) || isModeratorLike(user) || isQuizMasterLike(user);
}

export function canManageMainsSeries(user: GenericUser): boolean {
  return isAdminLike(user) || isModeratorLike(user) || isMainsMentorLike(user);
}

export function canManageMentorship(user: GenericUser): boolean {
  return isAdminLike(user) || isModeratorLike(user) || isMainsMentorLike(user);
}

export function isSeriesOperatorLike(user: GenericUser): boolean {
  return canManagePrelimsSeries(user) || canManageMainsSeries(user);
}

export function canAccessManualQuizBuilder(user: GenericUser): boolean {
  return canManagePrelimsSeries(user);
}

export function canAccessMainsAuthoring(user: GenericUser): boolean {
  return canManageMainsSeries(user);
}

export function getAccountRoleLabels(user: GenericUser): string[] {
  const labels: string[] = [];
  const role = getUserRole(user);
  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);

  if (isAdminLike(user)) {
    labels.push("Admin");
  }

  const explicitModerator = role === "moderator" || asBoolean(app.moderator) || asBoolean(meta.moderator);
  if (explicitModerator) {
    labels.push("Moderator");
  }

  if (isQuizMasterLike(user)) {
    labels.push("Quiz Master");
  }

  if (isMainsMentorLike(user)) {
    labels.push("Mains Mentor");
  }

  if (labels.length === 0 && role === "subscriber") {
    labels.push("Subscriber");
  }

  if (labels.length === 0) {
    labels.push("User");
  }

  return Array.from(new Set(labels));
}

export function hasGenerationSubscription(user: GenericUser): boolean {
  if (!isGenerationSubscriptionEnforced()) return true;
  if (isAdminLike(user)) return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);

  const status = [
    app.subscription_status,
    meta.subscription_status,
    app.plan_status,
    meta.plan_status,
  ].map(asString);

  if (status.some((value) => value === "active" || value === "paid" || value === "premium")) {
    return true;
  }

  const plan = [
    app.plan,
    meta.plan,
    app.current_plan,
    meta.current_plan,
    app.tier,
    meta.tier,
  ].map(asString);

  if (plan.some((value) => value && value !== "free" && value !== "basic")) {
    return true;
  }

  return (
    asBoolean(app.subscription_active) ||
    asBoolean(meta.subscription_active) ||
    asBoolean(app.is_subscribed) ||
    asBoolean(meta.is_subscribed) ||
    asBoolean(app.has_subscription) ||
    asBoolean(meta.has_subscription) ||
    asBoolean(app.premium) ||
    asBoolean(meta.premium)
  );
}

export function hasQuizMasterGenerationSubscription(user: GenericUser): boolean {
  if (isAdminLike(user)) return true;
  if (!isQuizMasterLike(user)) return false;
  if (!isQuizMasterGenerationSubscriptionEnforced()) return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);

  const status = [
    app.quiz_master_subscription_status,
    meta.quiz_master_subscription_status,
    app.quiz_master_ai_subscription_status,
    meta.quiz_master_ai_subscription_status,
    app.creator_subscription_status,
    meta.creator_subscription_status,
    app.creator_ai_subscription_status,
    meta.creator_ai_subscription_status,
  ].map(asString);

  if (status.some((value) => value === "active" || value === "paid" || value === "premium" || value === "enabled")) {
    return true;
  }

  const plan = [
    app.quiz_master_plan,
    meta.quiz_master_plan,
    app.quiz_master_ai_plan,
    meta.quiz_master_ai_plan,
    app.creator_plan,
    meta.creator_plan,
    app.creator_ai_plan,
    meta.creator_ai_plan,
  ].map(asString);

  if (plan.some((value) => value && value !== "free" && value !== "basic" && value !== "none")) {
    return true;
  }

  return (
    asBoolean(app.quiz_master_subscription_active) ||
    asBoolean(meta.quiz_master_subscription_active) ||
    asBoolean(app.quiz_master_ai_enabled) ||
    asBoolean(meta.quiz_master_ai_enabled) ||
    asBoolean(app.creator_subscription_active) ||
    asBoolean(meta.creator_subscription_active) ||
    asBoolean(app.creator_ai_enabled) ||
    asBoolean(meta.creator_ai_enabled) ||
    asBoolean(app.quiz_master_ai_access) ||
    asBoolean(meta.quiz_master_ai_access)
  );
}

export function hasMainsMentorGenerationSubscription(user: GenericUser): boolean {
  if (isAdminLike(user)) return true;
  if (!isMainsMentorLike(user)) return false;
  if (!isMainsMentorGenerationSubscriptionEnforced()) return true;

  const record = asRecord(user);
  const app = asRecord(record.app_metadata);
  const meta = asRecord(record.user_metadata);

  const status = [
    app.mains_mentor_subscription_status,
    meta.mains_mentor_subscription_status,
    app.mains_mentor_ai_subscription_status,
    meta.mains_mentor_ai_subscription_status,
    app.mentor_subscription_status,
    meta.mentor_subscription_status,
    app.mentor_ai_subscription_status,
    meta.mentor_ai_subscription_status,
  ].map(asString);

  if (status.some((value) => value === "active" || value === "paid" || value === "premium" || value === "enabled")) {
    return true;
  }

  const plan = [
    app.mains_mentor_plan,
    meta.mains_mentor_plan,
    app.mains_mentor_ai_plan,
    meta.mains_mentor_ai_plan,
    app.mentor_plan,
    meta.mentor_plan,
    app.mentor_ai_plan,
    meta.mentor_ai_plan,
  ].map(asString);

  if (plan.some((value) => value && value !== "free" && value !== "basic" && value !== "none")) {
    return true;
  }

  return (
    asBoolean(app.mains_mentor_subscription_active) ||
    asBoolean(meta.mains_mentor_subscription_active) ||
    asBoolean(app.mains_mentor_ai_enabled) ||
    asBoolean(meta.mains_mentor_ai_enabled) ||
    asBoolean(app.mentor_subscription_active) ||
    asBoolean(meta.mentor_subscription_active) ||
    asBoolean(app.mentor_ai_enabled) ||
    asBoolean(meta.mentor_ai_enabled) ||
    asBoolean(app.mains_mentor_ai_access) ||
    asBoolean(meta.mains_mentor_ai_access)
  );
}
