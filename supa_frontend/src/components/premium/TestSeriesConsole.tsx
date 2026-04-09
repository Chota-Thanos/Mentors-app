"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Layers3,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserSquare2,
} from "lucide-react";
import { toast } from "sonner";

import RichTextField from "@/components/ui/RichTextField";
import { useAuth } from "@/context/AuthContext";
import {
  isAdminLike,
  isMainsMentorLike,
  isModeratorLike,
  isQuizMasterLike,
  isSeriesOperatorLike,
} from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { richTextToPlainText, toNullableRichText } from "@/lib/richText";
import type {
  MainsCopySubmission,
  MentorshipEntitlement,
  MentorshipRequest,
  MentorshipSlot,
  ModerationActivitySummary,
  PremiumExam,
  ProviderDashboardSummary,
  TestSeries,
  TestSeriesCreatePayload,
  TestSeriesTest,
  TestSeriesUpdatePayload,
  UserMainsPerformanceReport,
} from "@/types/premium";

type ConsoleMode = "explore" | "provider";

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

const emptySeriesForm: TestSeriesCreatePayload = {
  title: "",
  description: "",
  cover_image_url: "",
  series_kind: "quiz",
  access_type: "subscription",
  price: 0,
  exam_ids: [],
  is_public: false,
  is_active: true,
  meta: {},
};

