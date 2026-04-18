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
import { useProfile } from "@/context/ProfileContext";
import {
  isAdminLike,
  isMainsMentorLike,
  isModeratorLike,
  isQuizMasterLike,
  isSeriesOperatorLike,
} from "@/lib/accessControl";
import { richTextToPlainText, toNullableRichText } from "@/lib/richText";
import {
  normalizeMainsCopySubmission,
  normalizeMentorshipRequest,
  normalizeMentorshipSlot,
} from "@/lib/mentorshipV2";
import { createClient } from "@/lib/supabase/client";
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
  UserMainsPerformanceQuestionRow,
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

type SeriesDbRow = {
  id?: number | string;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  cover_image_url?: string | null;
  series_kind?: string | null;
  access_type?: string | null;
  is_paid?: boolean | null;
  is_subscription?: boolean | null;
  price?: number | string | null;
  is_public?: boolean | null;
  is_active?: boolean | null;
  creator_id?: number | string | null;
  meta?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  test_count?: number | string | null;
};

type SeriesExamLinkRow = {
  test_series_id?: number | string;
  exam_id?: number | string;
};

type ProgramUnitCollectionRow = {
  id?: number | string;
  name?: string | null;
  description?: string | null;
  collection_type?: string | null;
  image_url?: string | null;
  is_paid?: boolean | null;
  is_public?: boolean | null;
  is_subscription?: boolean | null;
  price?: number | string | null;
  is_finalized?: boolean | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ProgramUnitStepRow = {
  id?: number | string;
  unit_id?: number | string | null;
  step_type?: string | null;
  title?: string | null;
  description?: string | null;
  collection_id?: number | string | null;
  display_order?: number | string | null;
  is_active?: boolean | null;
  meta?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  collection?: ProgramUnitCollectionRow | null;
};

type ProgramUnitRow = {
  id?: number | string;
  series_id?: number | string | null;
  title?: string | null;
  description?: string | null;
  display_order?: number | string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  steps?: ProgramUnitStepRow[] | null;
};

type MainsSubmissionRow = {
  id?: number | string;
  series_id?: number | string | null;
  unit_step_id?: number | string | null;
  collection_id?: number | string | null;
  test_collection_id?: number | string | null;
  status?: string | null;
  total_marks?: number | string | null;
  submitted_at?: string | null;
  checked_copy_pdf_url?: string | null;
  unit_step?: {
    title?: string | null;
    collection_id?: number | string | null;
  } | null;
};

const normalizeSeriesKindForUi = (value: unknown): TestSeries["series_kind"] => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "prelims" || raw === "quiz") return "quiz";
  if (raw === "mains" || raw === "hybrid") return raw as TestSeries["series_kind"];
  return "quiz";
};

const normalizeAccessTypeForUi = (row: SeriesDbRow): TestSeries["access_type"] => {
  const rawAccessType = String(row.access_type || "").trim().toLowerCase();
  if (rawAccessType === "free" || rawAccessType === "subscription" || rawAccessType === "paid") {
    return rawAccessType as TestSeries["access_type"];
  }
  if (row.is_paid) return "paid";
  if (row.is_subscription) return "subscription";
  return "free";
};

const normalizeSeriesRow = (row: SeriesDbRow, examIds: number[]): TestSeries => ({
  id: Number(row.id || 0),
  title: String(row.name || row.title || ""),
  description: row.description ?? null,
  cover_image_url: row.cover_image_url ?? null,
  creator_id: Number(row.creator_id || 0),
  series_kind: normalizeSeriesKindForUi(row.series_kind),
  access_type: normalizeAccessTypeForUi(row),
  price: Number(row.price || 0),
  is_public: Boolean(row.is_public),
  is_active: Boolean(row.is_active),
  meta: row.meta || {},
  exam_ids: examIds,
  test_count: Number(row.test_count || 0),
  created_at: String(row.created_at || new Date().toISOString()),
  updated_at: row.updated_at ?? null,
});

const normalizeSeriesKindForDb = (value: unknown): "prelims" | "mains" | "hybrid" => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "quiz" || raw === "prelims") return "prelims";
  if (raw === "mains" || raw === "hybrid") return raw as "mains" | "hybrid";
  return "prelims";
};

