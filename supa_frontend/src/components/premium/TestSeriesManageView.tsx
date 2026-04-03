"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarDays, ClipboardCheck, FileQuestion, LayoutPanelTop, MessageSquareWarning, PencilLine, PlayCircle, Plus, RefreshCcw, Sparkles, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getMainsMentorWorkspaceSections, getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import DiscussionConfigEditor from "@/components/premium/DiscussionConfigEditor";
import UserLifecycleBoard from "@/components/premium/UserLifecycleBoard";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isMentorLike, isModeratorLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { richTextToPlainText, toNullableRichText } from "@/lib/richText";
import { getDiscussionDraftFromMeta, getDiscussionFromMeta, mergeDiscussionIntoMeta } from "@/lib/testSeriesDiscussion";
import { lifecycleCompletionPercent, type UserLifecycleMetrics } from "@/lib/testSeriesLifecycle";
import RichTextField from "@/components/ui/RichTextField";
import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  ProfessionalProfile,
  TestSeries,
  TestSeriesEnrollment,
  TestSeriesProgramItem,
  TestSeriesProgramItemCreatePayload,
  TestSeriesProgramItemUpdatePayload,
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

type CurriculumEntry =
  | {
      entry_type: "test";
      entry_key: string;
      series_order: number;
      created_at?: string | null;
      test: TestSeriesTest;
    }
  | {
      entry_type: "pdf" | "lecture";
      entry_key: string;
      series_order: number;
      created_at?: string | null;
      item: TestSeriesProgramItem;
    };

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

const titleCaseLabel = (value?: string | null, fallback = "n/a"): string => {
  const normalized = String(value || "")
    .trim()
    .replaceAll("_", " ");
  if (!normalized) return fallback;
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
};

const emailHandleToLabel = (email?: string | null): string => {
  const handle = String(email || "").split("@")[0]?.trim();
  if (!handle) return "";
  return handle
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

const learnerLabelFromRequest = (request?: MentorshipRequest | null): string => {
  const learnerName = typeof request?.meta?.learner_name === "string" ? request.meta.learner_name.trim() : "";
  if (learnerName) return learnerName;
  const learnerEmail = typeof request?.meta?.learner_email === "string" ? request.meta.learner_email.trim() : "";
  return emailHandleToLabel(learnerEmail) || "Learner";
};

function PrelimsMetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{hint}</p>
    </article>
  );
}

function testStatusLabel(test: TestSeriesTest): string {
  if (test.is_finalized && test.is_public && test.is_active) return "Published";
  if (test.is_finalized) return "Ready";
  return "Draft";
}

