"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import UserLifecycleBoard from "@/components/premium/UserLifecycleBoard";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isMentorLike, isModeratorLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { richTextToPlainText, toNullableRichText } from "@/lib/richText";
import { lifecycleCompletionPercent, type UserLifecycleMetrics } from "@/lib/testSeriesLifecycle";
import RichTextField from "@/components/ui/RichTextField";
import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  ProfessionalProfile,
  TestSeries,
  TestSeriesEnrollment,
  TestSeriesTest,
  TestSeriesTestCreatePayload,
  TestSeriesUpdatePayload,
} from "@/types/premium";

interface TestSeriesManageViewProps {
  seriesId: number;
}

interface LifecycleRow {
  userId: string;
  metrics: UserLifecycleMetrics;
  completion: number;
}

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

const parseMentorIds = (raw: string): string[] => {
  const values = raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
};

const parseMentorIdsFromMeta = (meta: Record<string, unknown>): string[] => {
  const out: string[] = [];
  const rawList = meta.mentor_user_ids;
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      const value = String(item || "").trim();
      if (value && !out.includes(value)) out.push(value);
    }
  }
  const single = String(meta.mentor_user_id || "").trim();
  if (single && !out.includes(single)) out.push(single);
  return out;
};

const formatQuestionCount = (count: number): string => `${count} question${count === 1 ? "" : "s"}`;

const emptyTestForm: TestSeriesTestCreatePayload = {
  title: "",
  description: "",
  test_kind: "prelims",
  thumbnail_url: "",
  is_public: true,
  is_premium: true,
  price: 0,
  is_finalized: false,
  series_order: 0,
  meta: {},
};

