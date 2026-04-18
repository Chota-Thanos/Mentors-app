export type QuizKind = "gk" | "maths" | "passage";

export type PremiumAIContentType =
  | "premium_gk_quiz"
  | "premium_maths_quiz"
  | "premium_passage_quiz"
  | "mains_question_generation"
  | "mains_evaluation";

export type AIProvider = "openai" | "gemini" | "perplexity";
export type OutputLanguage = "en" | "hi";

export interface PremiumExam {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  is_active: boolean;
}

export interface PremiumCategory {
  id: number;
  name: string;
  type: string;
  description?: string | null;
  parent_id?: number | null;
  children?: PremiumCategory[];
}

export interface CategoryAISource {
  id: number;
  category_id: number;
  source_kind: "text" | "url" | "pdf" | "content_item";
  title?: string | null;
  source_url?: string | null;
  source_text?: string | null;
  source_content_html?: string | null;
  content_item_id?: number | null;
  priority: number;
  is_active: boolean;
  meta: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface MainsCategory {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  parent_id?: number | null;
  is_active: boolean;
  meta?: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
  children?: MainsCategory[];
}

export interface MainsCategorySource {
  id: number;
  mains_category_id: number;
  source_kind: "text" | "url" | "pdf" | "content_item";
  title?: string | null;
  source_url?: string | null;
  source_text?: string | null;
  source_content_html?: string | null;
  content_item_id?: number | null;
  priority: number;
  is_active: boolean;
  meta: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PremiumCollection {
  id: number;
  title?: string;
  name?: string;
  description?: string | null;
  test_kind?: "prelims" | "mains";
  test_label?: string;
  collection_mode?: string;
  meta?: Record<string, unknown> | null;
  exam_ids?: number[];
  is_public?: boolean;
  is_premium?: boolean;
  is_paid?: boolean;
  is_subscription?: boolean;
  is_private_source?: boolean;
  price?: number | null;
  category_ids?: number[];
  image_url?: string | null;
  thumbnail_url?: string | null;
}

export interface PremiumContentItem {
  id: number;
  title?: string | null;
  type: string;
  data?: Record<string, unknown> | null;
}

export interface CollectionTestQuestion {
  item_id: number;
  content_item_id: number;
  quiz_type: QuizKind;
  question_statement: string;
  supplementary_statement?: string | null;
  statements_facts?: string[];
  question_prompt?: string | null;
  options: { label: string; text: string }[];
  correct_answer: string;
  explanation_text?: string | null;
  passage_title?: string | null;
  passage_text?: string | null;
}

export interface CollectionTestPayload {
  collection_id: number;
  collection_title: string;
  total_questions: number;
  questions: CollectionTestQuestion[];
}

export interface CollectionScoreDetail {
  item_id: number;
  selected_option?: string | null;
  correct_answer: string;
  is_correct: boolean;
  explanation_text?: string | null;
}

export interface CollectionCategoryScore {
  category_id: number;
  category_name: string;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
}

export interface CollectionScorePayload {
  attempt_id?: number | null;
  score: number;
  total_questions: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered: number;
  details: CollectionScoreDetail[];
  category_wise_results: CollectionCategoryScore[];
}

export type QuizQuestionComplaintStatus = "received" | "pending" | "resolved";

export interface QuizQuestionComplaint {
  id: number;
  collection_id: number;
  collection_title?: string | null;
  series_id?: number | null;
  creator_user_id: string;
  user_id: string;
  attempt_id: number;
  question_item_id: number;
  question_number: number;
  question_text: string;
  selected_option?: string | null;
  correct_answer?: string | null;
  complaint_text: string;
  status: QuizQuestionComplaintStatus;
  creator_note?: string | null;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
}

export interface MainsCollectionTestQuestion {
  item_id: number;
  content_item_id: number;
  question_number: number;
  question_text: string;
  answer_approach?: string | null;
  model_answer?: string | null;
  word_limit: number;
  max_marks: number;
  answer_style_guidance?: string | null;
}

export interface MainsCollectionTestPayload {
  collection_id: number;
  series_id?: number | null;
  collection_title: string;
  total_questions: number;
  questions: MainsCollectionTestQuestion[];
}

export interface MainsCollectionScoreDetail {
  item_id: number;
  content_item_id: number;
  question_text: string;
  answer_text?: string | null;
  score: number;
  max_score: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  reference_model_answer?: string | null;
}

export interface MainsCollectionScorePayload {
  total_questions: number;
  attempted: number;
  evaluated: number;
  average_score: number;
  total_score: number;
  max_total_score: number;
  details: MainsCollectionScoreDetail[];
}

export interface DashboardWeakArea {
  id?: number;
  name: string;
  count: number;
}

export interface DashboardRecurringError {
  name: string;
  count: number;
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  value: number;
  activity_count: number;
  question_count?: number;
  score_percent?: number;
}

export type DashboardPerformanceBand = "best" | "average" | "bad";

export interface DashboardQuizCategoryPerformance {
  id?: number | null;
  name: string;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
  band: DashboardPerformanceBand;
}

export interface DashboardMainsAreaPerformance {
  name: string;
  strength_count: number;
  weakness_count: number;
  total_mentions: number;
  strength_ratio: number;
  band: DashboardPerformanceBand;
}

export interface DashboardPerformanceGroups<T> {
  best: T[];
  average: T[];
  bad: T[];
}

export interface DashboardRecommendationPlug {
  plug_key: string;
  plug_type: string;
  section: string;
  title: string;
  description?: string;
  priority?: string;
  payload?: Record<string, unknown> | null;
}

export interface DashboardQuizSection {
  content_type: "gk" | "maths" | "passage";
  label: string;
  activity_count: number;
  question_count: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  accuracy: number;
  weak_areas: DashboardWeakArea[];
  recurring_errors: DashboardRecurringError[];
  recommendations: string[];
  trend_7d: DashboardTrendPoint[];
  trend_30d: DashboardTrendPoint[];
  category_performance?: DashboardQuizCategoryPerformance[];
  performance_groups?: DashboardPerformanceGroups<DashboardQuizCategoryPerformance>;
}

export interface DashboardMainsSection {
  content_type: "mains";
  label: string;
  activity_count: number;
  question_count: number;
  total_score: number;
  max_total_score: number;
  average_score: number;
  score_percent: number;
  weak_areas: DashboardWeakArea[];
  recurring_errors: DashboardRecurringError[];
  recommendations: string[];
  trend_7d: DashboardTrendPoint[];
  trend_30d: DashboardTrendPoint[];
  category_performance?: DashboardMainsAreaPerformance[];
  area_performance?: DashboardMainsAreaPerformance[];
  performance_groups?: DashboardPerformanceGroups<DashboardMainsAreaPerformance>;
}

export interface DashboardAnalyticsSummary {
  total_quiz_attempts: number;
  total_mains_evaluations: number;
  overall_quiz_accuracy: number;
  overall_mains_average_score: number;
  overall_quiz_correct: number;
  overall_quiz_incorrect: number;
  overall_quiz_unanswered: number;
  overall_quiz_questions: number;
}

export interface DashboardActivityItem {
  type: string;
  created_at: string;
  title: string;
  score_text: string;
  accuracy: number;
}

export interface DashboardPurchaseSeriesItem {
  enrollment_id: number;
  series_id: number;
  title: string;
  series_kind: TestSeriesKind | string;
  access_type: TestSeriesAccessType | string;
  price: number;
  provider_user_id?: string | null;
  provider_display_name?: string | null;
  status: string;
  access_source: string;
  subscribed_until?: string | null;
  series_is_active?: boolean | null;
  series_is_public?: boolean | null;
  created_at: string;
  updated_at?: string | null;
}

export interface DashboardPurchaseOverview {
  total_enrollments: number;
  active_enrollments: number;
  active_prelims_enrollments: number;
  active_mains_enrollments: number;
  active_hybrid_enrollments: number;
  active_series: DashboardPurchaseSeriesItem[];
}

export interface DashboardAnalyticsPayload {
  generated_at: string;
  summary: DashboardAnalyticsSummary;
  sections: {
    gk: DashboardQuizSection;
    maths: DashboardQuizSection;
    passage: DashboardQuizSection;
    mains: DashboardMainsSection;
  };
  recent_activity: DashboardActivityItem[];
  recommendations: string[];
  recommendation_plugs: DashboardRecommendationPlug[];
  purchase_overview?: DashboardPurchaseOverview;
}

export type PerformanceAuditContentType = "gk" | "maths" | "passage" | "mains";
export type PerformanceAuditSourceKind = "ai" | "program";

export interface PerformanceAuditQuizMetrics {
  total_questions: number;
  attempted_questions: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  percentage: number;
}

export interface PerformanceAuditMainsMetrics {
  total_questions: number;
  total_score: number;
  max_total_score: number;
  percentage: number;
}

export interface PerformanceAuditQuizCategory extends PerformanceAuditQuizMetrics {
  id?: number | null;
  name: string;
  has_children: boolean;
}

export interface PerformanceAuditMainsCategory extends PerformanceAuditMainsMetrics {
  id?: number | null;
  name: string;
  has_children: boolean;
}

export interface PerformanceAuditQuizSubcategory extends PerformanceAuditQuizMetrics {
  id?: number | null;
  name: string;
  proficiency_label: string;
}

export interface PerformanceAuditMainsSubcategory extends PerformanceAuditMainsMetrics {
  id?: number | null;
  name: string;
  proficiency_label: string;
}

export interface PerformanceAuditAnalysis {
  title: string;
  summary: string;
  points: string[];
}

export interface PerformanceAuditQuizSource extends PerformanceAuditQuizMetrics {
  source_kind: PerformanceAuditSourceKind;
  first_level_categories: PerformanceAuditQuizCategory[];
}

export interface PerformanceAuditMainsSource extends PerformanceAuditMainsMetrics {
  source_kind: PerformanceAuditSourceKind;
  first_level_categories: PerformanceAuditMainsCategory[];
}

export interface PerformanceAuditQuizSection {
  content_type: Exclude<PerformanceAuditContentType, "mains">;
  label: string;
  is_quiz: true;
  sources: {
    ai: PerformanceAuditQuizSource;
    program: PerformanceAuditQuizSource;
  };
}

export interface PerformanceAuditMainsSection {
  content_type: "mains";
  label: string;
  is_quiz: false;
  sources: {
    ai: PerformanceAuditMainsSource;
    program: PerformanceAuditMainsSource;
  };
}

export interface PerformanceAuditOverviewPayload {
  generated_at: string;
  sections: {
    gk: PerformanceAuditQuizSection;
    maths: PerformanceAuditQuizSection;
    passage: PerformanceAuditQuizSection;
    mains: PerformanceAuditMainsSection;
  };
}

export interface PerformanceAuditQuizDetailPayload {
  generated_at: string;
  content_type: Exclude<PerformanceAuditContentType, "mains">;
  label: string;
  source_kind: PerformanceAuditSourceKind;
  source_summary: Omit<PerformanceAuditQuizSource, "first_level_categories" | "source_kind"> & {
    source_kind: PerformanceAuditSourceKind;
  };
  category: {
    id?: number | null;
    name: string;
  };
  summary: PerformanceAuditQuizMetrics;
  subcategories: PerformanceAuditQuizSubcategory[];
  analysis: PerformanceAuditAnalysis;
}

export interface PerformanceAuditMainsDetailPayload {
  generated_at: string;
  content_type: "mains";
  label: string;
  source_kind: PerformanceAuditSourceKind;
  source_summary: Omit<PerformanceAuditMainsSource, "first_level_categories" | "source_kind"> & {
    source_kind: PerformanceAuditSourceKind;
  };
  category: {
    id?: number | null;
    name: string;
  };
  summary: PerformanceAuditMainsMetrics;
  subcategories: PerformanceAuditMainsSubcategory[];
  analysis: PerformanceAuditAnalysis;
}

export type PerformanceAuditDetailPayload =
  | PerformanceAuditQuizDetailPayload
  | PerformanceAuditMainsDetailPayload;

export interface YearlyAttemptSummaryRow {
  content_type: "gk" | "maths" | "passage" | "mains";
  label: string;
  total_questions: number;
  total_questions_attempted: number;
  total_marks: number;
  marks_obtained: number;
}

export interface YearlyAttemptSummaryPayload {
  year: number;
  rows: {
    gk: YearlyAttemptSummaryRow;
    maths: YearlyAttemptSummaryRow;
    passage: YearlyAttemptSummaryRow;
    mains: YearlyAttemptSummaryRow;
  };
}

export interface ChallengeLinkCreateRequest {
  title?: string;
  description?: string;
  expires_in_hours?: number;
  allow_anonymous?: boolean;
  require_login?: boolean;
  max_attempts_per_participant?: number;
}

export interface ChallengeLinkResponse {
  id: number;
  collection_id: number;
  owner_user_id: string;
  title: string;
  description?: string | null;
  is_active: boolean;
  allow_anonymous: boolean;
  require_login: boolean;
  max_attempts_per_participant: number;
  expires_at?: string | null;
  total_attempts: number;
  created_at: string;
  updated_at?: string | null;
  share_path?: string | null;
  share_url?: string | null;
}

export interface ChallengeTestQuestion {
  item_id: number;
  content_item_id: number;
  quiz_type: QuizKind;
  question_statement: string;
  supplementary_statement?: string | null;
  statements_facts?: string[];
  question_prompt?: string | null;
  options: { label: string; text: string }[];
  passage_title?: string | null;
  passage_text?: string | null;
}

export interface ChallengeTestPayload {
  challenge_id: number;
  challenge_title: string;
  challenge_description?: string | null;
  collection_id: number;
  collection_title: string;
  total_questions: number;
  total_attempts: number;
  questions: ChallengeTestQuestion[];
}

export interface ChallengeAttemptSubmitRequest {
  answers: Array<{ item_id: number; selected_option?: string | null }>;
  participant_name?: string;
  participant_key?: string;
}

export interface ChallengeScorePayload {
  attempt_id: number;
  challenge_id: number;
  challenge_title: string;
  collection_id: number;
  collection_title: string;
  participant_name: string;
  score: number;
  total_questions: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered: number;
  details: CollectionScoreDetail[];
  category_wise_results: CollectionCategoryScore[];
  rank: number;
  total_participants: number;
  percentile: number;
  submitted_at: string;
  result_view_path?: string | null;
  result_view_url?: string | null;
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  participant_name: string;
  score: number;
  total_questions: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered: number;
  submitted_at: string;
}

export interface ChallengeLeaderboardPayload {
  challenge_id: number;
  challenge_title: string;
  collection_id: number;
  collection_title: string;
  total_participants: number;
  top_entries: ChallengeLeaderboardEntry[];
}

export interface PublicChallengeListItem {
  challenge_id: number;
  challenge_title: string;
  challenge_description?: string | null;
  collection_id: number;
  collection_title: string;
  collection_description?: string | null;
  collection_thumbnail_url?: string | null;
  test_kind: "prelims" | "mains";
  question_count: number;
  total_attempts: number;
  expires_at?: string | null;
  share_path: string;
  share_url?: string | null;
}

export interface AIInstruction {
  id: number;
  name: string;
  type: "quiz_gen" | "summary" | "explanation" | "grading";
  system_prompt: string;
  user_prompt_template?: string | null;
  is_active: boolean;
}

export interface PremiumAIQuizInstruction {
  id: number;
  content_type: PremiumAIContentType;
  ai_provider: AIProvider;
  ai_model_name: string;
  system_instructions: string;
  input_schema: Record<string, unknown>;
  example_input?: string | null;
  output_schema: Record<string, unknown>;
  example_output: Record<string, unknown>;
  style_analysis_system_prompt?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PremiumAIExampleAnalysis {
  id: number;
  title: string;
  description?: string | null;
  tag_level1?: string | null;
  tag_level2?: string | null;
  content_type: PremiumAIContentType;
  style_profile: Record<string, unknown>;
  example_questions: string[];
  tags: string[];
  exam_ids: number[];
  is_active: boolean;
  author_id?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PremiumAIExampleAnalysisListResponse {
  items: PremiumAIExampleAnalysis[];
  total: number;
}

export interface PremiumPreviewResponse {
  parsed_quiz_data: Record<string, unknown>;
}

export interface UploadedPDF {
  id: number;
  filename: string;
  extracted_text: string;
  uploader_id: string;
  page_count?: number | null;
  used_ocr: boolean;
  created_at: string;
  expires_at?: string | null;
  message?: string | null;
}

export interface PremiumPreviewMixPlanTaskPayload {
  plan_id: string;
  title?: string;
  example_analysis_id: number;
  desired_question_count: number;
  user_instructions?: string;
  formatting_instruction_text?: string;
}

export interface PremiumPreviewMixJobCreateRequest {
  content?: string;
  uploaded_pdf_id?: number;
  url?: string;
  content_type: PremiumAIContentType;
  ai_instruction_id?: number;
  ai_provider?: AIProvider;
  ai_model_name?: string;
  category_ids?: number[];
  example_question?: string;
  example_questions?: string[];
  recent_questions?: string[];
  user_instructions?: string;
  formatting_instruction_text?: string;
  max_attempts?: number;
  plans: PremiumPreviewMixPlanTaskPayload[];
  use_category_source?: boolean;
  output_language?: OutputLanguage;
}

export interface PremiumPreviewMixJobCreateResponse {
  job_id: string;
  status: string;
  total_tasks: number;
  queued_at: string;
}

export interface PremiumPreviewMixJobTaskStatus {
  plan_id: string;
  title: string;
  requested_count: number;
  status: string;
  attempt: number;
  max_attempts: number;
  produced_count: number;
  error?: string | null;
}

export interface PremiumPreviewMixJobStatusResponse {
  job_id: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  tasks: PremiumPreviewMixJobTaskStatus[];
  parsed_quiz_data?: Record<string, unknown> | null;
  warnings: string[];
  error?: string | null;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
  expires_at?: string | null;
}

export interface PremiumAIDraftQuiz {
  id: number;
  quiz_kind: QuizKind;
  content_type: PremiumAIContentType;
  parsed_quiz_data: Record<string, unknown>;
  category_ids: number[];
  exam_id?: number | null;
  ai_instruction_id?: number | null;
  source_url?: string | null;
  source_pdf_id?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PremiumAIDraftQuizListResponse {
  items: PremiumAIDraftQuiz[];
  total: number;
}

export interface ConvertDraftToPremiumQuizResponse {
  message: string;
  new_quiz_id: number;
  quiz_type: string;
}

export type TestSeriesKind = "mains" | "quiz" | "hybrid";
export type TestSeriesAccessType = "free" | "subscription" | "paid";
export type TestSeriesDiscussionMode = "video" | "live_zoom";
export type TestSeriesDiscussionZoomMode = "auto" | "manual";

export interface TestSeriesDiscussion {
  delivery_mode: TestSeriesDiscussionMode;
  title?: string | null;
  description?: string | null;
  video_url?: string | null;
  scheduled_for?: string | null;
  duration_minutes?: number | null;
  zoom_schedule_mode?: TestSeriesDiscussionZoomMode | null;
  meeting_link?: string | null;
  provider_session_id?: string | null;
  provider_host_url?: string | null;
  provider_join_url?: string | null;
  provider_payload?: Record<string, unknown> | null;
  starts_when_creator_joins?: boolean;
}

export interface DiscussionCallContext {
  scope_type: "series" | "test" | "lecture" | string;
  scope_id: number;
  discussion_key: "final_discussion" | "test_discussion" | string;
  discussion_channel?: string | null;
  title?: string | null;
  description?: string | null;
  scheduled_for?: string | null;
  duration_minutes?: number | null;
  call_provider: MentorshipCallProvider;
  mode: MentorshipMode;
  participant_role: "host" | "speaker" | "listener";
  host_controls_enabled: boolean;
  room_url?: string | null;
  join_url?: string | null;
  host_url?: string | null;
  sdk_user_name?: string | null;
  sdk_role_type?: number | null;
  agora_app_id?: string | null;
  agora_channel?: string | null;
  agora_token?: string | null;
  agora_uid?: number | null;
  provider_payload?: Record<string, unknown> | null;
  provider_error?: string | null;
  available_from?: string | null;
  available_until?: string | null;
  is_live?: boolean;
}

export interface DiscussionMessage {
  id: number;
  scope_type: string;
  scope_id: number;
  discussion_key: string;
  sender_user_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

export interface DiscussionMessagePayload {
  body: string;
}

export type DiscussionSpeakerRequestStatus = "pending" | "approved" | "rejected" | "withdrawn" | "removed";

export interface DiscussionSpeakerRequest {
  id: number;
  scope_type: "series" | "test" | "lecture" | string;
  scope_id: number;
  series_id: number;
  discussion_key: "final_discussion" | "test_discussion" | string;
  discussion_channel: string;
  user_id: string;
  display_name: string;
  status: DiscussionSpeakerRequestStatus;
  note?: string | null;
  requested_at: string;
  resolved_at?: string | null;
  resolved_by_user_id?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
}

export interface TestSeries {
  id: number;
  title: string;
  description?: string | null;
  cover_image_url?: string | null;
  creator_id: number;
  series_kind: TestSeriesKind;
  access_type: TestSeriesAccessType;
  price: number;
  is_public: boolean;
  is_active: boolean;
  meta: Record<string, unknown>;
  exam_ids: number[];
  test_count: number;
  created_at: string;
  updated_at?: string | null;
}

export interface TestSeriesCreatePayload {
  title: string;
  description?: string | null;
  cover_image_url?: string | null;
  series_kind?: TestSeriesKind;
  access_type?: TestSeriesAccessType;
  price?: number;
  is_public?: boolean;
  is_active?: boolean;
  creator_id?: number;
  exam_ids?: number[];
  meta?: Record<string, unknown>;
}

export interface TestSeriesUpdatePayload {
  title?: string;
  description?: string | null;
  cover_image_url?: string | null;
  series_kind?: TestSeriesKind;
  access_type?: TestSeriesAccessType;
  price?: number;
  is_public?: boolean;
  is_active?: boolean;
  exam_ids?: number[];
  meta?: Record<string, unknown>;
}

export type TestSeriesProgramItemType = "pdf" | "lecture";

export interface TestSeriesProgramItem {
  id: number;
  series_id: number;
  item_type: TestSeriesProgramItemType;
  title: string;
  description?: string | null;
  resource_url?: string | null;
  scheduled_for?: string | null;
  duration_minutes?: number | null;
  cover_image_url?: string | null;
  series_order: number;
  is_active: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
}

export interface TestSeriesProgramItemCreatePayload {
  item_type: TestSeriesProgramItemType;
  title: string;
  description?: string | null;
  resource_url?: string | null;
  scheduled_for?: string | null;
  duration_minutes?: number | null;
  cover_image_url?: string | null;
  series_order?: number;
  is_active?: boolean;
  meta?: Record<string, unknown>;
}

export interface TestSeriesProgramItemUpdatePayload {
  item_type?: TestSeriesProgramItemType;
  title?: string;
  description?: string | null;
  resource_url?: string | null;
  scheduled_for?: string | null;
  duration_minutes?: number | null;
  cover_image_url?: string | null;
  series_order?: number;
  is_active?: boolean;
  meta?: Record<string, unknown>;
}

export interface TestSeriesTest {
  id: number;
  series_id: number;
  title: string;
  description?: string | null;
  test_kind: "prelims" | "mains";
  test_label: string;
  thumbnail_url?: string | null;
  is_public: boolean;
  is_premium: boolean;
  price: number;
  is_finalized: boolean;
  is_active: boolean;
  series_order: number;
  question_count: number;
  meta: Record<string, unknown>;
  exam_ids: number[];
  created_at: string;
  updated_at?: string | null;
}

export interface TestSeriesTestCreatePayload {
  title: string;
  description?: string | null;
  test_kind?: "prelims" | "mains";
  test_label?: string;
  thumbnail_url?: string | null;
  is_public?: boolean;
  is_premium?: boolean;
  price?: number;
  is_finalized?: boolean;
  series_order?: number;
  exam_ids?: number[];
  meta?: Record<string, unknown>;
}

export interface TestSeriesTestUpdatePayload {
  title?: string;
  description?: string | null;
  test_kind?: "prelims" | "mains";
  test_label?: string;
  thumbnail_url?: string | null;
  is_public?: boolean;
  is_premium?: boolean;
  price?: number;
  is_finalized?: boolean;
  is_active?: boolean;
  series_order?: number;
  exam_ids?: number[];
  meta?: Record<string, unknown>;
}

export interface TestSeriesEnrollment {
  id: number;
  series_id: number;
  user_id: string;
  status: string;
  access_source: string;
  subscribed_until?: string | null;
  created_at: string;
  updated_at?: string | null;
  meta?: Record<string, unknown>;
}

export interface TestSeriesPaymentOrder {
  series_id: number;
  order_id: string;
  key_id: string;
  amount: number;
  currency: string;
  amount_display: number;
  name: string;
  description: string;
  prefill: Record<string, string>;
  notes: Record<string, string>;
}

export interface TestSeriesPaymentVerificationPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  access_source: string;
  subscribed_until?: string | null;
  payment_method: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  billing_cycle: string;
  is_active: boolean;
  features: string[];
  meta: Record<string, unknown>;
}

export interface UserSubscriptionStatus {
  is_active: boolean;
  status: string;
  plan_id?: string | null;
  plan_name?: string | null;
  valid_until?: string | null;
  source?: string | null;
  meta: Record<string, unknown>;
}

export type ProfessionalProfileRole = "provider" | "institute" | "mentor" | "creator";

export interface ProfessionalHighlight {
  label: string;
  icon?: string;
  description?: string;
}

export interface ProfessionalProfile {
  id: number;
  user_id: string;
  role: ProfessionalProfileRole | string;
  display_name: string;
  headline?: string | null;
  bio?: string | null;
  years_experience?: number | null;
  city?: string | null;
  profile_image_url?: string | null;
  is_verified: boolean;
  highlights: ProfessionalHighlight[] | string[];
  credentials: string[];
  specialization_tags: string[];
  languages: string[];
  contact_url?: string | null;
  public_email?: string | null;
  is_public: boolean;
  is_active: boolean;
  exam_ids: number[];
  meta: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
}

export interface ProfessionalProfilePayload {
  role?: ProfessionalProfileRole;
  display_name?: string;
  headline?: string | null;
  bio?: string | null;
  years_experience?: number | null;
  city?: string | null;
  profile_image_url?: string | null;
  is_verified?: boolean;
  highlights?: string[];
  credentials?: string[];
  specialization_tags?: string[];
  languages?: string[];
  contact_url?: string | null;
  public_email?: string | null;
  is_public?: boolean;
  is_active?: boolean;
  exam_ids?: number[];
  meta?: Record<string, unknown>;
}

export type MentorshipCallProvider = "custom" | "zoom" | "zoom_video_sdk" | "agora";

export interface ProfessionalSeriesOption {
  id: number;
  title: string;
  series_kind: TestSeriesKind;
}

export interface ProfessionalSeriesOptions {
  provided_series: ProfessionalSeriesOption[];
  assigned_series: ProfessionalSeriesOption[];
}

export interface ProfessionalProfileReview {
  id: number;
  target_user_id: string;
  reviewer_user_id: string;
  reviewer_label: string;
  rating: number;
  title?: string | null;
  comment?: string | null;
  is_public: boolean;
  is_active: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
}

export interface ProfessionalProfileReviewCreatePayload {
  rating: number;
  title?: string | null;
  comment?: string | null;
}

export interface ProfessionalProfileReviewSummary {
  average_rating: number;
  total_reviews: number;
  rating_1: number;
  rating_2: number;
  rating_3: number;
  rating_4: number;
  rating_5: number;
}

export interface ProfessionalPublicProfileDetail {
  profile: ProfessionalProfile;
  role_label: string;
  achievements: string[];
  service_specifications: string[];
  mentorship_price: number;
  copy_evaluation_price: number;
  currency: string;
  response_time_text?: string | null;
  exam_focus?: string | null;
  students_mentored?: number | null;
  sessions_completed?: number | null;
  authenticity_proof_url?: string | null;
  authenticity_note?: string | null;
  mentorship_availability_mode: "open" | "series_only";
  mentorship_open_scope_note?: string | null;
  mentorship_available_series_ids: number[];
  mentorship_default_call_provider: MentorshipCallProvider;
  mentorship_zoom_meeting_link?: string | null;
  mentorship_call_setup_note?: string | null;
  copy_evaluation_enabled: boolean;
  copy_evaluation_note?: string | null;
  provided_series: TestSeries[];
  assigned_series: TestSeries[];
  review_summary: ProfessionalProfileReviewSummary;
  recent_reviews: ProfessionalProfileReview[];
}

export type ProfessionalOnboardingDesiredRole = "mentor" | "creator";
export type ProfessionalOnboardingStatus = "draft" | "pending" | "approved" | "rejected";

export interface ProfessionalOnboardingAsset {
  bucket: string;
  path: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_at?: string | null;
  asset_kind?: string | null;
  url?: string | null;
}

export interface QuizMasterSampleMcq {
  question?: string | null;
  options: string[];
  correct_option?: "A" | "B" | "C" | "D" | "E" | null;
  explanation?: string | null;
}

export interface ProfessionalOnboardingDetails {
  current_occupation?: string | null;
  professional_headshot?: ProfessionalOnboardingAsset | null;
  upsc_roll_number?: string | null;
  upsc_years?: string | null;
  proof_documents: ProfessionalOnboardingAsset[];
  mains_written_count?: number | null;
  interview_faced_count?: number | null;
  prelims_cleared_count?: number | null;
  highest_prelims_score?: string | null;
  optional_subject?: string | null;
  gs_preferences: string[];
  mentorship_years?: number | null;
  institute_associations: string[];
  sample_evaluation?: ProfessionalOnboardingAsset | null;
  intro_video_url?: string | null;
  subject_focus: string[];
  content_experience?: string | null;
  short_bio?: string | null;
  preparation_strategy?: string | null;
  sample_mcqs: QuizMasterSampleMcq[];
}

export interface ProfessionalOnboardingApplication {
  id: number;
  user_id: string;
  email_snapshot?: string | null;
  desired_role: ProfessionalOnboardingDesiredRole | string;
  full_name: string;
  city?: string | null;
  years_experience?: number | null;
  phone?: string | null;
  phone_link?: string | null;
  about?: string | null;
  details: ProfessionalOnboardingDetails;
  status: ProfessionalOnboardingStatus | string;
  reviewer_user_id?: string | null;
  reviewer_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ProfessionalOnboardingApplicationPayload {
  desired_role: ProfessionalOnboardingDesiredRole;
  full_name: string;
  city?: string | null;
  years_experience?: number | null;
  phone: string;
  about?: string | null;
  details: ProfessionalOnboardingDetails;
}

export interface ProfessionalOnboardingDraftPayload {
  desired_role: ProfessionalOnboardingDesiredRole;
  full_name?: string | null;
  city?: string | null;
  years_experience?: number | null;
  phone?: string | null;
  about?: string | null;
  details: ProfessionalOnboardingDetails;
}

export interface ProfessionalOnboardingReviewPayload {
  action: "approve" | "reject";
  reviewer_note?: string | null;
}

export interface TestSeriesDiscoveryTest {
  test: TestSeriesTest;
  series: TestSeries;
  category_ids: number[];
  category_labels: string[];
  provider_profile?: ProfessionalProfile | null;
}

export interface TestSeriesDiscoverySeries {
  series: TestSeries;
  category_ids: number[];
  category_labels: string[];
  provider_profile?: ProfessionalProfile | null;
}

export interface MainsCopyMark {
  id: number;
  submission_id: number;
  question_item_id?: number | null;
  question_number?: number | null;
  marks_awarded: number;
  max_marks: number;
  remark?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export type CopySubmissionMode = "pdf" | "question_wise" | "digital_text" | "hybrid";
export type CopySubmissionStatus = "submitted" | "eta_declared" | "under_review" | "checked";

export interface MainsCopyQuestionResponse {
  question_item_id?: number | null;
  question_number?: number | null;
  question_text?: string | null;
  word_limit?: number | null;
  max_marks?: number | null;
  answer_image_urls: string[];
  answer_text?: string | null;
}

export interface MainsCopySubmission {
  id: number;
  series_id?: number | null;
  test_collection_id?: number | null;
  user_id: string;
  answer_pdf_url?: string | null;
  submission_mode: CopySubmissionMode;
  status: CopySubmissionStatus;
  learner_note?: string | null;
  provider_eta_hours?: number | null;
  provider_eta_text?: string | null;
  provider_note?: string | null;
  checked_copy_pdf_url?: string | null;
  total_marks?: number | null;
  ai_total_score?: number | null;
  submitted_at: string;
  eta_set_at?: string | null;
  checked_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  question_responses: MainsCopyQuestionResponse[];
  question_marks: MainsCopyMark[];
}

export interface MainsCopySubmissionCreatePayload {
  answer_pdf_url?: string;
  question_responses?: MainsCopyQuestionResponsePayload[];
  note?: string;
  ai_total_score?: number;
  preferred_mode?: MentorshipMode;
}

export interface MainsCopyEtaPayload {
  provider_eta_hours?: number;
  provider_eta_text?: string;
  provider_note?: string;
  status?: CopySubmissionStatus;
}

export interface MainsCopyMarkPayload {
  question_item_id?: number;
  question_number?: number;
  marks_awarded: number;
  max_marks?: number;
  remark?: string;
}

export interface MainsCopyQuestionResponsePayload {
  question_item_id?: number;
  question_number?: number;
  answer_image_urls: string[];
  answer_text?: string;
}

export interface MainsCheckedCopyPayload {
  checked_copy_pdf_url?: string;
  total_marks?: number;
  provider_note?: string;
  question_marks?: MainsCopyMarkPayload[];
}

export type MentorshipMode = "video" | "audio";
export type MentorshipServiceType = "mentorship_only" | "copy_evaluation_and_mentorship";
export type MentorshipPaymentStatus = "not_initiated" | "pending" | "paid" | "failed" | "refunded";
export type MentorshipRequestStatus = "requested" | "accepted" | "scheduled" | "rejected" | "expired" | "cancelled" | "completed";
export type MentorshipSessionStatus = "scheduled" | "live" | "completed" | "cancelled";
export type MentorshipWorkflowStage =
  | "submitted"
  | "accepted"
  | "payment_pending"
  | "paid"
  | "evaluating"
  | "feedback_ready"
  | "booking_open"
  | "scheduled"
  | "live"
  | "completed"
  | "cancelled"
  | "expired";

export interface MentorshipEntitlement {
  id: number;
  user_id: string;
  sessions_remaining: number;
  valid_until?: string | null;
  source: string;
  note?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface MentorshipSlotCreatePayload {
  starts_at: string;
  ends_at: string;
  mode: MentorshipMode;
  call_provider: MentorshipCallProvider;
  max_bookings: number;
  meeting_link?: string | null;
  title?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export interface MentorshipSlotBatchCreatePayload {
  slots: MentorshipSlotCreatePayload[];
}

export interface MentorshipSlotBatchDeactivatePayload {
  slot_ids: number[];
}

export interface MentorshipSlot {
  id: number;
  provider_user_id: string;
  starts_at: string;
  ends_at: string;
  mode: MentorshipMode;
  call_provider: MentorshipCallProvider;
  max_bookings: number;
  booked_count: number;
  is_active: boolean;
  meeting_link?: string | null;
  title?: string | null;
  description?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface MentorshipRequestOfferSlotsPayload {
  slot_ids: number[];
}

export interface MentorshipRequest {
  id: number;
  user_id: number;
  mentor_id: number;
  provider_user_id?: string; // Legacy alias
  series_id?: number | null;
  test_collection_id?: number | null;
  submission_id?: number | null;
  preferred_mode: MentorshipMode;
  note?: string | null;
  preferred_timing?: string | null;
  service_type: MentorshipServiceType;
  status: MentorshipRequestStatus;
  payment_status: MentorshipPaymentStatus;
  payment_amount: number;
  payment_currency: string;
  accepted_at?: string | null;
  scheduled_slot_id?: number | null;
  workflow_stage?: MentorshipWorkflowStage;
  booking_open?: boolean;
  feedback_ready_at?: string | null;
  booking_opened_at?: string | null;
  join_available?: boolean;
  requested_at: string;
  updated_at?: string | null;
  meta: Record<string, unknown>;
}

export interface MentorshipMessage {
  id: number;
  request_id: number;
  sender_user_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface MentorshipMessagePayload {
  body: string;
}

export interface MentorshipPaymentPayload {
  payment_method: string;
  coupon_code?: string | null;
}

export interface MentorshipPaymentOrder {
  request_id: number;
  order_id: string;
  key_id: string;
  amount: number;
  currency: string;
  amount_display: number;
  name: string;
  description: string;
  prefill: Record<string, string>;
  notes: Record<string, string>;
}

export interface MentorshipPaymentVerificationPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  payment_method: string;
  coupon_code?: string | null;
}

export interface MentorshipSession {
  id: number;
  request_id: number;
  slot_id?: number | null;
  mentor_id: number;
  provider_user_id?: string; // Legacy alias
  user_id: number;
  mode: MentorshipMode;
  call_provider: MentorshipCallProvider;
  starts_at: string;
  ends_at: string;
  meeting_link?: string | null;
  provider_session_id?: string | null;
  provider_host_url?: string | null;
  provider_join_url?: string | null;
  provider_payload?: Record<string, unknown>;
  provider_error?: string | null;
  live_started_at?: string | null;
  live_ended_at?: string | null;
  copy_attachment_url?: string | null;
  summary?: string | null;
  status: MentorshipSessionStatus;
  join_available?: boolean;
  created_at: string;
  updated_at?: string | null;
}

export type MentorAvailabilityStatusKind = "available_now" | "busy" | "offline";

export interface MentorAvailabilityStatus {
  provider_user_id: string;
  status: MentorAvailabilityStatusKind;
  available_now: boolean;
  busy_now: boolean;
  active_slots_now: number;
  next_available_at?: string | null;
  live_session_id?: number | null;
  updated_at: string;
}

export interface MentorshipStartNowPayload {
  call_provider?: MentorshipCallProvider;
  meeting_link?: string | null;
  duration_minutes?: number;
}

export interface ProviderDashboardSummary {
  series_count: number;
  test_count: number;
  active_enrollments: number;
  pending_copy_checks: number;
  mentorship_pending_requests: number;
  upcoming_slots: number;
}

export interface ModerationActivitySummary {
  series_count: number;
  active_series_count: number;
  test_count: number;
  active_test_count: number;
  active_enrollments: number;
  copy_submissions_total: number;
  pending_copy_checks: number;
  mentorship_requests_total: number;
  mentorship_pending_requests: number;
}

export type LifecycleIssueSeverity = "info" | "warning" | "critical";
export type LifecycleIssueActor = "user" | "mentor" | "moderator" | "system";

export interface LifecycleTrackingIssue {
  code: string;
  label: string;
  severity: LifecycleIssueSeverity;
  actor: LifecycleIssueActor;
  related_type?: string | null;
  related_id?: number | null;
  detected_at: string;
  detail?: string | null;
}

export interface MentorshipTrackingEvent {
  key: string;
  label: string;
  at?: string | null;
  actor?: string | null;
  detail?: string | null;
}

export interface MentorshipTrackingCycle {
  request_id: number;
  user_id: string;
  provider_user_id: string;
  series_id?: number | null;
  series_title?: string | null;
  test_collection_id?: number | null;
  test_title?: string | null;
  request_status: MentorshipRequestStatus;
  session_status?: MentorshipSessionStatus | null;
  workflow_stage?: MentorshipWorkflowStage;
  booking_open?: boolean;
  requested_at: string;
  accepted_at?: string | null;
  feedback_ready_at?: string | null;
  booking_opened_at?: string | null;
  scheduled_for?: string | null;
  completed_at?: string | null;
  join_available?: boolean;
  slot_id?: number | null;
  slot_mode?: MentorshipMode | null;
  note?: string | null;
  timeline: MentorshipTrackingEvent[];
  issues: LifecycleTrackingIssue[];
}

export interface UserLifecycleTrackingRow {
  user_id: string;
  enrolled_series_count: number;
  attempted_tests: number;
  copy_submissions: number;
  copy_checked: number;
  mentorship_requests: number;
  mentorship_scheduled: number;
  mentorship_completed: number;
  pending_copy_checks: number;
  pending_mentorship: number;
  delay_count: number;
  technical_issue_count: number;
  last_activity_at?: string | null;
  issues: LifecycleTrackingIssue[];
}

export interface LifecycleTrackingSummary {
  users: number;
  mentorship_cycles: number;
  pending_mentorship: number;
  scheduled_mentorship: number;
  completed_mentorship: number;
  pending_copy_checks: number;
  delayed_items: number;
  technical_issues: number;
}

export interface LifecycleTrackingPayload {
  generated_at: string;
  summary: LifecycleTrackingSummary;
  mentorship_cycles: MentorshipTrackingCycle[];
  user_rows: UserLifecycleTrackingRow[];
}

export interface UserMainsPerformanceQuestionRow {
  submission_id: number;
  test_collection_id: number;
  test_title?: string | null;
  question_item_id?: number | null;
  question_number?: number | null;
  question_text?: string | null;
  marks_awarded: number;
  max_marks: number;
  submitted_at: string;
}

export interface UserMainsPerformanceReport {
  total_submissions: number;
  checked_submissions: number;
  average_provider_marks: number;
  average_ai_score: number;
  questions: UserMainsPerformanceQuestionRow[];
}

export type ManagedUserRole =
  | "admin"
  | "moderator"
  | "provider"
  | "institute"
  | "creator"
  | "mentor"
  | "subscriber"
  | "user";

export interface AdminUserRoleRecord {
  user_id: string;
  email?: string | null;
  role: ManagedUserRole | string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at?: string | null;
  last_sign_in_at?: string | null;
}
