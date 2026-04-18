"use client";

import axios from "axios";
import { BookOpen, CircleHelp, FileStack, LayoutGrid, MessageSquareWarning, PlayCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import AppLayout from "@/components/layouts/AppLayout";
import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getMainsMentorWorkspaceSections, getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RichTextField from "@/components/ui/RichTextField";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isMainsMentorLike, isQuizMasterLike } from "@/lib/accessControl";
import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import type { PremiumExam, TestSeriesCreatePayload } from "@/types/premium";

const emptySeriesForm: TestSeriesCreatePayload = {
    title: "",
    description: "",
    cover_image_url: "",
    series_kind: "quiz",
    access_type: "subscription",
    price: 0,
    is_public: false,
    is_active: true,
    meta: {},
};

const toError = (error: unknown): string => {
    if (!axios.isAxiosError(error)) return "Unknown error";
    const detail = error.response?.data?.detail;
    return typeof detail === "string" && detail.trim() ? detail : error.message;
};

function BuilderBlueprintCard({
    icon,
    title,
    description,
    tone,
}: {
    icon: ReactNode;
    title: string;
    description: string;
    tone: "indigo" | "emerald" | "amber" | "slate";
}) {
    const toneClass =
        tone === "indigo"
            ? "border-indigo-200 bg-indigo-50/80 text-indigo-950"
            : tone === "emerald"
                ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
                : tone === "amber"
                    ? "border-amber-200 bg-amber-50/80 text-amber-950"
                    : "border-slate-200 bg-slate-50 text-slate-950";

    return (
        <article className={`rounded-[26px] border p-5 shadow-sm ${toneClass}`}>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
                {icon}
            </div>
            <h3 className="mt-4 text-lg font-black tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
        </article>
    );
}

