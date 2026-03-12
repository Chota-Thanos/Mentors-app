from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ConfigDict


class CategoryType(str, Enum):
    GK = "gk"
    MATHS = "maths"
    PASSAGE = "passage"
    VIDEO = "video"
    DOCUMENT = "document"
    COLLECTION = "collection"
    FOLDER = "folder"


class ContentType(str, Enum):
    QUIZ_GK = "quiz_gk"
    QUIZ_MATHS = "quiz_maths"
    QUIZ_PASSAGE = "quiz_passage"
    QUESTION = "question"
    NOTE = "note"
    VIDEO_LINK = "video_link"
    PDF_FILE = "pdf_file"
    ARTICLE = "article"


class QuizKind(str, Enum):
    GK = "gk"
    MATHS = "maths"
    PASSAGE = "passage"


class CollectionType(str, Enum):
    TEST_SERIES = "test_series"
    QUESTION_BANK = "question_bank"
    CRASH_COURSE = "crash_course"
    NOTES_BUNDLE = "notes_bundle"


class CollectionTestKind(str, Enum):
    PRELIMS = "prelims"
    MAINS = "mains"


class AIInstructionType(str, Enum):
    QUIZ_GEN = "quiz_gen"
    SUMMARY = "summary"
    EXPLANATION = "explanation"
    GRADING = "grading"


class AIProvider(str, Enum):
    OPENAI = "openai"
    GEMINI = "gemini"
    PERPLEXITY = "perplexity"


class LanguageCode(str, Enum):
    EN = "en"
    HI = "hi"


class AISystemInstructionContentType(str, Enum):
    GK_QUIZ = "gk_quiz"
    MATHS_QUIZ = "maths_quiz"
    PASSAGE_QUIZ = "passage_quiz"
    PLAIN_TEXT_QUIZ_INPUT = "plain_text_quiz_input"
    PREMIUM_GK_QUIZ = "premium_gk_quiz"
    PREMIUM_MATHS_QUIZ = "premium_maths_quiz"
    PREMIUM_PASSAGE_QUIZ = "premium_passage_quiz"
    MAINS_QUESTION_GENERATION = "mains_question_generation"
    MAINS_EVALUATION = "mains_evaluation"
    PREMIUM_AI_MAINS_QUESTIONS = "premium_ai_mains_questions"


class ExamCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class ExamUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class ExamResponse(BaseModel):
    id: int
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True
    created_at: str
    updated_at: Optional[str] = None


class CategoryCreate(BaseModel):
    name: str
    type: CategoryType = CategoryType.GK
    parent_id: Optional[int] = None
    description: Optional[str] = None
    slug: Optional[str] = None
    exam_ids: List[int] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[CategoryType] = None
    parent_id: Optional[int] = None
    description: Optional[str] = None
    slug: Optional[str] = None
    is_active: Optional[bool] = None
    exam_ids: Optional[List[int]] = None
    meta: Optional[Dict[str, Any]] = None


class CategoryBulkCreateItem(BaseModel):
    name: str
    description: Optional[str] = None


class CategoryBulkCreateRequest(BaseModel):
    parent_id: Optional[int] = None
    exam_ids: List[int] = Field(default_factory=list)
    categories: List[CategoryBulkCreateItem] = Field(default_factory=list)


class CategoryResponse(CategoryCreate):
    id: int
    is_active: bool = True
    created_at: str
    updated_at: Optional[str] = None


class CategoryBulkCreateResponse(BaseModel):
    message: str
    created_count: int
    created_categories: List[CategoryResponse] = Field(default_factory=list)
    skipped_details: List[str] = Field(default_factory=list)


class CategoryTreeNode(CategoryResponse):
    children: List["CategoryTreeNode"] = Field(default_factory=list)


class CategoryAISourceCreate(BaseModel):
    source_kind: str = Field(default="text", pattern="^(text|url|content_item)$")
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    source_content_html: Optional[str] = None
    content_item_id: Optional[int] = None
    priority: int = 0
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)


class CategoryAISourceUpdate(BaseModel):
    source_kind: Optional[str] = Field(default=None, pattern="^(text|url|content_item)$")
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    source_content_html: Optional[str] = None
    content_item_id: Optional[int] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None


class CategoryAISourceResponse(BaseModel):
    id: int
    category_id: int
    source_kind: str
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    source_content_html: Optional[str] = None
    content_item_id: Optional[int] = None
    priority: int = 0
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class MainsCategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    description: Optional[str] = None
    slug: Optional[str] = None
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)


class MainsCategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    description: Optional[str] = None
    slug: Optional[str] = None
    is_active: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None


class MainsCategoryResponse(MainsCategoryCreate):
    id: int
    created_at: str
    updated_at: Optional[str] = None


class MainsCategoryTreeNode(MainsCategoryResponse):
    children: List["MainsCategoryTreeNode"] = Field(default_factory=list)


class MainsCategorySourceCreate(BaseModel):
    source_kind: str = Field(default="text", pattern="^(text|url|content_item)$")
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    source_content_html: Optional[str] = None
    content_item_id: Optional[int] = None
    priority: int = 0
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)


class MainsCategorySourceUpdate(BaseModel):
    source_kind: Optional[str] = Field(default=None, pattern="^(text|url|content_item)$")
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    source_content_html: Optional[str] = None
    content_item_id: Optional[int] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None


class MainsCategorySourceResponse(BaseModel):
    id: int
    mains_category_id: int
    source_kind: str
    title: Optional[str] = None
    source_url: Optional[str] = None
    source_text: Optional[str] = None
    source_content_html: Optional[str] = None
    content_item_id: Optional[int] = None
    priority: int = 0
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class SourceLink(BaseModel):
    title: Optional[str] = None
    url: str


class CollectionCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: CollectionType = CollectionType.TEST_SERIES
    test_kind: Optional[CollectionTestKind] = None
    thumbnail_url: Optional[str] = None
    is_premium: bool = True
    is_public: bool = False
    price: float = 0.0
    is_finalized: bool = False
    parent_id: Optional[int] = None
    meta: Dict[str, Any] = Field(default_factory=dict)
    category_ids: List[int] = Field(default_factory=list)
    source_list: List[SourceLink] = Field(default_factory=list)
    source_category_ids: List[int] = Field(default_factory=list)
    source_pdf_url: Optional[str] = None
    source_content_html: Optional[str] = None
    admin_subpage_id: Optional[int] = None
    is_subscription: Optional[bool] = None
    is_private_source: Optional[bool] = None


class CollectionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[CollectionType] = None
    test_kind: Optional[CollectionTestKind] = None
    thumbnail_url: Optional[str] = None
    is_premium: Optional[bool] = None
    is_public: Optional[bool] = None
    price: Optional[float] = None
    is_finalized: Optional[bool] = None
    parent_id: Optional[int] = None
    is_active: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None
    category_ids: Optional[List[int]] = None
    source_list: Optional[List[SourceLink]] = None
    source_category_ids: Optional[List[int]] = None
    source_pdf_url: Optional[str] = None
    source_content_html: Optional[str] = None
    admin_subpage_id: Optional[int] = None
    is_subscription: Optional[bool] = None
    is_private_source: Optional[bool] = None


class CollectionResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    type: str
    test_kind: CollectionTestKind = CollectionTestKind.PRELIMS
    test_label: str = "Prelims Test"
    thumbnail_url: Optional[str] = None
    is_premium: bool
    is_public: bool
    price: Optional[float] = None
    is_finalized: bool
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: Optional[str] = None


class ContentItemCreate(BaseModel):
    title: Optional[str] = None
    type: ContentType
    data: Dict[str, Any] = Field(default_factory=dict)
    collection_id: Optional[int] = None
    category_id: Optional[int] = None


class ContentItemResponse(ContentItemCreate):
    id: int
    created_at: str
    updated_at: Optional[str] = None


class CollectionItemAddRequest(BaseModel):
    content_item_id: int
    order: int = 0
    section_title: Optional[str] = None


class CollectionItemsBulkAddRequest(BaseModel):
    items: List[CollectionItemAddRequest]


class QuizQuestionCreate(BaseModel):
    question_statement: str
    supp_question_statement: Optional[str] = None
    supplementary_statement: Optional[str] = None
    statements_facts: Optional[List[str]] = None
    statement_facts: Optional[List[str]] = None
    question_prompt: Optional[str] = None
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    option_e: Optional[str] = None
    correct_answer: str
    explanation: Optional[str] = None
    explanation_text: Optional[str] = None
    source_reference: Optional[str] = None
    source: Optional[str] = None
    category_ids: List[int] = Field(default_factory=list)
    premium_gk_category_ids: List[int] = Field(default_factory=list)
    premium_maths_category_ids: List[int] = Field(default_factory=list)
    alpha_cat_ids: List[int] = Field(default_factory=list)


class QuizBulkCreateRequest(BaseModel):
    title_prefix: Optional[str] = None
    items: List[QuizQuestionCreate]
    collection_id: Optional[int] = None
    exam_id: Optional[int] = None


class PassageQuestionOption(BaseModel):
    label: str
    text: str
    is_correct: Optional[bool] = None


class PassageQuestionCreate(BaseModel):
    question_statement: str
    supp_question_statement: Optional[str] = None
    supplementary_statement: Optional[str] = None
    statements_facts: Optional[List[str]] = None
    statement_facts: Optional[List[str]] = None
    question_prompt: Optional[str] = None
    options: Optional[List[PassageQuestionOption]] = None
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    option_e: Optional[str] = None
    correct_answer: str
    explanation: Optional[str] = None
    explanation_text: Optional[str] = None
    source_reference: Optional[str] = None
    source: Optional[str] = None


class PassageQuizCreateRequest(BaseModel):
    passage_title: Optional[str] = None
    passage_text: str
    source_reference: Optional[str] = None
    category_ids: List[int] = Field(default_factory=list)
    premium_passage_category_ids: List[int] = Field(default_factory=list)
    alpha_cat_ids: List[int] = Field(default_factory=list)
    questions: List[PassageQuestionCreate]
    collection_id: Optional[int] = None
    exam_id: Optional[int] = None


class CollectionTestQuestion(BaseModel):
    item_id: int
    content_item_id: int
    quiz_type: QuizKind
    question_statement: str
    supplementary_statement: Optional[str] = None
    statements_facts: Optional[List[str]] = None
    question_prompt: Optional[str] = None
    options: List[Dict[str, str]]
    correct_answer: str
    explanation_text: Optional[str] = None
    category_ids: List[int] = Field(default_factory=list)
    passage_title: Optional[str] = None
    passage_text: Optional[str] = None


class CollectionTestResponse(BaseModel):
    collection_id: int
    collection_title: str
    total_questions: int
    questions: List[CollectionTestQuestion]


class TestAnswerSubmission(BaseModel):
    item_id: int
    selected_option: Optional[str] = None


class CollectionTestScoreRequest(BaseModel):
    answers: List[TestAnswerSubmission]


class CollectionTestScoreDetail(BaseModel):
    item_id: int
    selected_option: Optional[str] = None
    correct_answer: str
    is_correct: bool
    explanation_text: Optional[str] = None


class CollectionCategoryScore(BaseModel):
    category_id: int
    category_name: str
    total: int
    correct: int
    incorrect: int
    unanswered: int
    accuracy: float


