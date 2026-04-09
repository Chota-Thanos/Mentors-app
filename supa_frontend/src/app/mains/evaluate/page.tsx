"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import AppLayout from "@/components/layouts/AppLayout";
import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getMainsMentorWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import MainsAIEvaluationSection from "@/components/mains/MainsAIEvaluationSection";
import MainsCategorySelector from "@/components/mains/MainsCategorySelector";
import {
    CheckCircle2,
    CircleDashed,
    Brain,
    Copy,
    ChevronDown,
    ChevronUp,
    Download,
    FileText,
    Layout,
    Link as LinkIcon,
    Loader2,
    PenTool,
    Plus,
    Sparkles,
    Trash2,
    Upload,
    Wand2,
    X,
} from "lucide-react";
import { premiumApi } from "@/lib/premiumApi";
import { OUTPUT_LANGUAGE_OPTIONS, persistOutputLanguage, readOutputLanguage, type OutputLanguage } from "@/lib/outputLanguage";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { hasGenerationSubscription, hasMainsMentorGenerationSubscription } from "@/lib/accessControl";
import { isMainsTestCollection } from "@/lib/collectionKind";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { PremiumAIExampleAnalysis, PremiumCollection } from "@/types/premium";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface UserAIMainsQuestion {
    id?: number;
    question_text: string;
    answer_approach?: string;
    model_answer?: string;
    answer_style_guidance?: string;
    word_limit: number;
    mains_category_ids?: number[];
    mains_category_id?: number | null;
    category_ids?: number[];
    description?: string;
    created_at?: string;
}

const normalizeTag = (value?: string | null): string => String(value || "").trim().toLowerCase();

const getErrorMessage = (error: unknown): string => {
    if (typeof error === "object" && error !== null && "response" in error) {
        const response = (error as { response?: { data?: { detail?: string } } }).response;
        if (response?.data?.detail) return response.data.detail;
    }
    if (error instanceof Error) return error.message;
    return "Unexpected error";
};

const MAINS_REFERENCE_STORAGE_PREFIX = "mains-ai-reference-repo";
const MAINS_REFERENCE_MAX_ITEMS = 30;
const MAINS_REFERENCE_PAYLOAD_SIZE = 10;
const MAINS_ITEMS_STORAGE_PREFIX = "mains-ai-items";
const MAINS_ITEMS_STORAGE_VERSION = 1;
const MAINS_ITEMS_MAX_ITEMS = 80;

const mainsReferenceStorageKey = (userId?: string | null): string =>
    `${MAINS_REFERENCE_STORAGE_PREFIX}:${String(userId || "anonymous")}`;
const mainsItemsStorageKey = (userId?: string | null): string =>
    `${MAINS_ITEMS_STORAGE_PREFIX}:${String(userId || "anonymous")}`;

const normalizeReferenceQuestion = (value?: string | null): string => {
    const collapsed = String(value || "").replace(/\s+/g, " ").trim();
    if (!collapsed) return "";
    if (collapsed.length <= 240) return collapsed;
    return `${collapsed.slice(0, 237).trimEnd()}...`;
};

const mergeReferenceQuestions = (existing: string[], incoming: string[]): string[] => {
    const output: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...existing, ...incoming]) {
        const normalized = normalizeReferenceQuestion(raw);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }
    return output.slice(-MAINS_REFERENCE_MAX_ITEMS);
};

const areStringListsEqual = (left: string[], right: string[]): boolean => {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
};

const toQuestionTitle = (questionText: string): string => {
    const normalized = normalizeReferenceQuestion(questionText);
    if (!normalized) return "Mains AI Question";
    if (normalized.length <= 120) return normalized;
    return `${normalized.slice(0, 117).trimEnd()}...`;
};

const normalizeCategoryIds = (value: unknown): number[] => {
    if (!Array.isArray(value)) return [];
    const output: number[] = [];
    value.forEach((item) => {
        const parsed = Number(item);
        if (!Number.isFinite(parsed) || parsed <= 0 || output.includes(parsed)) return;
        output.push(parsed);
    });
    return output;
};

const normalizeMainsItem = (raw: unknown): UserAIMainsQuestion | null => {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const questionText = String(row.question_text || "").trim();
    if (!questionText) return null;

    const maybeId = row.id;
    let normalizedId: number | undefined = undefined;
    if (maybeId !== undefined && maybeId !== null && String(maybeId).trim()) {
        const parsedId = Number(maybeId);
        if (Number.isFinite(parsedId)) normalizedId = parsedId;
    }

    const parsedWordLimit = Number(row.word_limit);
    const wordLimit = Number.isFinite(parsedWordLimit) && parsedWordLimit > 0
        ? Math.floor(parsedWordLimit)
        : 150;

    const answerApproach = String(row.answer_approach || "").trim();
    const modelAnswer = String(row.model_answer || "").trim();
    const answerStyleGuidance = String(row.answer_style_guidance || "").trim();
    const createdAt = String(row.created_at || "").trim();
    const mainsCategoryIds = normalizeCategoryIds([
        ...(Array.isArray(row.mains_category_ids) ? row.mains_category_ids : []),
        ...(Array.isArray(row.category_ids) ? row.category_ids : []),
    ]);
    const mainsCategoryId = Number(row.mains_category_id);

    return {
        id: normalizedId,
        question_text: questionText,
        answer_approach: answerApproach || undefined,
        model_answer: modelAnswer || undefined,
        answer_style_guidance: answerStyleGuidance || undefined,
        word_limit: wordLimit,
        mains_category_ids: mainsCategoryIds.length > 0 ? mainsCategoryIds : undefined,
        mains_category_id: Number.isFinite(mainsCategoryId) && mainsCategoryId > 0 ? mainsCategoryId : (mainsCategoryIds[0] || undefined),
        category_ids: mainsCategoryIds.length > 0 ? mainsCategoryIds : undefined,
        description: String(row.description || questionText).trim() || undefined,
        created_at: createdAt || undefined,
    };
};

const mainsItemSignature = (item: UserAIMainsQuestion): string => {
    if (item.id !== undefined && item.id !== null) return `id:${item.id}`;
    const normalizedQuestion = normalizeReferenceQuestion(item.question_text).toLowerCase();
    const normalizedCreatedAt = String(item.created_at || "").trim();
    return `${normalizedQuestion}|${normalizedCreatedAt}|${item.word_limit}`;
};

const mergeMainsItems = (primary: unknown[], secondary: unknown[]): UserAIMainsQuestion[] => {
    const output: UserAIMainsQuestion[] = [];
    const seen = new Set<string>();
    for (const candidate of [...primary, ...secondary]) {
        const normalized = normalizeMainsItem(candidate);
        if (!normalized) continue;
        const key = mainsItemSignature(normalized);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }
    return output.slice(0, MAINS_ITEMS_MAX_ITEMS);
};

const readStoredMainsItems = (storageKey: string): UserAIMainsQuestion[] => {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
            return mergeMainsItems(parsed, []);
        }
        if (parsed && typeof parsed === "object") {
            const payload = parsed as { version?: number; items?: unknown };
            const items = Array.isArray(payload.items) ? payload.items : [];
            return mergeMainsItems(items, []);
        }
        return [];
    } catch {
        window.localStorage.removeItem(storageKey);
        return [];
    }
};

const writeStoredMainsItems = (storageKey: string, items: UserAIMainsQuestion[]): void => {
    if (typeof window === "undefined") return;
    const normalized = mergeMainsItems(items, []);
    if (normalized.length === 0) {
        window.localStorage.removeItem(storageKey);
        return;
    }
    window.localStorage.setItem(
        storageKey,
        JSON.stringify({
            version: MAINS_ITEMS_STORAGE_VERSION,
            items: normalized,
        }),
    );
};