export default function CreateTestSeriesPage() {
    const router = useRouter();
    const { user, loading, isAuthenticated } = useAuth();
    const { profileId } = useProfile();
    const currentUserId = String(user?.id || "").trim();

    const quizMasterLike = useMemo(() => isQuizMasterLike(user), [user]);
    const mainsMentorLike = useMemo(() => isMainsMentorLike(user), [user]);
    const adminLike = useMemo(() => isAdminLike(user), [user]);

    const canBuildPrelimsSeries = useMemo(() => adminLike || quizMasterLike, [adminLike, quizMasterLike]);
    const canBuildMainsSeries = useMemo(() => adminLike || mainsMentorLike, [adminLike, mainsMentorLike]);
    const canBuildSeries = useMemo(
        () => canBuildPrelimsSeries || canBuildMainsSeries,
        [canBuildMainsSeries, canBuildPrelimsSeries],
    );

    const seriesKindOptions = useMemo(() => {
        if (adminLike || (canBuildPrelimsSeries && canBuildMainsSeries)) {
            return [
                { value: "quiz" as const, label: "Prelims Series" },
                { value: "mains" as const, label: "Mains Series" },
                { value: "hybrid" as const, label: "Hybrid Series" },
            ];
        }
        if (canBuildMainsSeries) {
            return [{ value: "mains" as const, label: "Mains Series" }];
        }
        return [{ value: "quiz" as const, label: "Prelims Series" }];
    }, [adminLike, canBuildMainsSeries, canBuildPrelimsSeries]);

    const [seriesForm, setSeriesForm] = useState<TestSeriesCreatePayload>(emptySeriesForm);
    const [savingSeries, setSavingSeries] = useState(false);
    const [availableExams, setAvailableExams] = useState<PremiumExam[]>([]);
    const [selectedExamIds, setSelectedExamIds] = useState<number[]>([]);
    const isPrelimsBuilder = String(seriesForm.series_kind || "").trim().toLowerCase() !== "mains";
    const workspaceSections = useMemo(
        () =>
            isPrelimsBuilder
                ? getQuizMasterWorkspaceSections(currentUserId || undefined)
                : getMainsMentorWorkspaceSections(currentUserId || undefined),
        [currentUserId, isPrelimsBuilder],
    );
    const workspaceTitle = isPrelimsBuilder ? "Prelims Expert Workspace" : "Series Builder Workspace";
    const workspaceSubtitle = isPrelimsBuilder
        ? "Create and structure prelims programs, connect tests, and keep the complaint loop visible."
        : "Create and structure series, configure access, and move directly into the builder desk.";
    const blueprintCards = useMemo(
        () =>
            isPrelimsBuilder
                ? [
                    {
                        icon: <BookOpen className="h-5 w-5 text-indigo-700" />,
                        title: "Objective Test Lane",
                        description: "Each prelims test becomes a builder lane where you attach questions, explanations, and launch-ready ordering.",
                        tone: "indigo" as const,
                    },
                    {
                        icon: <PlayCircle className="h-5 w-5 text-emerald-700" />,
                        title: "Add Program Materials",
                        description: "Attach PDF materials or scheduled lecture slots to mock tests without leaving the series workflow.",
                        tone: "emerald" as const,
                    },
                    {
                        icon: <Sparkles className="h-5 w-5 text-amber-700" />,
                        title: "Series Add-ons",
                        description: "Add live classes or PDF materials directly to the series to build a complete program.",
                        tone: "amber" as const,
                    },
                    {
                        icon: <MessageSquareWarning className="h-5 w-5 text-slate-700" />,
                        title: "Complaint Desk",
                        description: "Learner complaints from result pages flow into your creator workspace, so correction and resolution stay part of delivery.",
                        tone: "slate" as const,
                    },
                ]
                : [
                    {
                        icon: <LayoutGrid className="h-5 w-5 text-indigo-700" />,
                        title: "Series Structure",
                        description: "Define the program identity first, then move into the test builder with the correct access and pricing rules.",
                        tone: "indigo" as const,
                    },
                    {
                        icon: <FileStack className="h-5 w-5 text-emerald-700" />,
                        title: "Content Workflow",
                        description: "Use the management workspace to create tests, attach content, and publish the learner journey in sequence.",
                        tone: "emerald" as const,
                    },
                    {
                        icon: <CircleHelp className="h-5 w-5 text-amber-700" />,
                        title: "Program Items",
                        description: "Configure PDFs, lecture blocks and operational support before you open the program to learners.",
                        tone: "amber" as const,
                    },
                ],
        [isPrelimsBuilder],
    );

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated || !canBuildSeries) {
            router.push("/programs");
        }
    }, [loading, isAuthenticated, canBuildSeries, router]);

    useEffect(() => {
        const allowedSeriesKinds = seriesKindOptions.map((option) => option.value);
        if (allowedSeriesKinds.includes(seriesForm.series_kind || "quiz")) return;
        setSeriesForm((prev) => ({ ...prev, series_kind: allowedSeriesKinds[0] || "quiz" }));
    }, [seriesForm.series_kind, seriesKindOptions]);

    useEffect(() => {
        let active = true;
        premiumApi.get<PremiumExam[]>("/exams", { params: { active_only: true } })
            .then((response) => {
                if (!active) return;
                const rows = Array.isArray(response.data) ? response.data : [];
                setAvailableExams(rows);
            })
            .catch(() => {
                if (!active) return;
                setAvailableExams([]);
            });
        return () => {
            active = false;
        };
    }, []);

    const toggleExamId = (examId: number) => {
        setSelectedExamIds((current) => (
            current.includes(examId)
                ? current.filter((item) => item !== examId)
                : [...current, examId]
        ));
    };

    const saveSeries = async () => {
        const title = String(seriesForm.title || "").trim();
        if (!title) {
            toast.error("Series title is required");
            return;
        }
    const selectedKind = String(seriesForm.series_kind || "").trim().toLowerCase();
    if (!seriesKindOptions.some((option) => option.value === selectedKind)) {
        toast.error("Selected series kind is not allowed for your role.");
        return;
    }
    const selectedAccessType = String(seriesForm.access_type || "subscription").trim().toLowerCase();
    const dbSeriesKind =
        selectedKind === "quiz" || selectedKind === "prelims"
            ? "prelims"
            : (selectedKind as "mains" | "hybrid");
    const seriesPrice = selectedAccessType === "free" ? 0 : Number(seriesForm.price || 0);
    setSavingSeries(true);
    try {
            const supabase = createClient();
            const { data, error } = await supabase
                .from("test_series")
                .insert({
                    name: title,
                    description: toNullableRichText(seriesForm.description || ""),
                    series_kind: dbSeriesKind,
                    is_paid: selectedAccessType === "paid",
                    is_subscription: selectedAccessType === "subscription",
                    cover_image_url: seriesForm.cover_image_url || null,
                    price: seriesPrice,
                    is_public: !!seriesForm.is_public,
                    is_active: true,
                    creator_id: profileId,
                })
                .select()
                .single();

            if (error) throw error;

            const createdSeriesId = Number(data?.id || 0);
            if (Number.isFinite(createdSeriesId) && createdSeriesId > 0 && selectedExamIds.length > 0) {
                const { error: examLinkError } = await supabase
                    .from("test_series_exams")
                    .insert(selectedExamIds.map((examId) => ({
                        test_series_id: createdSeriesId,
                        exam_id: examId,
                    })));
                if (examLinkError) throw examLinkError;
            }
            toast.success("Programs created successfully!");
            if (Number.isFinite(createdSeriesId) && createdSeriesId > 0) {
                router.push(`/programs/${createdSeriesId}/manage`);
            } else {
                router.push("/programs");
            }
        } catch (error: unknown) {
            toast.error("Failed to create series", { description: toError(error) });
        } finally {
            setSavingSeries(false);
        }
    };

    if (loading) {
        return (
            <AppLayout>
                <div className="mx-auto max-w-2xl p-6">Loading...</div>
            </AppLayout>
        );
    }

    if (!canBuildSeries) return null;

    return (
        <AppLayout>
            <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6">
                <RoleWorkspaceSidebar
                    title={workspaceTitle}
                    subtitle={workspaceSubtitle}
                    sections={workspaceSections}
                    className="lg:self-start"
                />

                <div className="min-w-0 flex-1 space-y-6">
                    <div className="rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(224,231,255,0.9),_transparent_34%),linear-gradient(180deg,_#ffffff,_#f8fafc)] p-6 shadow-sm sm:p-8">
                        <HistoryBackButton
                            fallbackHref="/programs"
                            label="Back to programs"
                            className="inline-flex items-center text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800"
                            iconClassName="mr-1 h-4 w-4"
                        />

                        <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
                            <div className="max-w-3xl">
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-600">
                                    {isPrelimsBuilder ? "Prelims Expert Role" : "Series Builder"}
                                </p>
                                <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl">
                                    {isPrelimsBuilder ? "Create Prelims Program" : "Create New Programs"}
                                </h1>
                                <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
                                    {isPrelimsBuilder
                                        ? "Set up the public program identity, define access rules, and walk straight into the test workspace where questions, discussions, and learner complaints are managed."
                                        : "Define the series identity, access rules, and public description before you move into the builder workspace."}
                                </p>
                            </div>

                            <div className="grid min-w-[240px] gap-3 rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Builder status</p>
                                    <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                                        {isPrelimsBuilder ? "Program setup" : "Series setup"}
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Format</p>
                                        <p className="mt-2 font-bold text-slate-900">
                                            {seriesKindOptions.find((option) => option.value === seriesForm.series_kind)?.label || "Prelims Series"}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Delivery</p>
                                        <p className="mt-2 font-bold text-slate-900">
                                            {String(seriesForm.access_type || "subscription").replace(/^./, (char) => char.toUpperCase())}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <section className={`grid gap-4 ${blueprintCards.length > 3 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
                        {blueprintCards.map((card) => (
                            <BuilderBlueprintCard
                                key={card.title}
                                icon={card.icon}
                                title={card.title}
                                description={card.description}
                                tone={card.tone}
                            />
                        ))}
                    </section>

                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Program identity</p>
                                    <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Core series details</h2>
                                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                                        This sets the public-facing program card and the initial workspace configuration.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                                    After save, the builder opens directly on the program workspace.
                                </div>
                            </div>

                            <div className="mt-8 grid gap-5">
                                <div className="grid gap-5 md:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-800">Series Title</label>
                                        <input
                                            value={seriesForm.title || ""}
                                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                            placeholder="E.g., UPSC Prelims 2026 Study Kit"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-800">Cover Image URL <span className="text-slate-400 font-normal">(Optional)</span></label>
                                        <input
                                            value={seriesForm.cover_image_url || ""}
                                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                            placeholder="https://example.com/cover.jpg"
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-5 md:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-800">Programs Format</label>
                                        <select
                                            value={seriesForm.series_kind || seriesKindOptions[0]?.value || "quiz"}
                                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))}
                                            disabled={seriesKindOptions.length <= 1}
                                            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                        >
                                            {seriesKindOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-800">Access Type</label>
                                        <select
                                            value={seriesForm.access_type || "subscription"}
                                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, access_type: event.target.value as "subscription" | "free" | "paid" }))}
                                            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                        >
                                            <option value="subscription">Subscription</option>
                                            <option value="free">Free</option>
                                            <option value="paid">Paid</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid gap-5 md:grid-cols-2 lg:items-end">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-bold text-slate-800">Price (in INR)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            value={String(seriesForm.price || 0)}
                                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, price: Number(event.target.value) }))}
                                            className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                            placeholder="Price"
                                        />
                                    </div>

                                    <div>
                                        <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100/80">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(seriesForm.is_public)}
                                                onChange={(event) => setSeriesForm((prev) => ({ ...prev, is_public: event.target.checked }))}
                                                className="h-4.5 w-4.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 transition-all"
                                            />
                                            <span>Make globally visible</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <label className="text-sm font-bold text-slate-800">Target exams</label>
                                        <span className="text-xs text-slate-500">Programs and tests show under these exams.</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        {availableExams.length === 0 ? (
                                            <span className="text-sm text-slate-500">No active exams available.</span>
                                        ) : availableExams.map((exam) => {
                                            const active = selectedExamIds.includes(exam.id);
                                            return (
                                                <button
                                                    key={exam.id}
                                                    type="button"
                                                    onClick={() => toggleExamId(exam.id)}
                                                    className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                                                        active
                                                            ? "border-indigo-500 bg-indigo-600 text-white"
                                                            : "border-slate-300 bg-white text-slate-700"
                                                    }`}
                                                >
                                                    {exam.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <RichTextField
                                    label="Description"
                                    value={seriesForm.description || ""}
                                    onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                                    placeholder="Describe the program structure, learner outcome, difficulty, and how the tests should be used."
                                    helperText="This becomes the main learner-facing description for the series."
                                />

                            </div>
                        </section>

                        <section className="space-y-4">
                            <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Program flow</p>
                                <ol className="mt-5 space-y-4 text-sm text-slate-700">
                                    <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                        <p className="font-bold text-slate-950">1. Create the program shell</p>
                                        <p className="mt-1 leading-6">Save the identity, access model, pricing, and learner-facing description first.</p>
                                    </li>
                                    <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                        <p className="font-bold text-slate-950">2. Add prelims tests</p>
                                        <p className="mt-1 leading-6">The manage workspace opens next so you can create tests and connect questions by method.</p>
                                    </li>
                                    <li className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                        <p className="font-bold text-slate-950">3. Operate the complaint loop</p>
                                        <p className="mt-1 leading-6">Learner complaints raised from result pages remain accessible from the same expert workspace.</p>
                                    </li>
                                </ol>
                            </article>

                            <article className="rounded-[30px] border border-indigo-200 bg-indigo-950 p-6 text-white shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-200">Ready to continue</p>
                                <h3 className="mt-3 text-2xl font-black tracking-tight">
                                    {isPrelimsBuilder ? "Open the program builder next" : "Move into the series workspace"}
                                </h3>
                                <p className="mt-3 text-sm leading-7 text-indigo-100">
                                    Saving here sends you directly into the management desk, where you can add tests, open question methods, and review complaints.
                                </p>
                                <button
                                    type="button"
                                    disabled={savingSeries}
                                    onClick={() => void saveSeries()}
                                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 text-base font-black text-indigo-950 shadow-xl shadow-indigo-950/20 transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {savingSeries ? "Creating..." : "Create Program & Open Workspace"}
                                </button>
                            </article>
                        </section>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
