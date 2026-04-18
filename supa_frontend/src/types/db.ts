/**
 * V2 Schema Types — matches New_Supa_backend migrations 1-13
 * All user_id fields reference profiles.id (number), NOT auth.users.id (string).
 */

// ── Core ────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'admin'
  | 'moderator'
  | 'prelims_expert'
  | 'mains_expert'
  | 'user';

export interface Profile {
  id: number;
  auth_user_id: string;       // uuid from auth.users
  display_name: string;
  email: string;
  avatar_url?: string;
  role: UserRole;
  phone?: string;
  city?: string;
  bio?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Taxonomy ────────────────────────────────────────────────────────────────

export type CategoryDomain = 'gk' | 'maths' | 'passage' | 'mains' | 'article';

export interface Category {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  domain: CategoryDomain;
  parent_id?: number;
  display_order: number;
  is_active: boolean;
  icon_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Exam {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface AlphaCategory {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  domain: CategoryDomain;
  parent_id?: number;
  display_order: number;
  is_active: boolean;
}

// ── Quiz Types ───────────────────────────────────────────────────────────────

export type QuizDomain = 'gk' | 'maths' | 'passage';

export interface QuizOption {
  label: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface Quiz {
  id: number;
  quiz_domain: QuizDomain;
  question_statement: string;
  supp_question_statement?: string;
  statements_facts: string[];
  question_prompt?: string;
  options: QuizOption[];
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  language: string;
  category_id?: number;
  creator_id: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  category?: Category;
}

export interface PassageQuiz {
  id: number;
  passage_title?: string;
  passage_text: string;
  language: string;
  category_id?: number;
  creator_id: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  category?: Category;
  passage_questions?: PassageQuestion[];
}

export interface PassageQuestion {
  id: number;
  passage_quiz_id: number;
  question_statement: string;
  supp_question_statement?: string;
  statements_facts: string[];
  question_prompt?: string;
  options: QuizOption[];
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation?: string;
  display_order: number;
  created_at: string;
}

export interface MainsQuestion {
  id: number;
  question_text: string;
  answer_approach?: string;
  model_answer?: string;
  word_limit: number;
  language: string;
  category_id?: number;
  creator_id: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category?: Category;
}

// ── Collections & Programs ───────────────────────────────────────────────────

export type CollectionType = 'prelims' | 'mains' | 'mixed';
export type SeriesKind = 'prelims' | 'mains' | 'hybrid';

export interface PremiumCollection {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  collection_type: CollectionType;
  image_url?: string;
  is_paid: boolean;
  is_public: boolean;
  is_subscription: boolean;
  price?: number;
  time_limit_minutes?: number;
  negative_marking_factor: number;
  shuffle_questions: boolean;
  is_finalized: boolean;
  is_active: boolean;
  creator_id: number;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Relations
  creator?: Profile;
  items?: PremiumCollectionItem[];
}

export type CollectionItemType = 'gk_quiz' | 'maths_quiz' | 'passage_quiz' | 'mains_question';

export interface PremiumCollectionItem {
  id: number;
  premium_collection_id: number;
  order_index: number;
  item_type: CollectionItemType;
  quiz_id?: number;
  passage_quiz_id?: number;
  mains_question_id?: number;
  category_id?: number;
  created_at: string;
  // Relations
  quiz?: Quiz;
  passage_quiz?: PassageQuiz;
  mains_question?: MainsQuestion;
  category?: Category;
}

export interface TestSeries {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  series_kind: SeriesKind;
  cover_image_url?: string;
  is_paid: boolean;
  is_public: boolean;
  is_subscription: boolean;
  price?: number;
  evaluation_enabled: boolean;
  mentorship_enabled: boolean;
  is_finalized: boolean;
  is_active: boolean;
  creator_id: number;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Relations
  creator?: Profile;
  program_units?: ProgramUnit[];
  exams?: Exam[];
}

export type StepType = 'pdf' | 'live_lecture' | 'test' | 'note' | 'video' | 'link';

export interface ProgramUnit {
  id: number;
  series_id: number;
  title: string;
  description?: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  steps?: ProgramUnitStep[];
}

export interface ProgramUnitStep {
  id: number;
  unit_id: number;
  step_type: StepType;
  title: string;
  description?: string;
  collection_id?: number;
  live_room_id?: number;
  resource_url?: string;
  scheduled_for?: string;
  duration_minutes?: number;
  display_order: number;
  is_active: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Relations
  collection?: PremiumCollection;
}

// ── Commerce ─────────────────────────────────────────────────────────────────

export type PaymentStatus = 'created' | 'paid' | 'failed' | 'refunded';
export type SubscriptionPlan = 'free' | 'pro' | 'expert';

export interface SubscriptionPlanRow {
  id: number;
  name: SubscriptionPlan;
  display_name: string;
  description?: string;
  price_monthly?: number;
  price_annual?: number;
  ai_quota_gk: number;
  ai_quota_maths: number;
  ai_quota_passage: number;
  ai_quota_mains: number;
  can_access_subscribed_content: boolean;
  priority_ai: boolean;
  is_active: boolean;
  display_order: number;
}

export interface Subscription {
  id: number;
  user_id: number;
  plan_id?: number;
  plan: SubscriptionPlan;
  start_date: string;
  end_date: string;
  status: 'active' | 'pending' | 'inactive' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  user_id: number;
  amount: number;
  currency: string;
  status: PaymentStatus;
  gateway: string;
  gateway_order_id?: string;
  gateway_payment_id?: string;
  test_series_id?: number;
  collection_id?: number;
  subscription_plan?: string;
  notes?: string;
  created_at: string;
}

export interface UserContentAccess {
  id: number;
  user_id: number;
  access_type: 'test_series' | 'collection' | 'subscription';
  test_series_id?: number;
  collection_id?: number;
  payment_id?: number;
  granted_at: string;
  expires_at?: string;
  is_active: boolean;
}

// ── AI System ────────────────────────────────────────────────────────────────

export interface AiTest {
  id: number;
  user_id: number;
  title: string;
  quiz_domain: QuizDomain;
  source_type?: string;
  source_text?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  questions?: AiTestQuestion[];
}

export interface AiTestQuestion {
  id: number;
  ai_test_id: number;
  quiz_domain: QuizDomain;
  question_statement: string;
  supp_question_statement?: string;
  statements_facts: string[];
  question_prompt?: string;
  options: QuizOption[];
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation?: string;
  display_order: number;
}

export interface AiUsageQuota {
  user_id: number;
  quiz_domain: string;
  used_count: number;
  limit_count: number;
  period_start: string;
}

// ── Mentorship ───────────────────────────────────────────────────────────────

export interface MentorshipRequest {
  id: number;
  user_id: number;
  mentor_id: number;
  series_id?: number;
  preferred_mode: 'video' | 'chat' | 'call';
  note?: string;
  status: 'requested' | 'scheduled' | 'completed' | 'cancelled' | 'rejected';
  requested_at: string;
  updated_at: string;
  // Relations
  user?: Profile;
  mentor?: Profile;
}

export interface MentorshipSession {
  id: number;
  request_id: number;
  mentor_id: number;
  user_id: number;
  mode: string;
  starts_at: string;
  ends_at: string;
  meeting_link?: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  created_at: string;
}

// ── Live Rooms ───────────────────────────────────────────────────────────────

export interface LiveRoom {
  id: number;
  title: string;
  description?: string;
  series_id?: number;
  unit_step_id?: number;
  agora_channel_name: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduled_for?: string;
  started_at?: string;
  ended_at?: string;
  created_by: number;
  created_at: string;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface UserPerformanceSnapshot {
  id: number;
  user_id: number;
  quiz_domain: string;
  category_id?: number;
  total_questions: number;
  correct_count: number;
  incorrect_count: number;
  skipped_count: number;
  accuracy: number;
  avg_time_secs?: number;
  last_attempted?: string;
  updated_at: string;
  category?: Category;
}

export interface UserWeakArea {
  id: number;
  user_id: number;
  category_id: number;
  quiz_domain: string;
  accuracy: number;
  severity: 'critical' | 'moderate' | 'mild';
  generated_at: string;
  category?: Category;
}

// ── Creator Profile ──────────────────────────────────────────────────────────

export interface CreatorProfile {
  id: number;
  user_id: number;
  display_name: string;
  headline?: string;
  bio?: string;
  years_experience?: number;
  city?: string;
  profile_image_url?: string;
  is_verified: boolean;
  is_public: boolean;
  is_active: boolean;
  highlights: Record<string, unknown>[];
  credentials: Record<string, unknown>[];
  specialization_tags: string[];
  languages: string[];
  social_links: Record<string, string>;
  created_at: string;
  updated_at: string;
  // Relations
  profile?: Profile;
  exams?: Exam[];
}

// ── Mains Submissions ────────────────────────────────────────────────────────

export type EvaluatorType = 'ai' | 'mentor' | 'self';
export type SubmissionStatus =
  | 'submitted'
  | 'under_review'
  | 'evaluated'
  | 'returned';

export interface MainsTestCopySubmission {
  id: number;
  user_id: number;
  series_id?: number;
  collection_id?: number;
  mains_question_id?: number;
  answer_text: string;
  word_count?: number;
  status: SubmissionStatus;
  evaluator_type?: EvaluatorType;
  ai_score?: number;
  ai_max_score?: number;
  ai_feedback?: string;
  ai_strengths?: string[];
  ai_weaknesses?: string[];
  ai_structure_score?: number;
  ai_content_score?: number;
  ai_evaluated_at?: string;
  mentor_score?: number;
  mentor_feedback?: string;
  evaluated_at?: string;
  submitted_at: string;
  updated_at: string;
}

// ── API Response Wrappers ────────────────────────────────────────────────────

export interface AiGenerateResponse {
  questions: AiTestQuestion[];
  quota: { allowed: boolean; used: number; limit: number };
  count: number;
}

export interface QuotaResponse {
  plan: SubscriptionPlan;
  period: string;
  domains: Record<string, { used: number; limit: number; remaining: number }>;
}

export interface PaymentOrderResponse {
  order_id: string;
  amount: number;
  currency: string;
  payment_record_id: number;
  key_id: string;
}