export default function MainsEvaluationPage() {
    const { user, isAuthenticated, showLoginModal } = useAuth();
    const currentUserId = String(user?.id || "").trim();
    const mainsMentorWorkspaceSections = useMemo(
        () => getMainsMentorWorkspaceSections(currentUserId || undefined),
        [currentUserId],
    );
    const [mainsMentorMode, setMainsMentorMode] = useState(false);
    const [exampleQuestionsModalItem, setExampleQuestionsModalItem] = useState<PremiumAIExampleAnalysis | null>(null);
    const [requestedCollectionId, setRequestedCollectionId] = useState<number | null>(null);
    const [requireSpecificTargetCollection, setRequireSpecificTargetCollection] = useState(false);
    // --- State: Generation ---
    const [contentSource, setContentSource] = useState<"text" | "url" | "pdf">("text");
    const [contentValue, setContentValue] = useState("");
    const [useMainsCategorySource, setUseMainsCategorySource] = useState(false);
    const [selectedMainsCategoryIds, setSelectedMainsCategoryIds] = useState<number[]>([]);
    const [wordLimit, setWordLimit] = useState(150);
    const [userInstructions, setUserInstructions] = useState("");
    const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");
    const [isGenerating, setIsGenerating] = useState(false);

    // --- State: Style ---
    const [generationStyles, setGenerationStyles] = useState<PremiumAIExampleAnalysis[]>([]);
    const [mixCountByAnalysisId, setMixCountByAnalysisId] = useState<Map<string, string>>(new Map([["default", "1"]]));

    const setMixCountForAnalysis = useCallback((analysisId: string, countStr: string) => {
        setMixCountByAnalysisId((prev) => {
            const next = new Map(prev);
            if (!countStr || countStr === "0") next.delete(analysisId);
            else next.set(analysisId, countStr);
            return next;
        });
    }, []);

    const [analysisTagL1Filter, setAnalysisTagL1Filter] = useState("");
    const [analysisTagL2Filter, setAnalysisTagL2Filter] = useState("");
    const syncWithEvaluator = true;
    const selectedEvaluatorStyleId = "auto";

    // --- State: History & List ---
    const [mainsItems, setMainsItems] = useState<UserAIMainsQuestion[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [referenceRepo, setReferenceRepo] = useState<string[]>([]);
    const [referenceQuestionDraft, setReferenceQuestionDraft] = useState("");
    const [collections, setCollections] = useState<PremiumCollection[]>([]);
    const [selectedCollectionId, setSelectedCollectionId] = useState("");
    const [newCollectionName, setNewCollectionName] = useState("");
    const [isAddingToCollection, setIsAddingToCollection] = useState(false);

    // --- State: UI ---
    const [expandedItemKeys, setExpandedItemKeys] = useState<string[]>([]);
    const [selectedQuestionKeys, setSelectedQuestionKeys] = useState<string[]>([]);
    const [showManualAdd, setShowManualAdd] = useState(false);
    const [manualQuestion, setManualQuestion] = useState("");
    const [manualModelAnswer, setManualModelAnswer] = useState("");
    const generationStep = 4;
    const [showReferenceRepo, setShowReferenceRepo] = useState(false);
    const [mainsStorageHydrated, setMainsStorageHydrated] = useState(false);
    const [postActionTab, setPostActionTab] = useState<"quick" | "mains_test">("quick");

    useEffect(() => {
        setOutputLanguage(readOutputLanguage());
    }, []);

    const referenceStorageKey = useMemo(
        () => mainsReferenceStorageKey(user?.id ? String(user.id) : "anonymous"),
        [user?.id],
    );
    const itemsStorageKey = useMemo(
        () => mainsItemsStorageKey(user?.id ? String(user.id) : "anonymous"),
        [user?.id],
    );

    const getItemKey = useCallback((item: UserAIMainsQuestion, index: number): string => {
        if (item.id !== undefined && item.id !== null) {
            return `id-${String(item.id)}`;
        }
        const createdPart = String(item.created_at || "").trim();
        const textPart = normalizeReferenceQuestion(item.question_text).toLowerCase();
        const modelPart = normalizeReferenceQuestion(item.model_answer || "").toLowerCase().slice(0, 80);
        const fallback = `${createdPart}|${textPart.slice(0, 180)}|${modelPart}|${String(item.word_limit || "")}`;
        if (fallback.replace(/\|/g, "").trim()) {
            return `local-${fallback}`;
        }
        return `idx-${index}`;
    }, []);

    const analysisTagHierarchy = useMemo(() => {
        const levelMap = new Map<string, Set<string>>();
        for (const style of generationStyles) {
            const l1 = normalizeTag(style.tag_level1);
            const l2 = normalizeTag(style.tag_level2);
            if (!l1) continue;
            if (!levelMap.has(l1)) levelMap.set(l1, new Set());
            if (l2) levelMap.get(l1)?.add(l2);
        }
        return {
            level1: Array.from(levelMap.keys()).sort((a, b) => a.localeCompare(b)),
            level2ByLevel1: levelMap,
        };
    }, [generationStyles]);

    const filteredGenerationStyles = useMemo(() => {
        return generationStyles.filter((style) => {
            const l1Match = !analysisTagL1Filter || normalizeTag(style.tag_level1) === normalizeTag(analysisTagL1Filter);
            const l2Match = !analysisTagL2Filter || normalizeTag(style.tag_level2) === normalizeTag(analysisTagL2Filter);
            return l1Match && l2Match;
        });
    }, [analysisTagL1Filter, analysisTagL2Filter, generationStyles]);

    const generationSourceReady = useMemo(() => {
        if (useMainsCategorySource) {
            return selectedMainsCategoryIds.length > 0;
        }
        if (contentSource === "pdf") {
            return true;
        }
        return Boolean(contentValue.trim());
    }, [contentSource, contentValue, selectedMainsCategoryIds.length, useMainsCategorySource]);

    const generationSubmitDisabled = useMemo(
        () => isGenerating || !generationSourceReady,
        [generationSourceReady, isGenerating],
    );
    const generationStyleReady = useMemo(
        () => Array.from(mixCountByAnalysisId.values()).some(count => parseInt(count, 10) > 0),
        [mixCountByAnalysisId],
    );
    const generationOutputReady = mainsItems.length > 0;

    const selectedItems = useMemo(() => {
        const keySet = new Set(selectedQuestionKeys);
        return mainsItems.filter((item, index) => keySet.has(getItemKey(item, index)));
    }, [getItemKey, mainsItems, selectedQuestionKeys]);

    const mainsCollections = useMemo(
        () => collections.filter((collection) => isMainsTestCollection(collection)),
        [collections],
    );

    const availableMainsCollections = useMemo(() => {
        if (!requireSpecificTargetCollection || !requestedCollectionId) return mainsCollections;
        const bound = mainsCollections.find((collection) => Number(collection.id) === requestedCollectionId);
        if (bound) return [bound];
        return [
            {
                id: requestedCollectionId,
                title: `Mains Test ${requestedCollectionId}`,
                test_kind: "mains",
            } as PremiumCollection,
        ];
    }, [mainsCollections, requestedCollectionId, requireSpecificTargetCollection]);

    const targetCollectionMissing = useMemo(
        () => requireSpecificTargetCollection && !requestedCollectionId,
        [requireSpecificTargetCollection, requestedCollectionId],
    );

    const loadCollections = useCallback(async () => {
        if (!isAuthenticated) {
            setCollections([]);
            setSelectedCollectionId("");
            return;
        }
        try {
            const response = await premiumApi.get<PremiumCollection[]>("/collections", {
                params: { mine_only: true, test_kind: "mains" },
            });
            const rows = Array.isArray(response.data) ? response.data : [];
            setCollections(rows);
        } catch (error: unknown) {
            toast.error("Failed to load Mains Tests", { description: getErrorMessage(error) });
        }
    }, [isAuthenticated]);

    // --- Load Styles & History ---
    useEffect(() => {
        const fetchData = async () => {
            try {
                const [generationStylesRes, historyRes] = await Promise.all([
                    premiumApi.get("/ai/example-analyses?content_type=mains_question_generation&include_admin=true"),
                    premiumApi.get("/ai-mains-questions/user")
                ]);
                setGenerationStyles(Array.isArray(generationStylesRes.data?.items) ? generationStylesRes.data.items : []);
                setMainsItems((prev) => mergeMainsItems(Array.isArray(historyRes.data) ? historyRes.data : [], prev));
            } catch (error) {
                console.error("Failed to fetch data", error);
            } finally {
                setIsLoadingHistory(false);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const modeRaw = String(params.get("mode") || "").trim().toLowerCase();
        const bindRaw = String(params.get("bind_test") || "").trim().toLowerCase();
        const rawCollectionId = params.get("collection_id") || params.get("test_id") || "";
        const parsedCollectionId = Number(rawCollectionId);
        setMainsMentorMode(modeRaw === "mains_mentor");
        setRequireSpecificTargetCollection(bindRaw === "1" || bindRaw === "true" || bindRaw === "yes");
        if (Number.isFinite(parsedCollectionId) && parsedCollectionId > 0) {
            setRequestedCollectionId(Math.floor(parsedCollectionId));
        } else {
            setRequestedCollectionId(null);
        }
    }, []);

    useEffect(() => {
        const storedItems = readStoredMainsItems(itemsStorageKey);
        if (storedItems.length > 0) {
            setMainsItems((prev) => mergeMainsItems(storedItems, prev));
        }
        setMainsStorageHydrated(true);
    }, [itemsStorageKey]);

    useEffect(() => {
        void loadCollections();
    }, [loadCollections]);

    useEffect(() => {
        if (!mainsStorageHydrated) return;
        writeStoredMainsItems(itemsStorageKey, mainsItems);
    }, [mainsItems, mainsStorageHydrated, itemsStorageKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(referenceStorageKey);
            if (!raw) {
                setReferenceRepo([]);
                return;
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                window.localStorage.removeItem(referenceStorageKey);
                setReferenceRepo([]);
                return;
            }
            const normalized = mergeReferenceQuestions([], parsed.map((item) => String(item || "")));
            setReferenceRepo(normalized);
        } catch {
            window.localStorage.removeItem(referenceStorageKey);
            setReferenceRepo([]);
        }
    }, [referenceStorageKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (referenceRepo.length === 0) {
            window.localStorage.removeItem(referenceStorageKey);
            return;
        }
        window.localStorage.setItem(referenceStorageKey, JSON.stringify(referenceRepo.slice(-MAINS_REFERENCE_MAX_ITEMS)));
    }, [referenceRepo, referenceStorageKey]);

    useEffect(() => {
        const historyQuestions = mainsItems.map((item) => item.question_text);
        if (historyQuestions.length === 0) return;
        setReferenceRepo((prev) => {
            const next = mergeReferenceQuestions(prev, historyQuestions);
            return areStringListsEqual(prev, next) ? prev : next;
        });
    }, [mainsItems]);

    useEffect(() => {
        const availableKeys = mainsItems.map((item, index) => getItemKey(item, index));
        setExpandedItemKeys((prev) => prev.filter((key) => availableKeys.includes(key)));
        setSelectedQuestionKeys((prev) => {
            const retained = prev.filter((key) => availableKeys.includes(key));
            if (retained.length > 0) return retained;
            return availableKeys;
        });
    }, [getItemKey, mainsItems]);

    useEffect(() => {
        setSelectedCollectionId((prev) => {
            if (requireSpecificTargetCollection) {
                return requestedCollectionId ? String(requestedCollectionId) : "";
            }
            if (!prev) {
                return mainsCollections[0] ? String(mainsCollections[0].id) : "";
            }
            const stillExists = mainsCollections.some((collection) => String(collection.id) === prev);
            if (stillExists) return prev;
            return mainsCollections[0] ? String(mainsCollections[0].id) : "";
        });
    }, [mainsCollections, requestedCollectionId, requireSpecificTargetCollection]);

    useEffect(() => {
        if (!analysisTagL1Filter) {
            setAnalysisTagL2Filter("");
        }
    }, [analysisTagL1Filter]);

    const handleGenerate = async () => {
        if (!isAuthenticated) {
            showLoginModal();
            return;
        }

        const canGenerate = mainsMentorMode
            ? hasMainsMentorGenerationSubscription(user)
            : hasGenerationSubscription(user);
        if (!canGenerate) {
            toast.error(
                mainsMentorMode
                    ? "Active Mains Mentor AI subscription required for AI generation."
                    : "Active subscription required for AI generation.",
            );
            return;
        }

        if (useMainsCategorySource && selectedMainsCategoryIds.length === 0) {
            toast.error("Select at least one mains category in category source mode.");
            return;
        }

        if (!useMainsCategorySource && !contentValue.trim() && contentSource !== "pdf") {
            toast.error("Please provide content for generation.");
            return;
        }

        setIsGenerating(true);
        try {
            const mixEntries = Array.from(mixCountByAnalysisId.entries());
            if (mixEntries.length === 0) {
                toast.error("Please select at least one format and question count.");
                setIsGenerating(false);
                return;
            }

            let accumulatedNewQuestions: UserAIMainsQuestion[] = [];
            let totalRequestedCount = 0;

            for (const [analysisIdStr, countStr] of mixEntries) {
                const count = parseInt(countStr, 10);
                if (count <= 0 || isNaN(count)) continue;
                totalRequestedCount += count;

                const payload = {
                    content: useMainsCategorySource ? undefined : (contentSource === "text" ? contentValue : undefined),
                    url: useMainsCategorySource ? undefined : (contentSource === "url" ? contentValue : undefined),
                    mains_category_ids: selectedMainsCategoryIds.length > 0 ? selectedMainsCategoryIds : undefined,
                    use_mains_category_source: useMainsCategorySource,
                    number_of_questions: count,
                    word_limit: wordLimit,
                    example_format_id: analysisIdStr !== "default" ? Number(analysisIdStr) : undefined,
                    sync_with_evaluator: syncWithEvaluator,
                    evaluation_example_id:
                        syncWithEvaluator && selectedEvaluatorStyleId !== "auto"
                            ? Number(selectedEvaluatorStyleId)
                            : undefined,
                    user_instructions: userInstructions.trim() || undefined,
                    recent_questions: referenceRepo.slice(-MAINS_REFERENCE_PAYLOAD_SIZE),
                    output_language: outputLanguage,
                };

                const response = await premiumApi.post("/ai-mains-questions/generate", payload);
                const rawQuestions = Array.isArray(response.data?.questions) ? response.data.questions : [];
                const newQuestions: UserAIMainsQuestion[] = rawQuestions.map((item: UserAIMainsQuestion) => ({
                    ...item,
                    created_at: item.created_at || new Date().toISOString(),
                }));

                accumulatedNewQuestions = [...accumulatedNewQuestions, ...newQuestions];
            }

            if (accumulatedNewQuestions.length > 0) {
                setMainsItems((prev) => {
                    const nextItems = mergeMainsItems(accumulatedNewQuestions, prev);
                    const visibleNewKeys = nextItems
                        .slice(0, accumulatedNewQuestions.length)
                        .map((item, index) => getItemKey(item, index));
                    setExpandedItemKeys((prevExpanded) => Array.from(new Set([...visibleNewKeys, ...prevExpanded])));
                    return nextItems;
                });

                const generatedQuestionTexts = accumulatedNewQuestions.map(q => q.question_text).filter(Boolean);
                setReferenceRepo((prev) => mergeReferenceQuestions(prev, generatedQuestionTexts));

                const hasTransientItems = accumulatedNewQuestions.some((item: UserAIMainsQuestion) => item?.id === undefined || item?.id === null);
                toast.success(`Generated ${accumulatedNewQuestions.length} questions!`, hasTransientItems
                    ? { description: "Server-side save was partial; questions are kept in your browser workspace." }
                    : undefined);
            } else if (totalRequestedCount > 0) {
                toast.error("Generation returned 0 questions.");
            }
        } catch (error: unknown) {
            toast.error("Generation failed", { description: getErrorMessage(error) });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleManualAdd = () => {
        if (!manualQuestion.trim()) return;

        const newItem: UserAIMainsQuestion = {
            id: Date.now(), // Local temp ID
            question_text: manualQuestion,
            model_answer: manualModelAnswer,
            word_limit: 250,
            created_at: new Date().toISOString()
        };

        setMainsItems((prev) => mergeMainsItems([newItem], prev));
        setReferenceRepo((prev) => mergeReferenceQuestions(prev, [manualQuestion]));
        setManualQuestion("");
        setManualModelAnswer("");
        setShowManualAdd(false);
        setExpandedItemKeys((prev) => Array.from(new Set([getItemKey(newItem, 0), ...prev])));
        toast.success("Question added manually.");
    };

    const toggleSelectAll = () => {
        if (selectedQuestionKeys.length === mainsItems.length) {
            setSelectedQuestionKeys([]);
            return;
        }
        setSelectedQuestionKeys(mainsItems.map((item, index) => getItemKey(item, index)));
    };

    const toggleItemSelection = (itemKey: string) => {
        setSelectedQuestionKeys((prev) =>
            prev.includes(itemKey) ? prev.filter((key) => key !== itemKey) : [...prev, itemKey]
        );
    };

    const copyTextToClipboard = async (text: string, successLabel: string) => {
        if (!text.trim()) {
            toast.error("Nothing to copy.");
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            toast.success(successLabel);
        } catch {
            toast.error("Copy failed.");
        }
    };

    const handleCopySelectedQuestions = async () => {
        const payload = selectedItems
            .map((item, idx) => `Q${idx + 1}. ${item.question_text}`)
            .join("\n\n");
        await copyTextToClipboard(payload, "Selected questions copied.");
    };

    const handleCopySelectedAnswers = async () => {
        const payload = selectedItems
            .map((item, idx) => {
                const approach = item.answer_approach ? `Answer Approach:\n${item.answer_approach}` : "Answer Approach: Not available";
                const model = item.model_answer ? `Model Answer:\n${item.model_answer}` : "Model Answer: Not available";
                return `Q${idx + 1}. ${item.question_text}\n\n${approach}\n\n${model}`;
            })
            .join("\n\n====================\n\n");
        await copyTextToClipboard(payload, "Selected answer content copied.");
    };

    const handleDownloadSelected = () => {
        if (selectedItems.length === 0) {
            toast.error("Select at least one generated question.");
            return;
        }
        const fileContent = selectedItems
            .map((item, idx) => {
                const lines = [
                    `Q${idx + 1}. ${item.question_text}`,
                    `Word Limit: ${item.word_limit}`,
                ];
                if (item.answer_approach) lines.push(`Answer Approach:\n${item.answer_approach}`);
                if (item.model_answer) lines.push(`Model Answer:\n${item.model_answer}`);
                return lines.join("\n\n");
            })
            .join("\n\n----------------------------------------\n\n");

        const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `mains_ai_output_${new Date().toISOString().slice(0, 10)}.txt`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        toast.success("Downloaded selected output.");
    };

    const handleRemoveSelectedFromView = () => {
        if (selectedQuestionKeys.length === 0) {
            toast.error("Select at least one generated question.");
            return;
        }
        const selectedSet = new Set(selectedQuestionKeys);
        setMainsItems((prev) => prev.filter((item, index) => !selectedSet.has(getItemKey(item, index))));
        setSelectedQuestionKeys([]);
        setExpandedItemKeys((prev) => prev.filter((key) => !selectedSet.has(key)));
        toast.success("Selected questions removed from current view.");
    };

    const handleAddReferenceQuestion = () => {
        const normalized = normalizeReferenceQuestion(referenceQuestionDraft);
        if (!normalized) {
            toast.error("Add a concise reference question first.");
            return;
        }
        const nextRepo = mergeReferenceQuestions(referenceRepo, [normalized]);
        if (areStringListsEqual(referenceRepo, nextRepo)) {
            toast.success("Reference repo is already up to date.");
            setReferenceQuestionDraft("");
            return;
        }
        setReferenceRepo(nextRepo);
        setReferenceQuestionDraft("");
        toast.success("Reference added.");
    };

    const handleRemoveReferenceQuestion = (questionText: string) => {
        setReferenceRepo((prev) => prev.filter((item) => item !== questionText));
    };

    const handleClearReferenceRepo = () => {
        if (referenceRepo.length === 0) return;
        setReferenceRepo([]);
        toast.success("Reference repo cleared.");
    };

    const handleAddSelectedToReferenceRepo = () => {
        if (selectedItems.length === 0) {
            toast.error("Select at least one question first.");
            return;
        }
        const nextRepo = mergeReferenceQuestions(referenceRepo, selectedItems.map((item) => item.question_text));
        const addedCount = nextRepo.length - referenceRepo.length;
        setReferenceRepo(nextRepo);
        if (addedCount > 0) {
            toast.success(`Added ${addedCount} reference question(s).`);
            return;
        }
        toast.success("Reference repo is already up to date.");
    };

    const addSelectedToCollection = useCallback(async (collectionId: number): Promise<number> => {
        let addedCount = 0;
        const selectedOverrideCategoryIds = selectedMainsCategoryIds
            .map((value) => Number(value))
            .filter((value, index, values) => Number.isFinite(value) && value > 0 && values.indexOf(value) === index);
        for (const item of selectedItems) {
            const answerStyle = String(item.answer_style_guidance || "").trim();
            const mainsCategoryIds = selectedOverrideCategoryIds.length > 0
                ? selectedOverrideCategoryIds
                : normalizeCategoryIds([
                    ...(item.mains_category_ids || []),
                    ...(item.category_ids || []),
                ]);
            const payload = {
                title: toQuestionTitle(item.question_text),
                type: "question",
                data: {
                    mode: "mains_ai",
                    kind: "mains_ai_question",
                    question_text: item.question_text,
                    answer_approach: item.answer_approach || null,
                    model_answer: item.model_answer || null,
                    word_limit: Number(item.word_limit) > 0 ? Number(item.word_limit) : 150,
                    answer_style_guidance: answerStyle || null,
                    mains_category_ids: mainsCategoryIds.length > 0 ? mainsCategoryIds : undefined,
                    mains_category_id: mainsCategoryIds[0] || null,
                    category_ids: mainsCategoryIds.length > 0 ? mainsCategoryIds : undefined,
                    description: item.question_text,
                },
                collection_id: collectionId,
            };
            await premiumApi.post("/content", payload);
            addedCount += 1;
        }
        return addedCount;
    }, [selectedItems, selectedMainsCategoryIds]);

    const handleAddToExistingCollection = useCallback(async () => {
        if (!isAuthenticated) {
            showLoginModal();
            return;
        }
        if (selectedItems.length === 0) {
            toast.error("Select at least one generated question first.");
            return;
        }
        const collectionId = requireSpecificTargetCollection
            ? Number(requestedCollectionId || 0)
            : Number(selectedCollectionId);
        if (!Number.isFinite(collectionId) || collectionId <= 0) {
            toast.error(
                requireSpecificTargetCollection
                    ? "Target Mains Test ID is missing in URL. Open this workspace from Programs -> Add Questions."
                    : "Select a valid Mains Test first.",
            );
            return;
        }
        setIsAddingToCollection(true);
        try {
            const addedCount = await addSelectedToCollection(collectionId);
            toast.success(`Added ${addedCount} question(s) to Mains Test.`);
            await loadCollections();
        } catch (error: unknown) {
            toast.error("Failed to add questions to Mains Test", { description: getErrorMessage(error) });
        } finally {
            setIsAddingToCollection(false);
        }
    }, [addSelectedToCollection, isAuthenticated, loadCollections, requestedCollectionId, requireSpecificTargetCollection, selectedCollectionId, selectedItems.length, showLoginModal]);

    const handleCreateAndAddCollection = useCallback(async () => {
        if (!isAuthenticated) {
            showLoginModal();
            return;
        }
        if (selectedItems.length === 0) {
            toast.error("Select at least one generated question first.");
            return;
        }
        const name = newCollectionName.trim();
        if (!name) {
            toast.error("Mains Test name is required.");
            return;
        }
        setIsAddingToCollection(true);
        try {
            const response = await premiumApi.post<PremiumCollection>("/collections", {
                title: name,
                description: "Generated from Mains Studio",
                type: "test_series",
                test_kind: "mains",
                is_premium: true,
                is_public: false,
                is_finalized: false,
                meta: {
                    collection_mode: "mains_ai",
                },
            });
            const collectionId = Number(response.data?.id);
            if (!Number.isFinite(collectionId) || collectionId <= 0) {
                throw new Error("Mains Test creation returned invalid ID.");
            }
            const addedCount = await addSelectedToCollection(collectionId);
            setNewCollectionName("");
            setSelectedCollectionId(String(collectionId));
            toast.success(`Created Mains Test and added ${addedCount} question(s).`);
            await loadCollections();
        } catch (error: unknown) {
            toast.error("Failed to create Mains Test", { description: getErrorMessage(error) });
        } finally {
            setIsAddingToCollection(false);
        }
    }, [addSelectedToCollection, isAuthenticated, loadCollections, newCollectionName, selectedItems.length, showLoginModal]);

    return (
        <>
            <AppLayout>
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
                    <div className="container mx-auto py-12 px-4 max-w-7xl">
                        <div className={mainsMentorMode ? "space-y-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0" : ""}>
                            {mainsMentorMode ? (
                                <RoleWorkspaceSidebar
                                    title="Mains Mentor"
                                    subtitle="Mains generation, series delivery, mentorship queue, and repository management."
                                    sections={mainsMentorWorkspaceSections}
                                />
                            ) : null}

                            <div className="min-w-0">

                        <section className="mb-10">
                            <div className="mx-auto max-w-4xl text-center">
                                <h1 className="text-4xl font-semibold tracking-tight text-slate-900">Free AI Mains Generator</h1>
                                <p className="mt-3 text-lg text-slate-700">
                                    Create custom mains questions and evaluate answers with a guided AI workflow.
                                </p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Workspace mode: <span className="font-semibold text-slate-700">{mainsMentorMode ? "Mains Mentor" : "Learner"}</span>
                                </p>
                            </div>
                            <div className="mx-auto mt-6 grid max-w-5xl gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-4">
                                {[
                                    { label: "Source Ready", done: generationSourceReady },
                                    { label: "Style Ready", done: generationStyleReady },
                                    { label: "Generated", done: generationOutputReady },
                                    { label: "Evaluate", done: generationOutputReady && !isLoadingHistory },
                                ].map((step) => (
                                    <div key={step.label} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                                        {step.done ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                        ) : isGenerating ? (
                                            <CircleDashed className="h-4 w-4 animate-spin text-sky-600" />
                                        ) : (
                                            <CircleDashed className="h-4 w-4 text-slate-400" />
                                        )}
                                        <span className={step.done ? "font-semibold text-emerald-700" : "text-slate-600"}>{step.label}</span>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <div className="grid grid-cols-1 gap-8 items-start">

                            {/* LEFT COLUMN: Generation Sidebar */}
                            <div className="lg:col-span-12 space-y-5">
                                <div className="mx-auto w-full max-w-5xl space-y-6 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
                                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                                            <Wand2 className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold text-slate-900">Generator Settings</h3>
                                            <p className="text-xs text-slate-500">Choose source first, then configure all options below.</p>
                                        </div>
                                    </div>

                                    {generationStep >= 1 && (
                                        <>
                                            <div className="mb-4 flex w-full justify-start">
                                                <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm">
                                                    <span className="mr-2 font-bold text-slate-900">Step 1:</span> Source &mdash; choose input type and share content.
                                                </div>
                                            </div>
                                            <div className="mb-2 flex w-full justify-end">
                                                <div className="w-full space-y-4 rounded-2xl rounded-tr-sm border border-sky-200 bg-sky-50/50 p-4">
                                                    <div className="rounded-xl bg-slate-100 p-1">
                                                        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setUseMainsCategorySource(false);
                                                                    setContentSource("pdf");
                                                                }}
                                                                className={cn(
                                                                    "inline-flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition",
                                                                    !useMainsCategorySource && contentSource === "pdf"
                                                                        ? "bg-white text-sky-700 shadow-sm"
                                                                        : "text-slate-500 hover:text-slate-700",
                                                                )}
                                                            >
                                                                <Upload className="h-3.5 w-3.5" />
                                                                File
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setUseMainsCategorySource(false);
                                                                    setContentSource("text");
                                                                }}
                                                                className={cn(
                                                                    "inline-flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition",
                                                                    !useMainsCategorySource && contentSource === "text"
                                                                        ? "bg-white text-sky-700 shadow-sm"
                                                                        : "text-slate-500 hover:text-slate-700",
                                                                )}
                                                            >
                                                                <FileText className="h-3.5 w-3.5" />
                                                                Text
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setUseMainsCategorySource(false);
                                                                    setContentSource("url");
                                                                }}
                                                                className={cn(
                                                                    "inline-flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition",
                                                                    !useMainsCategorySource && contentSource === "url"
                                                                        ? "bg-white text-sky-700 shadow-sm"
                                                                        : "text-slate-500 hover:text-slate-700",
                                                                )}
                                                            >
                                                                <LinkIcon className="h-3.5 w-3.5" />
                                                                Article Link
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setUseMainsCategorySource(true)}
                                                                className={cn(
                                                                    "inline-flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition",
                                                                    useMainsCategorySource
                                                                        ? "bg-white text-sky-700 shadow-sm"
                                                                        : "text-slate-500 hover:text-slate-700",
                                                                )}
                                                            >
                                                                <Layout className="h-3.5 w-3.5" />
                                                                Category
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {useMainsCategorySource ? (
                                                        <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
                                                            <p className="text-xs text-slate-600">
                                                                Category source mode is active. Select one or more mains categories.
                                                            </p>
                                                            <MainsCategorySelector
                                                                selectedCategoryIds={selectedMainsCategoryIds}
                                                                onCategoryIdsChange={setSelectedMainsCategoryIds}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-3">
                                                            {contentSource === "text" && (
                                                                <textarea
                                                                    value={contentValue}
                                                                    onChange={(e) => setContentValue(e.target.value)}
                                                                    placeholder="Paste article, editorial, or notes here..."
                                                                    className="w-full min-h-[170px] rounded-xl border border-sky-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                                                                />
                                                            )}
                                                            {contentSource === "url" && (
                                                                <input
                                                                    type="text"
                                                                    value={contentValue}
                                                                    onChange={(e) => setContentValue(e.target.value)}
                                                                    placeholder="https://..."
                                                                    className="w-full rounded-xl border border-sky-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                                                                />
                                                            )}
                                                            {contentSource === "pdf" && (
                                                                <div className="rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/40 px-4 py-10 text-center">
                                                                    <Upload className="mx-auto h-8 w-8 text-slate-400" />
                                                                    <p className="mt-3 text-sm font-medium text-slate-700">Drag and drop a file to generate mains questions</p>
                                                                    <p className="mt-1 text-xs text-slate-500">PDF support in this section is being finalized.</p>
                                                                    <button
                                                                        type="button"
                                                                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                                                                    >
                                                                        <Upload className="h-4 w-4" />
                                                                        Upload a File
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    <p className="mt-2 text-xs text-slate-500">
                                                        {generationSourceReady ? "Source is ready." : "Add source text/URL or select category source to continue."}
                                                    </p>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {generationStep >= 2 && (
                                        <>
                                            <div className="mb-4 flex w-full justify-start">
                                                <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 shadow-sm">
                                                    <span className="mr-2 font-bold text-amber-950">Step 2:</span> Defaults &mdash; set question count, word limit, and language.
                                                </div>
                                            </div>
                                            <div className="mb-2 flex w-full justify-end">
                                                <div className="w-full overflow-hidden rounded-2xl rounded-tr-sm border border-amber-200 bg-amber-50/60">
                                                    <div className="grid grid-cols-1 divide-y divide-amber-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                                                        <div className="space-y-1 px-3 py-3">
                                                            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Word Limit</label>
                                                            <select
                                                                value={wordLimit}
                                                                onChange={(e) => setWordLimit(Number(e.target.value))}
                                                                className="w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                                                            >
                                                                {[150, 250].map((n) => <option key={n} value={n}>{n} words</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="space-y-1 px-3 py-3">
                                                            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Output Language</label>
                                                            <select
                                                                value={outputLanguage}
                                                                onChange={(e) => {
                                                                    const next = persistOutputLanguage(e.target.value);
                                                                    setOutputLanguage(next);
                                                                }}
                                                                className="w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                                                            >
                                                                {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-2 px-3 py-3">
                                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Prompt Settings</span>
                                                            <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                                                                Below
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {generationStep >= 3 && (
                                        <>
                                            <div className="mb-4 flex w-full justify-start">
                                                <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-900 shadow-sm">
                                                    <span className="mr-2 font-bold text-emerald-950">Step 3:</span> Prompt Settings &mdash; choose format mix, examples, and custom instructions.
                                                </div>
                                            </div>
                                            <div className="mb-2 flex w-full justify-end">
                                                <div className="w-full space-y-4 rounded-2xl rounded-tr-sm border border-emerald-200 bg-emerald-50/60 p-4">
                                                    <div className="space-y-3">
                                                        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Example Analysis Selection</label>
                                                        <div className="flex flex-col gap-3">
                                                            <div className="flex flex-wrap md:flex-nowrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 min-w-[60px] shrink-0">STYLE 1</p>
                                                                <div className="-mx-1 flex flex-wrap gap-2 px-1">
                                                                    <button
                                                                        type="button"
                                                                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${!analysisTagL1Filter
                                                                            ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                                                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                                                            }`}
                                                                        onClick={() => {
                                                                            setAnalysisTagL1Filter("");
                                                                            setAnalysisTagL2Filter("");
                                                                        }}
                                                                    >
                                                                        All
                                                                    </button>
                                                                    {analysisTagHierarchy.level1.map((tag) => {
                                                                        const active = normalizeTag(analysisTagL1Filter) === normalizeTag(tag);
                                                                        return (
                                                                            <button
                                                                                key={tag}
                                                                                type="button"
                                                                                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${active
                                                                                    ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                                                                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                                                                    }`}
                                                                                onClick={() => {
                                                                                    setAnalysisTagL1Filter(tag);
                                                                                    setAnalysisTagL2Filter("");
                                                                                }}
                                                                            >
                                                                                {tag}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>

                                                            {analysisTagL1Filter ? (
                                                                <div className="flex flex-wrap md:flex-nowrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 min-w-[60px] shrink-0">STYLE 2</p>
                                                                    <div className="-mx-1 flex flex-wrap gap-2 px-1">
                                                                        <button
                                                                            type="button"
                                                                            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${!analysisTagL2Filter
                                                                                ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                                                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                                                                }`}
                                                                            onClick={() => setAnalysisTagL2Filter("")}
                                                                        >
                                                                            All
                                                                        </button>
                                                                        {Array.from(analysisTagHierarchy.level2ByLevel1.get(normalizeTag(analysisTagL1Filter)) || []).map((tag) => {
                                                                            const active = normalizeTag(analysisTagL2Filter) === normalizeTag(tag);
                                                                            return (
                                                                                <button
                                                                                    key={tag}
                                                                                    type="button"
                                                                                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${active
                                                                                        ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                                                                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                                                                        }`}
                                                                                    onClick={() => setAnalysisTagL2Filter(tag)}
                                                                                >
                                                                                    {tag}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>

                                                    <div className="mt-4">
                                                        <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                                            Format & Count Mix
                                                        </label>
                                                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                            <div
                                                                className={`rounded-xl border p-3 transition-colors ${mixCountByAnalysisId.get("default")
                                                                    ? "border-emerald-500 bg-emerald-50/50"
                                                                    : "border-slate-200 bg-white"
                                                                    }`}
                                                            >
                                                                <div className="flex items-start justify-between">
                                                                    <div className="space-y-1 min-w-0 pr-2">
                                                                        <p className="font-semibold text-sm text-slate-900 truncate" title="Standard UPSC Format">Standard UPSC Format</p>
                                                                        <p className="text-xs text-slate-500 line-clamp-1">General standard structure</p>
                                                                    </div>
                                                                    <select
                                                                        value={mixCountByAnalysisId.get("default") || "0"}
                                                                        onChange={(e) => setMixCountForAnalysis("default", e.target.value)}
                                                                        className="shrink-0 w-[50px] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500 text-center"
                                                                    >
                                                                        <option value="0">0</option>
                                                                        <option value="1">1</option>
                                                                        <option value="2">2</option>
                                                                        <option value="3">3</option>
                                                                        <option value="4">4</option>
                                                                        <option value="5">5</option>
                                                                    </select>
                                                                </div>
                                                            </div>

                                                            {filteredGenerationStyles.map((item) => {
                                                                const analysisId = String(item.id);
                                                                const countValue = mixCountByAnalysisId.get(analysisId) || "0";
                                                                return (
                                                                    <div
                                                                        key={item.id}
                                                                        className={`rounded-xl border p-3 transition-colors ${countValue !== "0"
                                                                            ? "border-emerald-500 bg-emerald-50/50"
                                                                            : "border-slate-200 bg-white"
                                                                            }`}
                                                                    >
                                                                        <div className="flex items-start justify-between">
                                                                            <div className="space-y-1 min-w-0 pr-2">
                                                                                <p className="font-semibold text-sm text-slate-900 truncate" title={item.title}>{item.title}</p>
                                                                                <p className="text-[10px] text-slate-500 line-clamp-1 uppercase tracking-wider font-semibold">
                                                                                    {[item.tag_level1, item.tag_level2].filter(Boolean).join(" • ")}
                                                                                </p>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setExampleQuestionsModalItem(item)}
                                                                                    className="mt-1 flex items-center text-[10px] font-medium tracking-wide text-emerald-600 hover:text-emerald-700 transition-colors bg-emerald-50 hover:bg-emerald-100 rounded-md py-0.5 px-2 w-max"
                                                                                >
                                                                                    <Layout className="mr-1 h-3 w-3" />
                                                                                    View Examples
                                                                                </button>
                                                                            </div>
                                                                            <select
                                                                                value={countValue}
                                                                                onChange={(e) => setMixCountForAnalysis(analysisId, e.target.value)}
                                                                                className="shrink-0 w-[50px] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500 text-center"
                                                                            >
                                                                                <option value="0">0</option>
                                                                                <option value="1">1</option>
                                                                                <option value="2">2</option>
                                                                                <option value="3">3</option>
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    <div className="mt-4">
                                                        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">User Instructions (Optional)</label>
                                                        <textarea
                                                            value={userInstructions}
                                                            onChange={(e) => setUserInstructions(e.target.value)}
                                                            className="mt-1 min-h-[90px] w-full rounded-lg border border-emerald-200 bg-white p-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                                                        />
                                                    </div>                                                    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                                                Reference Repo
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowReferenceRepo((prev) => !prev)}
                                                                className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-50"
                                                            >
                                                                {showReferenceRepo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                                {referenceRepo.length}
                                                            </button>
                                                        </div>
                                                        <p className="mt-2 text-[11px] text-slate-500">
                                                            Prevents near-duplicate questions while still allowing fresh angles on the same topic.
                                                        </p>
                                                        {showReferenceRepo ? (
                                                            <>
                                                                <div className="mt-3 flex items-center gap-2">
                                                                    <input
                                                                        type="text"
                                                                        value={referenceQuestionDraft}
                                                                        onChange={(e) => setReferenceQuestionDraft(e.target.value)}
                                                                        placeholder="Add a concise prior question"
                                                                        className="flex-1 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-500"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={handleAddReferenceQuestion}
                                                                        className="rounded-lg border border-violet-200 bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-200"
                                                                    >
                                                                        Add
                                                                    </button>
                                                                </div>
                                                                {referenceRepo.length > 0 ? (
                                                                    <div className="mt-3 max-h-40 space-y-1 overflow-auto rounded-lg border border-violet-200 bg-white p-2">
                                                                        {[...referenceRepo].reverse().map((questionText) => (
                                                                            <div key={questionText} className="flex items-start justify-between gap-2">
                                                                                <p className="text-[11px] leading-relaxed text-slate-700">
                                                                                    {questionText}
                                                                                </p>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleRemoveReferenceQuestion(questionText)}
                                                                                    className="mt-0.5 text-slate-400 hover:text-rose-500"
                                                                                    aria-label="Remove reference"
                                                                                >
                                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <p className="mt-3 text-[11px] text-slate-500">
                                                                        No references yet. Your generated history auto-populates this repo.
                                                                    </p>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={handleClearReferenceRepo}
                                                                    disabled={referenceRepo.length === 0}
                                                                    className="mt-3 rounded-md border border-violet-200 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                                                                >
                                                                    Clear Repo
                                                                </button>
                                                            </>
                                                        ) : null}
                                                    </div>

                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {generationStep >= 4 && (
                                        <>
                                            <div className="flex w-full justify-start mb-4">
                                                <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-900 shadow-sm">
                                                    <span className="mr-2 font-bold text-sky-950">Step 4:</span> Review summary and generate your mains question set.
                                                </div>
                                            </div>
                                            <div className="flex w-full justify-end">
                                                <div className="w-full space-y-4 rounded-2xl rounded-tr-sm border border-sky-200 bg-sky-50/60 p-4">
                                                    <p className="text-xs text-sky-900">
                                                        Source: <span className="font-semibold uppercase">{useMainsCategorySource ? "Category source" : contentSource}</span> | Count:{" "}
                                                        <span className="font-semibold">{Array.from(mixCountByAnalysisId.values()).reduce((sum, val) => sum + parseInt(val, 10), 0)}</span> | Limit: <span className="font-semibold">{wordLimit}</span>
                                                    </p>
                                                    <div>
                                                        <button
                                                            onClick={handleGenerate}
                                                            disabled={generationSubmitDisabled}
                                                            className="inline-flex w-full items-center justify-center rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            {isGenerating ? (
                                                                <>
                                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                    Generating...
                                                                </>
                                                            ) : (
                                                                "Generate Questions"
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>



                            {/* RIGHT COLUMN: Questions List */}
                            <div className="lg:col-span-12 space-y-6">

                                {/* Manual Add Form (Collapsible) */}
                                {showManualAdd && (
                                    <div className="rounded-3xl border border-indigo-200 bg-indigo-50/50 p-6 dark:border-indigo-900 dark:bg-indigo-950/20 animate-in slide-in-from-top-4">
                                        <h3 className="font-bold text-indigo-900 dark:text-indigo-100 mb-4 flex items-center gap-2">
                                            <PenTool className="h-4 w-4" />
                                            Manual Question Entry
                                        </h3>
                                        <div className="space-y-4">
                                            <textarea
                                                value={manualQuestion}
                                                onChange={(e) => setManualQuestion(e.target.value)}
                                                placeholder="Enter your question text..."
                                                className="w-full rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none dark:border-slate-800 dark:bg-slate-900"
                                                rows={3}
                                            />
                                            <textarea
                                                value={manualModelAnswer}
                                                onChange={(e) => setManualModelAnswer(e.target.value)}
                                                placeholder="Model answer (optional)..."
                                                className="w-full rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none dark:border-slate-800 dark:bg-slate-900"
                                                rows={2}
                                            />
                                            <div className="flex justify-end gap-3">
                                                <button
                                                    onClick={() => setShowManualAdd(false)}
                                                    className="px-4 py-2 text-sm font-bold text-slate-500"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleManualAdd}
                                                    className="px-6 py-2 rounded-xl bg-indigo-600 font-bold text-white shadow-sm"
                                                >
                                                    Add to List
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <Layout className="h-4 w-4 text-slate-400" />
                                        <span className="text-xs font-black uppercase tracking-widest text-slate-400">Questions Workbench</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowManualAdd((prev) => !prev)}
                                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        {showManualAdd ? "Hide Manual Entry" : "Custom Question"}
                                    </button>
                                </div>

                                {mainsItems.length > 0 ? (
                                    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-white via-indigo-50/40 to-cyan-50/40 shadow-sm overflow-hidden">
                                        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-indigo-100 bg-white/50">
                                            <div>
                                                <p className="text-sm font-bold text-slate-800 tracking-tight">Post-Generation Actions</p>
                                                <p className="mt-0.5 text-xs text-slate-500 font-medium">
                                                    Total: <span className="text-indigo-600">{mainsItems.length}</span> | Selected: <span className="text-indigo-600">{selectedItems.length}</span>
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={toggleSelectAll}
                                                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                                            >
                                                {selectedQuestionKeys.length === mainsItems.length ? "Clear Selection" : "Select All"}
                                            </button>
                                        </div>
                                        <div className="flex bg-white/60 border-b border-indigo-100 px-4">
                                            <button
                                                type="button"
                                                onClick={() => setPostActionTab("quick")}
                                                className={`py-3 px-4 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2 mr-4 ${postActionTab === "quick" ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                                            >
                                                Quick Actions
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setPostActionTab("mains_test")}
                                                className={`py-3 px-4 text-[11px] font-bold uppercase tracking-wider transition-colors border-b-2 ${postActionTab === "mains_test" ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                                            >
                                                Manage Tests
                                            </button>
                                        </div>
                                        <div className="p-5">
                                            {postActionTab === "quick" ? (
                                                <div className="flex flex-wrap gap-2.5 animate-in slide-in-from-bottom-2 duration-300">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleCopySelectedQuestions()}
                                                        disabled={selectedItems.length === 0}
                                                        className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50"
                                                    >
                                                        <Copy className="mr-2 h-4 w-4 text-slate-400" />
                                                        Copy Questions
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleCopySelectedAnswers()}
                                                        disabled={selectedItems.length === 0}
                                                        className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50"
                                                    >
                                                        <Copy className="mr-2 h-4 w-4 text-slate-400" />
                                                        Copy Answers
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleDownloadSelected}
                                                        disabled={selectedItems.length === 0}
                                                        className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-all disabled:opacity-50"
                                                    >
                                                        <Download className="mr-2 h-4 w-4" />
                                                        Download TXT
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleAddSelectedToReferenceRepo}
                                                        disabled={selectedItems.length === 0}
                                                        className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-all disabled:opacity-50"
                                                    >
                                                        <Plus className="mr-2 h-4 w-4" />
                                                        Add to Repo
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleRemoveSelectedFromView}
                                                        disabled={selectedItems.length === 0}
                                                        className="inline-flex items-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-100 hover:border-rose-300 transition-all disabled:opacity-50"
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Remove Items
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="grid gap-4 xl:grid-cols-2 animate-in slide-in-from-bottom-2 duration-300">
                                                    {requireSpecificTargetCollection ? (
                                                        <p className={`xl:col-span-2 rounded-xl border px-4 py-3 text-sm font-medium ${targetCollectionMissing
                                                            ? "border-rose-200 bg-rose-50 text-rose-800"
                                                            : "border-indigo-200 bg-indigo-50/50 text-indigo-800"
                                                            }`}>
                                                            {targetCollectionMissing
                                                                ? "Target Mains Test ID is missing in URL. Open this workspace from Programs -> Add Questions."
                                                                : `Bound to Mains Test #${requestedCollectionId}. Selected questions will be added only to this test.`}
                                                        </p>
                                                    ) : null}
                                                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors">
                                                        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 block">
                                                            {requireSpecificTargetCollection ? "Add to Bound Mains Test" : "Add to Existing Mains Test"}
                                                        </label>
                                                        <div className="flex flex-col gap-2.5 sm:flex-row">
                                                            <select
                                                                value={selectedCollectionId}
                                                                onChange={(event) => setSelectedCollectionId(event.target.value)}
                                                                disabled={requireSpecificTargetCollection}
                                                                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                                            >
                                                                <option value="">{requireSpecificTargetCollection ? "Bound Mains Test" : "Select Mains Test"}</option>
                                                                {availableMainsCollections.map((collection) => (
                                                                    <option key={collection.id} value={String(collection.id)}>
                                                                        {collection.title || collection.name || `Mains Test ${collection.id}`}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleAddToExistingCollection()}
                                                                disabled={
                                                                    isAddingToCollection
                                                                    || selectedItems.length === 0
                                                                    || (!selectedCollectionId && !requireSpecificTargetCollection)
                                                                    || targetCollectionMissing
                                                                }
                                                                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-50"
                                                            >
                                                                {isAddingToCollection ? "Adding..." : "Add"}
                                                            </button>
                                                        </div>
                                                        {!requireSpecificTargetCollection && mainsCollections.length === 0 ? (
                                                            <p className="mt-3 text-xs text-amber-600 font-medium bg-amber-50 px-3 py-2 rounded-lg inline-block border border-amber-100">
                                                                No Mains Test found. Create one to get started.
                                                            </p>
                                                        ) : null}
                                                    </div>

                                                    {!requireSpecificTargetCollection ? (
                                                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors">
                                                            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 block">
                                                                Create New Mains Test
                                                            </label>
                                                            <div className="flex flex-col gap-2.5 sm:flex-row">
                                                                <input
                                                                    value={newCollectionName}
                                                                    onChange={(event) => setNewCollectionName(event.target.value)}
                                                                    placeholder="e.g. Polity Mains Drill"
                                                                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400 placeholder:font-normal"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCreateAndAddCollection()}
                                                                    disabled={isAddingToCollection || selectedItems.length === 0 || !newCollectionName.trim()}
                                                                    className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800 transition-all disabled:opacity-50 whitespace-nowrap"
                                                                >
                                                                    {isAddingToCollection ? "Working..." : "Create + Add"}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : null}

                                {isLoadingHistory ? (
                                    <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-100 dark:bg-slate-900 dark:border-slate-800">
                                        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin mb-4" />
                                        <p className="text-slate-500 font-medium">Loading your workbook...</p>
                                    </div>
                                ) : mainsItems.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 px-6 bg-white rounded-3xl border border-2 border-dashed border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-center">
                                        <div className="h-16 w-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                                            <Brain className="h-8 w-8 text-slate-300" />
                                        </div>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Ready to Start?</h3>
                                        <p className="text-slate-500 max-w-sm">
                                            Paste an article or URL on the left to generate target questions for your Mains practice.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {mainsItems.map((item, index) => {
                                            const itemKey = getItemKey(item, index);
                                            const isExpanded = expandedItemKeys.includes(itemKey);
                                            const isSelected = selectedQuestionKeys.includes(itemKey);
                                            return (
                                                <div
                                                    key={itemKey}
                                                    className={cn(
                                                        "group rounded-3xl border transition-all duration-300 overflow-hidden",
                                                        isExpanded
                                                            ? "border-indigo-200 bg-white shadow-2xl dark:border-indigo-900 dark:bg-slate-900"
                                                            : "border-slate-100 bg-white/60 hover:border-indigo-100 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60"
                                                    )}
                                                >
                                                    {/* Item Header */}
                                                    <div
                                                        onClick={() => setExpandedItemKeys((prev) =>
                                                            prev.includes(itemKey)
                                                                ? prev.filter((key) => key !== itemKey)
                                                                : [...prev, itemKey]
                                                        )}
                                                        className="p-6 cursor-pointer flex items-start gap-4"
                                                    >
                                                        <div className="h-10 w-10 shrink-0 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center font-black text-indigo-600">
                                                            {mainsItems.length - index}
                                                        </div>
                                                        <label
                                                            className="mt-2 inline-flex items-center"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => toggleItemSelection(itemKey)}
                                                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                            />
                                                        </label>
                                                        <div className="flex-1">
                                                            <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">
                                                                {item.question_text}
                                                            </h3>
                                                            <div className="mt-2 flex items-center gap-4 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                                <span>{item.word_limit} Words Target</span>
                                                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                                <span>UPSC Grade</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-2">
                                                            {isExpanded ? <ChevronUp className="h-5 w-5 text-indigo-500" /> : <ChevronDown className="h-5 w-5 text-slate-300 group-hover:text-indigo-400" />}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setMainsItems((prev) => prev.filter((q, qIndex) => getItemKey(q, qIndex) !== itemKey));
                                                                    setSelectedQuestionKeys((prev) => prev.filter((key) => key !== itemKey));
                                                                    setExpandedItemKeys((prev) => prev.filter((key) => key !== itemKey));
                                                                }}
                                                                className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-500 transition-opacity"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Expanded Content */}
                                                    {isExpanded && (
                                                        <div className="px-6 pb-8 animate-in slide-in-from-top-2">
                                                            <div className="h-px bg-slate-100 dark:bg-slate-800 mb-8" />

                                                            {item.answer_approach && (
                                                                <div className="mb-8 p-6 rounded-2xl bg-amber-50/50 border border-amber-100 dark:bg-amber-950/10 dark:border-amber-900/30">
                                                                    <h4 className="text-xs font-black uppercase tracking-widest text-amber-700 mb-3 flex items-center gap-2">
                                                                        <Sparkles className="h-3 w-3" />
                                                                        Answer Approach
                                                                    </h4>
                                                                    <div
                                                                        className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 prose-headings:text-amber-900 dark:prose-headings:text-amber-100"
                                                                        dangerouslySetInnerHTML={{ __html: item.answer_approach }}
                                                                    />
                                                                </div>
                                                            )}
                                                            {item.model_answer && (
                                                                <div className="mb-8 p-6 rounded-2xl bg-indigo-50/50 border border-indigo-100 dark:bg-indigo-950/10 dark:border-indigo-900/30">
                                                                    <h4 className="text-xs font-black uppercase tracking-widest text-indigo-700 mb-3 flex items-center gap-2">
                                                                        <FileText className="h-3 w-3" />
                                                                        Model Answer
                                                                    </h4>
                                                                    <div
                                                                        className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 prose-headings:text-indigo-900 dark:prose-headings:text-indigo-100"
                                                                        dangerouslySetInnerHTML={{ __html: item.model_answer }}
                                                                    />
                                                                </div>
                                                            )}

                                                            <MainsAIEvaluationSection
                                                                mainsQuestionId={item.id}
                                                                questionText={item.question_text}
                                                                modelAnswer={item.model_answer}
                                                                answerFormattingGuidance={item.answer_style_guidance || undefined}
                                                                outputLanguage={outputLanguage}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                            </div>
                        </div>
                    </div>
                </div>
            </AppLayout>

            {/* Example Questions Modal */}
            {
                exampleQuestionsModalItem ? (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
                        <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col transition-all">
                            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">{exampleQuestionsModalItem.title}</h3>
                                    <p className="text-xs text-slate-500 mt-0.5">Reference Patterns for AI Generator</p>
                                </div>
                                <button
                                    type="button"
                                    className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
                                    onClick={() => setExampleQuestionsModalItem(null)}
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-4">
                                {exampleQuestionsModalItem.example_questions.map((question, index) => (
                                    <div key={index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative group overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <p className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Example {index + 1}</p>
                                        <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans leading-relaxed">{question}</pre>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
        </>
    );
}