class CollectionTestScoreResponse(BaseModel):
    score: int
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    unanswered: int
    details: List[CollectionTestScoreDetail]
    category_wise_results: List[CollectionCategoryScore] = Field(default_factory=list)


class MainsCollectionTestQuestion(BaseModel):
    item_id: int
    content_item_id: int
    question_number: int
    question_text: str
    answer_approach: Optional[str] = None
    model_answer: Optional[str] = None
    word_limit: int = 150
    max_marks: float = 10.0
    answer_style_guidance: Optional[str] = None
    model_config = ConfigDict(protected_namespaces=())


class MainsCollectionTestResponse(BaseModel):
    collection_id: int
    series_id: Optional[int] = None
    collection_title: str
    total_questions: int
    questions: List[MainsCollectionTestQuestion]


class MainsCollectionTestAnswerSubmission(BaseModel):
    item_id: int
    answer_text: Optional[str] = None


class MainsCollectionTestScoreRequest(BaseModel):
    answers: List[MainsCollectionTestAnswerSubmission]


class MainsCollectionTestScoreDetail(BaseModel):
    item_id: int
    content_item_id: int
    question_text: str
    answer_text: Optional[str] = None
    score: float = 0.0
    max_score: float = 10.0
    feedback: str = ""
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    reference_model_answer: Optional[str] = None


class MainsCollectionTestScoreResponse(BaseModel):
    total_questions: int
    attempted: int
    evaluated: int
    average_score: float = 0.0
    total_score: float = 0.0
    max_total_score: float = 0.0
    details: List[MainsCollectionTestScoreDetail] = Field(default_factory=list)


class ChallengeLinkCreateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    expires_in_hours: Optional[int] = Field(default=72, ge=1, le=24 * 30)
    allow_anonymous: bool = True
    require_login: bool = False
    max_attempts_per_participant: int = Field(default=3, ge=1, le=50)


class ChallengeLinkUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    expires_at: Optional[str] = None
    allow_anonymous: Optional[bool] = None
    require_login: Optional[bool] = None
    max_attempts_per_participant: Optional[int] = Field(default=None, ge=1, le=50)


class ChallengeLinkResponse(BaseModel):
    id: int
    collection_id: int
    owner_user_id: str
    title: str
    description: Optional[str] = None
    is_active: bool
    allow_anonymous: bool
    require_login: bool
    max_attempts_per_participant: int
    expires_at: Optional[str] = None
    total_attempts: int = 0
    created_at: str
    updated_at: Optional[str] = None
    share_path: Optional[str] = None
    share_url: Optional[str] = None


class ChallengeTestQuestion(BaseModel):
    item_id: int
    content_item_id: int
    quiz_type: QuizKind
    question_statement: str
    supplementary_statement: Optional[str] = None
    statements_facts: Optional[List[str]] = None
    question_prompt: Optional[str] = None
    options: List[Dict[str, str]]
    passage_title: Optional[str] = None
    passage_text: Optional[str] = None


class ChallengeTestResponse(BaseModel):
    challenge_id: int
    challenge_title: str
    challenge_description: Optional[str] = None
    collection_id: int
    collection_title: str
    total_questions: int
    total_attempts: int = 0
    questions: List[ChallengeTestQuestion]


class ChallengeAttemptSubmitRequest(BaseModel):
    answers: List[TestAnswerSubmission]
    participant_name: Optional[str] = None
    participant_key: Optional[str] = None


class ChallengeScoreResponse(BaseModel):
    attempt_id: int
    challenge_id: int
    challenge_title: str
    collection_id: int
    collection_title: str
    participant_name: str
    score: int
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    unanswered: int
    details: List[CollectionTestScoreDetail]
    category_wise_results: List[CollectionCategoryScore] = Field(default_factory=list)
    rank: int
    total_participants: int
    percentile: float
    submitted_at: str
    result_view_path: Optional[str] = None
    result_view_url: Optional[str] = None


class ChallengeLeaderboardEntry(BaseModel):
    rank: int
    participant_name: str
    score: int
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    unanswered: int
    submitted_at: str


class ChallengeLeaderboardResponse(BaseModel):
    challenge_id: int
    challenge_title: str
    collection_id: int
    collection_title: str
    total_participants: int
    top_entries: List[ChallengeLeaderboardEntry] = Field(default_factory=list)


class AIInstructionCreate(BaseModel):
    name: str
    type: AIInstructionType
    system_prompt: str
    user_prompt_template: Optional[str] = None
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    output_schema: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class AIInstructionUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[AIInstructionType] = None
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class AIInstructionResponse(AIInstructionCreate):
    id: int
    created_at: str


class AIQuizGenerateRequest(BaseModel):
    content: str
    content_type: str
    quiz_kind: Optional[QuizKind] = None
    example_analysis_id: Optional[int] = None
    user_instructions: Optional[str] = None
    formatting_instruction_text: Optional[str] = None
    example_questions: Optional[List[str]] = None
    recent_questions: Optional[List[str]] = None
    instruction_type: AIInstructionType = AIInstructionType.QUIZ_GEN
    instruction_id: Optional[int] = None
    provider: str = "openai"
    model: str = "gpt-4o"
    category_id: Optional[int] = None
    count: int = 5
    url: Optional[str] = None
    uploaded_pdf_id: Optional[int] = None
    save_to_collection_id: Optional[int] = None
    output_language: LanguageCode = LanguageCode.EN


class AIQuizGenerateResponse(BaseModel):
    items: List[Dict[str, Any]]
    saved_content_item_ids: List[int] = Field(default_factory=list)