export default function TestSeriesConsole() {
  const { user, isAuthenticated, loading } = useAuth();
  const adminLike = useMemo(() => isAdminLike(user), [user]);
  const moderatorLike = useMemo(() => !adminLike && isModeratorLike(user), [user, adminLike]);
  const quizMasterLike = useMemo(() => !adminLike && isQuizMasterLike(user), [user, adminLike]);
  const mainsMentorLike = useMemo(() => !adminLike && !moderatorLike && isMainsMentorLike(user), [user, adminLike, moderatorLike]);
  const operatorEnabled = useMemo(() => isSeriesOperatorLike(user), [user]);
  const canBuildPrelimsSeries = useMemo(() => adminLike || quizMasterLike, [adminLike, quizMasterLike]);
  const canBuildMainsSeries = useMemo(() => adminLike || mainsMentorLike, [adminLike, mainsMentorLike]);
  const canBuildSeries = useMemo(
    () => canBuildPrelimsSeries || canBuildMainsSeries,
    [canBuildMainsSeries, canBuildPrelimsSeries],
  );
  const canScheduleMentorship = useMemo(() => adminLike || moderatorLike, [adminLike, moderatorLike]);
  const canManageMentorSlots = useMemo(() => mainsMentorLike, [mainsMentorLike]);
  const canHandleMentorship = useMemo(
    () => canManageMentorSlots || canScheduleMentorship,
    [canManageMentorSlots, canScheduleMentorship],
  );
  const [mode, setMode] = useState<ConsoleMode>("explore");

  const [seriesRows, setSeriesRows] = useState<TestSeries[]>([]);
  const [availableExams, setAvailableExams] = useState<PremiumExam[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null);
  const [seriesTestsById, setSeriesTestsById] = useState<Record<string, TestSeriesTest[]>>({});
  const [seriesLoading, setSeriesLoading] = useState(false);

  const [seriesForm, setSeriesForm] = useState<TestSeriesCreatePayload>(emptySeriesForm);
  const [editingSeriesId, setEditingSeriesId] = useState<number | null>(null);
  const [savingSeries, setSavingSeries] = useState(false);

  const [providerSummary, setProviderSummary] = useState<ProviderDashboardSummary | null>(null);
  const [providerSummaryLoading, setProviderSummaryLoading] = useState(false);
  const [moderationSummary, setModerationSummary] = useState<ModerationActivitySummary | null>(null);
  const [moderationSummaryLoading, setModerationSummaryLoading] = useState(false);

  const [copySubmissionsByTest, setCopySubmissionsByTest] = useState<Record<string, MainsCopySubmission[]>>({});
  const [slots, setSlots] = useState<MentorshipSlot[]>([]);

  const [mentorshipRequests, setMentorshipRequests] = useState<MentorshipRequest[]>([]);
  const [requestScope, setRequestScope] = useState<"me" | "provider">("me");

  const [entitlements, setEntitlements] = useState<MentorshipEntitlement[]>([]);
  const [performanceReport, setPerformanceReport] = useState<UserMainsPerformanceReport | null>(null);

  useEffect(() => {
    if (operatorEnabled) {
      setMode("provider");
      setRequestScope(canHandleMentorship ? "provider" : "me");
    } else {
      setMode("explore");
      setRequestScope("me");
    }
  }, [canHandleMentorship, operatorEnabled]);

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
  const examNameById = useMemo(
    () => new Map(availableExams.map((exam) => [exam.id, exam.name] as const)),
    [availableExams],
  );

  const toggleSeriesExamId = (examId: number) => {
    setSeriesForm((prev) => {
      const currentIds = Array.isArray(prev.exam_ids) ? prev.exam_ids : [];
      return {
        ...prev,
        exam_ids: currentIds.includes(examId)
          ? currentIds.filter((item) => item !== examId)
          : [...currentIds, examId],
      };
    });
  };

  const loadSeries = async () => {
    setSeriesLoading(true);
    try {
      const params =
        mode === "provider"
          ? {
            mine_only: !adminLike && !moderatorLike,
            include_tests: true,
            include_inactive: true,
          }
          : { only_public: true, include_tests: true };
      const [response, mineResponse] = await Promise.all([
        premiumApi.get<TestSeries[]>("/programs", { params }),
        mode === "provider" || !isAuthenticated
          ? Promise.resolve<{ data: TestSeries[] } | null>(null)
          : premiumApi
            .get<TestSeries[]>("/programs", {
              params: { mine_only: true, include_tests: true, include_inactive: true },
            })
            .catch(() => null),
      ]);

      const baseRows = Array.isArray(response.data) ? response.data : [];
      const mineRows = Array.isArray(mineResponse?.data) ? mineResponse.data : [];
      const rows =
        mineRows.length > 0
          ? [
            ...mineRows,
            ...baseRows.filter((row) => !mineRows.some((mineRow) => mineRow.id === row.id)),
          ]
          : baseRows;

      const scopedRows = rows.filter((row) => {
        const rawSeriesKind = String(row.series_kind || "").trim().toLowerCase();
        const seriesKind = rawSeriesKind === "prelims" ? "quiz" : rawSeriesKind;
        if (canBuildPrelimsSeries && !canBuildMainsSeries) return seriesKind !== "mains";
        if (canBuildMainsSeries && !canBuildPrelimsSeries) return seriesKind !== "quiz";
        return true;
      });

      if (mode !== "provider" && mineRows.length > 0) {
        setMode("provider");
      }

      setSeriesRows(scopedRows);
      setSelectedSeriesId((prev) => {
        if (prev && scopedRows.some((row) => row.id === prev)) return prev;
        return scopedRows.length > 0 ? scopedRows[0].id : null;
      });
    } catch (error: unknown) {
      toast.error("Failed to load programs", { description: toError(error) });
      setSeriesRows([]);
      setSelectedSeriesId(null);
    } finally {
      setSeriesLoading(false);
    }
  };

  const loadExams = async () => {
    try {
      const response = await premiumApi.get<PremiumExam[]>("/exams", {
        params: { active_only: true },
      });
      setAvailableExams(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      setAvailableExams([]);
      toast.error("Failed to load exams", { description: toError(error) });
    }
  };

  const loadSeriesTests = async (seriesId: number) => {
    try {
      const response = await premiumApi.get<TestSeriesTest[]>(`/programs/${seriesId}/tests`, {
        params: { include_inactive: mode === "provider" },
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      setSeriesTestsById((prev) => ({ ...prev, [String(seriesId)]: rows }));
    } catch (error: unknown) {
      toast.error("Failed to load tests", { description: toError(error) });
      setSeriesTestsById((prev) => ({ ...prev, [String(seriesId)]: [] }));
    }
  };

  const loadProviderSummary = async () => {
    if (!isAuthenticated || !canBuildSeries || mode !== "provider") return;
    setProviderSummaryLoading(true);
    try {
      const response = await premiumApi.get<ProviderDashboardSummary>("/provider/dashboard-summary");
      setProviderSummary(response.data);
    } catch (error: unknown) {
      setProviderSummary(null);
      toast.error("Failed to load provider summary", { description: toError(error) });
    } finally {
      setProviderSummaryLoading(false);
    }
  };

  const loadModerationSummary = async () => {
    if (!moderatorLike || canBuildSeries || mode !== "provider") return;
    setModerationSummaryLoading(true);
    try {
      const response = await premiumApi.get<ModerationActivitySummary>("/moderation/activity-summary");
      setModerationSummary(response.data);
    } catch (error: unknown) {
      setModerationSummary(null);
      toast.error("Failed to load moderation summary", { description: toError(error) });
    } finally {
      setModerationSummaryLoading(false);
    }
  };

  const loadMentorshipSlots = async () => {
    try {
      const response = await premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
        params: { include_past: mode === "provider" && canHandleMentorship },
      });
      setSlots(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      setSlots([]);
      toast.error("Failed to load mentorship slots", { description: toError(error) });
    }
  };

  const loadMentorshipRequests = async () => {
    if (!isAuthenticated) return;
    const scope = requestScope === "provider" && !canHandleMentorship ? "me" : requestScope;
    if (scope !== requestScope) {
      setRequestScope(scope);
    }
    try {
      const response = await premiumApi.get<MentorshipRequest[]>("/mentorship/requests", {
        params: { scope },
      });
      setMentorshipRequests(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      setMentorshipRequests([]);
      toast.error("Failed to load mentorship requests", { description: toError(error) });
    }
  };

  const loadMyEntitlements = async () => {
    if (!isAuthenticated) return;
    try {
      const response = await premiumApi.get<MentorshipEntitlement[]>("/mentorship/entitlements/me");
      setEntitlements(Array.isArray(response.data) ? response.data : []);
    } catch {
      setEntitlements([]);
    }
  };

  const loadMyPerformance = async () => {
    if (!isAuthenticated) return;
    try {
      const response = await premiumApi.get<UserMainsPerformanceReport>("/users/me/mains-performance-report");
      setPerformanceReport(response.data);
    } catch (error: unknown) {
      setPerformanceReport(null);
      toast.error("Failed to load performance report", { description: toError(error) });
    }
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (loading) return;
    void loadExams();
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    void loadSeries();
    void loadMentorshipSlots();
    void loadMentorshipRequests();
    void loadMyEntitlements();
    void loadMyPerformance();
    if (canBuildSeries && isAuthenticated) void loadProviderSummary();
    if (moderatorLike && !canBuildSeries) void loadModerationSummary();
  }, [loading, mode, canBuildSeries, moderatorLike, requestScope, isAuthenticated, canHandleMentorship]);

  useEffect(() => {
    if (!selectedSeriesId) return;
    void loadSeriesTests(selectedSeriesId);
  }, [selectedSeriesId, mode]);

  useEffect(() => {
    const missing = seriesRows
      .map((row) => row.id)
      .filter((id) => !seriesTestsById[String(id)]);
    if (missing.length === 0) return;
    for (const id of missing) {
      void loadSeriesTests(id);
    }
  }, [mode, seriesRows, seriesTestsById]);

  useEffect(() => {
    const allowedSeriesKinds = seriesKindOptions.map((option) => option.value);
    if (allowedSeriesKinds.includes(seriesForm.series_kind || "quiz")) return;
    setSeriesForm((prev) => ({ ...prev, series_kind: allowedSeriesKinds[0] || "quiz" }));
  }, [seriesForm.series_kind, seriesKindOptions]);

  /* eslint-enable react-hooks/exhaustive-deps */

  const resetSeriesForm = () => {
    setEditingSeriesId(null);
    setSeriesForm((prev) => ({
      ...emptySeriesForm,
      access_type: prev.access_type || "subscription",
      series_kind: seriesKindOptions[0]?.value || "quiz",
    }));
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
    setSavingSeries(true);
    try {
      if (editingSeriesId) {
        const payload: TestSeriesUpdatePayload = {
          ...seriesForm,
          title,
          description: toNullableRichText(seriesForm.description || ""),
          exam_ids: Array.isArray(seriesForm.exam_ids) ? seriesForm.exam_ids : [],
        };
        await premiumApi.put(`/programs/${editingSeriesId}`, payload);
        toast.success("Series updated");
      } else {
        const payload: TestSeriesCreatePayload = {
          ...seriesForm,
          title,
          description: toNullableRichText(seriesForm.description || ""),
          exam_ids: Array.isArray(seriesForm.exam_ids) ? seriesForm.exam_ids : [],
        };
        const response = await premiumApi.post<TestSeries>("/programs", payload);
        if (response.data?.id) {
          setSelectedSeriesId(response.data.id);
        }
        toast.success("Series created");
      }
      resetSeriesForm();
      await loadSeries();
      if (canBuildSeries) await loadProviderSummary();
    } catch (error: unknown) {
      toast.error("Failed to save series", { description: toError(error) });
    } finally {
      setSavingSeries(false);
    }
  };

  const enrollInSeries = async (seriesId: number, price?: number, accessType?: string) => {
    try {
      const requiresOnlinePayment = String(accessType || "").toLowerCase() !== "free" && Number(price || 0) > 0;
      if (requiresOnlinePayment) {
        if (typeof window !== "undefined") {
          window.location.assign(`/programs/${seriesId}?autobuy=1`);
          return;
        }
      }
      await premiumApi.post(`/programs/${seriesId}/enroll`, { access_source: "self_service" });
      toast.success("Enrolled in programs");
      await loadSeries();
    } catch (error: unknown) {
      toast.error("Enrollment failed", { description: toError(error) });
    }
  };

  const loadCopySubmissions = async (testId: number) => {
    try {
      const response = await premiumApi.get<MainsCopySubmission[]>(`/tests/${testId}/copy-submissions`);
      setCopySubmissionsByTest((prev) => ({
        ...prev,
        [String(testId)]: Array.isArray(response.data) ? response.data : [],
      }));
    } catch (error: unknown) {
      toast.error("Failed to load submissions", { description: toError(error) });
      setCopySubmissionsByTest((prev) => ({ ...prev, [String(testId)]: [] }));
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading workspace...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 p-6 text-white">
        <h1 className="text-2xl font-bold">Programs & Mentorship Hub</h1>
        <p className="mt-2 text-sm text-slate-100/90">
          Mobile-friendly workspace for Prelims and Mains operations, with role-based access for Quiz Masters and Mains Mentors.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("explore")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "explore" ? "bg-white text-slate-900" : "bg-white/20 text-white"}`}
          >
            Explore
          </button>
          {operatorEnabled ? (
            <button
              type="button"
              onClick={() => setMode("provider")}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "provider" ? "bg-white text-slate-900" : "bg-white/20 text-white"}`}
            >
              Operations Console
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void loadSeries();
              void loadMentorshipRequests();
              void loadMentorshipSlots();
              void loadMyPerformance();
              if (canBuildSeries) void loadProviderSummary();
              if (moderatorLike && !canBuildSeries) void loadModerationSummary();
            }}
            className="inline-flex items-center gap-1 rounded-md bg-white/20 px-3 py-1.5 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {mode === "provider" && operatorEnabled ? (
        <div className="space-y-6">
          {canBuildSeries ? (
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              {(
                canBuildPrelimsSeries && !canBuildMainsSeries
                  ? [
                    { key: "series", label: "Prelims Series", value: providerSummary?.series_count ?? 0, icon: Layers3 },
                    { key: "tests", label: "Prelims Tests", value: providerSummary?.test_count ?? 0, icon: FileCheck2 },
                    { key: "enrollments", label: "Enrollments", value: providerSummary?.active_enrollments ?? 0, icon: UserSquare2 },
                    { key: "checks", label: "Pending Checks", value: providerSummary?.pending_copy_checks ?? 0, icon: Clock3 },
                  ]
                  : [
                    { key: "series", label: "Series", value: providerSummary?.series_count ?? 0, icon: Layers3 },
                    { key: "tests", label: "Tests", value: providerSummary?.test_count ?? 0, icon: FileCheck2 },
                    { key: "enrollments", label: "Enrollments", value: providerSummary?.active_enrollments ?? 0, icon: UserSquare2 },
                    { key: "checks", label: "Pending Checks", value: providerSummary?.pending_copy_checks ?? 0, icon: Clock3 },
                    { key: "requests", label: "Mentorship", value: providerSummary?.mentorship_pending_requests ?? 0, icon: ShieldCheck },
                    { key: "slots", label: "Upcoming Slots", value: providerSummary?.upcoming_slots ?? 0, icon: CalendarDays },
                  ]
              ).map((card) => (
                <div key={card.key} className="rounded-xl border border-slate-200 bg-white p-4">
                  <card.icon className="h-4 w-4 text-slate-500" />
                  <p className="mt-2 text-xs font-semibold uppercase text-slate-500">{card.label}</p>
                  <p className="text-2xl font-bold text-slate-900">{providerSummaryLoading ? "..." : card.value}</p>
                </div>
              ))}
            </div>
          ) : moderatorLike ? (
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              {[
                { key: "series", label: "Series", value: moderationSummary?.series_count ?? 0, icon: Layers3 },
                { key: "tests", label: "Tests", value: moderationSummary?.test_count ?? 0, icon: FileCheck2 },
                { key: "active", label: "Active Enrollments", value: moderationSummary?.active_enrollments ?? 0, icon: UserSquare2 },
                { key: "copies", label: "Pending Checks", value: moderationSummary?.pending_copy_checks ?? 0, icon: Clock3 },
                { key: "mentorship", label: "Mentorship Pending", value: moderationSummary?.mentorship_pending_requests ?? 0, icon: ShieldCheck },
                { key: "copytotal", label: "Total Copy Submissions", value: moderationSummary?.copy_submissions_total ?? 0, icon: CalendarDays },
              ].map((card) => (
                <div key={card.key} className="rounded-xl border border-slate-200 bg-white p-4">
                  <card.icon className="h-4 w-4 text-slate-500" />
                  <p className="mt-2 text-xs font-semibold uppercase text-slate-500">{card.label}</p>
                  <p className="text-2xl font-bold text-slate-900">{moderationSummaryLoading ? "..." : card.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              Monitoring mode: series authoring stats are visible only to Quiz Master, Mains Mentor, or admin roles.
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              {canBuildSeries ? (
                <>
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-semibold text-slate-900">{editingSeriesId ? "Edit Programs" : "Programs Console"}</p>
                      {!editingSeriesId && (
                        <Link href="/programs/create" className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                          <Plus className="h-4 w-4" />
                          Create New
                        </Link>
                      )}
                    </div>
                    {editingSeriesId ? (
                      <div className="space-y-3">
                        <input
                          value={seriesForm.title || ""}
                          onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Series title"
                        />
                        <RichTextField
                          label="Series description"
                          value={seriesForm.description || ""}
                          onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                          placeholder="Describe the series structure, learner outcome, and how the series is intended to be used."
                          helperText="This becomes the public description across the series experience."
                        />
                        <input
                          value={seriesForm.cover_image_url || ""}
                          onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Cover image URL"
                        />
                        <div className="grid gap-2 md:grid-cols-2">
                          <select
                            value={seriesForm.series_kind || seriesKindOptions[0]?.value || "quiz"}
                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))}
                            disabled={seriesKindOptions.length <= 1}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          >
                            {seriesKindOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <select
                            value={seriesForm.access_type || "subscription"}
                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, access_type: event.target.value as "subscription" | "free" | "paid" }))}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="subscription">Subscription</option>
                            <option value="free">Free</option>
                            <option value="paid">Paid</option>
                          </select>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <input
                            type="number"
                            min={0}
                            value={String(seriesForm.price || 0)}
                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, price: Number(event.target.value) }))}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Price"
                          />
                          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(seriesForm.is_public)}
                              onChange={(event) => setSeriesForm((prev) => ({ ...prev, is_public: event.target.checked }))}
                            />
                            Public
                          </label>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <label className="text-xs font-semibold uppercase text-slate-500">Target exams</label>
                            <span className="text-xs text-slate-500">Programs and tests show under these exams.</span>
                          </div>
                          <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                            {availableExams.length === 0 ? (
                              <span className="text-sm text-slate-500">No active exams available.</span>
                            ) : availableExams.map((exam) => {
                              const active = (seriesForm.exam_ids || []).includes(exam.id);
                              return (
                                <button
                                  key={exam.id}
                                  type="button"
                                  onClick={() => toggleSeriesExamId(exam.id)}
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
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingSeries}
                            onClick={() => void saveSeries()}
                            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            <Plus className="h-4 w-4" />
                            Update
                          </button>
                          <button type="button" onClick={resetSeriesForm} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Use the cards below to open or manage a program, or use the button above to create a new one.</p>
                    )}
                  </>
                </>
              ) : (
                <p className="text-xs text-amber-700">Read-only mode. Quiz Master, Mains Mentor, or admin role is required to create or edit programs.</p>
              )}

              <div className="border-t border-slate-200 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Your Series</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {seriesRows.map((series) => (
                    <article key={series.id} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_14px_32px_rgba(15,23,42,0.06)] transition hover:-translate-y-1 hover:shadow-[0_22px_48px_rgba(15,23,42,0.12)]">
                      <div className="bg-[linear-gradient(135deg,#eef4ff_0%,#f8fbff_55%,#edfdf7_100%)] px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-black tracking-tight text-[#091a4a]">{series.title}</p>
                            <p className="mt-1 text-xs text-slate-600">
                              {series.test_count} tests
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${series.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                            {series.is_active ? "Active" : "Archived"}
                          </span>
                        </div>
                      </div>
                      <div className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            {String(series.series_kind || "").trim() || "series"}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            {String(series.access_type || "").trim() || "subscription"}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            {series.is_public ? "Public" : "Private"}
                          </span>
                          {(series.exam_ids || []).map((examId) => (
                            <span key={examId} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                              {examNameById.get(examId) || `Exam ${examId}`}
                            </span>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/programs/${series.id}`} className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700">
                          Detail
                        </Link>
                        <Link href={`/programs/${series.id}/manage`} className="inline-flex items-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-700">
                          Manage
                        </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!seriesLoading && seriesRows.length === 0 ? <p className="text-sm text-slate-500">No series yet.</p> : null}
                </div>
              </div>
            </div>
          </div>

          {canBuildMainsSeries || canHandleMentorship ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Mentorship Workspace</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Availability planning, mentorship settings, upcoming calls, and session records now live on the
                    dedicated mentorship manage page to avoid duplicate mentor workflows.
                  </p>
                </div>
                <Link
                  href={selectedSeriesId ? `/mentorship/manage?seriesId=${selectedSeriesId}` : "/mentorship/manage"}
                  className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"
                >
                  Open Mentorship Manage
                </Link>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4 text-xs">
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">Published slots</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{slots.length}</p>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">Open requests</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {mentorshipRequests.filter((request) => request.status === "requested").length}
                  </p>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">Scheduled calls</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {mentorshipRequests.filter((request) => request.status === "scheduled").length}
                  </p>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">Completed calls</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {mentorshipRequests.filter((request) => request.status === "completed").length}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={selectedSeriesId ? `/mentorship/manage?seriesId=${selectedSeriesId}` : "/mentorship/manage"}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  Open Series Queue
                </Link>
                <Link href="/mentorship/manage" className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  Open All Calls & Records
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {seriesRows.map((series) => {
              const tests = seriesTestsById[String(series.id)] || [];
              return (
                <article key={series.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
                  <div className="bg-[linear-gradient(135deg,#f9fbff_0%,#eef4ff_52%,#f5fffb_100%)] px-5 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-xl font-black tracking-tight text-[#091a4a]">{series.title}</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{richTextToPlainText(series.description || "") || "No description."}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600">
                          {String(series.series_kind || "").trim() || "series"}
                        </span>
                        <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600">
                          {series.test_count} tests
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link href={`/programs/${series.id}`} className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      Open Detail
                    </Link>
                    {isAuthenticated ? (
                      <button type="button" onClick={() => void enrollInSeries(series.id, Number(series.price || 0), String(series.access_type || ""))} className="inline-flex items-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Enroll</button>
                    ) : null}
                    </div>
                  </div>
                  <div className="space-y-2 px-5 py-5">
                    {tests.map((test) => {
                      const submissions = copySubmissionsByTest[String(test.id)] || [];
                      return (
                        <div key={test.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{test.title}</p>
                              <p className="text-xs text-slate-500">{richTextToPlainText(test.description || "") || "No description."}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <Link href={`/collections/${test.id}`} className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700">Open</Link>
                              <Link href={test.test_kind === "mains" ? `/collections/${test.id}` : `/collections/${test.id}/test`} className="rounded-xl border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700">{test.test_kind === "mains" ? "Open Test" : "Start"}</Link>
                            </div>
                          </div>
                          {test.test_kind === "mains" && isAuthenticated ? (
                            <div className="mt-2 space-y-2">
                              <p className="text-xs text-slate-600">Use the main test page to submit a full answer PDF or question-wise answer photos. That same page now runs the full evaluation and mentorship flow.</p>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => void loadCopySubmissions(test.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">Refresh Submissions</button>
                              </div>
                              {submissions.map((submission) => (
                                <div key={submission.id} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                                  #{submission.id} | {submission.status}
                                  {submission.total_marks !== null && submission.total_marks !== undefined ? ` | Marks: ${submission.total_marks}` : ""}
                                  {submission.checked_copy_pdf_url ? (
                                    <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="ml-2 text-indigo-700">Checked Copy</a>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            {!seriesLoading && seriesRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
                No public programs available yet.
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-slate-900">Mentorship Booking</h3>
                <Link href="/mentorship/manage" className="rounded border border-slate-300 px-2 py-1 text-[11px]">
                  Full Page
                </Link>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Use the dedicated mentorship manage page to compare mentor availability, review detailed mentor profiles,
                and book calls without duplicating the request flow here.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/mentors" className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  Browse Mentors
                </Link>
                <Link href="/mentorship/manage" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  Open Booking Workspace
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-lg font-semibold text-slate-900">My Entitlements</h3>
              <div className="mt-2 space-y-1">
                {entitlements.map((entitlement) => (
                  <div key={entitlement.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                    {entitlement.source} | Remaining: {entitlement.sessions_remaining}
                  </div>
                ))}
                {entitlements.length === 0 ? <p className="text-sm text-slate-500">No active mentorship entitlements.</p> : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-lg font-semibold text-slate-900">My Mains Performance</h3>
              {performanceReport ? (
                <div className="mt-2 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1"><span>Total submissions</span><span className="font-semibold">{performanceReport.total_submissions}</span></div>
                  <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1"><span>Checked submissions</span><span className="font-semibold">{performanceReport.checked_submissions}</span></div>
                  <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1"><span>Average provider marks</span><span className="font-semibold">{performanceReport.average_provider_marks}</span></div>
                  <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1"><span>Average AI score</span><span className="font-semibold">{performanceReport.average_ai_score}</span></div>
                </div>
              ) : <p className="mt-2 text-sm text-slate-500">No mains report yet.</p>}
              <button type="button" onClick={() => void loadMyPerformance()} className="mt-2 inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Refresh Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