export default function TestSeriesManageView({ seriesId }: TestSeriesManageViewProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const providerLike = useMemo(() => isProviderLike(user), [user]);
  const mentorLike = useMemo(() => isMentorLike(user), [user]);
  const moderatorLike = useMemo(() => isModeratorLike(user), [user]);
  const adminLike = useMemo(() => isAdminLike(user), [user]);
  const currentUserId = String(user?.id || "").trim();

  const [busy, setBusy] = useState(true);
  const [series, setSeries] = useState<TestSeries | null>(null);
  const [tests, setTests] = useState<TestSeriesTest[]>([]);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [sessions, setSessions] = useState<MentorshipSession[]>([]);
  const [copyByTest, setCopyByTest] = useState<Record<string, MainsCopySubmission[]>>({});

  const [seriesForm, setSeriesForm] = useState<TestSeriesUpdatePayload>({
    title: "",
    description: "",
    cover_image_url: "",
    series_kind: "mains",
    access_type: "subscription",
    price: 0,
    is_public: false,
    is_active: true,
    meta: {},
  });

  const [testForm, setTestForm] = useState<TestSeriesTestCreatePayload>(emptyTestForm);
  const [editingTestId, setEditingTestId] = useState<number | null>(null);

  const [focusedTestId, setFocusedTestId] = useState<number | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState("");

  const [mentorUserIdsText, setMentorUserIdsText] = useState("");
  const [mentorDirectory, setMentorDirectory] = useState<ProfessionalProfile[]>([]);
  const [mentorDirectoryLoading, setMentorDirectoryLoading] = useState(false);
  const [seriesSetupStep, setSeriesSetupStep] = useState<1 | 2>(2);
  const [testModalOpen, setTestModalOpen] = useState(false);

  const canEditSeriesStructure = useMemo(() => {
    if (!series) return false;
    if (adminLike) return true;
    if (!currentUserId) return false;
    if (series.provider_user_id !== currentUserId) return false;
    return providerLike || mentorLike;
  }, [series, providerLike, mentorLike, adminLike, currentUserId]);

  const canManage = useMemo(() => {
    if (!series) return false;
    if (canEditSeriesStructure) return true;
    return mentorLike || moderatorLike;
  }, [series, canEditSeriesStructure, mentorLike, moderatorLike]);

  const canReviewCopies = useMemo(() => adminLike || mentorLike, [adminLike, mentorLike]);
  const canAccessMentorshipProviderScope = useMemo(
    () => adminLike || moderatorLike || mentorLike,
    [adminLike, moderatorLike, mentorLike],
  );
  const seriesKind = String(series?.series_kind || "").trim().toLowerCase();
  const normalizedSeriesKind = seriesKind === "prelims" ? "quiz" : seriesKind;
  const isPrelimsSeries = normalizedSeriesKind === "quiz";
  const showMentorshipFeatures = canAccessMentorshipProviderScope && !isPrelimsSeries;
  const showCopyCheckingWorkspace = !isPrelimsSeries;
  const builderFlowTitle = isPrelimsSeries ? "Quiz Master Builder Flow" : "Mains Mentor Builder Flow";
  const builderFlowDescription = isPrelimsSeries
    ? "Default view opens Tests + Quiz Add. Use details only when you need to edit series settings."
    : "Default view opens Tests + Mains Add. Use details only when you need to edit series settings.";
  const testsStepLabel = isPrelimsSeries ? "Tests + Quiz Add" : "Tests + Mains Add";
  const testsStepDescription = isPrelimsSeries
    ? "Create tests, then open quiz add methods for each test."
    : "Create tests, then open mains add methods for each test.";
  const canCreatePrelimsTests = useMemo(
    () => adminLike || moderatorLike || providerLike,
    [adminLike, moderatorLike, providerLike],
  );
  const canCreateMainsTests = useMemo(
    () => adminLike || moderatorLike || mentorLike,
    [adminLike, moderatorLike, mentorLike],
  );

  const allowedTestKindOptions = useMemo(() => {
    const rawSeriesKindValue = String(series?.series_kind || "").trim().toLowerCase();
    const seriesKindValue = rawSeriesKindValue === "prelims" ? "quiz" : rawSeriesKindValue;
    const options: Array<{ value: "mains" | "prelims"; label: string }> = [];

    if (seriesKindValue === "quiz") {
      if (canCreatePrelimsTests) {
        options.push({ value: "prelims", label: "Quiz/Prelims" });
      }
      return options;
    }

    if (seriesKindValue === "mains") {
      if (canCreateMainsTests) {
        options.push({ value: "mains", label: "Mains" });
      }
      return options;
    }

    if (canCreatePrelimsTests) {
      options.push({ value: "prelims", label: "Quiz/Prelims" });
    }
    if (canCreateMainsTests) {
      options.push({ value: "mains", label: "Mains" });
    }
    return options;
  }, [canCreateMainsTests, canCreatePrelimsTests, series?.series_kind]);

  const mainsTests = useMemo(() => tests.filter((test) => test.test_kind === "mains"), [tests]);

  const loadTestSubmissions = async (testId: number): Promise<MainsCopySubmission[]> => {
    try {
      const response = await premiumApi.get<MainsCopySubmission[]>(`/tests/${testId}/copy-submissions`);
      return Array.isArray(response.data) ? response.data : [];
    } catch {
      return [];
    }
  };

  const loadPage = async () => {
    setBusy(true);
    try {
      const [seriesResponse, testsResponse] = await Promise.all([
        premiumApi.get<TestSeries>(`/test-series/${seriesId}`),
        premiumApi.get<TestSeriesTest[]>(`/test-series/${seriesId}/tests`, { params: { include_inactive: true } }),
      ]);

      const nextSeries = seriesResponse.data;
      const nextTests = Array.isArray(testsResponse.data) ? testsResponse.data : [];
      const nextMeta =
        nextSeries.meta && typeof nextSeries.meta === "object"
          ? (nextSeries.meta as Record<string, unknown>)
          : {};
      setSeries(nextSeries);
      setTests(nextTests);
      setSeriesForm({
        title: nextSeries.title,
        description: nextSeries.description || "",
        cover_image_url: nextSeries.cover_image_url || "",
        series_kind: nextSeries.series_kind,
        access_type: nextSeries.access_type,
        price: Number(nextSeries.price || 0),
        is_public: nextSeries.is_public,
        is_active: nextSeries.is_active,
        meta: nextMeta,
      });
      setMentorUserIdsText(parseMentorIdsFromMeta(nextMeta).join(", "));

      const managerScope =
        adminLike || moderatorLike || mentorLike || (providerLike && nextSeries.provider_user_id === currentUserId);
      if (!managerScope) {
        setEnrollments([]);
        setRequests([]);
        setSessions([]);
        setCopyByTest({});
        return;
      }

      const enrollmentsResponse = await premiumApi.get<TestSeriesEnrollment[]>(`/test-series/${seriesId}/enrollments`);
      setEnrollments(Array.isArray(enrollmentsResponse.data) ? enrollmentsResponse.data : []);

      const rawNextSeriesKind = String(nextSeries.series_kind || "").trim().toLowerCase();
      const nextSeriesKind = rawNextSeriesKind === "prelims" ? "quiz" : rawNextSeriesKind;
      const mentorshipEnabledForSeries = canAccessMentorshipProviderScope && nextSeriesKind !== "quiz";
      if (mentorshipEnabledForSeries) {
        const [requestsResponse, sessionsResponse] = await Promise.all([
          premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "provider" } }),
          premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope: "provider" } }),
        ]);
        setRequests(Array.isArray(requestsResponse.data) ? requestsResponse.data : []);
        setSessions(Array.isArray(sessionsResponse.data) ? sessionsResponse.data : []);
      } else {
        setRequests([]);
        setSessions([]);
      }

      const mains = nextTests.filter((row) => row.test_kind === "mains");
      const submissionsEntries = await Promise.all(
        mains.map(async (row) => [String(row.id), await loadTestSubmissions(row.id)] as const),
      );
      setCopyByTest(Object.fromEntries(submissionsEntries));
      setFocusedTestId((prev) => {
        if (prev && mains.some((row) => row.id === prev)) return prev;
        return mains[0]?.id || null;
      });
    } catch (error: unknown) {
      toast.error("Failed to load manage view", { description: toError(error) });
      setSeries(null);
      setTests([]);
      setEnrollments([]);
      setRequests([]);
      setSessions([]);
      setCopyByTest({});
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      setBusy(false);
      return;
    }
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, loading, isAuthenticated, providerLike, mentorLike, moderatorLike, adminLike, currentUserId]);

  useEffect(() => {
    if (!canEditSeriesStructure) {
      setMentorDirectory([]);
      setMentorDirectoryLoading(false);
      return;
    }
    let active = true;
    setMentorDirectoryLoading(true);
    premiumApi
      .get<ProfessionalProfile[]>("/mentors/public", { params: { only_verified: false, limit: 200 } })
      .then((response) => {
        if (!active) return;
        setMentorDirectory(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMentorDirectory([]);
        toast.error("Failed to load mentors directory", { description: toError(error) });
      })
      .finally(() => {
        if (active) setMentorDirectoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canEditSeriesStructure]);

  const seriesRequests = useMemo(() => requests.filter((row) => row.series_id === seriesId), [requests, seriesId]);
  const requestIdSet = useMemo(() => new Set(seriesRequests.map((row) => row.id)), [seriesRequests]);
  const seriesSessions = useMemo(() => sessions.filter((row) => requestIdSet.has(row.request_id)), [sessions, requestIdSet]);
  const allSubmissions = useMemo(() => Object.values(copyByTest).flat(), [copyByTest]);

  const lifecycleRows = useMemo((): LifecycleRow[] => {
    const userIds = new Set<string>();
    for (const row of enrollments) {
      if (row.status === "active") userIds.add(row.user_id);
    }
    for (const row of allSubmissions) userIds.add(row.user_id);
    for (const row of seriesRequests) userIds.add(row.user_id);
    for (const row of seriesSessions) userIds.add(row.user_id);

    const out: LifecycleRow[] = [];
    for (const userId of userIds) {
      const userSubmissions = allSubmissions.filter((row) => row.user_id === userId);
      const userRequests = seriesRequests.filter((row) => row.user_id === userId);
      const userSessions = seriesSessions.filter((row) => row.user_id === userId);
      const metrics: UserLifecycleMetrics = {
        enrolled: enrollments.some((row) => row.user_id === userId && row.status === "active"),
        attempted_tests: new Set(userSubmissions.map((row) => row.test_collection_id)).size,
        copy_submissions: userSubmissions.length,
        copy_checked: userSubmissions.filter((row) => row.status === "checked").length,
        mentorship_requests: userRequests.length,
        mentorship_scheduled: userSessions.filter((row) => row.status !== "cancelled").length,
        mentorship_completed: userSessions.filter((row) => row.status === "completed").length,
      };
      out.push({ userId, metrics, completion: lifecycleCompletionPercent(metrics) });
    }

    out.sort((left, right) => right.completion - left.completion);
    return out;
  }, [allSubmissions, enrollments, seriesRequests, seriesSessions]);

  useEffect(() => {
    if (!selectedLearnerId && lifecycleRows.length > 0) {
      setSelectedLearnerId(lifecycleRows[0].userId);
      return;
    }
    if (selectedLearnerId && !lifecycleRows.some((row) => row.userId === selectedLearnerId)) {
      setSelectedLearnerId(lifecycleRows[0]?.userId || "");
    }
  }, [lifecycleRows, selectedLearnerId]);

  useEffect(() => {
    setSeriesSetupStep(2);
    setTestModalOpen(false);
  }, [seriesId]);

  useEffect(() => {
    const allowedKinds = allowedTestKindOptions.map((item) => item.value);
    if (allowedKinds.length === 0) {
      return;
    }
    const selectedKind = (testForm.test_kind || "").trim().toLowerCase() as "mains" | "prelims" | "";
    if (selectedKind && allowedKinds.includes(selectedKind)) {
      return;
    }
    setTestForm((prev) => ({ ...prev, test_kind: allowedKinds[0] }));
  }, [allowedTestKindOptions, testForm.test_kind]);

  const focusedSubmissions = useMemo(
    () => (focusedTestId ? copyByTest[String(focusedTestId)] || [] : []),
    [copyByTest, focusedTestId],
  );
  const selectedMentorIds = useMemo(() => parseMentorIds(mentorUserIdsText), [mentorUserIdsText]);
  const canUseTestBuilder = allowedTestKindOptions.length > 0;

  const toggleMentorId = (mentorId: string) => {
    const current = parseMentorIds(mentorUserIdsText);
    const next = current.includes(mentorId)
      ? current.filter((id) => id !== mentorId)
      : [...current, mentorId];
    setMentorUserIdsText(next.join(", "));
  };

  const saveSeries = async (): Promise<boolean> => {
    if (!series) return false;
    const title = String(seriesForm.title || "").trim();
    if (!title) {
      toast.error("Series title is required");
      return false;
    }
    const mergedMeta = {
      ...((seriesForm.meta || {}) as Record<string, unknown>),
      mentor_user_ids: selectedMentorIds,
      mentor_user_id: selectedMentorIds.length > 0 ? selectedMentorIds[0] : null,
    };
    try {
      await premiumApi.put(`/test-series/${series.id}`, {
        ...seriesForm,
        title,
        description: toNullableRichText(seriesForm.description || ""),
        meta: mergedMeta,
      });
      toast.success("Series updated");
      await loadPage();
      return true;
    } catch (error: unknown) {
      toast.error("Failed to update series", { description: toError(error) });
      return false;
    }
  };

  const saveSeriesAndContinue = async () => {
    const ok = await saveSeries();
    if (ok) setSeriesSetupStep(2);
  };

  const archiveSeries = async () => {
    if (!series) return;
    if (!window.confirm("Archive this test series?")) return;
    try {
      await premiumApi.delete(`/test-series/${series.id}`);
      toast.success("Series archived");
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to archive series", { description: toError(error) });
    }
  };

  const saveTest = async () => {
    const title = String(testForm.title || "").trim();
    if (!title) {
      toast.error("Test title is required");
      return;
    }
    if (!allowedTestKindOptions.some((item) => item.value === testForm.test_kind)) {
      toast.error("Selected test type is not allowed for this series and role.");
      return;
    }
    try {
      if (editingTestId) {
        await premiumApi.put(`/tests/${editingTestId}`, {
          ...testForm,
          title,
          description: toNullableRichText(testForm.description || ""),
        });
        toast.success("Test updated");
      } else {
        await premiumApi.post(`/test-series/${seriesId}/tests`, {
          ...testForm,
          title,
          description: toNullableRichText(testForm.description || ""),
        });
        toast.success("Test created");
      }
      setEditingTestId(null);
      setTestForm(emptyTestForm);
      setTestModalOpen(false);
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to save test", { description: toError(error) });
    }
  };

  const editTest = (test: TestSeriesTest) => {
    setEditingTestId(test.id);
    setTestForm({
      title: test.title,
      description: test.description || "",
      test_kind: test.test_kind,
      thumbnail_url: test.thumbnail_url || "",
      is_public: test.is_public,
      is_premium: test.is_premium,
      price: Number(test.price || 0),
      is_finalized: test.is_finalized,
      series_order: test.series_order,
      meta: test.meta || {},
    });
  };

  const openCreateTestModal = () => {
    setEditingTestId(null);
    setTestForm({
      ...emptyTestForm,
      test_kind: allowedTestKindOptions[0]?.value || "prelims",
    });
    setTestModalOpen(true);
  };

  const openEditTestModal = (test: TestSeriesTest) => {
    editTest(test);
    setTestModalOpen(true);
  };

  const archiveTest = async (testId: number) => {
    if (!window.confirm("Archive this test?")) return;
    try {
      await premiumApi.delete(`/tests/${testId}`);
      toast.success("Test archived");
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to archive test", { description: toError(error) });
    }
  };

  const refreshFocusedSubmissions = async () => {
    if (!focusedTestId) return;
    const rows = await loadTestSubmissions(focusedTestId);
    setCopyByTest((prev) => ({ ...prev, [String(focusedTestId)]: rows }));
  };

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading manage view...</div>;
  }

  if (!isAuthenticated) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Sign in to access series management.</div>;
  }

  if (!series) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Series not found or inaccessible.</div>;
  }

  if (!canManage) {
    return (
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        <p>You do not have management access for this series.</p>
        <Link href={`/test-series/${seriesId}`} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1.5 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" />
          Open learner view
        </Link>
      </div>
    );
  }

  const selectedMetrics = lifecycleRows.find((row) => row.userId === selectedLearnerId)?.metrics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <HistoryBackButton
            fallbackHref={`/test-series/${seriesId}`}
            label="Back to series detail"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            iconClassName="h-4 w-4"
          />
          <h1 className="text-2xl font-bold text-slate-900">Series Management: {series.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadPage()} className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
          {showMentorshipFeatures ? (
            <Link href={`/mentorship/manage?seriesId=${seriesId}`} className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              {adminLike || moderatorLike ? "Admin Scheduling Queue" : "Mentorship Status"}
            </Link>
          ) : null}
        </div>
      </div>

      {canEditSeriesStructure ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{builderFlowTitle}</p>
              <p className="text-xs text-slate-600">{builderFlowDescription}</p>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setSeriesSetupStep(1)}
                className={`rounded px-3 py-1.5 text-xs font-semibold ${seriesSetupStep === 1 ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                Edit Series Details
              </button>
              <button
                type="button"
                onClick={() => setSeriesSetupStep(2)}
                className={`rounded px-3 py-1.5 text-xs font-semibold ${seriesSetupStep === 2 ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {testsStepLabel}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {canEditSeriesStructure ? (
        <>
          {seriesSetupStep === 1 ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Series Settings</h2>
              <button type="button" onClick={() => void archiveSeries()} className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700">Archive</button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input value={seriesForm.title || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Series title" />
              <input value={seriesForm.cover_image_url || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Cover image URL" />
              <select value={seriesForm.series_kind || "mains"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))} className="rounded border border-slate-300 px-3 py-2 text-sm">
                <option value="mains">Mains</option>
                <option value="quiz">Quiz</option>
                <option value="hybrid">Hybrid</option>
              </select>
              <select value={seriesForm.access_type || "subscription"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, access_type: event.target.value as "free" | "subscription" | "paid" }))} className="rounded border border-slate-300 px-3 py-2 text-sm">
                <option value="subscription">Subscription</option>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
              <input type="number" min={0} value={String(seriesForm.price || 0)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, price: Number(event.target.value) }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Price" />
              <label className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm">
                <input type="checkbox" checked={Boolean(seriesForm.is_public)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, is_public: event.target.checked }))} /> Public
              </label>
            </div>
            <div className="mt-2">
              <RichTextField
                label="Series description"
                value={seriesForm.description || ""}
                onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                placeholder="Describe the series structure, learner outcome, and how the series is meant to be used."
                helperText="This becomes the main learner-facing description for the series."
              />
            </div>
            {!isPrelimsSeries ? (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Mentor Assignment</p>
                <p className="text-xs text-slate-500">Primary mentor receives new mentorship requests for this series.</p>
              </div>
              <input
                value={mentorUserIdsText}
                onChange={(event) => setMentorUserIdsText(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="Mentor user IDs (comma separated)"
              />
              <p className="text-xs text-slate-600">
                Primary mentor: {selectedMentorIds[0] || "Not assigned"} | Total assigned: {selectedMentorIds.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {mentorDirectoryLoading ? (
                  <span className="text-xs text-slate-500">Loading mentor directory...</span>
                ) : null}
                {!mentorDirectoryLoading
                  ? mentorDirectory.slice(0, 24).map((mentor) => {
                      const selected = selectedMentorIds.includes(mentor.user_id);
                      return (
                        <button
                          key={mentor.user_id}
                          type="button"
                          onClick={() => toggleMentorId(mentor.user_id)}
                          className={`rounded border px-2 py-1 text-xs ${
                            selected
                              ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                              : "border-slate-300 bg-white text-slate-700"
                          }`}
                        >
                          {selected ? "Selected: " : ""}{mentor.display_name}
                        </button>
                      );
                    })
                  : null}
              </div>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void saveSeries()} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Save Series</button>
              <button type="button" onClick={() => void saveSeriesAndContinue()} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                Save & Open Tests
              </button>
            </div>
            </section>
          ) : null}

          {seriesSetupStep === 2 ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Step 2: Add Tests</h2>
                  <p className="text-xs text-slate-600">{testsStepDescription}</p>
                </div>
                <button type="button" disabled={!canUseTestBuilder} onClick={openCreateTestModal} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  Add Test
                </button>
              </div>
              {tests.map((test) => (
                <article key={test.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{test.title}</p>
                      <p className="text-xs text-slate-500">{richTextToPlainText(test.description || "") || "No description"}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">{test.test_label}</span>
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-700">{formatQuestionCount(test.question_count || 0)}</span>
                        <span className="rounded bg-white px-1.5 py-0.5 text-slate-600 ring-1 ring-slate-200">Order {test.series_order}</span>
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${test.is_finalized ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {test.is_finalized ? "Finalized" : "Draft"}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/collections/${test.id}/question-methods`} className="rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-xs text-indigo-700">
                        Add Questions
                      </Link>
                      <Link href={`/collections/${test.id}`} className="rounded border border-sky-300 bg-white px-2.5 py-1.5 text-xs text-sky-700">
                        View Questions ({test.question_count || 0})
                      </Link>
                        {test.test_kind === "mains" ? (
                          <Link href={`/mains-mentor/ai-mains?collection_id=${test.id}&bind_test=1&mode=mains_mentor`} className="rounded border border-violet-300 bg-white px-2.5 py-1.5 text-xs text-violet-700">
                            AI Mains Studio
                          </Link>
                        ) : null}
                      <button type="button" onClick={() => openEditTestModal(test)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs">
                        Edit
                      </button>
                      <button type="button" onClick={() => void archiveTest(test.id)} className="rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700">
                        Archive
                      </button>
                      {test.test_kind === "mains" ? (
                        <Link href={`/collections/${test.id}/mains-test`} className="rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-emerald-700">
                          Open Mentor Desk
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {tests.length === 0 ? <p className="text-sm text-slate-500">No tests created yet. Click Add Test to begin.</p> : null}
            </section>
          ) : null}
        </>
      ) : null}

      {showCopyCheckingWorkspace ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Mains Submission Status Board</h2>
          <button type="button" disabled={!focusedTestId} onClick={() => void refreshFocusedSubmissions()} className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Refresh</button>
        </div>
        <p className="text-xs text-slate-600">
          This board is now a status overview. Open the mentor desk on a mains test to set ETA, review question-wise answer photos, and save marks for each answer.
        </p>
        {!canReviewCopies ? <p className="text-xs text-amber-700">Read-only view. Mentor role is required to operate the mentor desk.</p> : null}
        {mainsTests.length > 0 ? (
          <>
            <select value={focusedTestId ? String(focusedTestId) : ""} onChange={(event) => setFocusedTestId(Number(event.target.value))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              {mainsTests.map((test) => <option key={test.id} value={String(test.id)}>#{test.id} {test.title}</option>)}
            </select>
            <div className="space-y-2">
              {focusedSubmissions.map((submission) => (
                <div key={submission.id} className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                  <p className="font-semibold text-slate-800">Submission #{submission.id} | User: {submission.user_id} | {submission.status}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                    {submission.answer_pdf_url ? (
                      <a href={submission.answer_pdf_url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                        Open Answer PDF
                      </a>
                    ) : null}
                    {submission.checked_copy_pdf_url ? (
                      <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                        Open Checked Copy
                      </a>
                    ) : null}
                    {submission.total_marks !== null && submission.total_marks !== undefined ? (
                      <span className="text-emerald-700">Marks: {submission.total_marks}</span>
                    ) : null}
                    {submission.question_responses.length > 0 ? (
                      <span className="text-slate-600">{submission.question_responses.length} question-wise answer sets</span>
                    ) : null}
                    {submission.provider_eta_text ? <span className="text-amber-700">ETA: {submission.provider_eta_text}</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/collections/${submission.test_collection_id}/mains-test`} className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700">
                      Open Mentor Desk
                    </Link>
                  </div>
                </div>
              ))}
              {focusedSubmissions.length === 0 ? <p className="text-sm text-slate-500">No submissions for selected test.</p> : null}
            </div>
          </>
        ) : <p className="text-sm text-slate-500">No mains tests in this series yet.</p>}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Learner Lifecycle Dashboard</h2>
        <div className={`grid gap-2 text-xs ${isPrelimsSeries ? "md:grid-cols-3 xl:grid-cols-3" : "md:grid-cols-3 xl:grid-cols-6"}`}>
          <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Learners</p><p className="font-semibold text-slate-900">{lifecycleRows.length}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Submitted</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.copy_submissions > 0).length}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Checked</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.copy_checked > 0).length}</p></div>
          {!isPrelimsSeries ? (
            <>
              <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Mentorship req</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.mentorship_requests > 0).length}</p></div>
              <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Scheduled</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.mentorship_scheduled > 0).length}</p></div>
              <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Completed</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.mentorship_completed > 0).length}</p></div>
            </>
          ) : null}
        </div>
        {lifecycleRows.length > 0 ? (
          <>
            <select value={selectedLearnerId} onChange={(event) => setSelectedLearnerId(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              {lifecycleRows.map((row) => <option key={row.userId} value={row.userId}>{row.userId} ({row.completion}% complete)</option>)}
            </select>
            {selectedMetrics ? <UserLifecycleBoard metrics={selectedMetrics} /> : null}
          </>
        ) : <p className="text-sm text-slate-500">No user activity yet.</p>}
      </section>

      {testModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{editingTestId ? "Edit Test" : "Add Test"}</h3>
              <button type="button" onClick={() => setTestModalOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs">Close</button>
            </div>
            <div className="space-y-2">
              <input
                value={testForm.title || ""}
                onChange={(event) => setTestForm((prev) => ({ ...prev, title: event.target.value }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="Test title"
              />
              <RichTextField
                label="Test description"
                value={testForm.description || ""}
                onChange={(value) => setTestForm((prev) => ({ ...prev, description: value }))}
                placeholder="Describe what this test covers, how learners should use it, and any submission expectations."
                helperText="Visible on test cards and detail pages."
              />
              <div className="grid gap-2 md:grid-cols-2">
                <select
                  value={testForm.test_kind || allowedTestKindOptions[0]?.value || "prelims"}
                  onChange={(event) => setTestForm((prev) => ({ ...prev, test_kind: event.target.value as "mains" | "prelims" }))}
                  disabled={allowedTestKindOptions.length <= 1}
                  className="rounded border border-slate-300 px-2 py-2 text-sm"
                >
                  {allowedTestKindOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  value={String(testForm.series_order || 0)}
                  onChange={(event) => setTestForm((prev) => ({ ...prev, series_order: Number(event.target.value) }))}
                  className="rounded border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Order"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={!canUseTestBuilder} onClick={() => void saveTest()} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {editingTestId ? "Update Test" : "Create Test"}
              </button>
              <button type="button" onClick={() => setTestModalOpen(false)} className="rounded border border-slate-300 px-3 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
