"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
    Loader2,
    Upload,
    FileText,
    CheckCircle,
    AlertCircle,
    RefreshCcw,
    Plus,
    ArrowUp,
    ArrowDown,
    Trash2,
    LogIn,
    Wand2,
    Send,
    Settings,
    MessageSquare
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import Image from "next/image";

import { useAuth } from "@/context/AuthContext";
import { hasGenerationSubscription } from "@/lib/accessControl";
import { OUTPUT_LANGUAGE_OPTIONS, persistOutputLanguage, readOutputLanguage, type OutputLanguage } from "@/lib/outputLanguage";
import { premiumApi } from "@/lib/premiumApi";
import type { PremiumAIExampleAnalysisListResponse } from "@/types/premium";

interface MainsAIEvaluationSectionProps {
    mainsQuestionId?: number;
    questionText: string;
    modelAnswer?: string;
    answerFormattingGuidance?: string;
    outputLanguage?: OutputLanguage;
}

interface EvaluationResult {
    score: number;
    max_score: number;
    feedback: string;
    strengths: string[];
    weaknesses: string[];
    improved_answer?: string;
}

const formatMarkdownToHtml = (text: string) => {
    if (!text) return "";
    if (text.includes("<h3") || text.includes("<p>")) return text;

    return text
        .replace(/^### (.*$)/gim, "<h3>$1</h3>")
        .replace(/^## (.*$)/gim, "<h2>$1</h2>")
        .replace(/\*\*(.*)\*\*/g, "<strong>$1</strong>")
        .replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>")
        .split("\n")
        .map((line) => {
            if (line.includes("<li>") && !text.includes("<ul>")) {
                return `<ul>${line}</ul>`;
            }
            return line;
        })
        .join("\n")
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br/>");
};

interface OcrFile {
    id: string;
    preview: string;
    base64: string;
    name: string;
}

const asStyleInstructions = (profile: Record<string, unknown> | null | undefined): string => {
    if (!profile) return "";
    const value = profile.style_instructions;
    return typeof value === "string" ? value : "";
};

const EVALUATION_PRESETS: Array<{ id: string; label: string; instructions: string }> = [
    {
        id: "balanced",
        label: "Balanced",
        instructions: "Evaluate with balanced strictness and provide concise, exam-focused improvements.",
    },
    {
        id: "strict",
        label: "UPSC Strict",
        instructions: "Apply strict UPSC mains standards, penalize missing dimensions, and prioritize precision.",
    },
    {
        id: "quick",
        label: "Quick Review",
        instructions: "Keep feedback short and actionable with top strengths, top gaps, and one improvement path.",
    },
];

const toErrorDetail = (error: unknown, fallback: string): string => {
    if (!error || typeof error !== "object") {
        return fallback;
    }
    const errorRecord = error as Record<string, unknown>;
    const response = errorRecord.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) {
        return detail;
    }
    const message = errorRecord.message;
    if (typeof message === "string" && message.trim()) {
        return message;
    }
    return fallback;
};

const MainsAIEvaluationSection: React.FC<MainsAIEvaluationSectionProps> = ({
    mainsQuestionId,
    questionText,
    modelAnswer,
    answerFormattingGuidance,
    outputLanguage: preferredOutputLanguage,
}) => {
    const { isAuthenticated, showLoginModal, user: currentUser } = useAuth();
    const [userAnswer, setUserAnswer] = useState("");
    const [isOcrLoading, setIsOcrLoading] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [result, setResult] = useState<EvaluationResult | null>(null);
    const [showOcrUpload, setShowOcrUpload] = useState(false);
    const [customInstructions, setCustomInstructions] = useState("");
    const [showInstructions, setShowInstructions] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [selectedEvaluationStyleId, setSelectedEvaluationStyleId] = useState<string>("");
    const [styleProfile, setStyleProfile] = useState<Record<string, unknown> | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [refineFeedback, setRefineFeedback] = useState("");
    const [isRefining, setIsRefining] = useState(false);
    const [formattingInstructions, setFormattingInstructions] = useState("");
    const [evaluationExampleInput, setEvaluationExampleInput] = useState("");
    const [isSaveFormatDialogOpen, setIsSaveFormatDialogOpen] = useState(false);
    const [saveFormatTitle, setSaveFormatTitle] = useState("");
    const [saveFormatDescription, setSaveFormatDescription] = useState("");
    const [isSavingFormat, setIsSavingFormat] = useState(false);
    const [ocrFiles, setOcrFiles] = useState<OcrFile[]>([]);
    const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");
    const [currentStep, setCurrentStep] = useState<number>(1);

    useEffect(() => {
        if (preferredOutputLanguage) {
            const normalized = persistOutputLanguage(preferredOutputLanguage);
            setOutputLanguage(normalized);
            return;
        }
        setOutputLanguage(readOutputLanguage());
    }, [preferredOutputLanguage]);

    const { data: evaluationStylesResponse, mutate: mutateEvaluationStyles } = useSWR<PremiumAIExampleAnalysisListResponse>(
        isAuthenticated ? `/ai/example-analyses?content_type=mains_evaluation&include_admin=true` : null,
        (url: string) => premiumApi.get(url).then((res) => res.data),
        { revalidateOnFocus: false }
    );

    const groupedStyles = useMemo(() => {
        if (!evaluationStylesResponse?.items) return { system: [], user: [] };
        return {
            system: evaluationStylesResponse.items.filter((item) => !item.author_id || item.author_id === "1"),
            user: evaluationStylesResponse.items.filter((item) => item.author_id && item.author_id === currentUser?.id),
        };
    }, [evaluationStylesResponse, currentUser]);

    const selectedEvaluationStyle = useMemo(() => {
        if (!evaluationStylesResponse?.items || !selectedEvaluationStyleId) return null;
        return evaluationStylesResponse.items.find((item) => String(item.id) === selectedEvaluationStyleId) || null;
    }, [evaluationStylesResponse, selectedEvaluationStyleId]);

    useEffect(() => {
        if (!selectedEvaluationStyleId || selectedEvaluationStyleId === "default") {
            setFormattingInstructions("");
            setStyleProfile(null);
            return;
        }
        if (selectedEvaluationStyleId === "custom") {
            return;
        }
        if (selectedEvaluationStyle) {
            setStyleProfile(selectedEvaluationStyle.style_profile || null);
            setFormattingInstructions(asStyleInstructions(selectedEvaluationStyle.style_profile));
        }
    }, [selectedEvaluationStyleId, selectedEvaluationStyle]);

    useEffect(() => {
        if (selectedEvaluationStyleId === "custom") {
            setShowAdvancedSettings(true);
        }
    }, [selectedEvaluationStyleId]);

    const handleEvaluationStyleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        setSelectedEvaluationStyleId(value);
        if (!value || value === "default") {
            setFormattingInstructions("");
            setStyleProfile(null);
            return;
        }
        if (value === "custom") {
            setFormattingInstructions("");
            setStyleProfile(null);
            setRefineFeedback("");
        }
    };

    const applyEvaluationPreset = (instructions: string) => {
        setCustomInstructions(instructions);
        setShowInstructions(true);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const newFiles: OcrFile[] = [];
        for (const file of files) {
            if (!file.type.startsWith("image/")) {
                toast.error(`"${file.name}" is not an image file.`);
                continue;
            }
            const reader = new FileReader();
            const filePromise = new Promise<OcrFile>((resolve) => {
                reader.onloadend = () => {
                    resolve({
                        id: Math.random().toString(36).substr(2, 9),
                        preview: reader.result as string,
                        base64: reader.result as string,
                        name: file.name,
                    });
                };
            });
            reader.readAsDataURL(file);
            newFiles.push(await filePromise);
        }
        setOcrFiles((prev) => [...prev, ...newFiles]);
        e.target.value = "";
    };

    const removeOcrFile = (id: string) => {
        setOcrFiles((prev) => prev.filter((f) => f.id !== id));
    };

    const moveOcrFile = (index: number, direction: "up" | "down") => {
        const newFiles = [...ocrFiles];
        const newIndex = direction === "up" ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= newFiles.length) return;
        [newFiles[index], newFiles[newIndex]] = [newFiles[newIndex], newFiles[index]];
        setOcrFiles(newFiles);
    };

    const processAllPages = async () => {
        if (ocrFiles.length === 0) return;
        setIsOcrLoading(true);
        try {
            const response = await premiumApi.post("/ai-evaluation/ocr", {
                images_base64: ocrFiles.map((f) => f.base64),
            });
            setUserAnswer((prev) => prev + (prev ? "\n\n" : "") + response.data.extracted_text);
            toast.success(`Success! Extracted text from ${ocrFiles.length} pages.`);
            setShowOcrUpload(false);
            setOcrFiles([]);
        } catch (error: unknown) {
            toast.error(toErrorDetail(error, "Failed to extract text from image"));
        } finally {
            setIsOcrLoading(false);
        }
    };

    const handleAnalyzePersona = async () => {
        if (!evaluationExampleInput.trim()) {
            toast.error("Add example", { description: "Provide an example evaluation to analyze." });
            return;
        }
        setIsAnalyzing(true);
        try {
            const resp = await premiumApi.post("/ai/style-profile", {
                content_type: "mains_evaluation",
                example_questions: [evaluationExampleInput.trim()],
                ai_provider: "gemini",
                ai_model_name: "gemini-3-flash-preview",
            });
            setStyleProfile(resp.data.style_profile);
            setFormattingInstructions(resp.data.style_profile.style_instructions || "");
            toast.success("Persona analyzed", { description: "Evaluator style is ready." });
        } catch (error: unknown) {
            toast.error("Analysis failed", {
                description: toErrorDetail(error, "Could not analyze evaluation persona."),
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleRefinePersona = async () => {
        if (!styleProfile || !refineFeedback.trim()) return;
        setIsRefining(true);
        try {
            const resp = await premiumApi.post("/ai/style-profile/refine", {
                style_profile: styleProfile,
                feedback: refineFeedback,
                ai_provider: "gemini",
                ai_model_name: "gemini-3-flash-preview",
                content_type: "mains_evaluation",
            });
            setStyleProfile(resp.data.style_profile);
            setFormattingInstructions(resp.data.style_profile.style_instructions || "");
            setRefineFeedback("");
            toast.success("Style refined");
        } catch (error: unknown) {
            toast.error("Refinement failed", {
                description: toErrorDetail(error, "Could not refine evaluator style."),
            });
        } finally {
            setIsRefining(false);
        }
    };

    const handleSaveFormat = async () => {
        if (!styleProfile || !saveFormatTitle.trim()) {
            toast.error("Missing title", { description: "Please provide a title for your saved evaluator style." });
            return;
        }

        setIsSavingFormat(true);
        try {
            const payload: Record<string, unknown> = {
                title: saveFormatTitle.trim(),
                description: saveFormatDescription.trim() || undefined,
                content_type: "mains_evaluation",
                style_profile: {
                    ...styleProfile,
                    style_instructions: formattingInstructions,
                },
                example_questions: evaluationExampleInput.trim() ? [evaluationExampleInput.trim()] : [],
                is_active: true,
            };

            await premiumApi.post("/ai/example-analyses", payload);
            toast.success("Format saved", { description: `"${saveFormatTitle.trim()}" is now available in styles.` });
            setIsSaveFormatDialogOpen(false);
            setSaveFormatTitle("");
            setSaveFormatDescription("");
            mutateEvaluationStyles();
        } catch (error: unknown) {
            toast.error("Failed to save", {
                description: toErrorDetail(error, "Could not save the format."),
            });
        } finally {
            setIsSavingFormat(false);
        }
    };

    const handleEvaluate = async () => {
        if (!isAuthenticated) {
            showLoginModal();
            return;
        }
        if (!hasGenerationSubscription(currentUser)) {
            toast.error("Active subscription required for AI evaluation.");
            return;
        }

        if (!userAnswer.trim()) {
            toast.error("Please provide an answer.");
            return;
        }

        setIsEvaluating(true);
        try {
            const response = await premiumApi.post("/ai-evaluation/evaluate-mains", {
                mains_question_id: mainsQuestionId || undefined,
                question_text: questionText,
                answer_text: userAnswer,
                model_answer: modelAnswer,
                instructions: formattingInstructions || customInstructions.trim() || undefined,
                answer_formatting_guidance: answerFormattingGuidance || undefined,
                example_evaluation_id:
                    selectedEvaluationStyleId && selectedEvaluationStyleId !== "default" && selectedEvaluationStyleId !== "custom"
                        ? Number(selectedEvaluationStyleId)
                        : undefined,
                output_language: outputLanguage,
            });

            setResult(response.data);
            toast.success("Evaluation complete!");
        } catch (error: unknown) {
            toast.error("Failed to evaluate answer", { description: toErrorDetail(error, "Could not evaluate answer.") });
        } finally {
            setIsEvaluating(false);
        }
    };
    const getWordCount = (text: string) => {
        return text.trim().split(/\s+/).filter(Boolean).length;
    };

    return (
        <div className="mt-12 space-y-6 max-w-4xl mx-auto font-sans">
            <div className="rounded-3xl border border-indigo-100 overflow-hidden shadow-2xl bg-slate-50/50 backdrop-blur-md">
                <div className="bg-white border-b border-indigo-50 p-4 shrink-0 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md">
                            <Wand2 className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                AI Evaluator
                                <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                            </h3>
                            <p className="text-[10px] sm:text-xs text-slate-500 font-medium">Ready to review your answer</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowAdvancedSettings((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        <Settings className="h-3.5 w-3.5" />
                        {showAdvancedSettings ? "Hide Settings" : "Show Settings"}
                    </button>
                </div>

                <div className="p-4 sm:p-6 md:p-8 space-y-6">
                    {/* Bot greeting */}
                    <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex gap-3 max-w-[90%] md:max-w-[85%]">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm mt-1 hidden sm:flex">
                                <Wand2 className="h-4 w-4 text-white" />
                            </div>
                            <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200 shadow-sm p-4 md:p-5 text-sm md:text-[15px] text-slate-700 space-y-3 leading-relaxed">
                                <p className="font-semibold text-slate-900">Hi there! I&apos;m your AI Evaluator.</p>
                                <p>Please provide the answer you would like me to evaluate. You can type it, paste it, or upload photos of your handwritten answer.</p>
                            </div>
                        </div>
                    </div>

                    {/* Step 1: User Answer Input */}
                    <div className="flex w-full justify-end animate-in fade-in slide-in-from-bottom-2">
                        <div className="w-full max-w-[95%] sm:max-w-[90%] md:max-w-[85%] space-y-3">
                            <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-all">
                                <div className="flex justify-between items-center px-2 pt-2 mb-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-2">Your Answer</span>
                                    <button
                                        onClick={() => setShowOcrUpload(!showOcrUpload)}
                                        className="inline-flex items-center rounded-lg px-2 sm:px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                    >
                                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">{showOcrUpload ? "Hide Upload" : "Upload OCR"}</span>
                                        <span className="sm:hidden">{showOcrUpload ? "Hide" : "OCR"}</span>
                                    </button>
                                </div>
                                <textarea
                                    value={userAnswer}
                                    onChange={(e) => setUserAnswer(e.target.value)}
                                    placeholder="Write or paste your answer here..."
                                    className="w-full min-h-[200px] sm:min-h-[250px] p-3 text-sm sm:text-base leading-relaxed resize-y outline-none bg-transparent"
                                />
                                {currentStep === 1 && (
                                    <div className="flex justify-end p-2 border-t border-slate-50 mt-2">
                                        <button
                                            onClick={() => {
                                                if (!userAnswer.trim() && ocrFiles.length === 0) {
                                                    toast.error("Please provide an answer first.");
                                                    return;
                                                }
                                                setCurrentStep(2);
                                            }}
                                            className="inline-flex items-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 shadow-md transition-all active:scale-95"
                                        >
                                            Next Step
                                            <Send className="ml-2 h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {showOcrUpload && (
                                <div className="p-5 sm:p-6 border-2 border-dashed border-indigo-200 rounded-2xl bg-white animate-in zoom-in-95 duration-200 relative">
                                    <button onClick={() => setShowOcrUpload(false)} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                    <div className="space-y-6">
                                        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                                            <div className="p-3 rounded-full bg-indigo-50 mb-3 text-indigo-600">
                                                <Upload className="h-6 w-6" />
                                            </div>
                                            <h4 className="font-bold text-slate-800 text-lg">Multi-Page Upload</h4>
                                            <p className="text-sm text-slate-500 mb-5">Select or capture all pages of your answer in order.</p>

                                            <label className="cursor-pointer">
                                                <div className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-md flex items-center justify-center gap-2 w-full sm:w-auto">
                                                    <Plus className="h-4 w-4" />
                                                    Select Photos
                                                </div>
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    accept="image/*"
                                                    multiple
                                                    onChange={handleFileChange}
                                                    disabled={isOcrLoading}
                                                />
                                            </label>
                                        </div>

                                        {ocrFiles.length > 0 && (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                                    {ocrFiles.map((file, index) => (
                                                        <div
                                                            key={file.id}
                                                            className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100"
                                                        >
                                                            <Image
                                                                src={file.preview}
                                                                alt="Page"
                                                                width={40}
                                                                height={56}
                                                                unoptimized
                                                                className="w-10 h-14 object-cover rounded shadow-sm border border-slate-200"
                                                            />
                                                            <div className="flex-grow min-w-0">
                                                                <p className="text-xs font-bold text-slate-700 truncate">Page {index + 1}</p>
                                                            </div>
                                                            <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 shadow-sm p-0.5">
                                                                <button
                                                                    className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 transition-colors"
                                                                    onClick={() => moveOcrFile(index, "up")}
                                                                    disabled={index === 0}
                                                                >
                                                                    <ArrowUp className="h-3 w-3" />
                                                                </button>
                                                                <button
                                                                    className="h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 transition-colors"
                                                                    onClick={() => moveOcrFile(index, "down")}
                                                                    disabled={index === ocrFiles.length - 1}
                                                                >
                                                                    <ArrowDown className="h-3 w-3" />
                                                                </button>
                                                                <button
                                                                    className="h-7 w-7 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                                    onClick={() => removeOcrFile(file.id)}
                                                                >
                                                                    <Trash2 className="h-3 w-3" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex justify-center sm:justify-start pt-2">
                                                    <button
                                                        onClick={processAllPages}
                                                        disabled={isOcrLoading}
                                                        className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 shadow-md transition-all active:scale-95"
                                                    >
                                                        {isOcrLoading ? (
                                                            <Loader2 className="animate-spin mr-2 h-4 w-4" />
                                                        ) : (
                                                            <FileText className="mr-2 h-4 w-4" />
                                                        )}
                                                        Extract Text Content
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {currentStep >= 2 && (
                        <>
                            <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2">
                                <div className="flex gap-3 max-w-[90%] md:max-w-[85%]">
                                    <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm mt-1 hidden sm:flex">
                                        <Wand2 className="h-4 w-4 text-white" />
                                    </div>
                                    <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200 shadow-sm p-4 md:p-5 text-sm md:text-[15px] text-slate-700 space-y-3 leading-relaxed">
                                        <p>Got it! Now, how should I evaluate this? Choose an <strong className="text-indigo-700">evaluation persona</strong> and any specific instructions you want me to follow.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Step 2: Settings Input */}
                            <div className="flex w-full justify-end animate-in fade-in slide-in-from-bottom-2">
                                <div className="w-full max-w-[95%] sm:max-w-[85%] space-y-3 bg-white border border-slate-200 shadow-sm rounded-2xl rounded-tr-sm p-4 sm:p-5 text-left">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Settings className="h-5 w-5 text-indigo-500" />
                                        <h4 className="font-bold text-slate-800">Evaluation Settings</h4>
                                    </div>
                                    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Default Evaluator Modes</p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {EVALUATION_PRESETS.map((preset) => (
                                                <button
                                                    key={preset.id}
                                                    type="button"
                                                    onClick={() => applyEvaluationPreset(preset.instructions)}
                                                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="grid md:grid-cols-2 gap-5">
                                        <div className="space-y-1.5 flex flex-col text-left">
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide text-left block">Evaluation Persona</label>
                                            <select
                                                value={selectedEvaluationStyleId}
                                                onChange={handleEvaluationStyleChange}
                                                className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-colors"
                                            >
                                                <option value="default">Default Evaluator</option>
                                                <option value="custom">Create Custom Persona</option>
                                                {groupedStyles.system.length > 0 && (
                                                    <optgroup label="Standard Personas">
                                                        {groupedStyles.system.map((item) => (
                                                            <option key={item.id} value={String(item.id)}>
                                                                {item.title}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                                {groupedStyles.user.length > 0 && (
                                                    <optgroup label="My Custom Personas">
                                                        {groupedStyles.user.map((item) => (
                                                            <option key={item.id} value={String(item.id)}>
                                                                {item.title}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                        </div>

                                        <div className="space-y-1.5 flex flex-col text-left">
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide text-left block">Output Language</label>
                                            <select
                                                value={outputLanguage}
                                                onChange={(event) => {
                                                    const next = persistOutputLanguage(event.target.value);
                                                    setOutputLanguage(next);
                                                }}
                                                className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-colors"
                                            >
                                                {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-1.5 md:col-span-2 flex flex-col text-left">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide text-left block">Additional Instructions</label>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowAdvancedSettings((prev) => !prev)}
                                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                                                >
                                                    {showAdvancedSettings ? "Hide" : "Advanced"}
                                                </button>
                                            </div>
                                            {showAdvancedSettings || selectedEvaluationStyleId === "custom" ? (
                                                <>
                                                    {showInstructions || selectedEvaluationStyleId === "custom" ? null : (
                                                        <button
                                                            onClick={() => setShowInstructions(true)}
                                                            className="w-full inline-flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 h-11 px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                                                        >
                                                            <Plus className="mr-2 h-4 w-4" />
                                                            Add specific instructions
                                                        </button>
                                                    )}
                                                    {(showInstructions || selectedEvaluationStyleId === "custom") && selectedEvaluationStyleId !== "custom" && (
                                                        <div className="relative">
                                                            <textarea
                                                                value={customInstructions}
                                                                onChange={(e) => setCustomInstructions(e.target.value)}
                                                                placeholder="Any specific instructions for this evaluation..."
                                                                className="w-full min-h-[100px] rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-colors"
                                                            />
                                                            <button onClick={() => setShowInstructions(false)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 bg-white rounded-md shadow-sm border border-slate-100">
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <p className="text-xs text-slate-500">Using default persona guidance. Open Advanced to override.</p>
                                            )}
                                        </div>
                                    </div>

                                    {answerFormattingGuidance ? (
                                        <div className="bg-indigo-50/50 rounded-lg p-3 border border-indigo-100 mt-4 flex gap-2">
                                            <AlertCircle className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                                            <p className="text-xs text-indigo-700 leading-relaxed text-left">
                                                Improved answer will follow your active answer-writing style guidance.
                                            </p>
                                        </div>
                                    ) : null}

                                    {selectedEvaluationStyleId === "custom" && (
                                        <div className="space-y-4 p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 mt-4 text-left">
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[11px] font-black text-indigo-800 uppercase tracking-widest">Analysis Source</label>
                                                    <button
                                                        className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-60 flex items-center gap-1 bg-indigo-100 px-2.5 py-1 rounded-md transition-colors"
                                                        onClick={handleAnalyzePersona}
                                                        disabled={isAnalyzing}
                                                    >
                                                        {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                                                        {isAnalyzing ? "Analyzing..." : "Analyze Example"}
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={evaluationExampleInput}
                                                    onChange={(e) => setEvaluationExampleInput(e.target.value)}
                                                    placeholder="Paste an evaluation to mimic..."
                                                    className="w-full min-h-[100px] rounded-xl border border-indigo-200 p-3 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                                                />
                                            </div>

                                            {styleProfile && (
                                                <div className="space-y-3 pt-4 border-t border-indigo-200">
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Persona Logic</div>
                                                        <button
                                                            className="text-[11px] font-bold text-white bg-slate-800 hover:bg-slate-900 px-3 py-1 rounded-md transition-colors shadow-sm"
                                                            onClick={() => setIsSaveFormatDialogOpen(true)}
                                                        >
                                                            Save Style
                                                        </button>
                                                    </div>

                                                    {/* Save Format Dialog */}
                                                    {isSaveFormatDialogOpen && (
                                                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm transition-opacity">
                                                            <div className="w-full max-w-md rounded-2xl bg-white p-6 md:p-8 shadow-2xl animate-in fade-in zoom-in-95 text-left">
                                                                <h4 className="text-xl font-bold text-slate-900">Save Evaluation Persona</h4>
                                                                <p className="mt-2 text-sm text-slate-500">Give it a name so you can easily reuse it later.</p>
                                                                <div className="mt-6 space-y-4 text-left">
                                                                    <div className="space-y-1.5 flex flex-col text-left">
                                                                        <label className="text-xs font-bold text-slate-700 block">Persona Name</label>
                                                                        <input
                                                                            value={saveFormatTitle}
                                                                            onChange={(e) => setSaveFormatTitle(e.target.value)}
                                                                            placeholder="e.g. Sharp GS2 Evaluator"
                                                                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                                                                        />
                                                                    </div>
                                                                    <div className="space-y-1.5 flex flex-col text-left">
                                                                        <label className="text-xs font-bold text-slate-700 block">Description (Optional)</label>
                                                                        <textarea
                                                                            value={saveFormatDescription}
                                                                            onChange={(e) => setSaveFormatDescription(e.target.value)}
                                                                            placeholder="What makes this persona unique?"
                                                                            className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-colors"
                                                                            rows={3}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="mt-8 flex justify-end gap-3">
                                                                    <button
                                                                        onClick={() => setIsSaveFormatDialogOpen(false)}
                                                                        className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        onClick={handleSaveFormat}
                                                                        disabled={isSavingFormat}
                                                                        className="inline-flex items-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-70 shadow-md transition-colors"
                                                                    >
                                                                        {isSavingFormat ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                                                        {isSavingFormat ? "Saving..." : "Save Persona"}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <textarea
                                                        value={formattingInstructions}
                                                        onChange={(e) => setFormattingInstructions(e.target.value)}
                                                        className="w-full min-h-[120px] rounded-xl border border-indigo-100 bg-white p-3 text-[12px] font-mono outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 leading-relaxed shadow-inner"
                                                    />
                                                    <div className="flex gap-2 text-left">
                                                        <input
                                                            value={refineFeedback}
                                                            onChange={(e) => setRefineFeedback(e.target.value)}
                                                            placeholder="Tell me how to refine this logic..."
                                                            className="flex-grow rounded-xl border border-indigo-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                                        />
                                                        <button
                                                            className="rounded-xl bg-slate-800 text-white px-4 py-2 text-sm font-bold hover:bg-slate-900 transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center"
                                                            onClick={handleRefinePersona}
                                                            disabled={isRefining || !refineFeedback.trim()}
                                                        >
                                                            {isRefining ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                                                            {isRefining ? "Refining..." : "Refine"}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {currentStep === 2 && (
                                        <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-slate-100 mt-6 gap-4">
                                            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 w-full sm:w-auto justify-center">
                                                <MessageSquare className="h-4 w-4" />
                                                <span>{getWordCount(userAnswer)} words detected</span>
                                            </div>
                                            <button
                                                disabled={isEvaluating}
                                                onClick={handleEvaluate}
                                                className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white px-8 py-3 text-base font-bold shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-70"
                                            >
                                                {isEvaluating ? (
                                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                ) : !isAuthenticated ? (
                                                    <LogIn className="mr-2 h-5 w-5" />
                                                ) : (
                                                    <CheckCircle className="mr-2 h-5 w-5" />
                                                )}
                                                {isEvaluating
                                                    ? "Evaluating Answer..."
                                                    : !isAuthenticated
                                                        ? "Sign In to Evaluate"
                                                        : "Evaluate My Answer"}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Step 3: Result */}
                    {isEvaluating && (
                        <div className="flex w-full justify-start mb-6 animate-in fade-in slide-in-from-bottom-2">
                            <div className="flex gap-3 max-w-[85%]">
                                <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm mt-1">
                                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                                </div>
                                <div className="rounded-2xl rounded-tl-sm bg-white border border-indigo-100 shadow-sm p-4 text-sm text-indigo-700 space-y-1 font-medium flex items-center">
                                    <span className="relative flex h-3 w-3 mr-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                                    </span>
                                    Analyzing your answer...
                                </div>
                            </div>
                        </div>
                    )}

                    {result && !isEvaluating && (
                        <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2">
                            <div className="flex gap-3 w-full">
                                <div className="h-8 w-8 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 flex items-center justify-center shrink-0 shadow-sm mt-1 hidden md:flex">
                                    <CheckCircle className="h-4 w-4 text-white" />
                                </div>
                                <div className="w-full space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <div className="rounded-3xl border border-emerald-100 bg-gradient-to-b from-emerald-50 to-white pt-8 pb-6 px-4 flex flex-col items-center justify-center shadow-lg shadow-emerald-100/50">
                                            <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest mb-3">Overall Score</p>
                                            <div className="text-7xl font-black text-emerald-600 leading-none tracking-tighter shrink-0 mb-1">
                                                {result.score}
                                                <span className="text-3xl text-emerald-300 font-bold tracking-normal align-top">/{result.max_score}</span>
                                            </div>
                                        </div>

                                        <div className="md:col-span-2 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xl shadow-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 text-left">
                                            <div>
                                                <h4 className="flex items-center gap-2 font-bold mb-4 text-emerald-600 text-lg border-b border-emerald-100 pb-2 text-left">
                                                    <CheckCircle className="h-5 w-5" /> Strengths
                                                </h4>
                                                <ul className="space-y-3 text-[14px] text-slate-700 text-left">
                                                    {result.strengths.map((s, i) => (
                                                        <li key={i} className="flex gap-2.5 leading-relaxed">
                                                            <span className="text-emerald-500 font-black shrink-0 mt-0.5">+</span>
                                                            <span className="opacity-90">{s}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                            <div>
                                                <h4 className="flex items-center gap-2 font-bold mb-4 text-amber-600 text-lg border-b border-amber-100 pb-2 text-left">
                                                    <AlertCircle className="h-5 w-5" /> To Improve
                                                </h4>
                                                <ul className="space-y-3 text-[14px] text-slate-700 text-left">
                                                    {result.weaknesses.map((w, i) => (
                                                        <li key={i} className="flex gap-2.5 leading-relaxed">
                                                            <span className="text-amber-500 font-black shrink-0 mt-0.5">!</span>
                                                            <span className="opacity-90">{w}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-10 shadow-xl shadow-slate-100 relative overflow-hidden text-left">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-[100px] -z-10"></div>
                                        <h3 className="text-2xl font-serif font-bold text-slate-900 border-b border-slate-100 pb-5 mb-6 text-left">Detailed Evaluation Report</h3>
                                        <div
                                            className="prose prose-indigo prose-p:leading-loose prose-li:leading-loose max-w-none text-slate-700 font-hindi-secondary text-[15px] sm:text-base text-left"
                                            dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(result.feedback) }}
                                        />
                                    </div>

                                    {result.improved_answer && (
                                        <div className="rounded-3xl border-2 border-indigo-100 bg-indigo-50/30 p-6 sm:p-10 shadow-xl shadow-indigo-100/50 relative overflow-hidden text-left">
                                            <div className="absolute top-0 right-0 p-4">
                                                <div className="bg-indigo-100 text-indigo-700 px-3 py-1 text-xs font-bold rounded-full uppercase tracking-wider">Reference</div>
                                            </div>
                                            <h3 className="text-xl font-serif font-bold text-indigo-900 border-b border-indigo-100 pb-4 mb-6 text-left">Improved Model Answer</h3>
                                            <div
                                                className="prose prose-indigo prose-p:leading-loose prose-li:leading-loose max-w-none text-slate-800 text-[15px] sm:text-base text-left"
                                                dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(result.improved_answer) }}
                                            />
                                        </div>
                                    )}

                                    <div className="flex justify-center pt-4 pb-2">
                                        <button
                                            onClick={() => {
                                                setResult(null);
                                                setCurrentStep(1);
                                                setUserAnswer("");
                                                setOcrFiles([]);
                                            }}
                                            className="inline-flex items-center text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 text-sm font-bold bg-white px-6 py-2.5 rounded-full border border-slate-200 shadow-sm transition-all hover:shadow hover:border-indigo-200"
                                        >
                                            <RefreshCcw className="mr-2 h-4 w-4" />
                                            Evaluate Another Answer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MainsAIEvaluationSection;