class PremiumAIQuizInstructionBase(BaseModel):
    content_type: AISystemInstructionContentType
    ai_provider: AIProvider = AIProvider.GEMINI
    ai_model_name: str = "gemini-3-flash-preview"
    system_instructions: str
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    example_input: Optional[str] = None
    output_schema: Dict[str, Any] = Field(default_factory=dict)

    example_output: Dict[str, Any] = Field(default_factory=dict)
    style_analysis_system_prompt: Optional[str] = None


class PremiumAIQuizInstructionCreate(PremiumAIQuizInstructionBase):
    pass


class PremiumAIQuizInstructionUpdate(BaseModel):
    ai_provider: Optional[AIProvider] = None
    ai_model_name: Optional[str] = None
    system_instructions: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None
    example_input: Optional[str] = None
    output_schema: Optional[Dict[str, Any]] = None

    example_output: Optional[Dict[str, Any]] = None
    style_analysis_system_prompt: Optional[str] = None


class PremiumAIQuizInstruction(PremiumAIQuizInstructionBase):
    id: int
    created_at: str
    updated_at: Optional[str] = None


class PremiumAIExampleAnalysisCreate(BaseModel):
    title: str
    description: Optional[str] = None
    tag_level1: Optional[str] = None
    tag_level2: Optional[str] = None
    content_type: AISystemInstructionContentType
    style_profile: Dict[str, Any] = Field(default_factory=dict)
    example_questions: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    is_active: bool = True


class PremiumAIExampleAnalysisUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tag_level1: Optional[str] = None
    tag_level2: Optional[str] = None
    style_profile: Optional[Dict[str, Any]] = None
    example_questions: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    is_active: Optional[bool] = None