export default function TestSeriesConsole() {
  const { user, isAuthenticated, loading } = useAuth();
  const { profileId } = useProfile();
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
      const supabase = createClient();
      let query = supabase
        .from("test_series")
        .select("id, name, description, cover_image_url, series_kind, is_paid, is_public, is_subscription, price, is_active, creator_id, created_at, updated_at");

      if (mode === "provider") {
        if (!adminLike && !moderatorLike) {
          // Quiz Masters only see their own series
          query = query.eq("creator_id", profileId);
        }
      } else {
        query = query.eq("is_public", true).eq("is_active", true);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      const seriesRowsRaw = Array.isArray(data) ? (data as SeriesDbRow[]) : [];
      const seriesIds = seriesRowsRaw
        .map((row) => Number(row.id || 0))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      const examLinks = seriesIds.length > 0
        ? await supabase
          .from("test_series_exams")
          .select("test_series_id, exam_id")
          .in("test_series_id", seriesIds)
        : { data: [] as SeriesExamLinkRow[] };
      const examMap = new Map<number, number[]>();
      for (const link of (examLinks.data || []) as SeriesExamLinkRow[]) {
        const seriesId = Number(link.test_series_id || 0);
        const examId = Number(link.exam_id || 0);
        if (!Number.isFinite(seriesId) || seriesId <= 0 || !Number.isFinite(examId) || examId <= 0) continue;
        const current = examMap.get(seriesId) || [];
        current.push(examId);
        examMap.set(seriesId, current);
      }

      const rows = seriesRowsRaw.map((row) => normalizeSeriesRow(row, examMap.get(Number(row.id || 0)) || []));
      
      const scopedRows = rows.filter((row) => {
        const rawSeriesKind = String(row.series_kind || "").trim().toLowerCase();
        const seriesKind = rawSeriesKind === "prelims" || rawSeriesKind === "quiz" ? "quiz" : rawSeriesKind;
        if (canBuildPrelimsSeries && !canBuildMainsSeries) return seriesKind !== "mains";
        if (canBuildMainsSeries && !canBuildPrelimsSeries) return seriesKind !== "quiz";
        return true;
      });

      if (mode !== "provider" && scopedRows.some(r => r.creator_id === profileId)) {
        // If we found our own series in explore mode, maybe switch to provider mode automatically?
        // Retaining original logic preference
      }

      setSeriesRows(scopedRows);
      
      setSelectedSeriesId((prev) => {
        if (prev && scopedRows.some((row) => row.id === prev)) return prev;
        return scopedRows.length > 0 ? scopedRows[0].id : null;
      });
    } catch (error: unknown) {
      console.error("Failed to load programs:", error);
      toast.error("Failed to load programs", { description: String(error) });
      setSeriesRows([]);
      setSelectedSeriesId(null);
    } finally {
      setSeriesLoading(false);
    }
  };

  const loadExams = async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("exams")
        .select("*")
        .eq("is_active", true)
        .order("name");
        
      if (error) throw error;
      setAvailableExams(Array.isArray(data) ? data : []);
    } catch (error: unknown) {
      console.error("Failed to load exams:", error);
      setAvailableExams([]);
    }
  };

  const loadSeriesTests = async (seriesId: number) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("program_units")
        .select(`
          id,
          series_id,
          title,
          description,
          display_order,
          is_active,
          created_at,
          updated_at,
          steps:program_unit_steps (
            id,
            unit_id,
            step_type,
            title,
            description,
            collection_id,
            display_order,
            is_active,
            meta,
            created_at,
            updated_at,
            collection:premium_collections (
              id,
              name,
              description,
              collection_type,
              image_url,
              is_paid,
              is_public,
              is_subscription,
              price,
              is_finalized,
              is_active,
              created_at,
              updated_at
            )
          )
        `)
        .eq("series_id", seriesId)
        .order("display_order", { ascending: true });
      if (error) throw error;

      const rows: TestSeriesTest[] = [];
      for (const unit of (Array.isArray(data) ? data : []) as ProgramUnitRow[]) {
        const unitOrder = Number(unit.display_order || 0);
        for (const step of (Array.isArray(unit.steps) ? unit.steps : []) as ProgramUnitStepRow[]) {
          if (step.step_type !== "test" || !step.collection) continue;
          const collection = step.collection;
          rows.push({
            id: Number(collection.id || 0),
            series_id: seriesId,
            title: String(step.title || collection.name || "Test"),
            description: step.description || collection.description || null,
            test_kind: String(collection.collection_type || "").toLowerCase() === "mains" ? "mains" : "prelims",
            test_label: String(collection.collection_type || "prelims").toUpperCase(),
            thumbnail_url: collection.image_url || null,
            is_public: Boolean(collection.is_public),
            is_premium: Boolean(collection.is_paid || collection.is_subscription),
            price: Number(collection.price || 0),
            is_finalized: Boolean(collection.is_finalized),
            is_active: Boolean(step.is_active && collection.is_active),
            series_order: unitOrder * 1000 + Number(step.display_order || 0),
            question_count: 0,
            meta: step.meta || {},
            exam_ids: [],
            created_at: String(step.created_at || collection.created_at || new Date().toISOString()),
            updated_at: step.updated_at ?? null,
          });
        }
      }
      rows.sort((left, right) => left.series_order - right.series_order);
      setSeriesTestsById((prev) => ({ ...prev, [String(seriesId)]: rows }));
      setSeriesRows((prev) => prev.map((row) => (row.id === seriesId ? { ...row, test_count: rows.length } : row)));
    } catch (error: unknown) {
      console.error("Failed to load tests:", error);
      setSeriesTestsById((prev) => ({ ...prev, [String(seriesId)]: [] }));
    }
  };

  const loadProviderSummary = async () => {
    if (!isAuthenticated || !canBuildSeries || mode !== "provider") return;
    setProviderSummaryLoading(true);
    try {
      const supabase = createClient();
      
      const seriesIds = seriesRows.map(s => s.id);
      
      const [seriesRes, enrollmentsRes, mentorshipRes, slotsRes] = await Promise.all([
        supabase.from("test_series").select("id", { count: "exact", head: true }).eq("creator_id", profileId),
        seriesIds.length > 0 
          ? supabase.from("test_series_enrollments").select("id", { count: "exact", head: true }).in("series_id", seriesIds)
          : Promise.resolve({ count: 0 }),
        supabase.from("mentorship_requests").select("id", { count: "exact", head: true }).eq("mentor_id", profileId).eq("status", "requested"),
        supabase.from("mentorship_slots").select("id", { count: "exact", head: true }).eq("mentor_id", profileId).gte("starts_at", new Date().toISOString()),
      ]);

      setProviderSummary({
        series_count: seriesRes.count || 0,
        test_count: seriesRows.reduce((acc, curr) => acc + (curr.test_count || 0), 0),
        active_enrollments: enrollmentsRes.count || 0,
        pending_copy_checks: 0, // Placeholder - can be loaded from mains_test_copy_submissions if needed
        mentorship_pending_requests: mentorshipRes.count || 0,
        upcoming_slots: slotsRes.count || 0
      });
    } catch (error: unknown) {
      console.error("Provider summary failed:", error);
      setProviderSummary(null);
    } finally {
      setProviderSummaryLoading(false);
    }
  };

  const loadModerationSummary = async () => {
    if (!moderatorLike || canBuildSeries || mode !== "provider") return;
    setModerationSummaryLoading(true);
    try {
      const supabase = createClient();
      
      // Parallel aggregates for moderator overview
      const [seriesRes, activeSeriesRes, testsRes, activeTestsRes, enrollmentsRes, copiesRes, pendingCopiesRes, mentorshipRes, pendingMentorshipRes] = await Promise.all([
        supabase.from("test_series").select("id", { count: "exact", head: true }),
        supabase.from("test_series").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("program_unit_steps").select("id", { count: "exact", head: true }).eq("step_type", "test"),
        supabase.from("program_unit_steps").select("id", { count: "exact", head: true }).eq("step_type", "test").eq("is_active", true),
        supabase.from("test_series_enrollments").select("id", { count: "exact", head: true }),
        supabase.from("mains_test_copy_submissions").select("id", { count: "exact", head: true }),
        supabase.from("mains_test_copy_submissions").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]),
        supabase.from("mentorship_requests").select("id", { count: "exact", head: true }),
        supabase.from("mentorship_requests").select("id", { count: "exact", head: true }).eq("status", "requested"),
      ]);

      setModerationSummary({
        series_count: seriesRes.count || 0,
        active_series_count: activeSeriesRes.count || 0,
        test_count: testsRes.count || 0,
        active_test_count: activeTestsRes.count || 0,
        active_enrollments: enrollmentsRes.count || 0,
        copy_submissions_total: copiesRes.count || 0,
        pending_copy_checks: pendingCopiesRes.count || 0,
        mentorship_requests_total: mentorshipRes.count || 0,
        mentorship_pending_requests: pendingMentorshipRes.count || 0,
      });
    } catch (error: unknown) {
      console.error("Moderation summary failed:", error);
      setModerationSummary(null);
    } finally {
      setModerationSummaryLoading(false);
    }
  };

  const loadMentorshipSlots = async () => {
    try {
      const supabase = createClient();
      const query = supabase.from("mentorship_slots").select("*");
      
      if (!(mode === "provider" && canHandleMentorship)) {
        query.gte("starts_at", new Date().toISOString());
      }
      
      const { data, error } = await query.order("starts_at", { ascending: true });
      if (error) throw error;
      
      setSlots((data || []).map(normalizeMentorshipSlot));
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
      const supabase = createClient();
      let query = supabase.from("mentorship_requests").select("*");
      
      if (scope === "me") {
        query = query.eq("user_id", profileId);
      } else if (scope === "provider") {
        query = query.eq("mentor_id", profileId);
      }
      
      const { data, error } = await query.order("requested_at", { ascending: false });
      if (error) throw error;
      
      setMentorshipRequests((data || []).map(normalizeMentorshipRequest));
    } catch (error: unknown) {
      setMentorshipRequests([]);
      toast.error("Failed to load mentorship requests", { description: toError(error) });
    }
  };

  const loadMyEntitlements = async () => {
    if (!isAuthenticated) return;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("mentorship_entitlements")
        .select("*")
        .eq("user_id", profileId)
        .eq("is_active", true);
      
      if (error) throw error;
      setEntitlements(Array.isArray(data) ? data : []);
    } catch {
      setEntitlements([]);
    }
  };

  const loadMyPerformance = async () => {
    if (!isAuthenticated) return;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("mains_test_copy_submissions")
        .select(`
          *,
          unit_step:program_unit_steps!unit_step_id (
            id,
            title,
            collection_id
          )
        `)
        .eq("user_id", profileId);
      
      if (error) throw error;

      const submissions = (Array.isArray(data) ? (data as MainsSubmissionRow[]) : []).map((row) => ({
        submission: normalizeMainsCopySubmission({
          ...row,
          collection_id: row.unit_step?.collection_id ?? row.collection_id ?? row.test_collection_id ?? null,
        }),
        testTitle: String(row.unit_step?.title || "Test"),
        testCollectionId: Number(row.unit_step?.collection_id || row.collection_id || row.test_collection_id || 0),
      }));
      const checked = submissions.filter((row) => row.submission.status === "checked");
      const totalMarks = checked.reduce((acc, row) => acc + Number(row.submission.total_marks || 0), 0);
      
      setPerformanceReport({
        total_submissions: submissions.length,
        checked_submissions: checked.length,
        average_provider_marks: checked.length > 0 ? totalMarks / checked.length : 0,
        average_ai_score: 0,
        questions: checked.map((row): UserMainsPerformanceQuestionRow => ({
          submission_id: Number(row.submission.id),
          test_collection_id: Number(row.testCollectionId),
          test_title: row.testTitle,
          marks_awarded: Number(row.submission.total_marks || 0),
          max_marks: 0,
          submitted_at: row.submission.submitted_at,
        })),
      });
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
      const supabase = createClient();
      const selectedAccessType = String(seriesForm.access_type || "subscription").trim().toLowerCase();
      const seriesPrice = selectedAccessType === "free" ? 0 : Number(seriesForm.price || 0);
      const basePayload = {
        name: title,
        description: toNullableRichText(seriesForm.description || ""),
        cover_image_url: seriesForm.cover_image_url || null,
        series_kind: normalizeSeriesKindForDb(selectedKind),
        is_paid: selectedAccessType === "paid",
        is_subscription: selectedAccessType === "subscription",
        price: seriesPrice,
        is_public: !!seriesForm.is_public,
        is_active: !!seriesForm.is_active,
        creator_id: profileId,
      };

      if (editingSeriesId) {
        const { error: updateError } = await supabase
          .from("test_series")
          .update(basePayload)
          .eq("id", editingSeriesId);
        if (updateError) throw updateError;
        const currentExamIds = Array.isArray(seriesForm.exam_ids) ? seriesForm.exam_ids : [];
        await supabase.from("test_series_exams").delete().eq("test_series_id", editingSeriesId);
        if (currentExamIds.length > 0) {
          const { error: examLinkError } = await supabase.from("test_series_exams").insert(
            currentExamIds.map((exam_id) => ({ test_series_id: editingSeriesId, exam_id })),
          );
          if (examLinkError) throw examLinkError;
        }
        toast.success("Series updated");
      } else {
        const { data: createData, error: createError } = await supabase
          .from("test_series")
          .insert(basePayload)
          .select()
          .single();
        if (createError) throw createError;
        const currentExamIds = Array.isArray(seriesForm.exam_ids) ? seriesForm.exam_ids : [];
        if (Number(createData?.id || 0) > 0 && currentExamIds.length > 0) {
          const { error: examLinkError } = await supabase.from("test_series_exams").insert(
            currentExamIds.map((exam_id) => ({ test_series_id: Number(createData.id), exam_id })),
          );
          if (examLinkError) throw examLinkError;
        }
        if (createData?.id) {
          setSelectedSeriesId(createData.id);
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
      const supabase = createClient();
      const { error: enrollError } = await supabase
        .from("user_content_access")
        .insert({
          user_id: profileId,
          access_type: "test_series",
          test_series_id: seriesId,
          is_active: true,
          granted_at: new Date().toISOString(),
        });
      if (enrollError) throw enrollError;
      toast.success("Enrolled in programs");
      await loadSeries();
    } catch (error: unknown) {
      toast.error("Enrollment failed", { description: toError(error) });
    }
  };

  const loadCopySubmissions = async (seriesId: number, testCollectionId: number) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("mains_test_copy_submissions")
        .select(`
          *,
          unit_step:program_unit_steps!unit_step_id (
            id,
            title,
            collection_id
          )
        `)
        .eq("series_id", seriesId)
        .order("submitted_at", { ascending: false });
      
      if (error) throw error;
      const rows = (Array.isArray(data) ? (data as MainsSubmissionRow[]) : [])
        .filter((row) => Number(row.unit_step?.collection_id || row.collection_id || row.test_collection_id || 0) === testCollectionId)
        .map((row) => normalizeMainsCopySubmission({
          ...row,
          collection_id: row.unit_step?.collection_id ?? row.collection_id ?? row.test_collection_id ?? null,
        }));
      setCopySubmissionsByTest((prev) => ({
        ...prev,
        [String(testCollectionId)]: rows,
      }));
    } catch (error: unknown) {
      toast.error("Failed to load submissions", { description: toError(error) });
      setCopySubmissionsByTest((prev) => ({ ...prev, [String(testCollectionId)]: [] }));
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 text-sm text-[#6c7590] dark:text-[#94a3b8]">Loading workspace...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-gradient-to-r from-slate-900 to-slate-700 p-6 text-white">
        <h1 className="text-2xl font-bold">Programs & Mentorship Hub</h1>
        <p className="mt-2 text-sm text-slate-100/90">
          Mobile-friendly workspace for Prelims and Mains operations, with role-based access for Quiz Masters and Mains Mentors.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("explore")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "explore" ? "bg-white dark:bg-[#0b1120] text-[#141b2d] dark:text-white" : "bg-white dark:bg-[#0b1120]/20 text-white"}`}
          >
            Explore
          </button>
          {operatorEnabled ? (
            <button
              type="button"
              onClick={() => setMode("provider")}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === "provider" ? "bg-white dark:bg-[#0b1120] text-[#141b2d] dark:text-white" : "bg-white dark:bg-[#0b1120]/20 text-white"}`}
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
            className="inline-flex items-center gap-1 rounded-md bg-white dark:bg-[#0b1120]/20 px-3 py-1.5 text-sm font-semibold text-white"
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
                <div key={card.key} className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
                  <card.icon className="h-4 w-4 text-[#6c7590] dark:text-[#94a3b8]" />
                  <p className="mt-2 text-xs font-semibold uppercase text-[#6c7590] dark:text-[#94a3b8]">{card.label}</p>
                  <p className="text-2xl font-bold text-[#141b2d] dark:text-white">{providerSummaryLoading ? "..." : card.value}</p>
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
                <div key={card.key} className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
                  <card.icon className="h-4 w-4 text-[#6c7590] dark:text-[#94a3b8]" />
                  <p className="mt-2 text-xs font-semibold uppercase text-[#6c7590] dark:text-[#94a3b8]">{card.label}</p>
                  <p className="text-2xl font-bold text-[#141b2d] dark:text-white">{moderationSummaryLoading ? "..." : card.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4 text-sm text-[#636b86] dark:text-gray-300">
              Monitoring mode: series authoring stats are visible only to Quiz Master, Mains Mentor, or admin roles.
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-4 rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
              {canBuildSeries ? (
                <>
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-semibold text-[#141b2d] dark:text-white">{editingSeriesId ? "Edit Programs" : "Programs Console"}</p>
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
                          className="w-full rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm"
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
                          className="w-full rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm"
                          placeholder="Cover image URL"
                        />
                        <div className="grid gap-2 md:grid-cols-2">
                          <select
                            value={seriesForm.series_kind || seriesKindOptions[0]?.value || "quiz"}
                            onChange={(event) => setSeriesForm((prev) => ({ ...prev, series_kind: event.target.value as "mains" | "quiz" | "hybrid" }))}
                            disabled={seriesKindOptions.length <= 1}
                            className="rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm"
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
                            className="rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm"
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
                            className="rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm"
                            placeholder="Price"
                          />
                          <label className="inline-flex items-center gap-2 rounded-md border border-[#dce3fb] dark:border-[#1e2a4a] px-3 py-2 text-sm">
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
                            <label className="text-xs font-semibold uppercase text-[#6c7590] dark:text-[#94a3b8]">Target exams</label>
                            <span className="text-xs text-[#6c7590] dark:text-[#94a3b8]">Programs and tests show under these exams.</span>
                          </div>
                          <div className="flex flex-wrap gap-2 rounded-md border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                            {availableExams.length === 0 ? (
                              <span className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No active exams available.</span>
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
                                      : "border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] text-[#334155] dark:text-gray-200"
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
                          <button type="button" onClick={resetSeriesForm} className="rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#6c7590] dark:text-[#94a3b8]">Use the cards below to open or manage a program, or use the button above to create a new one.</p>
                    )}
                  </>
                </>
              ) : (
                <p className="text-xs text-amber-700">Read-only mode. Quiz Master, Mains Mentor, or admin role is required to create or edit programs.</p>
              )}

              <div className="border-t border-[#dce3fb] dark:border-[#1e2a4a] pt-4">
                <p className="mb-2 text-xs font-semibold uppercase text-[#6c7590] dark:text-[#94a3b8]">Your Series</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {seriesRows.map((series) => (
                    <article key={series.id} className="overflow-hidden rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] shadow-[0_14px_32px_rgba(15,23,42,0.06)] transition hover:-translate-y-1 hover:shadow-[0_22px_48px_rgba(15,23,42,0.12)]">
                      <div className="bg-gradient-to-b from-white to-[#f7f9ff] dark:from-[#0b1120] dark:to-[#0f172a] px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-black tracking-tight text-[#141b2d] dark:text-white">{series.title}</p>
                            <p className="mt-1 text-xs text-[#636b86] dark:text-gray-300">
                              {series.test_count} tests
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${series.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-[#636b86] dark:text-gray-300"}`}>
                            {series.is_active ? "Active" : "Archived"}
                          </span>
                        </div>
                      </div>
                      <div className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-2.5 py-1 text-[11px] font-semibold text-[#636b86] dark:text-gray-300">
                            {String(series.series_kind || "").trim() || "series"}
                          </span>
                          <span className="rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-2.5 py-1 text-[11px] font-semibold text-[#636b86] dark:text-gray-300">
                            {String(series.access_type || "").trim() || "subscription"}
                          </span>
                          <span className="rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-2.5 py-1 text-[11px] font-semibold text-[#636b86] dark:text-gray-300">
                            {series.is_public ? "Public" : "Private"}
                          </span>
                          {(series.exam_ids || []).map((examId) => (
                            <span key={examId} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                              {examNameById.get(examId) || `Exam ${examId}`}
                            </span>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/programs/${series.id}`} className="inline-flex items-center rounded-xl border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-3 py-2 text-[11px] font-semibold text-[#334155] dark:text-gray-200">
                          Detail
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSeriesId(series.id);
                            setSeriesForm({
                              title: series.title,
                              description: series.description,
                              cover_image_url: series.cover_image_url,
                              series_kind: series.series_kind,
                              access_type: series.access_type,
                              price: series.price,
                              exam_ids: series.exam_ids,
                              is_public: series.is_public,
                              is_active: series.is_active,
                              meta: series.meta || {},
                            });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="inline-flex items-center rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
                        >
                          Edit
                        </button>
                        <Link href={`/programs/${series.id}/manage`} className="inline-flex items-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-700">
                          Manage
                        </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!seriesLoading && seriesRows.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No series yet.</p> : null}
                </div>
              </div>
            </div>
          </div>

          {canBuildMainsSeries || canHandleMentorship ? (
            <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[#141b2d] dark:text-white">Mentorship Workspace</h3>
                  <p className="mt-1 text-xs text-[#636b86] dark:text-gray-300">
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
                <div className="rounded border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                  <p className="text-[#6c7590] dark:text-[#94a3b8]">Published slots</p>
                  <p className="mt-1 text-lg font-semibold text-[#141b2d] dark:text-white">{slots.length}</p>
                </div>
                <div className="rounded border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                  <p className="text-[#6c7590] dark:text-[#94a3b8]">Open requests</p>
                  <p className="mt-1 text-lg font-semibold text-[#141b2d] dark:text-white">
                    {mentorshipRequests.filter((request) => request.status === "requested").length}
                  </p>
                </div>
                <div className="rounded border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                  <p className="text-[#6c7590] dark:text-[#94a3b8]">Scheduled calls</p>
                  <p className="mt-1 text-lg font-semibold text-[#141b2d] dark:text-white">
                    {mentorshipRequests.filter((request) => request.status === "scheduled").length}
                  </p>
                </div>
                <div className="rounded border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                  <p className="text-[#6c7590] dark:text-[#94a3b8]">Completed calls</p>
                  <p className="mt-1 text-lg font-semibold text-[#141b2d] dark:text-white">
                    {mentorshipRequests.filter((request) => request.status === "completed").length}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={selectedSeriesId ? `/mentorship/manage?seriesId=${selectedSeriesId}` : "/mentorship/manage"}
                  className="rounded border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-3 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200"
                >
                  Open Series Queue
                </Link>
                <Link href="/mentorship/manage" className="rounded border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-3 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
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
                <article key={series.id} className="overflow-hidden rounded-[28px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
                  <div className="bg-gradient-to-b from-white to-[#f7f9ff] dark:from-[#0b1120] dark:to-[#0f172a] px-5 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-xl font-black tracking-tight text-[#141b2d] dark:text-white">{series.title}</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#636b86] dark:text-gray-300">{richTextToPlainText(series.description || "") || "No description."}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/70 bg-white dark:bg-[#0b1120]/80 px-3 py-1 text-[11px] font-semibold text-[#636b86] dark:text-gray-300">
                          {String(series.series_kind || "").trim() || "series"}
                        </span>
                        <span className="rounded-full border border-white/70 bg-white dark:bg-[#0b1120]/80 px-3 py-1 text-[11px] font-semibold text-[#636b86] dark:text-gray-300">
                          {series.test_count} tests
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link href={`/programs/${series.id}`} className="inline-flex items-center rounded-xl border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-3 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
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
                        <div key={test.id} className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-slate-50/80 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-[#141b2d] dark:text-white">{test.title}</p>
                              <p className="text-xs text-[#6c7590] dark:text-[#94a3b8]">{richTextToPlainText(test.description || "") || "No description."}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <Link href={`/collections/${test.id}`} className="rounded-xl border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-2.5 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">Open</Link>
                              <Link href={test.test_kind === "mains" ? `/collections/${test.id}` : `/collections/${test.id}/test`} className="rounded-xl border border-indigo-300 bg-white dark:bg-[#0b1120] px-2.5 py-1.5 text-xs font-semibold text-indigo-700">{test.test_kind === "mains" ? "Open Test" : "Start"}</Link>
                            </div>
                          </div>
                          {test.test_kind === "mains" && isAuthenticated ? (
                            <div className="mt-2 space-y-2">
                              <p className="text-xs text-[#636b86] dark:text-gray-300">Use the main test page to submit a full answer PDF or question-wise answer photos. That same page now runs the full evaluation and mentorship flow.</p>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => void loadCopySubmissions(series.id, test.id)} className="rounded border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-2 py-1 text-xs">Refresh Submissions</button>
                              </div>
                              {submissions.map((submission) => (
                                <div key={submission.id} className="rounded border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] px-2 py-1 text-xs">
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
              <div className="rounded-xl border border-dashed border-[#c9d6fb] dark:border-[#2a3c6b] bg-[#f8faff] dark:bg-[#0f172a] p-10 text-center text-sm text-[#6c7590] dark:text-[#94a3b8]">
                No public programs available yet.
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-[#141b2d] dark:text-white">Mentorship Booking</h3>
                <Link href="/mentorship/manage" className="rounded border border-[#c9d6fb] dark:border-[#2a3c6b] px-2 py-1 text-[11px]">
                  Full Page
                </Link>
              </div>
              <p className="mt-3 text-sm text-[#636b86] dark:text-gray-300">
                Use the dedicated mentorship manage page to compare mentor availability, review detailed mentor profiles,
                and book calls without duplicating the request flow here.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/mentors" className="rounded border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-3 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
                  Browse Mentors
                </Link>
                <Link href="/mentorship/manage" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  Open Booking Workspace
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
              <h3 className="text-lg font-semibold text-[#141b2d] dark:text-white">My Entitlements</h3>
              <div className="mt-2 space-y-1">
                {entitlements.map((entitlement) => (
                  <div key={entitlement.id} className="rounded border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-2 py-1 text-xs">
                    {entitlement.source} | Remaining: {entitlement.sessions_remaining}
                  </div>
                ))}
                {entitlements.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No active mentorship entitlements.</p> : null}
              </div>
            </div>

            <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
              <h3 className="text-lg font-semibold text-[#141b2d] dark:text-white">My Mains Performance</h3>
              {performanceReport ? (
                <div className="mt-2 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded bg-[#f8faff] dark:bg-[#0f172a] px-2 py-1"><span>Total submissions</span><span className="font-semibold">{performanceReport.total_submissions}</span></div>
                  <div className="flex items-center justify-between rounded bg-[#f8faff] dark:bg-[#0f172a] px-2 py-1"><span>Checked submissions</span><span className="font-semibold">{performanceReport.checked_submissions}</span></div>
                  <div className="flex items-center justify-between rounded bg-[#f8faff] dark:bg-[#0f172a] px-2 py-1"><span>Average provider marks</span><span className="font-semibold">{performanceReport.average_provider_marks}</span></div>
                  <div className="flex items-center justify-between rounded bg-[#f8faff] dark:bg-[#0f172a] px-2 py-1"><span>Average AI score</span><span className="font-semibold">{performanceReport.average_ai_score}</span></div>
                </div>
              ) : <p className="mt-2 text-sm text-[#6c7590] dark:text-[#94a3b8]">No mains report yet.</p>}
              <button type="button" onClick={() => void loadMyPerformance()} className="mt-2 inline-flex items-center gap-1 rounded border border-[#c9d6fb] dark:border-[#2a3c6b] px-2 py-1 text-xs">
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
