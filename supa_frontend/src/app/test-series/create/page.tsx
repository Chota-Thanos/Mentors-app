"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import AppLayout from "@/components/layouts/AppLayout";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RichTextField from "@/components/ui/RichTextField";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isMainsMentorLike, isQuizMasterLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import type { TestSeries, TestSeriesCreatePayload } from "@/types/premium";

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

export default function CreateTestSeriesPage() {
    const router = useRouter();
    const { user, loading, isAuthenticated } = useAuth();

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

    useEffect(() => {
        if (loading) return;
        if (!isAuthenticated || !canBuildSeries) {
            router.push("/test-series");
        }
    }, [loading, isAuthenticated, canBuildSeries, router]);

    useEffect(() => {
        const allowedSeriesKinds = seriesKindOptions.map((option) => option.value);
        if (allowedSeriesKinds.includes(seriesForm.series_kind || "quiz")) return;
        setSeriesForm((prev) => ({ ...prev, series_kind: allowedSeriesKinds[0] || "quiz" }));
    }, [seriesForm.series_kind, seriesKindOptions]);

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
        setSavingSeries(true);
        try {
            const payload: TestSeriesCreatePayload = {
                ...seriesForm,
                title,
                description: toNullableRichText(seriesForm.description || ""),
            };
            await premiumApi.post<TestSeries>("/test-series", payload);
            toast.success("Test series created successfully!");
            router.push("/test-series");
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
            <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
                <HistoryBackButton
                    fallbackHref="/test-series"
                    label="Back to test series"
                    className="inline-flex items-center text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800"
                    iconClassName="mr-1 h-4 w-4"
                />
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-sky-500"></div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Create New Test Series</h1>
                    <p className="mt-2 text-sm text-slate-500">
                        Design a new learning collection. You can configure tests, access type, and pricing.
                    </p>

                    <div className="mt-8 space-y-5">
                        <div className="space-y-1.5">
                            <label className="text-sm font-bold text-slate-800">Series Title</label>
                            <input
                                value={seriesForm.title || ""}
                                onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))}
                                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                placeholder="E.g., Complete Prelims Mock 2026"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <RichTextField
                                label="Description"
                                value={seriesForm.description || ""}
                                onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                                placeholder="Describe the series structure, learner outcome, difficulty, and how mentorship or evaluation will work."
                                helperText="This becomes the main public description for the series."
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-bold text-slate-800">Cover Image URL <span className="text-slate-400 font-normal">(Optional)</span></label>
                            <input
                                value={seriesForm.cover_image_url || ""}
                                onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))}
                                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                placeholder="https://example.com/cover.jpg"
                            />
                        </div>

                        <div className="grid gap-5 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-slate-800">Test Series Format</label>
                                <select
                                    value={seriesForm.series_kind || seriesKindOptions[0]?.value || "quiz"}
                                    onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))}
                                    disabled={seriesKindOptions.length <= 1}
                                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
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
                                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
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
                                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                                    placeholder="Price"
                                />
                            </div>

                            <div>
                                <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100/80">
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

                        <div className="pt-6">
                            <button
                                type="button"
                                disabled={savingSeries}
                                onClick={() => void saveSeries()}
                                className="w-full flex justify-center items-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-base font-black text-white shadow-xl shadow-slate-900/10 transition-all hover:bg-slate-800 hover:-translate-y-0.5 active:translate-y-0 disabled:-translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {savingSeries ? "Creating..." : "Create Test Series"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
