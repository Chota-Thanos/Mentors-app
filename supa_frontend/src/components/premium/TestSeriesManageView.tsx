"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarDays, ClipboardCheck, FileQuestion, FileText, LayoutList, LayoutPanelTop, LineChart, Loader2, MessageSquareWarning, PencilLine, PlayCircle, Plus, RefreshCcw, Trash2, Users, Video } from "lucide-react";
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

const formatLocalDatetime = (isoStr: string | null | undefined): string => {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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
  const [savingTest, setSavingTest] = useState(false);
  const [savingProgramItem, setSavingProgramItem] = useState(false);

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
        premiumApi.get<TestSeries>(`/programs/${seriesId}`),
        premiumApi.get<TestSeriesTest[]>(`/programs/${seriesId}/tests`, { params: { include_inactive: true } }),
        premiumApi.get<TestSeriesProgramItem[]>(`/programs/${seriesId}/program-items`, { params: { include_inactive: true } }),
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

      const enrollmentsResponse = await premiumApi.get<TestSeriesEnrollment[]>(`/programs/${seriesId}/enrollments`);
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
      await premiumApi.put(`/programs/${series.id}`, {
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
    if (!window.confirm("Archive this programs?")) return;
    try {
      await premiumApi.delete(`/programs/${series.id}`);
      toast.success("Series archived");
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to archive series", { description: toError(error) });
    }
  };

  const saveTest = async () => {
    if (savingTest) return;
    const title = String(testForm.title || "").trim();
    if (!title) {
      toast.error("Test title is required");
      return;
    }
    if (!allowedTestKindOptions.some((item) => item.value === testForm.test_kind)) {
      toast.error("Selected test type is not allowed for this series and role.");
      return;
    }
    setSavingTest(true);
    try {
      if (editingTestId) {
        await premiumApi.put(`/tests/${editingTestId}`, {
          ...testForm,
          title,
          description: toNullableRichText(testForm.description || ""),
        });
        toast.success("Test updated");
      } else {
        await premiumApi.post(`/programs/${seriesId}/tests`, {
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
    } finally {
      setSavingTest(false);
    }
  };

  const saveProgramItem = async () => {
    if (savingProgramItem) return;
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
      toast.error("Please set a scheduled date and time for the lecture.");
      return;
    }

    const payload: TestSeriesProgramItemUpdatePayload = {
      item_type: programItemForm.item_type,
      title,
      description: toNullableRichText(programItemForm.description || ""),
      series_order: programItemForm.series_order,
      duration_minutes: programItemForm.duration_minutes,
      resource_url: String(programItemForm.resource_url || "").trim() || undefined,
      scheduled_for: String(programItemForm.scheduled_for || "").trim() || undefined,
      cover_image_url: String(programItemForm.cover_image_url || "").trim() || undefined,
      is_active: programItemForm.is_active,
    };

    setSavingProgramItem(true);
    try {
      if (editingProgramItemId) {
        await premiumApi.put(`/programs/program-items/${editingProgramItemId}`, payload);
        toast.success("Program item updated");
      } else {
        await premiumApi.post(`/programs/${seriesId}/program-items`, payload);
        toast.success("Program item added");
      }
      setEditingProgramItemId(null);
      setProgramItemForm(emptyProgramItemForm);
      setProgramItemModalOpen(false);
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to save program item", { description: toError(error) });
    } finally {
      setSavingProgramItem(false);
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
    if (!window.confirm("Are you sure you want to delete this test? This will remove it from the curriculum.")) return;
    try {
      await premiumApi.delete(`/tests/${testId}`, { params: { hard_delete: true } });
      toast.success("Test removed from curriculum");
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to delete test", { description: toError(error) });
    }
  };

  const archiveProgramItem = async (itemId: number) => {
    if (!window.confirm("Are you sure you want to delete this item?")) return;
    try {
      await premiumApi.delete(`/programs/program-items/${itemId}`, { params: { hard_delete: true } });
      toast.success("Item removed from curriculum");
      await loadPage();
    } catch (error: unknown) {
      toast.error("Failed to delete item", { description: toError(error) });
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
        <Link href={`/programs/${seriesId}`} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1.5 text-xs">
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
  const totalQuestions = orderedTests.reduce((sum, test) => sum + Number(test.question_count || 0), 0);
  const builderIntegrity = orderedTests.length > 0
    ? Math.round((publishedTests.length / orderedTests.length) * 100)
    : 0;
  const mainsPendingReviewCount = allSubmissions.filter((row) => row.status !== "checked").length;
  const mainsScheduledSessionCount = seriesSessions.filter((row) => row.status === "scheduled" || row.status === "live").length;
  const mainsCompletedSessionCount = seriesSessions.filter((row) => row.status === "completed").length;
  const activeLearnerCount = lifecycleRows.length;

  const modals = (
    <>
      {testModalOpen ? (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex min-h-full items-start justify-center py-2 sm:items-center">
            <div className="flex w-full max-w-lg max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <h3 className="text-xl font-black tracking-tight text-slate-900">{editingTestId ? "Edit Test" : "Create New Test"}</h3>
                <button type="button" onClick={() => setTestModalOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                  <Plus className="h-5 w-5 rotate-45" />
                </button>
              </div>
              <div className="space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Test Title</label>
                  <input
                    value={testForm.title || ""}
                    onChange={(event) => setTestForm((prev) => ({ ...prev, title: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="e.g. History Full Length Test 01"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Test Type</label>
                    <select
                      value={testForm.test_kind}
                      onChange={(event) => setTestForm((prev) => ({ ...prev, test_kind: event.target.value as "prelims" | "mains" }))}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:bg-white focus:outline-none"
                    >
                      {allowedTestKindOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Display Label</label>
                    <input
                      value={testForm.test_label || ""}
                      onChange={(event) => setTestForm((prev) => ({ ...prev, test_label: event.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:bg-white"
                      placeholder="e.g. GS Paper 1"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Sequence Order</label>
                    <input
                      type="number"
                      min={0}
                      value={String(testForm.series_order || 0)}
                      onChange={(event) => setTestForm((prev) => ({ ...prev, series_order: Number(event.target.value) }))}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:bg-white"
                    />
                  </div>
                  <div className="space-y-1 flex items-end pb-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <input type="checkbox" checked={Boolean(testForm.is_public)} onChange={(e) => setTestForm(prev => ({ ...prev, is_public: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                        Publicly Visible
                    </label>
                  </div>
                </div>
                <RichTextField
                  label="Learner Instructions"
                  value={testForm.description || ""}
                  onChange={(value) => setTestForm((prev) => ({ ...prev, description: value }))}
                  placeholder="What should the learner know before taking this test?"
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                <button type="button" onClick={() => setTestModalOpen(false)} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="button" onClick={() => void saveTest()} disabled={savingTest} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-950 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-900 disabled:opacity-70">
                  {savingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {editingTestId ? "Update Test" : "Create Test"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {programItemModalOpen ? (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex min-h-full items-start justify-center py-2 sm:items-center">
            <div className="flex w-full max-w-lg max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <h3 className="text-xl font-black tracking-tight text-slate-900">{editingProgramItemId ? "Edit Resource" : "Add PDF / Lecture"}</h3>
                    <button type="button" onClick={() => setProgramItemModalOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                        <Plus className="h-5 w-5 rotate-45" />
                    </button>
                </div>
                <div className="space-y-4 overflow-y-auto px-6 py-5">
                    <div className="grid grid-cols-2 gap-4">
                        <button type="button" onClick={() => setProgramItemForm(prev => ({ ...prev, item_type: "pdf" }))} className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-all ${programItemForm.item_type === "pdf" ? "border-indigo-600 bg-indigo-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}>
                            <FileText className={`h-6 w-6 ${programItemForm.item_type === "pdf" ? "text-indigo-600" : "text-slate-400"}`} />
                            <span className={`text-xs font-bold uppercase tracking-wider ${programItemForm.item_type === "pdf" ? "text-indigo-900" : "text-slate-500"}`}>PDF Handout</span>
                        </button>
                        <button type="button" onClick={() => setProgramItemForm(prev => ({ ...prev, item_type: "lecture" }))} className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-all ${programItemForm.item_type === "lecture" ? "border-indigo-600 bg-indigo-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}>
                            <Video className={`h-6 w-6 ${programItemForm.item_type === "lecture" ? "text-indigo-600" : "text-slate-400"}`} />
                            <span className={`text-xs font-bold uppercase tracking-wider ${programItemForm.item_type === "lecture" ? "text-indigo-900" : "text-slate-500"}`}>Live Lecture</span>
                        </button>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Resource Title</label>
                        <input value={programItemForm.title || ""} onChange={e => setProgramItemForm(prev => ({ ...prev, title: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder={programItemForm.item_type === "pdf" ? "e.g. Budget 2024 Summary" : "e.g. Strategy session for prelims"} />
                    </div>
                    <RichTextField label="Description" value={programItemForm.description || ""} onChange={val => setProgramItemForm(prev => ({ ...prev, description: val }))} placeholder="Briefly describe the contents of this resource." />
                    <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">{programItemForm.item_type === "pdf" ? "Final PDF URL" : "Meeting / Video Link"}</label>
                        <input value={programItemForm.resource_url || ""} onChange={e => setProgramItemForm(prev => ({ ...prev, resource_url: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm placeholder:opacity-50" placeholder="https://..." />
                    </div>
                    {(programItemForm.item_type === "lecture") && (
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Scheduled For</label>
                                <input type="datetime-local" value={formatLocalDatetime(programItemForm.scheduled_for)} onChange={e => setProgramItemForm(prev => ({ ...prev, scheduled_for: e.target.value ? new Date(e.target.value).toISOString() : "" }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Duration (Min)</label>
                                <input type="number" min={0} value={String(programItemForm.duration_minutes || 60)} onChange={e => setProgramItemForm(prev => ({ ...prev, duration_minutes: Number(e.target.value) }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                            </div>
                        </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Display Order</label>
                            <input type="number" min={0} value={String(programItemForm.series_order || 0)} onChange={e => setProgramItemForm(prev => ({ ...prev, series_order: Number(e.target.value) }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm placeholder:opacity-50" />
                        </div>
                        <div className="space-y-1 flex items-end pb-3">
                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <input type="checkbox" checked={Boolean(programItemForm.is_active)} onChange={(e) => setProgramItemForm(prev => ({ ...prev, is_active: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                                Resource Active
                            </label>
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
                    <button type="button" onClick={() => setProgramItemModalOpen(false)} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                    <button type="button" onClick={() => void saveProgramItem()} disabled={savingProgramItem} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-950 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-900 disabled:opacity-70">
                        {savingProgramItem ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {editingProgramItemId ? "Update Resource" : "Create Resource"}
                    </button>
                </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (isPrelimsSeries) {
    return (
      <>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
        <RoleWorkspaceSidebar
          title="Prelims Expert Workspace"
          subtitle="Build objective programs, open question lanes, and keep learner complaints visible."
          sections={quizWorkspaceSections}
          className="lg:self-start"
        />

        <div className="min-w-0 flex-1 space-y-6">
          <section className="relative overflow-hidden rounded-[34px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="absolute right-0 top-0 h-full w-full opacity-40 bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.15),_transparent_50%)] pointer-events-none" />
            <div className="relative flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-2xl">
                <HistoryBackButton
                  fallbackHref={`/programs/${seriesId}`}
                  label="Back to series detail"
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  iconClassName="h-3 w-3"
                />
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-indigo-600">Workspace Management</p>
                <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl text-balance">
                  {series.title || "Untitled Series"}
                </h1>
                <p className="mt-4 text-base leading-relaxed text-slate-600 max-w-xl">
                  {richTextToPlainText(series.description || "") || "No description provided for this prelims program."}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5 flex items-center gap-3">
                     <FileQuestion className="h-5 w-5 text-indigo-500" />
                     <div>
                        <p className="text-xl font-black text-indigo-950 leading-none">{publishedTests.length}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 mt-1">Published</p>
                     </div>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 px-4 py-2.5 flex items-center gap-3">
                     <BookOpen className="h-5 w-5 text-emerald-500" />
                     <div>
                        <p className="text-xl font-black text-emerald-950 leading-none">{totalQuestions}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mt-1">Questions</p>
                     </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3 min-w-[200px]">
                <div className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 transition-colors hover:border-slate-200">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Access</p>
                    <p className="mt-0.5 font-bold text-slate-900">{String(series.access_type || "subscription").replace(/^./, (char) => char.toUpperCase())}</p>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Visibility</p>
                    <p className="mt-0.5 font-bold text-slate-900">{series.is_public ? "Public" : "Private"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative mt-8 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-6">
              <button
                type="button"
                onClick={() => setSeriesSetupStep(seriesSetupStep === 1 ? 2 : 1)}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-all ${
                  seriesSetupStep === 1
                    ? "bg-indigo-950 text-white shadow-md shadow-indigo-900/20"
                    : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <PencilLine className="h-4 w-4" />
                Edit Program {seriesSetupStep === 1 ? "(Active)" : ""}
              </button>
              <div className="h-8 w-px bg-slate-200" />
              <button
                type="button"
                onClick={openCreateTestModal}
                disabled={!canUseTestBuilder}
                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-500 hover:shadow-md hover:shadow-indigo-500/20 disabled:translate-y-0 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Add Test
              </button>
              <button
                type="button"
                onClick={openCreateProgramItemModal}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
                Add PDF / Lecture
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => void loadPage()}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                title="Refresh"
              >
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-8 grid gap-4 grid-cols-2 lg:grid-cols-4">
              <Link href={`/programs/${seriesId}/purchases`} className="rounded-[24px] border border-sky-200 bg-sky-100/70 p-5 shadow-sm transition hover:border-sky-400 hover:shadow-md group">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-white/70 p-3 text-sky-700">
                    <Users className="h-6 w-6" />
                  </div>
                  <p className="text-3xl font-black tracking-tight text-[#091a4a]">{enrollments.length}</p>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-900">Purchases</p>
                  <ArrowUpRight className="h-4 w-4 text-sky-400 opacity-0 group-hover:opacity-100 transition" />
                </div>
              </Link>
              <Link href={`/programs/${seriesId}/leaderboard`} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow-md group">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a] group-hover:bg-indigo-50 group-hover:text-indigo-600 transition">
                    <LayoutList className="h-6 w-6" />
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-slate-300 group-hover:text-indigo-400 transition" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 group-hover:text-indigo-900 transition">Rankings</p>
              </Link>
              <Link href="/quiz-master/complaints" className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-amber-200 hover:shadow-md group">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-amber-50 p-3 text-amber-700 transition">
                    <MessageSquareWarning className="h-6 w-6" />
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-slate-300 group-hover:text-amber-400 transition" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 group-hover:text-amber-900 transition">Complaints</p>
              </Link>
              <Link href={`/programs/${seriesId}/reviews`} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-200 hover:shadow-md group">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a] group-hover:bg-emerald-50 group-hover:text-emerald-700 transition">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <ArrowUpRight className="h-5 w-5 text-slate-300 group-hover:text-emerald-500 transition" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 group-hover:text-emerald-800 transition">Reviews</p>
              </Link>
            </div>
          </section>

          {seriesSetupStep === 1 ? (
            <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-600">Program settings</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Series Identity</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                    Update the learner-facing identity before you continue adding or publishing tests.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void archiveSeries()}
                  className="rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                >
                  Archive Program
                </button>
              </div>

              <div className="mt-8 grid gap-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <input value={seriesForm.title || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, title: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all" placeholder="Program title" />
                  <input value={seriesForm.cover_image_url || ""} onChange={(event) => setSeriesForm((prev) => ({ ...prev, cover_image_url: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all" placeholder="Cover image URL" />
                  <select value={seriesForm.series_kind || "quiz"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all">
                    <option value="quiz">Quiz</option>
                    <option value="mains">Mains</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                  <select value={seriesForm.access_type || "subscription"} onChange={(event) => setSeriesForm((prev) => ({ ...prev, access_type: event.target.value as "free" | "subscription" | "paid" }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all">
                    <option value="subscription">Subscription</option>
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                  <input type="number" min={0} value={String(seriesForm.price || 0)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, price: Number(event.target.value) }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all" placeholder="Price" />
                  <label className="inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                    <input type="checkbox" checked={Boolean(seriesForm.is_public)} onChange={(event) => setSeriesForm((prev) => ({ ...prev, is_public: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600" />
                    Public
                  </label>
                </div>

                <RichTextField
                  label="Program description"
                  value={seriesForm.description || ""}
                  onChange={(value) => setSeriesForm((prev) => ({ ...prev, description: value }))}
                  placeholder="Program description"
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

                <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
                  <button type="button" onClick={() => void saveSeries()} className="rounded-2xl bg-indigo-950 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900">
                    Save Details
                  </button>
                  <button type="button" onClick={() => setSeriesSetupStep(2)} className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
                    Close
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-6">
            
            {/* Minimal Guideline Banner */}
            <div className="flex items-center gap-4 rounded-2xl bg-indigo-50/50 p-4 border border-indigo-100/50 text-sm text-indigo-900/80">
                <div className="rounded-full bg-indigo-100/80 p-2 text-indigo-500">
                    <LayoutList className="h-4 w-4" />
                </div>
                <div className="flex-1">
                    <strong>Quick Tip:</strong> First build your shells via &quot;Add Test&quot;. Use &quot;Question Methods&quot; to load questions before you enable &quot;Published&quot; state. You can also mix in PDFs and Live discussions directly into the timeline.
                </div>
            </div>

            <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-6">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">Curriculum Journey</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Design the learner&apos;s timeline. Dragging support coming soon.
                  </p>
                </div>
              </div>

              <div className="mt-8 relative max-w-4xl">
                 {orderedProgramEntries.length > 0 && (
                     <div className="absolute top-4 bottom-8 left-[23px] w-0.5 bg-slate-100 rounded-full" />
                 )}
                 <div className="space-y-6 relative">
                    {orderedProgramEntries.map((entry, index) => {
                    if (entry.entry_type === "test") {
                        const test = entry.test;
                        const isPublished = test.is_finalized && test.is_public && test.is_active;
                        return (
                        <article key={entry.entry_key} className="group relative pl-16">
                            <div className={`absolute top-5 left-3 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white shadow-sm transition-colors ${isPublished ? "bg-indigo-500" : "bg-slate-300 group-hover:bg-indigo-300"}`} />
                            
                            <div className="flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm transition-all hover:border-indigo-200 hover:shadow-md group-hover:-translate-y-0.5">
                                <div className="flex flex-col p-5 sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">#{String(index + 1).padStart(2, "0")}</span>
                                            <h3 className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">{test.title}</h3>
                                            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${testStatusClass(test)}`}>
                                                {testStatusLabel(test)}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                            {richTextToPlainText(test.description || "") || <span className="italic opacity-60">No content description provided.</span>}
                                        </p>
                                        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
                                            <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                <FileQuestion className="h-3.5 w-3.5 text-slate-400" />
                                                {formatQuestionCount(test.question_count || 0)} Sync
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <BookOpen className="h-3.5 w-3.5" />
                                                Order {test.series_order}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 shrink-0">
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <Link href={`/collections/${test.id}/question-methods`} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-indigo-700 transition">
                                                Manage Questions
                                            </Link>
                                            <button type="button" onClick={() => openEditTestModal(test)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition">
                                                <PencilLine className="h-3.5 w-3.5" /> Edit
                                            </button>
                                        </div>
                                        <button type="button" onClick={() => void archiveTest(test.id)} title="Delete" className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </article>
                        );
                    }

                    if (entry.entry_type === "pdf" || entry.entry_type === "lecture") {
                        const item = entry.item;
                        const isPdf = entry.entry_type === "pdf";
                        const scheduledDate = item.scheduled_for ? new Date(item.scheduled_for) : null;
                        return (
                        <article key={entry.entry_key} className="group relative pl-16">
                             <div className={`absolute top-5 left-3 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white shadow-sm transition-colors ${isPdf ? "bg-emerald-400" : "bg-violet-400"}`} />
                             <div className={`flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md group-hover:-translate-y-0.5 ${isPdf ? "hover:border-emerald-200" : "hover:border-violet-200"}`}>
                                <div className="flex flex-col p-5 sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">#{String(index + 1).padStart(2, "0")}</span>
                                            <h3 className={`text-xl font-bold tracking-tight transition-colors ${isPdf ? "text-slate-900 group-hover:text-emerald-700" : "text-slate-900 group-hover:text-violet-700"}`}>
                                                {item.title}
                                            </h3>
                                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${isPdf ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>
                                                {isPdf ? <BookOpen className="h-2.5 w-2.5" /> : <PlayCircle className="h-2.5 w-2.5" />}
                                                {isPdf ? "PDF" : "Lecture"}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                            {richTextToPlainText(item.description || "") || <span className="italic opacity-60">{isPdf ? "PDF Resource." : "Live class resource."}</span>}
                                        </p>
                                        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
                                            {!isPdf && scheduledDate && (
                                                <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                                                    {scheduledDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                                                    {" at "}
                                                    {scheduledDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                            )}
                                            {item.resource_url && (
                                                <a href={String(item.resource_url)} target="_blank" rel="noreferrer" className={`flex items-center gap-1 ${isPdf ? "text-emerald-600 hover:text-emerald-700" : "text-violet-600 hover:text-violet-700"}`}>
                                                    Open Link <ArrowUpRight className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                            <span className="flex items-center gap-1.5 opacity-70">
                                                Order {item.series_order}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 shrink-0">
                                        <button type="button" onClick={() => openEditProgramItemModal(item)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
                                            <PencilLine className="h-3.5 w-3.5" /> Edit
                                        </button>
                                        <button type="button" onClick={() => void archiveProgramItem(item.id)} title="Delete" className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                             </div>
                        </article>
                        );
                    }

                    return null;
                    })}
                 </div>

                {orderedProgramEntries.length === 0 ? (
                  <div className="rounded-[28px] border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center mt-4 mix-blend-multiply">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-200/50 text-slate-400">
                        <LineChart className="h-8 w-8" />
                    </div>
                    <p className="mt-4 text-lg font-bold text-slate-900">It&apos;s a blank canvas</p>
                    <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">Start building your curriculum timeline by creating an outline of tests, materials, and lectures.</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      <button
                        type="button"
                        onClick={openCreateTestModal}
                        disabled={!canUseTestBuilder}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition shadow-sm disabled:opacity-60"
                      >
                        <Plus className="h-4 w-4" />
                        Add First Mock
                      </button>
                      <button
                        type="button"
                        onClick={openCreateProgramItemModal}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                      >
                        <Plus className="h-4 w-4" />
                        Add Handout
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
      {modals}
      </>
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
                fallbackHref={`/programs/${seriesId}`}
                label="Back to series detail"
                className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
                iconClassName="h-4 w-4"
              />
              <p className="text-xs font-black uppercase tracking-[0.3em] text-[#1d3b8b]">Workspace Management</p>
              <h1 className="text-3xl font-black tracking-tight text-[#091a4a] sm:text-4xl">{series.title || "Untitled Series"}</h1>
              <p className="text-sm text-slate-600 max-w-xl">
                 {richTextToPlainText(series.description || "") || "Manage the program structure, test delivery, learner progress, and mentor workflow from one desk."}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                  <div className="rounded-2xl border border-indigo-200/50 bg-[#e2e8ff]/50 px-4 py-2.5 flex items-center gap-3">
                     <FileQuestion className="h-5 w-5 text-indigo-700" />
                     <div>
                        <p className="text-xl font-black text-[#091a4a] leading-none">{publishedTests.length}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mt-1">Published</p>
                     </div>
                  </div>
                  <div className="rounded-2xl border border-indigo-200/50 bg-[#e2e8ff]/50 px-4 py-2.5 flex items-center gap-3">
                     <BookOpen className="h-5 w-5 text-indigo-700" />
                     <div>
                        <p className="text-xl font-black text-[#091a4a] leading-none">{totalQuestions}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mt-1">Questions</p>
                     </div>
                  </div>
                  <div className="rounded-2xl border border-indigo-200/50 bg-[#e2e8ff]/50 px-4 py-2.5 flex items-center gap-3">
                     <ClipboardCheck className="h-5 w-5 text-indigo-700" />
                     <div>
                        <p className="text-xl font-black text-[#091a4a] leading-none">{builderIntegrity}%</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mt-1">Integrity</p>
                     </div>
                  </div>
              </div>
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

          <div className="mt-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
              <article className="rounded-[24px] border border-sky-200 bg-sky-100/70 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-white/70 p-3 text-sky-700">
                    <Users className="h-6 w-6" />
                  </div>
                  <p className="text-3xl font-black tracking-tight text-[#091a4a]">{activeLearnerCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-sky-900">Active Learners</p>
              </article>
              <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                    <FileQuestion className="h-6 w-6" />
                  </div>
                  <p className="text-3xl font-black tracking-tight text-[#091a4a]">{mainsPendingReviewCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Pending Reviews</p>
              </article>
              <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                    <CalendarDays className="h-6 w-6" />
                  </div>
                  <p className="text-3xl font-black tracking-tight text-[#091a4a]">{mainsScheduledSessionCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Scheduled Sessions</p>
              </article>
              <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <p className="text-3xl font-black tracking-tight text-[#091a4a]">{mainsCompletedSessionCount}</p>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Completed Sessions</p>
              </article>
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
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${seriesSetupStep === 1 ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                <PencilLine className="h-3.5 w-3.5" /> Edit Program
              </button>
              <button
                type="button"
                onClick={() => setSeriesSetupStep(2)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${seriesSetupStep === 2 ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                <LayoutList className="h-3.5 w-3.5" /> Manage Curriculum
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
              <div className="mt-8 relative max-w-4xl">
                 {orderedProgramEntries.length > 0 && (
                     <div className="absolute top-4 bottom-8 left-[23px] w-0.5 bg-slate-100 rounded-full" />
                 )}
                 <div className="space-y-6 relative">
                    {orderedProgramEntries.map((entry, index) => {
                    if (entry.entry_type === "test") {
                        const test = entry.test;
                        const isPublished = test.is_finalized && test.is_public && test.is_active;
                        const copyCount = Number(copyByTest[String(test.id)]?.length || 0);
                        return (
                        <article key={entry.entry_key} className="group relative pl-16">
                            <div className={`absolute top-5 left-3 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white shadow-sm transition-colors ${isPublished ? "bg-[#091a4a]" : "bg-slate-300 group-hover:bg-slate-400"}`} />
                            
                            <div className="flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm transition-all hover:border-[#091a4a]/20 hover:shadow-md group-hover:-translate-y-0.5">
                                <div className="flex flex-col p-5 sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">#{String(index + 1).padStart(2, "0")}</span>
                                            <h3 className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-[#091a4a] transition-colors">{test.title}</h3>
                                            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${testStatusClass(test)}`}>
                                                {testStatusLabel(test)}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                            {richTextToPlainText(test.description || "") || <span className="italic opacity-60">No description added.</span>}
                                        </p>
                                        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
                                            <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                <FileQuestion className="h-3.5 w-3.5 text-slate-400" />
                                                {formatQuestionCount(test.question_count || 0)} Sync
                                            </span>
                                            {test.test_kind === "mains" && (
                                                <span className="flex items-center gap-1.5 bg-violet-50 text-violet-700 px-2 py-1 rounded-md border border-violet-100 font-semibold">
                                                  {copyCount} Submission{copyCount === 1 ? "" : "s"}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-1.5 opacity-70">
                                                Order {test.series_order}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 shrink-0">
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            {test.test_kind === "mains" ? (
                                                <Link href={`/mains-mentor/ai-mains?collection_id=${test.id}&bind_test=1&mode=mains_mentor`} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 px-3 py-2 text-xs font-semibold transition">
                                                    AI Mains Studio
                                                </Link>
                                            ) : null}
                                            <Link href={`/collections/${test.id}/question-methods`} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-50 hover:bg-[#091a4a]/5 border border-slate-200 hover:border-[#091a4a]/20 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-[#091a4a] transition">
                                                Manage Questions
                                            </Link>
                                            <button type="button" onClick={() => openEditTestModal(test)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition">
                                                <PencilLine className="h-3.5 w-3.5" /> Edit
                                            </button>
                                        </div>
                                        <button type="button" onClick={() => void archiveTest(test.id)} title="Delete" className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </article>
                        );
                    }

                    if (entry.entry_type === "pdf" || entry.entry_type === "lecture") {
                        const item = entry.item;
                        const isPdf = entry.entry_type === "pdf";
                        const scheduledDate = item.scheduled_for ? new Date(item.scheduled_for) : null;
                        return (
                        <article key={entry.entry_key} className="group relative pl-16">
                             <div className={`absolute top-5 left-3 flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-white shadow-sm transition-colors ${isPdf ? "bg-emerald-400" : "bg-violet-400"}`} />
                             <div className={`flex flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md group-hover:-translate-y-0.5 ${isPdf ? "hover:border-emerald-200" : "hover:border-violet-200"}`}>
                                <div className="flex flex-col p-5 sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">#{String(index + 1).padStart(2, "0")}</span>
                                            <h3 className={`text-xl font-bold tracking-tight transition-colors ${isPdf ? "text-slate-900 group-hover:text-emerald-700" : "text-slate-900 group-hover:text-violet-700"}`}>
                                                {item.title}
                                            </h3>
                                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${isPdf ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>
                                                {isPdf ? <BookOpen className="h-2.5 w-2.5" /> : <PlayCircle className="h-2.5 w-2.5" />}
                                                {isPdf ? "PDF" : "Lecture"}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                            {richTextToPlainText(item.description || "") || <span className="italic opacity-60">{isPdf ? "PDF Resource." : "Live class resource."}</span>}
                                        </p>
                                        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
                                            {!isPdf && scheduledDate && (
                                                <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                                                    {scheduledDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                                                    {" at "}
                                                    {scheduledDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                            )}
                                            {item.resource_url && (
                                                <a href={String(item.resource_url)} target="_blank" rel="noreferrer" className={`flex items-center gap-1 ${isPdf ? "text-emerald-600 hover:text-emerald-700" : "text-violet-600 hover:text-violet-700"}`}>
                                                    Open Link <ArrowUpRight className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                            {item.duration_minutes ? <span className="flex items-center opacity-70">{item.duration_minutes} min</span> : null}
                                            <span className="flex items-center gap-1.5 opacity-70">
                                                Order {item.series_order}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 shrink-0">
                                        <button type="button" onClick={() => openEditProgramItemModal(item)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
                                            <PencilLine className="h-3.5 w-3.5" /> Edit
                                        </button>
                                        <button type="button" onClick={() => void archiveProgramItem(item.id)} title="Delete" className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                             </div>
                        </article>
                        );
                    }

                    return null;
                    })}
                 </div>

                {orderedProgramEntries.length === 0 ? (
                  <div className="rounded-[28px] border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center mt-4">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-200/50 text-slate-400">
                        <LineChart className="h-8 w-8" />
                    </div>
                    <p className="mt-4 text-lg font-bold text-slate-900">It&apos;s a blank canvas</p>
                    <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">Start building your curriculum timeline by creating an outline of tests, materials, and lectures.</p>
                  </div>
                ) : null}
              </div>
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

      {modals}

      </div>
    </div>
  );
}
