"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { premiumApi } from "@/lib/premiumApi";
import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { PremiumAIExampleAnalysis, PremiumAIContentType, PremiumAIQuizInstruction } from "@/types/premium";

function normalizeTag(value?: string | null): string {
    return String(value ?? "").trim().toLowerCase();
}

export default function StyleAnalysisPage() {
    const [analyses, setAnalyses] = useState<PremiumAIExampleAnalysis[]>([]);
    const [instructionSettings, setInstructionSettings] = useState<PremiumAIQuizInstruction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    // Form State
    const [title, setTitle] = useState("");
    const [contentType, setContentType] = useState<PremiumAIContentType>("mains_evaluation");
    const [examples, setExamples] = useState("");
    const [styleProfile, setStyleProfile] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [tagLevel1, setTagLevel1] = useState("");
    const [tagLevel2, setTagLevel2] = useState("");
    const [analysisPrompt, setAnalysisPrompt] = useState("");
    const [filterTagLevel1, setFilterTagLevel1] = useState("");
    const [filterTagLevel2, setFilterTagLevel2] = useState("");
    const [questionStyleInstructions, setQuestionStyleInstructions] = useState("");
    const [answerStyleInstructions, setAnswerStyleInstructions] = useState("");

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingUniversalPrompt, setIsSavingUniversalPrompt] = useState(false);

    const tagHierarchy = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const item of analyses) {
            const l1 = normalizeTag(item.tag_level1);
            const l2 = normalizeTag(item.tag_level2);
            if (!l1) continue;
            if (!map.has(l1)) map.set(l1, new Set());
            if (l2) map.get(l1)?.add(l2);
        }
        return {
            level1: Array.from(map.keys()).sort((a, b) => a.localeCompare(b)),
            level2ByLevel1: map,
        };
    }, [analyses]);

    const filteredAnalyses = useMemo(() => {
        return analyses.filter((item) => {
            const l1Match = !filterTagLevel1 || normalizeTag(item.tag_level1) === normalizeTag(filterTagLevel1);
            const l2Match = !filterTagLevel2 || normalizeTag(item.tag_level2) === normalizeTag(filterTagLevel2);
            return l1Match && l2Match;
        });
    }, [analyses, filterTagLevel1, filterTagLevel2]);

    const currentInstructionSetting = useMemo(() => {
        return instructionSettings.find((item) => item.content_type === contentType) || null;
    }, [instructionSettings, contentType]);
    const isMainsQuestionGeneration = contentType === "mains_question_generation";

    useEffect(() => {
        loadAnalyses();
    }, []);

    useEffect(() => {
        loadInstructionSettings();
    }, []);

    useEffect(() => {
        setAnalysisPrompt(String(currentInstructionSetting?.style_analysis_system_prompt || "").trim());
    }, [currentInstructionSetting?.id, currentInstructionSetting?.style_analysis_system_prompt]);

    useEffect(() => {
        if (filteredAnalyses.length === 0) return;
        if (selectedId && !filteredAnalyses.some((item) => item.id === selectedId)) {
            setSelectedId(filteredAnalyses[0].id);
        }
    }, [filteredAnalyses, selectedId]);

    const loadAnalyses = async () => {
        try {
            const res = await premiumApi.get("/ai/example-analyses?limit=50");
            setAnalyses(res.data.items);
        } catch {
            toast.error("Failed to load analyses");
        } finally {
            setIsLoading(false);
        }
    };

    const loadInstructionSettings = async () => {
        try {
            const response = await legacyPremiumAiApi.get<PremiumAIQuizInstruction[]>("/admin/premium-ai-settings/");
            setInstructionSettings(Array.isArray(response.data) ? response.data : []);
        } catch {
            toast.error("Failed to load universal style-analysis prompts.");
        }
    };

    const resetForm = useCallback(() => {
        const mainsDefaultPrompt = String(
            instructionSettings.find((item) => item.content_type === "mains_evaluation")?.style_analysis_system_prompt || "",
        ).trim();
        setTitle("");
        setContentType("mains_evaluation");
        setExamples("");
        setStyleProfile("{}");
        setTags([]);
        setTagLevel1("");
        setTagLevel2("");
        setAnalysisPrompt(mainsDefaultPrompt);
        setQuestionStyleInstructions("");
        setAnswerStyleInstructions("");
    }, [instructionSettings]);

    useEffect(() => {
        if (selectedId) {
            const item = analyses.find(a => a.id === selectedId);
            if (item) {
                setTitle(item.title);
                setContentType(item.content_type);
                setExamples((item.example_questions || []).join("\n\n---\n\n"));
                setStyleProfile(JSON.stringify(item.style_profile, null, 2));
                const parsedProfile = item.style_profile || {};
                setQuestionStyleInstructions(
                    String(
                        parsedProfile.question_style_instructions
                        || parsedProfile.question_style
                        || parsedProfile.style_instructions
                        || "",
                    ),
                );
                setAnswerStyleInstructions(
                    String(parsedProfile.answer_style_instructions || parsedProfile.answer_style || ""),
                );
                setTags(item.tags || []);
                setTagLevel1(item.tag_level1 || "");
                setTagLevel2(item.tag_level2 || "");
            }
        } else {
            resetForm();
        }
    }, [selectedId, analyses, resetForm]);

    const handleCreateNew = () => {
        setSelectedId(null);
        resetForm();
    };

    const handleAnalyze = async () => {
        if (!examples.trim()) {
            toast.error("Please provide examples to analyze");
            return;
        }
        setIsAnalyzing(true);
        try {
            // Split examples by separator if needed, or send as list
            const exampleList = examples.split(/\n-{3,}\n/).map(e => e.trim()).filter(Boolean);
            const analysisPayload: Record<string, unknown> = {
                content_type: contentType,
                example_questions: exampleList.length > 0 ? exampleList : [examples],
                ai_provider: "gemini",
            };
            if (!currentInstructionSetting && analysisPrompt.trim()) {
                analysisPayload.style_analysis_prompt = analysisPrompt.trim();
            }

            const res = await premiumApi.post("/ai/style-profile", analysisPayload);

            if (res.data && res.data.style_profile) {
                setStyleProfile(JSON.stringify(res.data.style_profile, null, 2));
                if (contentType === "mains_question_generation") {
                    const parsedProfile = res.data.style_profile as Record<string, unknown>;
                    setQuestionStyleInstructions(
                        String(
                            parsedProfile.question_style_instructions
                            || parsedProfile.question_style
                            || parsedProfile.style_instructions
                            || "",
                        ),
                    );
                    setAnswerStyleInstructions(
                        String(parsedProfile.answer_style_instructions || parsedProfile.answer_style || ""),
                    );
                }
                toast.success("Style analysis complete");
            }
        } catch {
            toast.error("Analysis failed");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSaveUniversalPrompt = async () => {
        if (!currentInstructionSetting) {
            toast.error("No AI instruction found for this content type. Create one in Premium AI Settings first.");
            return;
        }

        setIsSavingUniversalPrompt(true);
        try {
            const response = await legacyPremiumAiApi.put<PremiumAIQuizInstruction>(
                `/admin/premium-ai-settings/${currentInstructionSetting.id}`,
                { style_analysis_system_prompt: analysisPrompt.trim() || null },
            );
            const updated = response.data;
            setInstructionSettings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            toast.success("Universal style-analysis prompt saved.");
        } catch {
            toast.error("Failed to save universal style-analysis prompt.");
        } finally {
            setIsSavingUniversalPrompt(false);
        }
    };

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error("Please enter a title");
            return;
        }
        if (tagLevel2.trim() && !tagLevel1.trim()) {
            toast.error("Tag level 1 is required when tag level 2 is set.");
            return;
        }

        let profileJson = {};
        try {
            profileJson = JSON.parse(styleProfile);
        } catch {
            toast.error("Invalid JSON in Style Profile");
            return;
        }
        if (contentType === "mains_question_generation") {
            const profileRecord = profileJson as Record<string, unknown>;
            const questionStyle = questionStyleInstructions.trim();
            const answerStyle = answerStyleInstructions.trim();

            if (questionStyle) {
                profileRecord.question_style_instructions = questionStyle;
                if (!String(profileRecord.style_instructions || "").trim()) {
                    profileRecord.style_instructions = questionStyle;
                }
            } else {
                delete profileRecord.question_style_instructions;
            }

            if (answerStyle) {
                profileRecord.answer_style_instructions = answerStyle;
            } else {
                delete profileRecord.answer_style_instructions;
            }
        }

        setIsSaving(true);
        try {
            const exampleList = examples.split(/\n-{3,}\n/).map(e => e.trim()).filter(Boolean);
            const payload = {
                title,
                content_type: contentType,
                example_questions: exampleList.length > 0 ? exampleList : [examples],
                style_profile: profileJson,
                tags: tags,
                tag_level1: normalizeTag(tagLevel1) || null,
                tag_level2: normalizeTag(tagLevel2) || null,
                is_active: true
            };

            if (selectedId) {
                await premiumApi.put(`/ai/example-analyses/${selectedId}`, payload);
                toast.success("Updated successfully");
            } else {
                await premiumApi.post("/ai/example-analyses", payload);
                toast.success("Created successfully");
            }
            loadAnalyses();
        } catch {
            toast.error("Failed to save");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this analysis?")) return;
        try {
            await premiumApi.delete(`/ai/example-analyses/${id}`);
            toast.success("Deleted successfully");
            if (selectedId === id) setSelectedId(null);
            loadAnalyses();
        } catch {
            toast.error("Failed to delete");
        }
    };

    return (
        <AdminOnly>
            <AppLayout adminNav>
                <div className="container mx-auto p-6 max-w-7xl">
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">Style Analysis Studio</h1>
                            <p className="text-slate-500 mt-1">
                                Analyze examples to extract and save AI style profiles. The style-analysis prompt is shared per content type and reused across all analyses.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Sidebar List */}
                        <div className="lg:col-span-3 space-y-4">
                            <button
                                onClick={handleCreateNew}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors"
                            >
                                <Plus className="h-4 w-4" />
                                New Analysis
                            </button>

                            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tag Filters</p>
                                <select
                                    className="w-full rounded border border-slate-300 px-2 py-2 text-xs"
                                    value={filterTagLevel1}
                                    onChange={(e) => {
                                        setFilterTagLevel1(e.target.value);
                                        setFilterTagLevel2("");
                                    }}
                                >
                                    <option value="">All L1 tags</option>
                                    {tagHierarchy.level1.map((tag) => (
                                        <option key={tag} value={tag}>{tag}</option>
                                    ))}
                                </select>
                                <select
                                    className="w-full rounded border border-slate-300 px-2 py-2 text-xs"
                                    value={filterTagLevel2}
                                    onChange={(e) => setFilterTagLevel2(e.target.value)}
                                    disabled={!filterTagLevel1}
                                >
                                    <option value="">All L2 tags</option>
                                    {filterTagLevel1 &&
                                        Array.from(tagHierarchy.level2ByLevel1.get(normalizeTag(filterTagLevel1)) || []).map((tag) => (
                                            <option key={tag} value={tag}>{tag}</option>
                                        ))}
                                </select>
                            </div>

                            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                {isLoading ? (
                                    <div className="p-8 text-center text-slate-400">Loading...</div>
                                ) : filteredAnalyses.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400">No analyses yet.</div>
                                ) : (
                                    <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                                        {filteredAnalyses.map(item => (
                                            <div
                                                key={item.id}
                                                onClick={() => setSelectedId(item.id)}
                                                className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors group ${selectedId === item.id ? 'bg-indigo-50 hover:bg-indigo-50' : ''}`}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h3 className={`font-bold text-sm ${selectedId === item.id ? 'text-indigo-700' : 'text-slate-700'}`}>{item.title}</h3>
                                                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                                            {item.content_type.replace(/_/g, " ")}
                                                        </span>
                                                        {(item.tag_level1 || item.tag_level2) ? (
                                                            <p className="mt-1 text-[10px] font-semibold text-slate-500">
                                                                {[item.tag_level1, item.tag_level2].filter(Boolean).join(" / ")}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Editor Area */}
                        <div className="lg:col-span-9 space-y-6">
                            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold uppercase text-slate-400">Title</label>
                                            <input
                                                type="text"
                                                value={title}
                                                onChange={(e) => setTitle(e.target.value)}
                                                className="w-full text-lg font-bold border-b-2 border-slate-200 py-1 focus:border-indigo-500 focus:outline-none bg-transparent"
                                                placeholder="e.g. Drishti IAS Mains Style"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold uppercase text-slate-400">Content Type</label>
                                            <select
                                                value={contentType}
                                                onChange={(e) => setContentType(e.target.value as PremiumAIContentType)}
                                                className="w-full p-2 rounded-lg border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                            >
                                                <option value="mains_evaluation">Mains Evaluation</option>
                                                <option value="mains_question_generation">Mains Question Generation</option>
                                                <option value="premium_gk_quiz">GK Quiz</option>
                                                <option value="premium_maths_quiz">Maths Quiz</option>
                                                <option value="premium_passage_quiz">Passage Quiz</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold uppercase text-slate-400">Tag Level 1</label>
                                            <input
                                                type="text"
                                                value={tagLevel1}
                                                onChange={(e) => {
                                                    setTagLevel1(e.target.value);
                                                    if (!e.target.value.trim()) setTagLevel2("");
                                                }}
                                                className="w-full text-sm border-b-2 border-slate-200 py-1 focus:border-indigo-500 focus:outline-none bg-transparent"
                                                placeholder="e.g. assertion reasoning"
                                                list="style-l1-tags"
                                            />
                                            <datalist id="style-l1-tags">
                                                {tagHierarchy.level1.map((tag) => (
                                                    <option key={tag} value={tag} />
                                                ))}
                                            </datalist>
                                            <div className="mt-2 flex flex-wrap gap-1.5 pt-1">
                                                {tagHierarchy.level1.map((tag) => (
                                                    <button
                                                        key={`btn-l1-${tag}`}
                                                        type="button"
                                                        onClick={() => {
                                                            setTagLevel1(tag);
                                                            setTagLevel2("");
                                                        }}
                                                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                                                    >
                                                        {tag}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold uppercase text-slate-400">Tag Level 2</label>
                                            <input
                                                type="text"
                                                value={tagLevel2}
                                                onChange={(e) => setTagLevel2(e.target.value)}
                                                className="w-full text-sm border-b-2 border-slate-200 py-1 focus:border-indigo-500 focus:outline-none bg-transparent"
                                                placeholder="e.g. statement pair"
                                                list="style-l2-tags"
                                                disabled={!tagLevel1.trim()}
                                            />
                                            <datalist id="style-l2-tags">
                                                {tagLevel1 &&
                                                    Array.from(tagHierarchy.level2ByLevel1.get(normalizeTag(tagLevel1)) || []).map((tag) => (
                                                        <option key={tag} value={tag} />
                                                    ))}
                                            </datalist>
                                            <div className="mt-2 flex flex-wrap gap-1.5 pt-1">
                                                {tagLevel1 &&
                                                    Array.from(tagHierarchy.level2ByLevel1.get(normalizeTag(tagLevel1)) || []).map((tag) => (
                                                        <button
                                                            key={`btn-l2-${tag}`}
                                                            type="button"
                                                            onClick={() => setTagLevel2(tag)}
                                                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                                                        >
                                                            {tag}
                                                        </button>
                                                    ))}
                                            </div>
                                        </div>
                                        <div className="space-y-1 md:col-span-2">
                                            <label className="text-xs font-bold uppercase text-slate-400">Additional Tags (Comma separated)</label>
                                            <input
                                                type="text"
                                                value={tags.join(", ")}
                                                onChange={(e) => setTags(e.target.value.split(",").map(t => t.trim()).filter(Boolean))}
                                                className="w-full text-sm border-b-2 border-slate-200 py-1 focus:border-indigo-500 focus:outline-none bg-transparent"
                                                placeholder="e.g. upsc, prelims, environment"
                                            />
                                        </div>
                                        <div className="space-y-1 md:col-span-2">
                                            <label className="text-xs font-bold uppercase text-slate-400">Universal Style Analysis Prompt (Per Content Type)</label>
                                            <textarea
                                                value={analysisPrompt}
                                                onChange={(e) => setAnalysisPrompt(e.target.value)}
                                                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-indigo-500 focus:outline-none"
                                                placeholder="Default prompt used for all analyses of this selected content type."
                                                rows={3}
                                            />
                                            <div className="mt-2 flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleSaveUniversalPrompt}
                                                    disabled={isSavingUniversalPrompt || !currentInstructionSetting}
                                                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                                >
                                                    {isSavingUniversalPrompt ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                                                    Save as Default Prompt
                                                </button>
                                                <p className="text-xs text-slate-500">
                                                    {currentInstructionSetting
                                                        ? "This default prompt will be reused for every example analysis in this content type."
                                                        : "Create a matching instruction in Premium AI Settings to persist this default prompt."}
                                                </p>
                                            </div>
                                        </div>
                                        {isMainsQuestionGeneration ? (
                                            <div className="space-y-4 md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                                    Mains Generation Split Style
                                                </p>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-xs font-bold uppercase text-slate-400">
                                                            Question Style Instructions
                                                        </label>
                                                        <textarea
                                                            value={questionStyleInstructions}
                                                            onChange={(e) => setQuestionStyleInstructions(e.target.value)}
                                                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-indigo-500 focus:outline-none bg-white min-h-[110px]"
                                                            placeholder="How question framing, directive, structure, and demand analysis should be styled."
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs font-bold uppercase text-slate-400">
                                                            Answer Style Instructions
                                                        </label>
                                                        <textarea
                                                            value={answerStyleInstructions}
                                                            onChange={(e) => setAnswerStyleInstructions(e.target.value)}
                                                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-indigo-500 focus:outline-none bg-white min-h-[110px]"
                                                            placeholder="How answer_approach/model_answer should be styled: depth, tone, structure, evidence, balance."
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Examples Column */}
                                        <div className="space-y-2 flex flex-col h-full">
                                            <label className="text-xs font-bold uppercase text-slate-400 flex justify-between">
                                                Examples (Input)
                                                <span className="text-[10px] normal-case text-slate-400">Use --- to separate multiple</span>
                                            </label>
                                            <textarea
                                                value={examples}
                                                onChange={(e) => setExamples(e.target.value)}
                                                placeholder="Paste high-quality examples here..."
                                                className="flex-1 w-full min-h-[400px] p-4 rounded-xl border border-slate-200 text-sm font-mono focus:border-indigo-500 focus:ring-0 resize-none bg-slate-50"
                                            />
                                            <button
                                                onClick={handleAnalyze}
                                                disabled={isAnalyzing}
                                                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors disabled:opacity-70"
                                            >
                                                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                                Analyze Style
                                            </button>
                                        </div>

                                        {/* Profile Column */}
                                        <div className="space-y-2 flex flex-col h-full">
                                            <label className="text-xs font-bold uppercase text-slate-400">Extracted Style Profile (Output)</label>
                                            <textarea
                                                value={styleProfile}
                                                onChange={(e) => setStyleProfile(e.target.value)}
                                                placeholder="{ ... }"
                                                className="flex-1 w-full min-h-[400px] p-4 rounded-xl border border-slate-200 text-sm font-mono focus:border-indigo-500 focus:ring-0 resize-none bg-slate-900 text-green-400"
                                            />
                                            <button
                                                onClick={handleSave}
                                                disabled={isSaving}
                                                className="w-full py-3 bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-colors disabled:opacity-70"
                                            >
                                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                                Save Analysis
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </AppLayout>
        </AdminOnly>
    );
}