class PremiumAIExampleAnalysis(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    tag_level1: Optional[str] = None
    tag_level2: Optional[str] = None
    content_type: AISystemInstructionContentType
    style_profile: Dict[str, Any] = Field(default_factory=dict)
    example_questions: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    is_active: bool = True
    author_id: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class PremiumAIExampleAnalysisListResponse(BaseModel):
    items: List[PremiumAIExampleAnalysis]
    total: int


class AIGenerateQuizRequest(BaseModel):
    content: Optional[str] = None
    uploaded_pdf_id: Optional[int] = None
    url: Optional[str] = None
    content_type: AISystemInstructionContentType
    ai_instruction_id: Optional[int] = None
    example_analysis_id: Optional[int] = None
    ai_provider: Optional[AIProvider] = None
    ai_model_name: Optional[str] = None
    category_ids: Optional[List[int]] = None
    example_question: Optional[str] = None
    example_questions: Optional[List[str]] = None
    user_instructions: Optional[str] = None
    recent_questions: Optional[List[str]] = None
    formatting_instruction_text: Optional[str] = None
    desired_question_count: Optional[int] = None
    use_category_source: bool = False
    output_language: LanguageCode = LanguageCode.EN


class PremiumPreviewResponse(BaseModel):
    parsed_quiz_data: Dict[str, Any]


class UploadedPDF(BaseModel):
    id: int
    filename: str
    extracted_text: str = ""
    uploader_id: str
    page_count: Optional[int] = None
    used_ocr: bool = False
    created_at: str
    expires_at: Optional[str] = None
    message: Optional[str] = None


class PremiumPreviewMixPlanTask(BaseModel):
    plan_id: str
    title: Optional[str] = None
    example_analysis_id: int
    desired_question_count: int = Field(default=1, ge=1, le=50)
    user_instructions: Optional[str] = None
    formatting_instruction_text: Optional[str] = None


class PremiumPreviewMixJobCreateRequest(BaseModel):
    content: Optional[str] = None
    uploaded_pdf_id: Optional[int] = None
    url: Optional[str] = None
    content_type: AISystemInstructionContentType
    ai_instruction_id: Optional[int] = None
    ai_provider: Optional[AIProvider] = None
    ai_model_name: Optional[str] = None
    category_ids: Optional[List[int]] = None
    example_question: Optional[str] = None
    example_questions: Optional[List[str]] = None
    recent_questions: Optional[List[str]] = None
    user_instructions: Optional[str] = None
    formatting_instruction_text: Optional[str] = None
    max_attempts: int = Field(default=3, ge=1, le=5)
    plans: List[PremiumPreviewMixPlanTask] = Field(default_factory=list, min_length=1, max_length=30)
    use_category_source: bool = False
    output_language: LanguageCode = LanguageCode.EN


class PremiumPreviewMixJobCreateResponse(BaseModel):
    job_id: str
    status: str
    total_tasks: int
    queued_at: str


class PremiumPreviewMixJobTaskStatus(BaseModel):
    plan_id: str
    title: str
    requested_count: int
    status: str
    attempt: int
    max_attempts: int
    produced_count: int = 0
    error: Optional[str] = None


class PremiumPreviewMixJobStatusResponse(BaseModel):
    job_id: str
    status: str
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    tasks: List[PremiumPreviewMixJobTaskStatus]
    parsed_quiz_data: Optional[Dict[str, Any]] = None
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None
    created_at: str
    updated_at: str
    finished_at: Optional[str] = None
    expires_at: Optional[str] = None


class SavePremiumDraftRequest(BaseModel):
    parsed_quiz_data: Dict[str, Any]
    category_ids: List[int] = Field(default_factory=list)
    exam_id: Optional[int] = None
    ai_instruction_id: Optional[int] = None
    source_url: Optional[str] = None
    source_pdf_id: Optional[int] = None
    notes: Optional[str] = None


class PremiumAIDraftQuiz(BaseModel):
    id: int
    quiz_kind: QuizKind
    content_type: AISystemInstructionContentType
    parsed_quiz_data: Dict[str, Any]
    category_ids: List[int] = Field(default_factory=list)
    exam_id: Optional[int] = None
    ai_instruction_id: Optional[int] = None
    source_url: Optional[str] = None
    source_pdf_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class PremiumAIDraftQuizListResponse(BaseModel):
    items: List[PremiumAIDraftQuiz]
    total: int


class PremiumAIDraftQuizUpdate(BaseModel):
    parsed_quiz_data: Optional[Dict[str, Any]] = None
    category_ids: Optional[List[int]] = None
    exam_id: Optional[int] = None
    ai_instruction_id: Optional[int] = None
    source_url: Optional[str] = None
    source_pdf_id: Optional[int] = None
    notes: Optional[str] = None


class ConvertDraftToPremiumQuizRequest(BaseModel):
    draft_quiz_id: int


class ConvertDraftToPremiumQuizResponse(BaseModel):
    message: str
    new_quiz_id: int
    quiz_type: str


class OCRRequest(BaseModel):
    image_base64: Optional[str] = None
    image_url: Optional[str] = None
    images_base64: Optional[List[str]] = None
    ai_provider: Optional[AIProvider] = None
    ai_model_name: Optional[str] = None


class OCRResponse(BaseModel):
    extracted_text: str


class MainsEvaluationRequest(BaseModel):
    mains_question_id: Optional[int] = None
    question_text: str
    answer_text: str
    model_answer: Optional[str] = None
    instructions: Optional[str] = None
    answer_formatting_guidance: Optional[str] = None
    example_evaluation_id: Optional[int] = None
    ai_provider: Optional[AIProvider] = None
    ai_model_name: Optional[str] = None
    output_language: LanguageCode = LanguageCode.EN
    
    model_config = ConfigDict(protected_namespaces=())


class MainsEvaluationResponse(BaseModel):
    score: float
    max_score: float = 10.0
    feedback: str
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    improved_answer: Optional[str] = None


class MainsAIGenerateRequest(BaseModel):
    content: Optional[str] = None
    url: Optional[str] = None
    uploaded_pdf_id: Optional[int] = None
    mains_category_ids: Optional[List[int]] = None
    use_mains_category_source: bool = False
    example_format_id: Optional[int] = None
    evaluation_example_id: Optional[int] = None
    example_formatting_guidance: Optional[str] = None # For ad-hoc style analysis
    answer_formatting_guidance: Optional[str] = None
    recent_questions: Optional[List[str]] = None
    sync_with_evaluator: bool = True
    number_of_questions: int = 1
    word_limit: int = 150
    user_instructions: Optional[str] = None
    ai_provider: Optional[AIProvider] = None
    ai_model_name: Optional[str] = None
    output_language: LanguageCode = LanguageCode.EN


class UserAIMainsQuestion(BaseModel):
    id: Optional[int] = None
    question_text: str
    answer_approach: Optional[str] = None
    model_answer: Optional[str] = None
    word_limit: int
    source_reference: Optional[str] = None
    author_id: Optional[str] = None
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    
    model_config = ConfigDict(protected_namespaces=())


class MainsAIGenerateResponse(BaseModel):
    questions: List[UserAIMainsQuestion]
    usage: Optional[Dict[str, Any]] = None


class TestSeriesKind(str, Enum):
    MAINS = "mains"
    QUIZ = "quiz"
    HYBRID = "hybrid"


class TestSeriesAccessType(str, Enum):
    FREE = "free"
    SUBSCRIPTION = "subscription"
    PAID = "paid"


class CopySubmissionStatus(str, Enum):
    SUBMITTED = "submitted"
    ETA_DECLARED = "eta_declared"
    UNDER_REVIEW = "under_review"
    CHECKED = "checked"


class CopySubmissionMode(str, Enum):
    PDF = "pdf"
    QUESTION_WISE = "question_wise"
    HYBRID = "hybrid"


class MentorshipMode(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"


class MentorshipCallProvider(str, Enum):
    CUSTOM = "custom"
    ZOOM = "zoom"
    ZOOM_VIDEO_SDK = "zoom_video_sdk"


class MentorshipRequestStatus(str, Enum):
    REQUESTED = "requested"
    SCHEDULED = "scheduled"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class MentorshipSessionStatus(str, Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class TestSeriesCreate(BaseModel):
    title: str
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    series_kind: TestSeriesKind = TestSeriesKind.MAINS
    access_type: TestSeriesAccessType = TestSeriesAccessType.SUBSCRIPTION
    price: float = 0.0
    is_public: bool = False
    is_active: bool = True
    provider_user_id: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class TestSeriesUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    series_kind: Optional[TestSeriesKind] = None
    access_type: Optional[TestSeriesAccessType] = None
    price: Optional[float] = None
    is_public: Optional[bool] = None
    is_active: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None


class TestSeriesResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    provider_user_id: str
    series_kind: TestSeriesKind = TestSeriesKind.MAINS
    access_type: TestSeriesAccessType = TestSeriesAccessType.SUBSCRIPTION
    price: float = 0.0
    is_public: bool = False
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)
    test_count: int = 0
    created_at: str
    updated_at: Optional[str] = None


class TestSeriesTestCreate(BaseModel):
    title: str
    description: Optional[str] = None
    test_kind: CollectionTestKind = CollectionTestKind.MAINS
    thumbnail_url: Optional[str] = None
    is_public: bool = False
    is_premium: bool = True
    price: float = 0.0
    is_finalized: bool = False
    series_order: int = 0
    meta: Dict[str, Any] = Field(default_factory=dict)


class TestSeriesTestUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    test_kind: Optional[CollectionTestKind] = None
    thumbnail_url: Optional[str] = None
    is_public: Optional[bool] = None
    is_premium: Optional[bool] = None
    price: Optional[float] = None
    is_finalized: Optional[bool] = None
    is_active: Optional[bool] = None
    series_order: Optional[int] = None
    meta: Optional[Dict[str, Any]] = None


class TestSeriesTestResponse(BaseModel):
    id: int
    series_id: int
    title: str
    description: Optional[str] = None
    test_kind: CollectionTestKind = CollectionTestKind.MAINS
    test_label: str = "Mains Test"
    thumbnail_url: Optional[str] = None
    is_public: bool = False
    is_premium: bool = True
    price: float = 0.0
    is_finalized: bool = False
    is_active: bool = True
    series_order: int = 0
    question_count: int = 0
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: Optional[str] = None


class TestSeriesEnrollmentResponse(BaseModel):
    id: int
    series_id: int
    user_id: str
    status: str
    access_source: str
    subscribed_until: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class SubscriptionPlanResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    price: float = 0.0
    currency: str = "INR"
    billing_cycle: str = "monthly"
    is_active: bool = True
    features: List[str] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class UserSubscriptionStatusResponse(BaseModel):
    is_active: bool = False
    status: str = "inactive"
    plan_id: Optional[str] = None
    plan_name: Optional[str] = None
    valid_until: Optional[str] = None
    source: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class ProfessionalProfileUpdate(BaseModel):
    role: Optional[str] = Field(default=None, pattern="^(provider|institute|mentor|creator)$")
    display_name: Optional[str] = None
    headline: Optional[str] = None
    bio: Optional[str] = None
    years_experience: Optional[int] = Field(default=None, ge=0, le=80)
    city: Optional[str] = None
    profile_image_url: Optional[str] = None
    is_verified: Optional[bool] = None
    highlights: Optional[List[str]] = None
    credentials: Optional[List[str]] = None
    specialization_tags: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    contact_url: Optional[str] = None
    public_email: Optional[str] = None
    is_public: Optional[bool] = None
    is_active: Optional[bool] = None
    meta: Optional[Dict[str, Any]] = None


class ProfessionalProfileResponse(BaseModel):
    id: int
    user_id: str
    role: str
    display_name: str
    headline: Optional[str] = None
    bio: Optional[str] = None
    years_experience: Optional[int] = None
    city: Optional[str] = None
    profile_image_url: Optional[str] = None
    is_verified: bool = False
    highlights: List[str] = Field(default_factory=list)
    credentials: List[str] = Field(default_factory=list)
    specialization_tags: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    contact_url: Optional[str] = None
    public_email: Optional[str] = None
    is_public: bool = True
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: Optional[str] = None


class ProfessionalSeriesOptionResponse(BaseModel):
    id: int
    title: str
    series_kind: TestSeriesKind = TestSeriesKind.MAINS


class ProfessionalSeriesOptionsResponse(BaseModel):
    provided_series: List[ProfessionalSeriesOptionResponse] = Field(default_factory=list)
    assigned_series: List[ProfessionalSeriesOptionResponse] = Field(default_factory=list)


class ProfessionalProfileReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    title: Optional[str] = Field(default=None, max_length=140)
    comment: Optional[str] = Field(default=None, max_length=2500)


class ProfessionalProfileReviewResponse(BaseModel):
    id: int
    target_user_id: str
    reviewer_user_id: str
    reviewer_label: str
    rating: int = Field(ge=1, le=5)
    title: Optional[str] = None
    comment: Optional[str] = None
    is_public: bool = True
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: Optional[str] = None


class ProfessionalProfileReviewSummaryResponse(BaseModel):
    average_rating: float = 0.0
    total_reviews: int = 0
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0


class ProfessionalPublicProfileDetailResponse(BaseModel):
    profile: ProfessionalProfileResponse
    role_label: str = "Professional"
    achievements: List[str] = Field(default_factory=list)
    service_specifications: List[str] = Field(default_factory=list)
    authenticity_proof_url: Optional[str] = None
    authenticity_note: Optional[str] = None
    mentorship_availability_mode: str = Field(default="open", pattern="^(open|series_only)$")
    mentorship_open_scope_note: Optional[str] = None
    mentorship_available_series_ids: List[int] = Field(default_factory=list)
    mentorship_default_call_provider: MentorshipCallProvider = MentorshipCallProvider.CUSTOM
    mentorship_zoom_meeting_link: Optional[str] = None
    mentorship_call_setup_note: Optional[str] = None
    copy_evaluation_enabled: bool = False
    copy_evaluation_note: Optional[str] = None
    provided_series: List[TestSeriesResponse] = Field(default_factory=list)
    assigned_series: List[TestSeriesResponse] = Field(default_factory=list)
    review_summary: ProfessionalProfileReviewSummaryResponse = Field(
        default_factory=ProfessionalProfileReviewSummaryResponse
    )
    recent_reviews: List[ProfessionalProfileReviewResponse] = Field(default_factory=list)


class TestSeriesDiscoveryTestResponse(BaseModel):
    test: TestSeriesTestResponse
    series: TestSeriesResponse
    category_ids: List[int] = Field(default_factory=list)
    category_labels: List[str] = Field(default_factory=list)
    provider_profile: Optional[ProfessionalProfileResponse] = None


class TestSeriesDiscoverySeriesResponse(BaseModel):
    series: TestSeriesResponse
    category_ids: List[int] = Field(default_factory=list)
    category_labels: List[str] = Field(default_factory=list)
    provider_profile: Optional[ProfessionalProfileResponse] = None


class MainsCopySubmissionQuestionMarkCreate(BaseModel):
    question_item_id: Optional[int] = None
    question_number: Optional[int] = None
    marks_awarded: float
    max_marks: float = 10.0
    remark: Optional[str] = None


class MainsCopySubmissionQuestionMarkResponse(MainsCopySubmissionQuestionMarkCreate):
    id: int
    submission_id: int
    created_at: str
    updated_at: Optional[str] = None


class MainsCopySubmissionQuestionResponseCreate(BaseModel):
    question_item_id: Optional[int] = None
    question_number: Optional[int] = None
    answer_image_urls: List[str] = Field(default_factory=list)


class MainsCopySubmissionQuestionResponse(MainsCopySubmissionQuestionResponseCreate):
    question_text: Optional[str] = None
    word_limit: Optional[int] = None
    max_marks: Optional[float] = None


class MainsCopySubmissionCreate(BaseModel):
    answer_pdf_url: Optional[str] = None
    question_responses: List[MainsCopySubmissionQuestionResponseCreate] = Field(default_factory=list)
    note: Optional[str] = None
    ai_total_score: Optional[float] = None
    preferred_mode: MentorshipMode = MentorshipMode.VIDEO


class MainsCopySubmissionEtaUpdate(BaseModel):
    provider_eta_hours: Optional[int] = Field(default=None, ge=1, le=24 * 45)
    provider_eta_text: Optional[str] = None
    provider_note: Optional[str] = None
    status: Optional[CopySubmissionStatus] = None


class MainsCopySubmissionCheckUpdate(BaseModel):
    checked_copy_pdf_url: Optional[str] = None
    total_marks: Optional[float] = None
    provider_note: Optional[str] = None
    question_marks: List[MainsCopySubmissionQuestionMarkCreate] = Field(default_factory=list)


class MainsCopySubmissionResponse(BaseModel):
    id: int
    series_id: Optional[int] = None
    test_collection_id: Optional[int] = None
    user_id: str
    answer_pdf_url: Optional[str] = None
    submission_mode: CopySubmissionMode = CopySubmissionMode.PDF
    status: CopySubmissionStatus = CopySubmissionStatus.SUBMITTED
    learner_note: Optional[str] = None
    provider_eta_hours: Optional[int] = None
    provider_eta_text: Optional[str] = None
    provider_note: Optional[str] = None
    checked_copy_pdf_url: Optional[str] = None
    total_marks: Optional[float] = None
    ai_total_score: Optional[float] = None
    submitted_at: str
    eta_set_at: Optional[str] = None
    checked_at: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    question_responses: List[MainsCopySubmissionQuestionResponse] = Field(default_factory=list)
    question_marks: List[MainsCopySubmissionQuestionMarkResponse] = Field(default_factory=list)


class MentorshipSlotCreate(BaseModel):
    starts_at: str
    ends_at: str
    mode: MentorshipMode = MentorshipMode.VIDEO
    call_provider: MentorshipCallProvider = MentorshipCallProvider.CUSTOM
    max_bookings: int = Field(default=1, ge=1, le=5)
    meeting_link: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class MentorshipSlotUpdate(BaseModel):
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    mode: Optional[MentorshipMode] = None
    call_provider: Optional[MentorshipCallProvider] = None
    max_bookings: Optional[int] = Field(default=None, ge=1, le=5)
    meeting_link: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class MentorshipSlotBatchCreate(BaseModel):
    slots: List[MentorshipSlotCreate] = Field(default_factory=list, max_length=180)


class MentorshipSlotBatchDeactivate(BaseModel):
    slot_ids: List[int] = Field(default_factory=list, max_length=240)


class MentorshipSlotResponse(BaseModel):
    id: int
    provider_user_id: str
    starts_at: str
    ends_at: str
    mode: MentorshipMode = MentorshipMode.VIDEO
    call_provider: MentorshipCallProvider = MentorshipCallProvider.CUSTOM
    max_bookings: int = 1
    booked_count: int = 0
    is_active: bool = True
    meeting_link: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class MentorshipRequestCreate(BaseModel):
    series_id: Optional[int] = None
    test_id: Optional[int] = None
    submission_id: Optional[int] = None
    provider_user_id: Optional[str] = None
    slot_id: Optional[int] = None
    slot_segment_starts_at: Optional[str] = None
    slot_segment_ends_at: Optional[str] = None
    preferred_mode: MentorshipMode = MentorshipMode.VIDEO
    note: Optional[str] = None


class MentorshipRequestSchedule(BaseModel):
    slot_id: int
    call_provider: Optional[MentorshipCallProvider] = None
    meeting_link: Optional[str] = None


class MentorshipRequestOfferSlots(BaseModel):
    slot_ids: List[int] = Field(default_factory=list, max_length=24)


class MentorshipRequestStartNow(BaseModel):
    call_provider: Optional[MentorshipCallProvider] = None
    meeting_link: Optional[str] = None
    duration_minutes: int = Field(default=45, ge=15, le=180)


class MentorshipRequestStatusUpdate(BaseModel):
    status: MentorshipRequestStatus
    reason: Optional[str] = None


class MentorshipRequestResponse(BaseModel):
    id: int
    user_id: str
    provider_user_id: str
    series_id: Optional[int] = None
    test_collection_id: Optional[int] = None
    submission_id: Optional[int] = None
    preferred_mode: MentorshipMode = MentorshipMode.VIDEO
    note: Optional[str] = None
    status: MentorshipRequestStatus = MentorshipRequestStatus.REQUESTED
    scheduled_slot_id: Optional[int] = None
    requested_at: str
    updated_at: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class MentorshipSessionResponse(BaseModel):
    id: int
    request_id: int
    slot_id: Optional[int] = None
    provider_user_id: str
    user_id: str
    mode: MentorshipMode = MentorshipMode.VIDEO
    call_provider: MentorshipCallProvider = MentorshipCallProvider.CUSTOM
    starts_at: str
    ends_at: str
    meeting_link: Optional[str] = None
    provider_session_id: Optional[str] = None
    provider_host_url: Optional[str] = None
    provider_join_url: Optional[str] = None
    provider_payload: Dict[str, Any] = Field(default_factory=dict)
    provider_error: Optional[str] = None
    live_started_at: Optional[str] = None
    live_ended_at: Optional[str] = None
    copy_attachment_url: Optional[str] = None
    summary: Optional[str] = None
    status: MentorshipSessionStatus = MentorshipSessionStatus.SCHEDULED
    created_at: str
    updated_at: Optional[str] = None


class MentorZoomIntegrationStatusResponse(BaseModel):
    connected: bool = False
    requires_reconnect: bool = False
    zoom_user_id: Optional[str] = None
    zoom_account_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    expires_at: Optional[str] = None
    connected_at: Optional[str] = None
    updated_at: Optional[str] = None
    last_error: Optional[str] = None
    authorize_url: Optional[str] = None


class MentorZoomConnectResponse(BaseModel):
    authorize_url: str


class MentorshipCallContextResponse(BaseModel):
    session_id: int
    request_id: int
    call_provider: MentorshipCallProvider = MentorshipCallProvider.CUSTOM
    mode: MentorshipMode = MentorshipMode.VIDEO
    join_url: Optional[str] = None
    host_url: Optional[str] = None
    room_url: Optional[str] = None
    sdk_signature: Optional[str] = None
    sdk_key: Optional[str] = None
    sdk_session_name: Optional[str] = None
    sdk_user_name: Optional[str] = None
    sdk_user_identity: Optional[str] = None
    sdk_role_type: Optional[int] = None
    provider_payload: Dict[str, Any] = Field(default_factory=dict)
    available_from: Optional[str] = None
    available_until: Optional[str] = None


class MentorshipEntitlementGrantCreate(BaseModel):
    user_id: str
    sessions: int = Field(default=1, ge=1, le=200)
    valid_until: Optional[str] = None
    source: str = "payment"
    note: Optional[str] = None


class MentorshipEntitlementResponse(BaseModel):
    id: int
    user_id: str
    sessions_remaining: int
    valid_until: Optional[str] = None
    source: str = "payment"
    note: Optional[str] = None
    is_active: bool = True
    created_at: str
    updated_at: Optional[str] = None


class MentorAvailabilityStatusResponse(BaseModel):
    provider_user_id: str
    status: str = Field(default="offline", pattern="^(available_now|busy|offline)$")
    available_now: bool = False
    busy_now: bool = False
    active_slots_now: int = 0
    next_available_at: Optional[str] = None
    live_session_id: Optional[int] = None
    updated_at: str


class LifecycleTrackingIssueResponse(BaseModel):
    code: str
    label: str
    severity: str = Field(default="warning", pattern="^(info|warning|critical)$")
    actor: str = Field(default="system", pattern="^(user|mentor|moderator|system)$")
    related_type: Optional[str] = None
    related_id: Optional[int] = None
    detected_at: str
    detail: Optional[str] = None


class MentorshipTrackingEventResponse(BaseModel):
    key: str
    label: str
    at: Optional[str] = None
    actor: Optional[str] = None
    detail: Optional[str] = None


class MentorshipTrackingCycleResponse(BaseModel):
    request_id: int
    user_id: str
    provider_user_id: str
    series_id: Optional[int] = None
    series_title: Optional[str] = None
    test_collection_id: Optional[int] = None
    test_title: Optional[str] = None
    request_status: MentorshipRequestStatus = MentorshipRequestStatus.REQUESTED
    session_status: Optional[MentorshipSessionStatus] = None
    requested_at: str
    accepted_at: Optional[str] = None
    scheduled_for: Optional[str] = None
    completed_at: Optional[str] = None
    slot_id: Optional[int] = None
    slot_mode: Optional[MentorshipMode] = None
    note: Optional[str] = None
    timeline: List[MentorshipTrackingEventResponse] = Field(default_factory=list)
    issues: List[LifecycleTrackingIssueResponse] = Field(default_factory=list)


class UserLifecycleTrackingRowResponse(BaseModel):
    user_id: str
    enrolled_series_count: int = 0
    attempted_tests: int = 0
    copy_submissions: int = 0
    copy_checked: int = 0
    mentorship_requests: int = 0
    mentorship_scheduled: int = 0
    mentorship_completed: int = 0
    pending_copy_checks: int = 0
    pending_mentorship: int = 0
    delay_count: int = 0
    technical_issue_count: int = 0
    last_activity_at: Optional[str] = None
    issues: List[LifecycleTrackingIssueResponse] = Field(default_factory=list)


class LifecycleTrackingSummaryResponse(BaseModel):
    users: int = 0
    mentorship_cycles: int = 0
    pending_mentorship: int = 0
    scheduled_mentorship: int = 0
    completed_mentorship: int = 0
    pending_copy_checks: int = 0
    delayed_items: int = 0
    technical_issues: int = 0


class LifecycleTrackingResponse(BaseModel):
    generated_at: str
    summary: LifecycleTrackingSummaryResponse
    mentorship_cycles: List[MentorshipTrackingCycleResponse] = Field(default_factory=list)
    user_rows: List[UserLifecycleTrackingRowResponse] = Field(default_factory=list)


class UserPerformanceQuestionRow(BaseModel):
    submission_id: int
    test_collection_id: int
    test_title: Optional[str] = None
    question_item_id: Optional[int] = None
    question_number: Optional[int] = None
    question_text: Optional[str] = None
    marks_awarded: float
    max_marks: float
    submitted_at: str


class UserPerformanceReportResponse(BaseModel):
    total_submissions: int
    checked_submissions: int
    average_provider_marks: float = 0.0
    average_ai_score: float = 0.0
    questions: List[UserPerformanceQuestionRow] = Field(default_factory=list)


CategoryTreeNode.model_rebuild()
MainsCategoryTreeNode.model_rebuild()