function testStatusClass(test: TestSeriesTest): string {
  if (test.is_finalized && test.is_public && test.is_active) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (test.is_finalized) return "border-indigo-200 bg-indigo-50 text-indigo-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

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

const emptyProgramItemForm: TestSeriesProgramItemCreatePayload = {
  item_type: "pdf",
  title: "",
  description: "",
  resource_url: "",
  scheduled_for: "",
  duration_minutes: 60,
  cover_image_url: "",
  series_order: 0,
  is_active: true,
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
  const [programItems, setProgramItems] = useState<TestSeriesProgramItem[]>([]);
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
  const [programItemForm, setProgramItemForm] = useState<TestSeriesProgramItemCreatePayload>(emptyProgramItemForm);
  const [editingProgramItemId, setEditingProgramItemId] = useState<number | null>(null);

  const [focusedTestId, setFocusedTestId] = useState<number | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState("");

  const [mentorUserIdsText, setMentorUserIdsText] = useState("");
  const [mentorDirectory, setMentorDirectory] = useState<ProfessionalProfile[]>([]);
  const [mentorDirectoryLoading, setMentorDirectoryLoading] = useState(false);
  const [seriesSetupStep, setSeriesSetupStep] = useState<1 | 2>(2);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [programItemModalOpen, setProgramItemModalOpen] = useState(false);

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
  const quizWorkspaceSections = useMemo(
    () => getQuizMasterWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );
  const mainsWorkspaceSections = useMemo(
    () => getMainsMentorWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );
  const showMentorshipFeatures = canAccessMentorshipProviderScope && !isPrelimsSeries;
  const showCopyCheckingWorkspace = !isPrelimsSeries;
  const builderFlowTitle = isPrelimsSeries ? "Quiz Master Builder Flow" : "Mains Mentor Builder Flow";
  const builderFlowDescription = isPrelimsSeries
    ? "Set the program basics first, then move into tests, question methods, and complaint handling."
    : "Set the program basics first, then move into tests, submissions, and learner progress.";
  const testsStepLabel = isPrelimsSeries ? "Tests + Quiz Add" : "Tests + Mains Add";
  const testsStepDescription = isPrelimsSeries
    ? "Add each test, wire the question builder, and keep the learner-facing flow clean."
    : "Add each mains paper here, then manage submissions and learner progress from the same workspace.";
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
  const orderedTests = useMemo(
    () =>
      [...tests].sort((left, right) => {
        const leftOrder = Number.isFinite(left.series_order) ? Number(left.series_order) : Number.MAX_SAFE_INTEGER;
        const rightOrder = Number.isFinite(right.series_order) ? Number(right.series_order) : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.id - right.id;
      }),
    [tests],
  );
  const orderedProgramEntries = useMemo<CurriculumEntry[]>(
    () =>
      [
        ...orderedTests.map((test) => ({
          entry_type: "test" as const,
          entry_key: `test-${test.id}`,
          series_order: Number.isFinite(test.series_order) ? Number(test.series_order) : Number.MAX_SAFE_INTEGER,
          created_at: test.created_at || null,
          test,
        })),
        ...programItems.map((item) => ({
          entry_type: item.item_type,
          entry_key: `${item.item_type}-${item.id}`,
          series_order: Number.isFinite(item.series_order) ? Number(item.series_order) : Number.MAX_SAFE_INTEGER,
          created_at: item.created_at || null,
          item,
        })),
      ].sort((left, right) => {
        if (left.series_order !== right.series_order) return left.series_order - right.series_order;
        const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
        const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
        if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
        return left.entry_key.localeCompare(right.entry_key);
      }),
    [orderedTests, programItems],
  );

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
      const [seriesResponse, testsResponse, programItemsResponse] = await Promise.all([
        premiumApi.get<TestSeries>(`/test-series/${seriesId}`),
        premiumApi.get<TestSeriesTest[]>(`/test-series/${seriesId}/tests`, { params: { include_inactive: true } }),
        premiumApi.get<TestSeriesProgramItem[]>(`/test-series/${seriesId}/program-items`, { params: { include_inactive: true } }),
      ]);

      const nextSeries = seriesResponse.data;
      const nextTests = Array.isArray(testsResponse.data) ? testsResponse.data : [];
      const nextProgramItems = Array.isArray(programItemsResponse.data) ? programItemsResponse.data : [];
      const nextMeta =
        nextSeries.meta && typeof nextSeries.meta === "object"
          ? (nextSeries.meta as Record<string, unknown>)
          : {};
      setSeries(nextSeries);
      setTests(nextTests);
      setProgramItems(nextProgramItems);
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
      setProgramItems([]);
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
  const learnerDirectory = useMemo(() => {
    const output = new Map<string, string>();
    for (const row of seriesRequests) {
      if (!output.has(row.user_id)) output.set(row.user_id, learnerLabelFromRequest(row));
    }
    return output;
  }, [seriesRequests]);

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
    setProgramItemModalOpen(false);
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

  const saveProgramItem = async () => {
    const title = String(programItemForm.title || "").trim();
    if (!title) {
      toast.error("Program item title is required");
      return;
    }
    if (programItemForm.item_type === "pdf" && !String(programItemForm.resource_url || "").trim()) {
      toast.error("PDF items require a resource URL");
      return;
    }
    if (programItemForm.item_type === "lecture" && !String(programItemForm.scheduled_for || "").trim()) {
      toast.error("Lecture items require a scheduled time");
      return;
    }

    const payload: TestSeriesProgramItemUpdatePayload = {
      ...programItemForm,
      title,
      description: toNullableRichText(programItemForm.description || ""),
      resource_url: String(programItemForm.resource_url || "").trim() || undefined,
      scheduled_for: String(programItemForm.scheduled_for || "").trim() || undefined,
      cover_image_url: String(programItemForm.cover_image_url || "").trim() || undefined,
    };

    try {
      if (editingProgramItemId) {
        await premiumApi.put(`/test-series/program-items/${editingProgramItemId}`, payload);
        toast.success("Program item updated");
      } else {
        await premiumApi.post(`/test-series/${seriesId}/program-items`, payload);
        toast.success("Program item added");
      }
      setEditingProgramItemId(null);
      setProgramItemForm(emptyProgramItemForm);
      setProgramItemModalOpen(false);
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to save program item", { description: toError(error) });
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

  const openCreateProgramItemModal = () => {
    setEditingProgramItemId(null);
    setProgramItemForm(emptyProgramItemForm);
    setProgramItemModalOpen(true);
  };

  const openEditProgramItemModal = (item: TestSeriesProgramItem) => {
    setEditingProgramItemId(item.id);
    setProgramItemForm({
      item_type: item.item_type,
      title: item.title,
      description: item.description || "",
      resource_url: item.resource_url || "",
      scheduled_for: item.scheduled_for || "",
      duration_minutes: item.duration_minutes || 60,
      cover_image_url: item.cover_image_url || "",
      series_order: item.series_order || 0,
      is_active: item.is_active ?? true,
      meta: item.meta || {},
    });
    setProgramItemModalOpen(true);
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

  const archiveProgramItem = async (itemId: number) => {
    if (!window.confirm("Archive this program item?")) return;
    try {
      await premiumApi.delete(`/test-series/program-items/${itemId}`);
      toast.success("Program item archived");
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to archive program item", { description: toError(error) });
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
  const finalDiscussion = getDiscussionDraftFromMeta(seriesForm.meta, "final_discussion");
  const activeTestDiscussion = getDiscussionDraftFromMeta(testForm.meta, "test_discussion");
  const publishedTests = orderedTests.filter((test) => Boolean(test.is_finalized && test.is_public && test.is_active));
  const discussionReadyTests = orderedTests.filter((test) => Boolean(getDiscussionFromMeta(test.meta, "test_discussion")));
  const totalQuestions = orderedTests.reduce((sum, test) => sum + Number(test.question_count || 0), 0);
  const builderIntegrity = orderedTests.length > 0
    ? Math.round((((publishedTests.length * 2) + discussionReadyTests.length) / (orderedTests.length * 3)) * 100)
    : 0;
  const mainsPendingReviewCount = allSubmissions.filter((row) => row.status !== "checked").length;
  const mainsScheduledSessionCount = seriesSessions.filter((row) => row.status === "scheduled" || row.status === "live").length;
  const mainsCompletedSessionCount = seriesSessions.filter((row) => row.status === "completed").length;
  const activeLearnerCount = lifecycleRows.length;

  if (isPrelimsSeries) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
        <RoleWorkspaceSidebar
          title="Prelims Expert Workspace"
          subtitle="Build objective programs, open question lanes, and keep learner complaints visible."
          sections={quizWorkspaceSections}
          className="lg:self-start"
        />

        <div className="min-w-0 flex-1 space-y-6">
          <section className="rounded-[34px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(224,231,255,0.9),_transparent_34%),linear-gradient(180deg,_#ffffff,_#f8fafc)] p-6 shadow-sm sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-3xl">
                <HistoryBackButton
                  fallbackHref={`/test-series/${seriesId}`}
                  label="Back to series detail"
                  className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
                  iconClassName="h-4 w-4"
                />
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-indigo-600">Programs / {series.title}</p>
                <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl">Workspace Content</h1>
                <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
                  Curate the prelims journey into launch-ready tests. Create each mock, open its question methods, attach discussion support, and keep complaint resolution one click away.
                </p>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Workspace state</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Access</p>
                    <p className="mt-2 font-bold text-slate-900">{String(series.access_type || "subscription").replace(/^./, (char) => char.toUpperCase())}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Visibility</p>
                    <p className="mt-2 font-bold text-slate-900">{series.is_public ? "Public" : "Private"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setSeriesSetupStep(1)}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold shadow-sm transition ${
                  seriesSetupStep === 1
                    ? "bg-indigo-950 text-white"
                    : "border border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                }`}
              >
                <LayoutPanelTop className="h-4 w-4" />
                Program Setup
              </button>
              <button
                type="button"
                onClick={openCreateTestModal}
                disabled={!canUseTestBuilder}
                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Add Test
              </button>
              <button
                type="button"
                onClick={() => void loadPage()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
              <Link
                href="/quiz-master/complaints"
                className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900"
              >
                <MessageSquareWarning className="h-4 w-4" />
                Complaint Desk
              </Link>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-4">
            <PrelimsMetricCard
              label="Published Tests"
              value={publishedTests.length}
              hint="Mocks currently ready for learner access."
            />
            <PrelimsMetricCard
              label="Question Inventory"
              value={totalQuestions}
              hint="Total questions connected across the series."
            />
            <PrelimsMetricCard
              label="Discussion Coverage"
              value={`${discussionReadyTests.length}/${orderedTests.length || 0}`}
              hint="Tests that already have a post-test discussion block."
            />
            <PrelimsMetricCard
              label="Program Integrity"
              value={`${builderIntegrity}%`}
              hint="Blend of publishing progress and discussion readiness."
            />
          </section>

          {seriesSetupStep === 1 ? (
            <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Program settings</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Series identity and access</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                    Update the learner-facing identity before you continue adding or publishing tests.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void archiveSeries()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Archive Series
                </button>
              </div>

              <div className="mt-8 grid gap-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <input value={seriesForm.title || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm" placeholder="Series title" />
                  <input value={seriesForm.cover_image_url || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm" placeholder="Cover image URL" />
                  <select value={seriesForm.series_kind || "quiz"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
                    <option value="quiz">Quiz</option>
                    <option value="mains">Mains</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                  <select value={seriesForm.access_type || "subscription"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, access_type: event.target.value as "free" | "subscription" | "paid" }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
                    <option value="subscription">Subscription</option>
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                  <input type="number" min={0} value={String(seriesForm.price || 0)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, price: Number(event.target.value) }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm" placeholder="Price" />
                  <label className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={Boolean(seriesForm.is_public)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, is_public: event.target.checked }))} />
                    Public
                  </label>
                </div>

                <RichTextField
                  label="Series description"
                  value={seriesForm.description || ""}
                  onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                  placeholder="Describe the program structure, learner outcome, and how the tests are meant to be used."
                  helperText="This becomes the main learner-facing description for the series."
                />

                <DiscussionConfigEditor
                  heading="End-of-series discussion"
                  hint="Publish a final discussion after learners finish the whole prelims series. This can be a recorded video or a scheduled live Agora class."
                  value={finalDiscussion}
                  onChange={(discussion) =>
                    setSeriesForm((prev) => ({
                      ...prev,
                      meta: mergeDiscussionIntoMeta(prev.meta || {}, "final_discussion", discussion),
                    }))
                  }
                />

                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => void saveSeries()} className="rounded-2xl bg-indigo-950 px-5 py-3 text-sm font-semibold text-white">
                    Save Program
                  </button>
                  <button type="button" onClick={() => void saveSeriesAndContinue()} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800">
                    Save & Open Tests
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Workspace content</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Tests in this program</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                    Each test acts as a program block. Open question methods, review the question inventory, or edit the test before publishing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateTestModal}
                  disabled={!canUseTestBuilder}
                  className="inline-flex items-center gap-2 rounded-2xl bg-indigo-950 px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Add Test
                </button>
              </div>

              <div className="mt-8 space-y-4">
                {orderedTests.map((test, index) => {
                  const testDiscussion = getDiscussionFromMeta(test.meta, "test_discussion");
                  return (
                    <article key={test.id} className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 gap-4">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-100 text-lg font-black text-indigo-900">
                            {String(index + 1).padStart(2, "0")}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-2xl font-black tracking-tight text-slate-950">{test.title}</h3>
                              <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${testStatusClass(test)}`}>
                                {testStatusLabel(test)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-7 text-slate-600">
                              {richTextToPlainText(test.description || "") || "Add the learner-facing description for this test so the catalog and series detail page stay informative."}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                <FileQuestion className="h-3.5 w-3.5" />
                                {formatQuestionCount(test.question_count || 0)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                <BookOpen className="h-3.5 w-3.5" />
                                Order {test.series_order}
                              </span>
                              {testDiscussion ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                                  <PlayCircle className="h-3.5 w-3.5" />
                                  Discussion ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                                  <Sparkles className="h-3.5 w-3.5" />
                                  Discussion pending
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Link href={`/collections/${test.id}/question-methods`} className="inline-flex items-center gap-1 rounded-2xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700">
                            Add Questions
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                          <Link href={`/collections/${test.id}`} className="inline-flex items-center gap-1 rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700">
                            View Questions
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                          <button type="button" onClick={() => openEditTestModal(test)} className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                            <PencilLine className="h-4 w-4" />
                            Edit
                          </button>
                          <button type="button" onClick={() => void archiveTest(test.id)} className="inline-flex items-center gap-1 rounded-2xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700">
                            <Trash2 className="h-4 w-4" />
                            Archive
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {orderedTests.length === 0 ? (
                  <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
                    <p className="text-lg font-semibold text-slate-900">No tests created yet</p>
                    <p className="mt-2 text-sm text-slate-600">Create the first prelims test to open the question methods workflow for this program.</p>
                    <button
                      type="button"
                      onClick={openCreateTestModal}
                      disabled={!canUseTestBuilder}
                      className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-indigo-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Plus className="h-4 w-4" />
                      Add First Test
                    </button>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="space-y-4">
              <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Complaint handling</p>
                <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Learner complaint desk</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Result-page complaints from learners are managed in a dedicated desk. Use it to mark items received, pending, or resolved with a creator note.
                </p>
                <Link
                  href="/quiz-master/complaints"
                  className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
                >
                  <MessageSquareWarning className="h-4 w-4" />
                  Open Complaint Desk
                </Link>
              </article>

              <article className="rounded-[32px] border border-indigo-200 bg-indigo-950 p-6 text-white shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-200">Builder guidance</p>
                <h3 className="mt-3 text-2xl font-black tracking-tight">Recommended content mix</h3>
                <div className="mt-5 space-y-3 text-sm leading-7 text-indigo-100">
                  <p>1. Publish the test shell first so question authors have a stable target collection.</p>
                  <p>2. Add questions through the question methods desk before you switch the test into a published state.</p>
                  <p>3. Add a post-test discussion whenever the mock deserves a guided debrief or current-affairs wrap-up.</p>
                </div>
              </article>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
      <RoleWorkspaceSidebar
        title="Mains Mentor Workspace"
        subtitle="Programs, reviews, mentorship."
        sections={mainsWorkspaceSections}
        className="lg:self-start"
      />

      <div className="min-w-0 space-y-8">
        <section className="overflow-hidden rounded-[34px] border border-[#d8def4] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.95),_rgba(255,255,255,1)_46%,_rgba(239,246,255,0.95)_100%)] p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-3">
              <HistoryBackButton
                fallbackHref={`/test-series/${seriesId}`}
                label="Back to series detail"
                className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
                iconClassName="h-4 w-4"
              />
              <p className="text-xs font-black uppercase tracking-[0.3em] text-[#1d3b8b]">Workspace Content</p>
              <h1 className="text-3xl font-black tracking-tight text-[#091a4a] sm:text-4xl">{series.title}</h1>
              <p className="text-sm text-slate-600">Manage the program structure, test delivery, learner progress, and mentor workflow from one desk.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEditSeriesStructure ? (
                <button
                  type="button"
                  onClick={() => setSeriesSetupStep(1)}
                  className={`rounded-full px-4 py-2.5 text-sm font-semibold ${seriesSetupStep === 1 ? "bg-[#091a4a] text-white" : "border border-indigo-300 bg-indigo-50 text-indigo-700"}`}
                >
                  {seriesSetupStep === 1 ? "Editing Details" : "Edit Series Details"}
                </button>
              ) : null}
              <button type="button" onClick={() => void loadPage()} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
              {showMentorshipFeatures ? (
                <Link href={`/mentorship/manage?seriesId=${seriesId}`} className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
                  {adminLike || moderatorLike ? "Admin Scheduling Queue" : "Mentorship Status"}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <article className="rounded-[28px] bg-[#0b1c5a] p-6 text-white shadow-lg shadow-[#0b1c5a]/15">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">Program Integrity</p>
                  <p className="mt-3 text-5xl font-black tracking-tight">{builderIntegrity}%</p>
                </div>
                <div className="rounded-[22px] bg-white/10 p-4 text-white">
                  <ClipboardCheck className="h-8 w-8" />
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Tests</p>
                  <p className="mt-2 text-2xl font-black">{orderedTests.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Questions</p>
                  <p className="mt-2 text-2xl font-black">{totalQuestions}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Published</p>
                  <p className="mt-2 text-2xl font-black">{publishedTests.length}</p>
                </div>
              </div>
            </article>

            <div className="grid gap-4 sm:grid-cols-2">
              <article className="rounded-[24px] border border-sky-200 bg-sky-100/70 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-white/70 p-3 text-sky-700">
                    <Users className="h-6 w-6" />
                  </div>
                  <p className="text-4xl font-black tracking-tight text-[#091a4a]">{activeLearnerCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-sky-900">Active Learners</p>
              </article>
              <article className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                    <FileQuestion className="h-6 w-6" />
                  </div>
                  <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mainsPendingReviewCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Pending Reviews</p>
              </article>
              <article className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                    <CalendarDays className="h-6 w-6" />
                  </div>
                  <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mainsScheduledSessionCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Scheduled Sessions</p>
              </article>
              <article className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mainsCompletedSessionCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Completed Sessions</p>
              </article>
            </div>
          </div>
        </section>

      {canEditSeriesStructure ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{builderFlowTitle}</p>
              {builderFlowDescription ? <p className="text-xs text-slate-600">{builderFlowDescription}</p> : null}
            </div>
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setSeriesSetupStep(1)}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${seriesSetupStep === 1 ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                Edit Series Details
              </button>
              <button
                type="button"
                onClick={() => setSeriesSetupStep(2)}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${seriesSetupStep === 2 ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
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
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-900">Series Settings</h2>
              </div>
              <button type="button" onClick={() => void archiveSeries()} className="rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">Archive Series</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={seriesForm.title || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm" placeholder="Series title" />
              <input value={seriesForm.cover_image_url || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm" placeholder="Cover image URL" />
              <select value={seriesForm.series_kind || "mains"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
                <option value="mains">Mains</option>
                <option value="quiz">Quiz</option>
                <option value="hybrid">Hybrid</option>
              </select>
              <select value={seriesForm.access_type || "subscription"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, access_type: event.target.value as "free" | "subscription" | "paid" }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
                <option value="subscription">Subscription</option>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
              <input type="number" min={0} value={String(seriesForm.price || 0)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, price: Number(event.target.value) }))} className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm" placeholder="Price" />
              <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
                <input type="checkbox" checked={Boolean(seriesForm.is_public)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, is_public: event.target.checked }))} /> Public
              </label>
            </div>
            <div className="mt-2">
              <RichTextField
                label="Series description"
                value={seriesForm.description || ""}
                onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                placeholder="Series description"
              />
            </div>
            {isPrelimsSeries ? (
              <div className="mt-3">
                <DiscussionConfigEditor
                  heading="End-of-series discussion"
                  hint=""
                  value={finalDiscussion}
                  onChange={(discussion) =>
                    setSeriesForm((prev) => ({
                      ...prev,
                      meta: mergeDiscussionIntoMeta(prev.meta || {}, "final_discussion", discussion),
                    }))
                  }
                />
              </div>
            ) : null}
            {!isPrelimsSeries ? (
              <div className="mt-4 space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Mentor Assignment</p>
              </div>
              <input
                value={mentorUserIdsText}
                onChange={(event) => setMentorUserIdsText(event.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"
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
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void saveSeries()} className="rounded-full bg-[#091a4a] px-5 py-2.5 text-sm font-semibold text-white">Save Series</button>
              <button type="button" onClick={() => void saveSeriesAndContinue()} className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700">
                Save & Open Tests
              </button>
            </div>
            </section>
          ) : null}

          {seriesSetupStep === 2 ? (
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900">Program Curriculum</h2>
                  <p className="text-sm text-slate-600">
                    {testsStepDescription} You can now mix tests with PDF handouts and scheduled lecture blocks in one ordered preparation flow.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!canUseTestBuilder} onClick={openCreateTestModal} className="rounded-full bg-[#091a4a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                    Add Test
                  </button>
                  <button type="button" onClick={openCreateProgramItemModal} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
                    Add PDF / Lecture
                  </button>
                </div>
              </div>
              {orderedProgramEntries.map((entry) => {
                if (entry.entry_type === "test") {
                  const test = entry.test;
                  return (
                    <article key={entry.entry_key} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xl font-black tracking-tight text-slate-900">{test.title}</p>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${testStatusClass(test)}`}>
                              {testStatusLabel(test)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{richTextToPlainText(test.description || "") || "No description added."}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">{test.test_label}</span>
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-semibold text-sky-700">{formatQuestionCount(test.question_count || 0)}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">Order {test.series_order}</span>
                            {test.test_kind === "mains" ? (
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 font-semibold text-violet-700">
                                {Number(copyByTest[String(test.id)]?.length || 0)} submission{Number(copyByTest[String(test.id)]?.length || 0) === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/collections/${test.id}/question-methods`} className="rounded-full border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700">
                            Add Questions
                          </Link>
                          <Link href={`/collections/${test.id}`} className="rounded-full border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700">
                            View Questions ({test.question_count || 0})
                          </Link>
                          {test.test_kind === "mains" ? (
                            <Link href={`/mains-mentor/ai-mains?collection_id=${test.id}&bind_test=1&mode=mains_mentor`} className="rounded-full border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-700">
                              AI Mains Studio
                            </Link>
                          ) : null}
                          <button type="button" onClick={() => openEditTestModal(test)} className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                            Edit
                          </button>
                          <button type="button" onClick={() => void archiveTest(test.id)} className="rounded-full border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700">
                            Archive
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                }

                const item = entry.item;
                const isPdf = item.item_type === "pdf";
                return (
                  <article key={entry.entry_key} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xl font-black tracking-tight text-slate-900">{item.title}</p>
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${isPdf ? "border-sky-200 bg-sky-50 text-sky-800" : "border-violet-200 bg-violet-50 text-violet-800"}`}>
                            {isPdf ? "PDF Resource" : "Lecture"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{richTextToPlainText(item.description || "") || (isPdf ? "PDF handout" : "Scheduled lecture block")}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">Order {item.series_order}</span>
                          {item.scheduled_for ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">{new Date(item.scheduled_for).toLocaleString()}</span> : null}
                          {item.duration_minutes ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">{item.duration_minutes} min</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.resource_url ? (
                          <a href={item.resource_url} target="_blank" rel="noreferrer" className={`rounded-full border bg-white px-3 py-2 text-xs font-semibold ${isPdf ? "border-sky-300 text-sky-700" : "border-violet-300 text-violet-700"}`}>
                            {isPdf ? "Open PDF" : "Open Link"}
                          </a>
                        ) : null}
                        <button type="button" onClick={() => openEditProgramItemModal(item)} className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          Edit
                        </button>
                        <button type="button" onClick={() => void archiveProgramItem(item.id)} className="rounded-full border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700">
                          Archive
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {orderedProgramEntries.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No curriculum items created yet. Add a test, PDF, or lecture to begin.</p> : null}
            </section>
          ) : null}
        </>
      ) : null}

      {showCopyCheckingWorkspace ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">Mains Submission Status Board</h2>
          </div>
          <button type="button" disabled={!focusedTestId} onClick={() => void refreshFocusedSubmissions()} className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold disabled:opacity-50">Refresh</button>
        </div>
        {!canReviewCopies ? <p className="text-xs text-amber-700">Read-only view. Mentor role is required to operate the mentor desk.</p> : null}
        {mainsTests.length > 0 ? (
          <>
            <select value={focusedTestId ? String(focusedTestId) : ""} onChange={(event) => setFocusedTestId(Number(event.target.value))} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
              {mainsTests.map((test) => <option key={test.id} value={String(test.id)}>#{test.id} {test.title}</option>)}
            </select>
            <div className="space-y-3">
              {focusedSubmissions.map((submission) => (
                <div key={submission.id} className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 text-xs">
                  <p className="font-semibold text-slate-800">
                    Submission #{submission.id} | {learnerDirectory.get(submission.user_id) || "Learner"} | {titleCaseLabel(submission.status)}
                  </p>
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
                    <Link href={`/collections/${submission.test_collection_id}`} className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                      Open Test
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

      {!isPrelimsSeries ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">Learner Lifecycle Dashboard</h2>
          </div>
          <div className="grid gap-2 text-xs md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Learners</p><p className="font-semibold text-slate-900">{lifecycleRows.length}</p></div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Submitted</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.copy_submissions > 0).length}</p></div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Checked</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.copy_checked > 0).length}</p></div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Mentorship req</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.mentorship_requests > 0).length}</p></div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Scheduled</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.mentorship_scheduled > 0).length}</p></div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2"><p className="text-slate-500">Completed</p><p className="font-semibold text-slate-900">{lifecycleRows.filter((row) => row.metrics.mentorship_completed > 0).length}</p></div>
          </div>
          {lifecycleRows.length > 0 ? (
            <>
              <select value={selectedLearnerId} onChange={(event) => setSelectedLearnerId(event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
                {lifecycleRows.map((row) => <option key={row.userId} value={row.userId}>{learnerDirectory.get(row.userId) || "Learner"} ({row.completion}% complete)</option>)}
              </select>
              {selectedMetrics ? <UserLifecycleBoard metrics={selectedMetrics} /> : null}
            </>
          ) : <p className="text-sm text-slate-500">No user activity yet.</p>}
        </section>
      ) : null}

      {testModalOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-4">
          <div className="flex min-h-full items-start justify-center py-2 sm:items-center">
            <div className="flex w-full max-w-lg max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-base font-semibold text-slate-900">{editingTestId ? "Edit Test" : "Add Test"}</h3>
                <button type="button" onClick={() => setTestModalOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs">Close</button>
              </div>
              <div className="space-y-3 overflow-y-auto px-4 py-3">
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
                  placeholder="Test description"
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
                {(testForm.test_kind || allowedTestKindOptions[0]?.value || "prelims") === "prelims" ? (
                  <DiscussionConfigEditor
                    heading="Post-test discussion"
                    hint=""
                    value={activeTestDiscussion}
                    onChange={(discussion) =>
                      setTestForm((prev) => ({
                        ...prev,
                        meta: mergeDiscussionIntoMeta(prev.meta || {}, "test_discussion", discussion),
                      }))
                    }
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
                <button type="button" disabled={!canUseTestBuilder} onClick={() => void saveTest()} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {editingTestId ? "Update Test" : "Create Test"}
                </button>
                <button type="button" onClick={() => setTestModalOpen(false)} className="rounded border border-slate-300 px-3 py-2 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {programItemModalOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-4">
          <div className="flex min-h-full items-start justify-center py-2 sm:items-center">
            <div className="flex w-full max-w-lg max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-base font-semibold text-slate-900">{editingProgramItemId ? "Edit Program Item" : "Add Program Item"}</h3>
                <button type="button" onClick={() => setProgramItemModalOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs">Close</button>
              </div>
              <div className="space-y-3 overflow-y-auto px-4 py-3">
                <select
                  value={programItemForm.item_type}
                  onChange={(event) => setProgramItemForm((prev) => ({ ...prev, item_type: event.target.value as "pdf" | "lecture" }))}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="pdf">PDF Resource</option>
                  <option value="lecture">Scheduled Lecture</option>
                </select>
                <input
                  value={programItemForm.title || ""}
                  onChange={(event) => setProgramItemForm((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Title"
                />
                <RichTextField
                  label="Description"
                  value={programItemForm.description || ""}
                  onChange={(value) => setProgramItemForm((prev) => ({ ...prev, description: value }))}
                  placeholder="Description"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    type="number"
                    min={0}
                    value={String(programItemForm.series_order || 0)}
                    onChange={(event) => setProgramItemForm((prev) => ({ ...prev, series_order: Number(event.target.value) }))}
                    className="rounded border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Order"
                  />
                  <input
                    type="number"
                    min={0}
                    value={String(programItemForm.duration_minutes || 0)}
                    onChange={(event) => setProgramItemForm((prev) => ({ ...prev, duration_minutes: Number(event.target.value) }))}
                    className="rounded border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Duration (min)"
                  />
                </div>
                <input
                  value={programItemForm.resource_url || ""}
                  onChange={(event) => setProgramItemForm((prev) => ({ ...prev, resource_url: event.target.value }))}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder={programItemForm.item_type === "pdf" ? "PDF URL" : "Lecture link (optional)"}
                />
                {programItemForm.item_type === "lecture" ? (
                  <input
                    type="datetime-local"
                    value={String(programItemForm.scheduled_for || "").replace("Z", "").slice(0, 16)}
                    onChange={(event) => setProgramItemForm((prev) => ({ ...prev, scheduled_for: event.target.value ? new Date(event.target.value).toISOString() : "" }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
                <button type="button" onClick={() => void saveProgramItem()} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                  {editingProgramItemId ? "Update Item" : "Create Item"}
                </button>
                <button type="button" onClick={() => setProgramItemModalOpen(false)} className="rounded border border-slate-300 px-3 py-2 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      </div>
    </div>
  );
}
