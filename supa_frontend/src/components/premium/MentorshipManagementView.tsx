"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import CopyEvaluationFlowStatus from "@/components/premium/CopyEvaluationFlowStatus";
import MentorAvailabilityCalendar from "@/components/premium/MentorAvailabilityCalendar";
import MentorshipAvailabilityManager from "@/components/premium/MentorshipAvailabilityManager";
import MentorshipSlotOfferList from "@/components/premium/MentorshipSlotOfferList";
import WorkflowProgressTrack from "@/components/premium/WorkflowProgressTrack";
import { useAuth } from "@/context/AuthContext";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RichTextContent from "@/components/ui/RichTextContent";
import RichTextField from "@/components/ui/RichTextField";
import { isAdminLike, isMentorLike, isModeratorLike } from "@/lib/accessControl";
import { buildCopyEvaluationFlowSteps, isCopyEvaluationFlow, offeredSlotsForRequest } from "@/lib/copyEvaluationFlow";
import { buildMentorshipWorkflowSteps, mentorshipCurrentStatusLabel, mentorshipNextActionLabel } from "@/lib/mentorshipOrderFlow";
import { buildAvailabilityDays, formatSlotTimeRange, mentorshipCallLabel } from "@/lib/mentorAvailability";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import type {
  MentorAvailabilityStatus,
  MainsCopySubmission,
  MentorshipEntitlement,
  MentorshipRequest,
  MentorshipRequestOfferSlotsPayload,
  MentorshipSession,
  MentorshipSlot,
  TestSeries,
  TestSeriesTest,
} from "@/types/premium";

interface MentorshipManagementViewProps {
  seriesId?: number | null;
  prefillMentorUserId?: string | null;
}

type ManageMode = "user" | "provider";

interface DirectSubmissionReviewDraft {
  etaHours: string;
  etaText: string;
  checkedCopyUrl: string;
  totalMarks: string;
  providerNote: string;
}

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

const mentorshipStatusLabel = (status: MentorshipRequest["status"]): string => {
  if (status === "requested") return "Requested";
  if (status === "scheduled") return "Slot Booked";
  if (status === "completed") return "Mentorship Completed";
  if (status === "rejected") return "Request Rejected";
  return "Request Cancelled";
};

const mentorStatusLabel = (status?: MentorAvailabilityStatus | null): string => {
  if (!status) return "Status unavailable";
  if (status.status === "available_now") return "Available Now";
  if (status.status === "busy") return "Busy";
  return "Offline";
};

const mentorStatusBadgeClass = (status?: MentorAvailabilityStatus | null): string => {
  if (!status) return "border-slate-200 bg-slate-100 text-slate-700";
  if (status.status === "available_now") return "border-emerald-200 bg-emerald-100 text-emerald-800";
  if (status.status === "busy") return "border-amber-200 bg-amber-100 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
};

const toIsoDateTime = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const formatDateTime = (value?: string | null): string => {
  const isoValue = toIsoDateTime(value);
  if (!isoValue) return "Not set";
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return isoValue;
  return parsed.toLocaleString();
};

const requestMetaDate = (request: MentorshipRequest, key: string): string | null =>
  toIsoDateTime(request.meta?.[key]);

const isDirectProfileBooking = (request: MentorshipRequest): boolean => {
  const bookingSource = String(request.meta?.booking_source || "").trim().toLowerCase();
  return Boolean(request.meta?.standalone) || bookingSource === "self_service_slot";
};

const buildDirectSubmissionReviewDraft = (submission: MainsCopySubmission): DirectSubmissionReviewDraft => ({
  etaHours: submission.provider_eta_hours ? String(submission.provider_eta_hours) : "",
  etaText: submission.provider_eta_text || "",
  checkedCopyUrl: submission.checked_copy_pdf_url || "",
  totalMarks:
    submission.total_marks !== null && submission.total_marks !== undefined ? String(submission.total_marks) : "",
  providerNote: submission.provider_note || "",
});

export default function MentorshipManagementView({ seriesId, prefillMentorUserId }: MentorshipManagementViewProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const currentUserId = String(user?.id || "").trim();
  const adminLike = useMemo(() => isAdminLike(user), [user]);
  const moderatorLike = useMemo(() => !adminLike && isModeratorLike(user), [user, adminLike]);
  const mentorLike = useMemo(() => !adminLike && !moderatorLike && isMentorLike(user), [user, adminLike, moderatorLike]);
  const canScheduleMentorship = useMemo(() => adminLike || moderatorLike, [adminLike, moderatorLike]);
  const canManageMentorSlots = useMemo(() => mentorLike, [mentorLike]);
  const canOperateMentorSessions = useMemo(() => mentorLike, [mentorLike]);
  const canGrantEntitlements = useMemo(() => adminLike || moderatorLike, [adminLike, moderatorLike]);
  const canHandleMentorship = useMemo(
    () => canScheduleMentorship || canManageMentorSlots,
    [canManageMentorSlots, canScheduleMentorship],
  );
  const canViewHandlerPanel = useMemo(() => canHandleMentorship, [canHandleMentorship]);
  const normalizedPrefillMentorUserId = useMemo(
    () => String(prefillMentorUserId || "").trim(),
    [prefillMentorUserId],
  );

  const [mode, setMode] = useState<ManageMode>(
    normalizedPrefillMentorUserId ? "user" : canViewHandlerPanel ? "provider" : "user",
  );
  const [providerAspect, setProviderAspect] = useState<"availability" | "calls">(mentorLike ? "availability" : "calls");
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [slots, setSlots] = useState<MentorshipSlot[]>([]);
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [sessions, setSessions] = useState<MentorshipSession[]>([]);
  const [entitlements, setEntitlements] = useState<MentorshipEntitlement[]>([]);
  const [seriesById, setSeriesById] = useState<Record<string, TestSeries>>({});
  const [testsById, setTestsById] = useState<Record<string, TestSeriesTest>>({});
  const [submissionById, setSubmissionById] = useState<Record<string, MainsCopySubmission>>({});

  const [slotByRequestId, setSlotByRequestId] = useState<Record<string, string>>({});
  const [slotOfferDraftByRequestId, setSlotOfferDraftByRequestId] = useState<Record<string, number[]>>({});
  const [mentorStatusByProviderId, setMentorStatusByProviderId] = useState<Record<string, MentorAvailabilityStatus>>({});
  const [startNowBusyByRequestId, setStartNowBusyByRequestId] = useState<Record<string, boolean>>({});
  const [startNowMeetingLinkByRequestId, setStartNowMeetingLinkByRequestId] = useState<Record<string, string>>({});
  const [offeringSlotsRequestId, setOfferingSlotsRequestId] = useState<number | null>(null);
  const [acceptingSlotKey, setAcceptingSlotKey] = useState<string | null>(null);
  const [directReviewDrafts, setDirectReviewDrafts] = useState<Record<string, DirectSubmissionReviewDraft>>({});
  const [savingEtaSubmissionId, setSavingEtaSubmissionId] = useState<number | null>(null);
  const [savingReviewSubmissionId, setSavingReviewSubmissionId] = useState<number | null>(null);

  const [standaloneProviderId, setStandaloneProviderId] = useState(normalizedPrefillMentorUserId);
  const [standaloneNote, setStandaloneNote] = useState("");
  const [selectedMentorDateKey, setSelectedMentorDateKey] = useState<string | null>(null);
  const [selectedMentorSlotId, setSelectedMentorSlotId] = useState<number | null>(null);
  const [bookingSlotId, setBookingSlotId] = useState<number | null>(null);

  const [grantUserId, setGrantUserId] = useState("");
  const [grantSessions, setGrantSessions] = useState("1");
  const [selectedMentorSlots, setSelectedMentorSlots] = useState<MentorshipSlot[]>([]);
  const latestLearnerBookingSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (normalizedPrefillMentorUserId) {
      setMode("user");
      return;
    }
    setMode(canViewHandlerPanel ? "provider" : "user");
  }, [canViewHandlerPanel, normalizedPrefillMentorUserId]);

  useEffect(() => {
    if (!normalizedPrefillMentorUserId) {
      return;
    }
    setStandaloneProviderId(normalizedPrefillMentorUserId);
  }, [normalizedPrefillMentorUserId]);

  const loadSelectedMentorSlots = async (providerUserId: string) => {
    const providerId = String(providerUserId || "").trim();
    if (!providerId) {
      setSelectedMentorSlots([]);
      return;
    }

    try {
      const response = await premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
        params: {
          provider_user_id: providerId,
          only_available: false,
        },
      });
      setSelectedMentorSlots(Array.isArray(response.data) ? response.data : []);
    } catch {
      setSelectedMentorSlots([]);
    }
  };

  useEffect(() => {
    if (mode !== "provider") return;
    setProviderAspect(canManageMentorSlots ? "availability" : "calls");
  }, [canManageMentorSlots, mode]);

  const loadAll = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!isAuthenticated) {
      setBusy(false);
      setRefreshing(false);
      setSeriesById({});
      setTestsById({});
      setSubmissionById({});
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setBusy(true);
    }
    try {
      const scope = mode === "provider" ? (canScheduleMentorship ? "all" : "provider") : "me";
      const [slotsResponse, requestsResponse, sessionsResponse] = await Promise.all([
        premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
          params: { include_past: mode === "provider", only_available: false },
        }),
        premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope } }),
        premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope } }),
      ]);

      setSlots(Array.isArray(slotsResponse.data) ? slotsResponse.data : []);
      setRequests(Array.isArray(requestsResponse.data) ? requestsResponse.data : []);
      setSessions(Array.isArray(sessionsResponse.data) ? sessionsResponse.data : []);

      if (mode === "user") {
        const entitlementsResponse = await premiumApi.get<MentorshipEntitlement[]>("/mentorship/entitlements/me");
        setEntitlements(Array.isArray(entitlementsResponse.data) ? entitlementsResponse.data : []);
      } else {
        setEntitlements([]);
      }
    } catch (error: unknown) {
      if (!silent) {
        toast.error("Failed to load mentorship management", { description: toError(error) });
        setSlots([]);
        setRequests([]);
        setSessions([]);
        setEntitlements([]);
        setSeriesById({});
        setTestsById({});
        setSubmissionById({});
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    if (loading) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated, mode, canScheduleMentorship]);

  const filteredRequests = useMemo(
    () => {
      if (!seriesId) return requests;
      if (mode !== "provider") {
        return requests.filter((row) => row.series_id === seriesId);
      }
      return requests.filter((row) => row.series_id === seriesId || isDirectProfileBooking(row));
    },
    [mode, requests, seriesId],
  );

  const filteredRequestIdSet = useMemo(
    () => new Set(filteredRequests.map((row) => row.id)),
    [filteredRequests],
  );

  const filteredSessions = useMemo(
    () => (seriesId ? sessions.filter((row) => filteredRequestIdSet.has(row.request_id)) : sessions),
    [sessions, seriesId, filteredRequestIdSet],
  );

  const sessionByRequestId = useMemo(() => {
    const map: Record<string, MentorshipSession> = {};
    for (const row of filteredSessions) {
      const key = String(row.request_id);
      const existing = map[key];
      if (!existing || (existing.status !== "live" && row.status === "live")) {
        map[key] = row;
      }
    }
    return map;
  }, [filteredSessions]);

  useEffect(() => {
    setSlotOfferDraftByRequestId((prev) => {
      const next: Record<string, number[]> = {};
      for (const request of filteredRequests) {
        const key = String(request.id);
        const existing = prev[key];
        const offered = (Array.isArray(request.meta?.offered_slot_ids) ? request.meta.offered_slot_ids : [])
          .map((value) => Number(value))
          .filter((value, index, array) => Number.isFinite(value) && value > 0 && array.indexOf(value) === index);
        next[key] = existing && existing.length > 0 ? existing : offered;
      }
      return next;
    });
  }, [filteredRequests]);

  useEffect(() => {
    const next: Record<string, DirectSubmissionReviewDraft> = {};
    for (const submission of Object.values(submissionById)) {
      if ((submission.test_collection_id || 0) > 0) continue;
      next[String(submission.id)] = buildDirectSubmissionReviewDraft(submission);
    }
    setDirectReviewDrafts(next);
  }, [submissionById]);

  const mentorStatusProviderIds = useMemo(() => {
    const values: string[] = [];
    const pushValue = (value: unknown) => {
      const id = String(value || "").trim();
      if (id && !values.includes(id)) values.push(id);
    };
    for (const request of filteredRequests) {
      pushValue(request.provider_user_id);
    }
    if (mode === "user") {
      pushValue(standaloneProviderId);
    }
    return values;
  }, [filteredRequests, mode, standaloneProviderId]);

  const selectedStandaloneMentorStatus = useMemo(
    () => mentorStatusByProviderId[String(standaloneProviderId || "").trim()] || null,
    [mentorStatusByProviderId, standaloneProviderId],
  );
  const selectedMentorAvailabilityDays = useMemo(
    () => buildAvailabilityDays(selectedMentorSlots, 14),
    [selectedMentorSlots],
  );
  const selectedMentorDay = useMemo(
    () => selectedMentorAvailabilityDays.find((day) => day.dateKey === selectedMentorDateKey) || null,
    [selectedMentorAvailabilityDays, selectedMentorDateKey],
  );
  const selectedMentorSlot = useMemo(
    () => selectedMentorSlots.find((slot) => slot.id === selectedMentorSlotId) || null,
    [selectedMentorSlotId, selectedMentorSlots],
  );
  const recentLearnerBookings = useMemo(
    () =>
      filteredRequests
        .filter((request) => request.status === "scheduled" && Boolean(requestMetaDate(request, "booked_by_user_at")))
        .sort((left, right) => {
          const leftTime = new Date(requestMetaDate(left, "booked_by_user_at") || left.requested_at).getTime();
          const rightTime = new Date(requestMetaDate(right, "booked_by_user_at") || right.requested_at).getTime();
          return rightTime - leftTime;
        }),
    [filteredRequests],
  );
  const recentLearnerBookingCount = recentLearnerBookings.length;
  const recentLearnerBookingSignature = useMemo(() => {
    const latestBooking = recentLearnerBookings[0];
    if (!latestBooking) return null;
    return `${latestBooking.id}:${requestMetaDate(latestBooking, "booked_by_user_at") || latestBooking.updated_at || latestBooking.requested_at}`;
  }, [recentLearnerBookings]);

  const pendingRequests = filteredRequests.filter((row) => row.status === "requested").length;
  const scheduledRequests = filteredRequests.filter((row) => row.status === "scheduled").length;
  const completedRequests = filteredRequests.filter((row) => row.status === "completed").length;
  const backFallbackHref = seriesId ? `/test-series/${seriesId}` : prefillMentorUserId ? "/mentors" : "/test-series";
  const handlerTabLabel = canScheduleMentorship ? "Admin Oversight" : "Mentor Desk";
  const handlerPanelTitle = canScheduleMentorship ? "Admin Workflow Oversight" : "Mentor Delivery Queue";
  const handlerPanelDescription = canScheduleMentorship
    ? "Admins can monitor every mentorship workflow and step in only for older non-copy requests that still need manual slot assignment."
    : "Publish availability, review copies, offer mentorship slots after checking, and complete audio or video calls from one mentor workspace.";
  const providerDescription =
    canManageMentorSlots && providerAspect === "availability"
      ? "Manage direct copy-evaluation settings, publish day-wise calendar availability, and block specific dates from the mentor workspace."
      : handlerPanelDescription;
  const userDescription =
    "Track direct mentorship bookings and copy-evaluation workflows. For reviewed copies, the mentor first checks the submission, then offers one or more call slots for you to accept.";

  useEffect(() => {
    if (mode === "provider" && canManageMentorSlots && recentLearnerBookingCount > 0 && providerAspect === "availability") {
      setProviderAspect("calls");
    }
  }, [canManageMentorSlots, mode, providerAspect, recentLearnerBookingCount]);

  useEffect(() => {
    if (mode !== "provider" || !canManageMentorSlots) {
      latestLearnerBookingSignatureRef.current = recentLearnerBookingSignature;
      return;
    }
    if (!recentLearnerBookingSignature) {
      latestLearnerBookingSignatureRef.current = null;
      return;
    }

    if (
      latestLearnerBookingSignatureRef.current &&
      latestLearnerBookingSignatureRef.current !== recentLearnerBookingSignature
    ) {
      const latestBooking = recentLearnerBookings[0];
      const scheduledFor = latestBooking ? requestMetaDate(latestBooking, "scheduled_slot_starts_at") : null;
      toast.success("New learner booking received", {
        description: scheduledFor
          ? `Scheduled for ${formatDateTime(scheduledFor)}.`
          : "A learner booked one of your 20-minute mentorship slots.",
      });
    }

    latestLearnerBookingSignatureRef.current = recentLearnerBookingSignature;
  }, [canManageMentorSlots, mode, recentLearnerBookingSignature, recentLearnerBookings]);

  useEffect(() => {
    if (selectedMentorDateKey && !selectedMentorAvailabilityDays.some((day) => day.dateKey === selectedMentorDateKey)) {
      setSelectedMentorDateKey(null);
    }
    if (selectedMentorSlotId && !selectedMentorSlots.some((slot) => slot.id === selectedMentorSlotId)) {
      setSelectedMentorSlotId(null);
    }
  }, [selectedMentorAvailabilityDays, selectedMentorDateKey, selectedMentorSlotId, selectedMentorSlots]);

  useEffect(() => {
    if (!isAuthenticated || filteredRequests.length === 0) {
      if (filteredRequests.length === 0) {
        setSeriesById({});
        setTestsById({});
        setSubmissionById({});
      }
      return;
    }

    let cancelled = false;

    void (async () => {
      const uniqueSeriesIds = Array.from(
        new Set(
          filteredRequests
            .map((row) => Number(row.series_id || 0))
            .filter((value) => Number.isFinite(value) && value > 0),
        ),
      );
      const uniqueSubmissionIds = Array.from(
        new Set(
          filteredRequests
            .map((row) => Number(row.submission_id || 0))
            .filter((value) => Number.isFinite(value) && value > 0),
        ),
      );

      try {
        const [seriesEntries, testEntries, submissionEntries] = await Promise.all([
          Promise.all(
            uniqueSeriesIds.map(async (id) => {
              try {
                const response = await premiumApi.get<TestSeries>(`/test-series/${id}`);
                return [String(id), response.data] as const;
              } catch {
                return null;
              }
            }),
          ),
          Promise.all(
            uniqueSeriesIds.map(async (id) => {
              try {
                const response = await premiumApi.get<TestSeriesTest[]>(`/test-series/${id}/tests`, {
                  params: { include_inactive: true },
                });
                return Array.isArray(response.data) ? response.data : [];
              } catch {
                return [] as TestSeriesTest[];
              }
            }),
          ),
          Promise.all(
            uniqueSubmissionIds.map(async (id) => {
              try {
                const response = await premiumApi.get<MainsCopySubmission>(`/copy-submissions/${id}`);
                return [String(id), response.data] as const;
              } catch {
                return null;
              }
            }),
          ),
        ]);

        if (cancelled) return;

        const nextSeriesById: Record<string, TestSeries> = {};
        for (const entry of seriesEntries) {
          if (!entry) continue;
          nextSeriesById[entry[0]] = entry[1];
        }

        const nextTestsById: Record<string, TestSeriesTest> = {};
        for (const rows of testEntries) {
          for (const row of rows) {
            nextTestsById[String(row.id)] = row;
          }
        }

        const nextSubmissionById: Record<string, MainsCopySubmission> = {};
        for (const entry of submissionEntries) {
          if (!entry) continue;
          nextSubmissionById[entry[0]] = entry[1];
        }

        setSeriesById(nextSeriesById);
        setTestsById(nextTestsById);
        setSubmissionById(nextSubmissionById);
      } catch {
        if (!cancelled) {
          setSeriesById({});
          setTestsById({});
          setSubmissionById({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredRequests, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setMentorStatusByProviderId({});
      return;
    }
    if (mentorStatusProviderIds.length === 0) {
      setMentorStatusByProviderId({});
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await premiumApi.get<MentorAvailabilityStatus[]>("/mentorship/mentors/status", {
          params: {
            provider_user_ids: mentorStatusProviderIds.join(","),
            include_offline: true,
            limit: Math.min(mentorStatusProviderIds.length, 500),
          },
        });
        if (cancelled) return;
        const map: Record<string, MentorAvailabilityStatus> = {};
        for (const row of Array.isArray(response.data) ? response.data : []) {
          const providerUserId = String(row.provider_user_id || "").trim();
          if (!providerUserId) continue;
          map[providerUserId] = row;
        }
        setMentorStatusByProviderId(map);
      } catch {
        if (!cancelled) {
          setMentorStatusByProviderId({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, mentorStatusProviderIds]);

  useEffect(() => {
    if (mode !== "user") {
      setSelectedMentorSlots([]);
      return;
    }

    const providerUserId = String(standaloneProviderId || "").trim();
    if (!providerUserId) {
      setSelectedMentorSlots([]);
      return;
    }

    setSelectedMentorDateKey(null);
    setSelectedMentorSlotId(null);
    void loadSelectedMentorSlots(providerUserId);
  }, [mode, standaloneProviderId]);

  const scheduleRequest = async (requestId: number) => {
    if (!canScheduleMentorship) {
      toast.error("Admin or moderator access is required to assign mentorship time");
      return;
    }
    const slotId = Number(slotByRequestId[String(requestId)] || 0);
    if (!slotId) {
      toast.error("Select a slot first");
      return;
    }
    try {
      await premiumApi.post(`/mentorship/requests/${requestId}/schedule`, { slot_id: slotId });
      toast.success("Request scheduled");
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to schedule request", { description: toError(error) });
    }
  };

  const startRequestNow = async (requestId: number) => {
    if (!canOperateMentorSessions) {
      toast.error("Mains Mentor access is required to start immediate sessions");
      return;
    }

    const key = String(requestId);
    const scheduledSession = sessionByRequestId[key] || null;
    const scheduledSlot = slots.find((slot) => slot.id === scheduledSession?.slot_id) || null;
    const callProvider =
      scheduledSession?.call_provider ||
      scheduledSlot?.call_provider ||
      null;
    setStartNowBusyByRequestId((prev) => ({ ...prev, [key]: true }));
    try {
      const meetingLink = String(startNowMeetingLinkByRequestId[key] || "").trim();
      await premiumApi.post(`/mentorship/requests/${requestId}/start-now`, {
        call_provider: callProvider,
        duration_minutes: 45,
        meeting_link: meetingLink || null,
      });
      toast.success("Immediate mentorship session started");
      setStartNowMeetingLinkByRequestId((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to start immediate session", { description: toError(error) });
    } finally {
      setStartNowBusyByRequestId((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const updateRequestStatus = async (
    requestId: number,
    status: "rejected" | "completed" | "cancelled",
  ) => {
    if (status === "rejected" && !canScheduleMentorship) {
      toast.error("Admin or moderator access is required to reject requests");
      return;
    }
    if (status === "completed" && !(canOperateMentorSessions || canScheduleMentorship)) {
      toast.error("Mains Mentor, moderator, or admin access is required to complete requests");
      return;
    }
    try {
      await premiumApi.put(`/mentorship/requests/${requestId}/status`, { status });
      toast.success("Request updated");
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to update request", { description: toError(error) });
    }
  };

  const bookStandaloneSlot = async () => {
    const providerId = standaloneProviderId.trim();
    if (!providerId) {
      toast.error("Mains Mentor user id is required");
      return;
    }
    if (!selectedMentorSlot) {
      toast.error("Select an available 20-minute slot first");
      return;
    }

    setBookingSlotId(selectedMentorSlot.id);
    try {
      await premiumApi.post("/mentorship/requests", {
        provider_user_id: providerId,
        slot_id: selectedMentorSlot.id,
        preferred_mode: selectedMentorSlot.mode,
        note: toNullableRichText(standaloneNote),
      });
      toast.success("Mentorship slot booked. The mentor can now see it in Calls & Records.");
      setStandaloneNote("");
      setSelectedMentorSlotId(null);
      await Promise.all([loadAll({ silent: true }), loadSelectedMentorSlots(providerId)]);
    } catch (error: unknown) {
      toast.error("Failed to book mentorship slot", { description: toError(error) });
    } finally {
      setBookingSlotId(null);
    }
  };

  const updateDirectReviewDraft = (
    submissionId: number,
    updater: (draft: DirectSubmissionReviewDraft) => DirectSubmissionReviewDraft,
  ) => {
    setDirectReviewDrafts((prev) => {
      const current = prev[String(submissionId)];
      if (!current) return prev;
      return { ...prev, [String(submissionId)]: updater(current) };
    });
  };

  const saveDirectSubmissionEta = async (submissionId: number) => {
    const draft = directReviewDrafts[String(submissionId)];
    if (!draft) return;
    setSavingEtaSubmissionId(submissionId);
    try {
      await premiumApi.put(`/copy-submissions/${submissionId}/eta`, {
        provider_eta_hours: draft.etaHours.trim() ? Number(draft.etaHours) : undefined,
        provider_eta_text: draft.etaText.trim() || undefined,
      });
      toast.success("Checking ETA updated");
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to update ETA", { description: toError(error) });
    } finally {
      setSavingEtaSubmissionId(null);
    }
  };

  const saveDirectSubmissionReview = async (submissionId: number) => {
    const draft = directReviewDrafts[String(submissionId)];
    if (!draft) return;
    setSavingReviewSubmissionId(submissionId);
    try {
      await premiumApi.put(`/copy-submissions/${submissionId}/checked-copy`, {
        checked_copy_pdf_url: draft.checkedCopyUrl.trim() || undefined,
        total_marks: draft.totalMarks.trim() ? Number(draft.totalMarks) : undefined,
        provider_note: toNullableRichText(draft.providerNote) || undefined,
      });
      toast.success("Copy review saved");
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to save review", { description: toError(error) });
    } finally {
      setSavingReviewSubmissionId(null);
    }
  };

  const toggleOfferedSlot = (requestId: number, slotId: number) => {
    setSlotOfferDraftByRequestId((prev) => {
      const key = String(requestId);
      const current = prev[key] || [];
      const next = current.includes(slotId)
        ? current.filter((value) => value !== slotId)
        : [...current, slotId].sort((left, right) => left - right);
      return { ...prev, [key]: next };
    });
  };

  const offerSlots = async (requestId: number) => {
    const payload: MentorshipRequestOfferSlotsPayload = {
      slot_ids: slotOfferDraftByRequestId[String(requestId)] || [],
    };
    if (payload.slot_ids.length === 0) {
      toast.error("Select at least one mentor slot first");
      return;
    }

    setOfferingSlotsRequestId(requestId);
    try {
      await premiumApi.post(`/mentorship/requests/${requestId}/offer-slots`, payload);
      toast.success("Mentor slot options shared");
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to offer slots", { description: toError(error) });
    } finally {
      setOfferingSlotsRequestId(null);
    }
  };

  const acceptOfferedSlot = async (requestId: number, slotId: number) => {
    const requestSlotKey = `${requestId}:${slotId}`;
    setAcceptingSlotKey(requestSlotKey);
    try {
      await premiumApi.post(`/mentorship/requests/${requestId}/accept-slot`, { slot_id: slotId });
      toast.success("Mentor slot accepted");
      await loadAll({ silent: true });
    } catch (error: unknown) {
      toast.error("Failed to accept mentor slot", { description: toError(error) });
    } finally {
      setAcceptingSlotKey(null);
    }
  };

  const grantEntitlement = async () => {
    if (!canGrantEntitlements) {
      toast.error("Admin or moderator access is required to grant entitlements");
      return;
    }
    const targetUserId = grantUserId.trim();
    if (!targetUserId) {
      toast.error("Target user id is required");
      return;
    }
    const sessionsCount = Number(grantSessions);
    if (!Number.isFinite(sessionsCount) || sessionsCount <= 0) {
      toast.error("Sessions must be at least 1");
      return;
    }

    try {
      await premiumApi.post("/mentorship/entitlements/grant", {
        user_id: targetUserId,
        sessions: sessionsCount,
        source: "manual",
      });
      toast.success("Entitlement granted");
      setGrantUserId("");
      setGrantSessions("1");
    } catch (error: unknown) {
      toast.error("Failed to grant entitlement", { description: toError(error) });
    }
  };

  const mentorOwnedSlots = useMemo(
    () =>
      slots.filter(
        (slot) =>
          slot.provider_user_id === currentUserId &&
          Boolean(slot.is_active) &&
          new Date(slot.ends_at).getTime() >= Date.now(),
      ),
    [currentUserId, slots],
  );

  const upcomingSessions = useMemo(
    () =>
      [...filteredSessions]
        .filter((session) => {
          const endsAt = new Date(session.ends_at).getTime();
          return endsAt >= Date.now() && (session.status === "scheduled" || session.status === "live");
        })
        .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()),
    [filteredSessions],
  );

  const recordedSessions = useMemo(
    () =>
      [...filteredSessions]
        .filter((session) => {
          const endsAt = new Date(session.ends_at).getTime();
          return session.status === "completed" || session.status === "cancelled" || endsAt < Date.now();
        })
        .sort((left, right) => new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime()),
    [filteredSessions],
  );

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship management...</div>;
  }

  if (!isAuthenticated) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Sign in to manage mentorship.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <HistoryBackButton
            fallbackHref={backFallbackHref}
            label="Back"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            iconClassName="h-4 w-4"
          />
          <h1 className="text-2xl font-bold text-slate-900">
            {mode === "provider" && canScheduleMentorship ? "Admin Mentorship Oversight" : "Mains Mentorship Management"}
          </h1>
          <p className="text-sm text-slate-600">
            {mode === "provider" ? providerDescription : userDescription}
          </p>
          {seriesId ? (
            <p className="text-xs text-slate-500">
              Filtered for series #{seriesId}. Direct mentor-profile bookings are also shown here.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewHandlerPanel ? (
            <div className="inline-flex rounded border border-slate-300 p-0.5 text-xs">
              <button type="button" onClick={() => setMode("provider")} className={`rounded px-2 py-1 ${mode === "provider" ? "bg-slate-900 text-white" : "text-slate-600"}`}>{handlerTabLabel}</button>
              <button type="button" onClick={() => setMode("user")} className={`rounded px-2 py-1 ${mode === "user" ? "bg-slate-900 text-white" : "text-slate-600"}`}>User</button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void loadAll({ silent: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <section className={`grid gap-2 text-xs ${mode === "provider" ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-slate-500">{canScheduleMentorship && mode === "provider" ? "Pending workflows" : "Pending requests"}</p><p className="font-semibold text-slate-900">{pendingRequests}</p></div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-slate-500">Scheduled requests</p><p className="font-semibold text-slate-900">{scheduledRequests}</p></div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-slate-500">Completed requests</p><p className="font-semibold text-slate-900">{completedRequests}</p></div>
        {mode === "provider" ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-emerald-700">Learner bookings</p>
            <p className="font-semibold text-emerald-900">{recentLearnerBookingCount}</p>
          </div>
        ) : null}
      </section>

      {mode === "provider" && canManageMentorSlots ? (
        <section className="rounded-xl border border-slate-200 bg-white p-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
            <button
              type="button"
              onClick={() => setProviderAspect("availability")}
              className={`rounded px-3 py-1.5 font-semibold ${providerAspect === "availability" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Availability & Settings
            </button>
            <button
              type="button"
              onClick={() => setProviderAspect("calls")}
              className={`rounded px-3 py-1.5 font-semibold ${providerAspect === "calls" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Calls & Records{recentLearnerBookingCount > 0 ? ` (${recentLearnerBookingCount})` : ""}
            </button>
          </div>
        </section>
      ) : null}

      {mode === "provider" ? (
        <div className="space-y-6">
          {(!canManageMentorSlots || providerAspect === "availability") ? (
            canManageMentorSlots ? (
              <MentorshipAvailabilityManager slots={mentorOwnedSlots} onRefresh={() => loadAll({ silent: true })} />
            ) : (
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-semibold text-slate-900">Mentor Slot Reference</h2>
                <p className="text-xs text-slate-600">
                  Admin sees the same published mentor availability here. Manual assignment is kept only as a fallback for older non-copy workflows.
                </p>
                <div className="space-y-2">
                  {slots.map((slot) => (
                    <div key={slot.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                      <p className="font-semibold text-slate-800">{slot.title || `Slot #${slot.id}`}</p>
                      <p className="text-slate-600">{new Date(slot.starts_at).toLocaleString()} - {new Date(slot.ends_at).toLocaleString()}</p>
                      <p className="text-slate-500">Mentor: {slot.provider_user_id}</p>
                      <p className="text-slate-600">Bookings: {slot.booked_count}/{slot.max_bookings}</p>
                    </div>
                  ))}
                  {slots.length === 0 ? <p className="text-sm text-slate-500">No slots published yet.</p> : null}
                </div>
              </section>
            )
          ) : null}

          {(!canManageMentorSlots || providerAspect === "calls") ? (
            <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-semibold text-slate-900">{handlerPanelTitle}</h2>
                <p className="text-xs text-slate-600">{handlerPanelDescription}</p>
                {recentLearnerBookingCount > 0 ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <p className="font-semibold">New learner bookings are waiting for you.</p>
                    <p className="mt-1">
                      {recentLearnerBookingCount} booking{recentLearnerBookingCount === 1 ? "" : "s"} were made directly from your
                      public profile and are listed first below.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2">
                  {filteredRequests.map((request) => {
                    const requestSession = sessionByRequestId[String(request.id)] || null;
                    const mentorStatus = mentorStatusByProviderId[request.provider_user_id] || null;
                    const requestSeries = request.series_id ? seriesById[String(request.series_id)] || null : null;
                    const requestTest = request.test_collection_id ? testsById[String(request.test_collection_id)] || null : null;
                    const requestSubmission = request.submission_id ? submissionById[String(request.submission_id)] || null : null;
                    const scheduledSlot = slots.find((slot) => slot.id === request.scheduled_slot_id) || null;
                    const isCopyFlow = isCopyEvaluationFlow(request, requestSubmission);
                    const isDirectSubmission = Boolean(requestSubmission && (requestSubmission.test_collection_id || 0) <= 0);
                    const directReviewDraft =
                      requestSubmission && isDirectSubmission ? directReviewDrafts[String(requestSubmission.id)] || null : null;
                    const acceptedAt = requestMetaDate(request, "accepted_at");
                    const bookedByUserAt = requestMetaDate(request, "booked_by_user_at");
                    const scheduledFor = requestMetaDate(request, "scheduled_slot_starts_at");
                    const scheduledByAdminAt = requestMetaDate(request, "scheduled_by_admin_at");
                    const startNowBusy = Boolean(startNowBusyByRequestId[String(request.id)]);
                    const canOpenImmediateSession = canOperateMentorSessions && request.status === "scheduled";
                    const resolvedCallProvider =
                      requestSession?.call_provider ||
                      scheduledSlot?.call_provider ||
                      (String(request.meta?.call_provider || "").trim().toLowerCase() === "zoom" ? "zoom" : "custom");
                    const matchingSlots = slots.filter(
                      (slot) =>
                        slot.provider_user_id === request.provider_user_id &&
                        new Date(slot.ends_at).getTime() > Date.now(),
                    );
                    const offerableSlots = matchingSlots.filter(
                      (slot) => (slot.booked_count || 0) < (slot.max_bookings || 1) && Boolean(slot.is_active),
                    );
                    const offeredSlots = offeredSlotsForRequest(request, slots);
                    const selectedOfferedSlotIds = slotOfferDraftByRequestId[String(request.id)] || [];
                    const workflowSteps = buildMentorshipWorkflowSteps({
                      request,
                      session: requestSession,
                      submission: requestSubmission,
                      offeredSlotCount: offeredSlots.length,
                    });
                    const currentStatus = mentorshipCurrentStatusLabel(
                      request,
                      requestSession,
                      requestSubmission,
                      offeredSlots.length,
                    );
                    const nextAction = mentorshipNextActionLabel(
                      request,
                      requestSession,
                      requestSubmission,
                      offeredSlots.length,
                    );
                    const canAssignSlot =
                      canScheduleMentorship &&
                      !isCopyFlow &&
                      (request.status === "requested" || request.status === "scheduled");
                    const canRejectRequest = canScheduleMentorship && request.status === "requested";
                    const canOfferSlots =
                      canManageMentorSlots &&
                      request.status === "requested" &&
                      (!isCopyFlow || requestSubmission?.status === "checked");
                    const canMarkComplete =
                      (canOperateMentorSessions || canScheduleMentorship) &&
                      (request.status === "scheduled" || requestSession?.status === "live");
                    const providerNextAction =
                      request.status === "completed" || requestSession?.status === "completed"
                        ? "Workflow delivered successfully."
                        : requestSession?.status === "live"
                          ? "Keep the live session running or complete it once delivered."
                          : isCopyFlow && requestSubmission?.status !== "checked"
                            ? "Finish the copy evaluation before mentorship can move ahead."
                            : canOfferSlots && offeredSlots.length === 0
                              ? "Offer one or more mentor slots after review."
                              : request.status === "requested" && offeredSlots.length > 0
                                ? "Waiting for the learner to accept one of the shared slots."
                                : request.status === "scheduled"
                                  ? "Run the scheduled session and mark it complete after delivery."
                                  : canAssignSlot
                                    ? "Assign a published mentor slot to move this request forward."
                                    : nextAction;

                    return (
                      <div id={`request-${request.id}`} key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-lg font-semibold text-slate-900">Request #{request.id}</p>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
                                {isCopyFlow ? "Copy Evaluation + Mentorship" : "Direct Mentorship"}
                              </span>
                              {bookedByUserAt ? (
                                <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                                  New learner booking
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-sm text-slate-600">Learner: <span className="font-semibold text-slate-900">{request.user_id}</span></p>
                            <p className="text-sm text-slate-600">Mentor: <span className="font-semibold text-slate-900">{request.provider_user_id}</span></p>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 xl:max-w-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
                                {currentStatus}
                              </span>
                              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${mentorStatusBadgeClass(mentorStatus)}`}>
                                Mentor {mentorStatusLabel(mentorStatus)}
                              </span>
                            </div>
                            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Next action</p>
                            <p className="mt-1 font-semibold text-slate-900">{providerNextAction}</p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                            <p>Requested: <span className="font-semibold text-slate-900">{formatDateTime(request.requested_at)}</span></p>
                            <p>Call setup: <span className="font-semibold text-slate-900">{mentorshipCallLabel(request.preferred_mode, resolvedCallProvider)}</span></p>
                            {requestSeries ? <p>Series: <span className="font-semibold text-slate-900">{requestSeries.title}</span></p> : null}
                            {requestTest ? <p>Test: <span className="font-semibold text-slate-900">{requestTest.title}</span></p> : null}
                            {acceptedAt ? <p>Accepted: <span className="font-semibold text-slate-900">{formatDateTime(acceptedAt)}</span></p> : null}
                            {bookedByUserAt ? <p>Booked by learner: <span className="font-semibold text-slate-900">{formatDateTime(bookedByUserAt)}</span></p> : null}
                            {scheduledFor ? <p>Scheduled for: <span className="font-semibold text-slate-900">{formatDateTime(scheduledFor)}</span></p> : null}
                            {scheduledByAdminAt ? <p>Assigned by admin: <span className="font-semibold text-slate-900">{formatDateTime(scheduledByAdminAt)}</span></p> : null}
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                            {requestSession?.slot_id ? (
                              <p>Slot #{requestSession.slot_id}: <span className="font-semibold text-slate-900">{formatDateTime(requestSession.starts_at)} - {formatDateTime(requestSession.ends_at)}</span></p>
                            ) : (
                              <p>No mentorship slot assigned yet.</p>
                            )}
                            {requestSession ? (
                              <p className="mt-1">Platform: <span className="font-semibold text-slate-900">{mentorshipCallLabel(requestSession.mode, requestSession.call_provider)}</span></p>
                            ) : scheduledSlot ? (
                              <p className="mt-1">Platform: <span className="font-semibold text-slate-900">{mentorshipCallLabel(scheduledSlot.mode, scheduledSlot.call_provider)}</span></p>
                            ) : null}
                            {requestSession?.call_provider === "zoom_video_sdk" && requestSession.status !== "cancelled" ? (
                              <Link href={`/mentorship/session/${requestSession.id}`} className="mt-2 inline-flex text-sm font-semibold text-indigo-700 hover:underline">
                                Open in-app room
                              </Link>
                            ) : requestSession?.meeting_link && requestSession.status !== "cancelled" ? (
                              <a href={(canOperateMentorSessions || canScheduleMentorship) && requestSession.provider_host_url ? requestSession.provider_host_url : requestSession.meeting_link} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-indigo-700 hover:underline">
                                {requestSession.call_provider === "zoom" ? "Join Zoom" : "Open call link"}
                              </a>
                            ) : null}
                            {mentorStatus?.available_now && request.status === "requested" && !isCopyFlow ? (
                              <p className="mt-2 text-emerald-700">Mentor is available now, but the request still needs a clear slot assignment.</p>
                            ) : null}
                            {request.status === "requested" && matchingSlots.length === 0 && (canScheduleMentorship || canManageMentorSlots) ? (
                              <p className="mt-2 text-amber-700">No active future slot exists for this mentor yet. Publish availability before offering or assigning time.</p>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4">
                          <WorkflowProgressTrack steps={workflowSteps} />
                        </div>

                        {requestSubmission ? (
                          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                            <p className="font-semibold text-slate-900">Submission #{requestSubmission.id}</p>
                            <p className="mt-1">Learner: {requestSubmission.user_id}</p>
                            {requestSubmission.provider_eta_hours || requestSubmission.provider_eta_text ? (
                              <p className="mt-1">
                                ETA:
                                {requestSubmission.provider_eta_hours ? ` ${requestSubmission.provider_eta_hours} hour(s)` : ""}
                                {requestSubmission.provider_eta_text ? ` | ${requestSubmission.provider_eta_text}` : ""}
                              </p>
                            ) : null}
                            {requestSubmission.learner_note ? (
                              <div className="mt-2">
                                <p className="font-semibold text-slate-700">Learner note</p>
                                <RichTextContent value={requestSubmission.learner_note} className="text-[11px] text-slate-600 [&_p]:my-1" />
                              </div>
                            ) : null}
                            {requestSubmission.provider_note ? (
                              <div className="mt-2">
                                <p className="font-semibold text-slate-700">Mentor note</p>
                                <RichTextContent value={requestSubmission.provider_note} className="text-[11px] text-slate-600 [&_p]:my-1" />
                              </div>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {requestSubmission.answer_pdf_url ? (
                                <a href={requestSubmission.answer_pdf_url ?? undefined} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                                  Answer PDF
                                </a>
                              ) : null}
                              {requestSubmission.checked_copy_pdf_url ? (
                                <a href={requestSubmission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                                  Checked Copy
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {request.note ? (
                          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="font-semibold text-slate-700">Order note</p>
                            <RichTextContent value={request.note} className="mt-1 text-xs text-slate-600 [&_p]:my-1" />
                          </div>
                        ) : null}
                        {requestSubmission && requestSubmission.status !== "checked" && requestTest && canManageMentorSlots ? (
                          <div className="mt-2 rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                            <p>This submission still needs review before slots can be offered.</p>
                            <Link href={`/collections/${requestSubmission.test_collection_id}/mains-test`} className="mt-2 inline-flex rounded border border-emerald-300 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                              Open Writing Desk Review
                            </Link>
                          </div>
                        ) : null}
                        {requestSubmission && isDirectSubmission && directReviewDraft && canManageMentorSlots ? (
                          <div className="mt-2 rounded border border-slate-200 bg-white p-3 text-[11px] text-slate-700">
                            <p className="font-semibold text-slate-900">Direct Copy Review</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-[120px_1fr_auto]">
                              <input
                                type="number"
                                min={1}
                                value={directReviewDraft.etaHours}
                                onChange={(event) =>
                                  updateDirectReviewDraft(requestSubmission.id, (draft) => ({ ...draft, etaHours: event.target.value }))
                                }
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                placeholder="ETA hours"
                              />
                              <input
                                value={directReviewDraft.etaText}
                                onChange={(event) =>
                                  updateDirectReviewDraft(requestSubmission.id, (draft) => ({ ...draft, etaText: event.target.value }))
                                }
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                placeholder="ETA note"
                              />
                              <button
                                type="button"
                                disabled={savingEtaSubmissionId === requestSubmission.id}
                                onClick={() => void saveDirectSubmissionEta(requestSubmission.id)}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-60"
                              >
                                {savingEtaSubmissionId === requestSubmission.id ? "Saving..." : "Save ETA"}
                              </button>
                            </div>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <input
                                value={directReviewDraft.checkedCopyUrl}
                                onChange={(event) =>
                                  updateDirectReviewDraft(requestSubmission.id, (draft) => ({ ...draft, checkedCopyUrl: event.target.value }))
                                }
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                placeholder="Checked copy PDF URL"
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={directReviewDraft.totalMarks}
                                onChange={(event) =>
                                  updateDirectReviewDraft(requestSubmission.id, (draft) => ({ ...draft, totalMarks: event.target.value }))
                                }
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                placeholder="Total marks"
                              />
                            </div>
                            <RichTextField
                              label="Mentor feedback note"
                              value={directReviewDraft.providerNote}
                              onChange={(value) =>
                                updateDirectReviewDraft(requestSubmission.id, (draft) => ({ ...draft, providerNote: value }))
                              }
                              className="mt-2"
                              placeholder="Write the learner-facing review note, key findings, and mentorship direction."
                              helperText="Saved with the checked-copy review and shown back in the workflow."
                            />
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                disabled={savingReviewSubmissionId === requestSubmission.id}
                                onClick={() => void saveDirectSubmissionReview(requestSubmission.id)}
                                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                              >
                                {savingReviewSubmissionId === requestSubmission.id ? "Saving..." : "Save Review"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {offeredSlots.length > 0 ? (
                          <div className="mt-2 rounded border border-slate-200 bg-white p-3 text-[11px] text-slate-700">
                            <p className="font-semibold text-slate-900">
                              {request.status === "scheduled" ? "Accepted Mentor Slot" : "Offered Mentor Slots"}
                            </p>
                            <div className="mt-2">
                              <MentorshipSlotOfferList slots={offeredSlots} />
                            </div>
                          </div>
                        ) : null}
                        {canOfferSlots ? (
                          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50/60 p-3 text-[11px] text-slate-700">
                            <p className="font-semibold text-slate-900">Offer Multiple Mentor Slots</p>
                            <p className="mt-1 text-slate-600">
                              Pick one or more future slots. The learner can accept only one of the offered options.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {offerableSlots.map((slot) => {
                                const selected = selectedOfferedSlotIds.includes(slot.id);
                                return (
                                  <button
                                    key={`offer-slot-${request.id}-${slot.id}`}
                                    type="button"
                                    onClick={() => toggleOfferedSlot(request.id, slot.id)}
                                    className={`rounded border px-2 py-1 ${selected
                                        ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                        : "border-slate-300 bg-white text-slate-700"
                                      }`}
                                  >
                                    #{slot.id} {formatDateTime(slot.starts_at)}
                                  </button>
                                );
                              })}
                            </div>
                            {offerableSlots.length === 0 ? (
                              <p className="mt-2 text-amber-700">Publish future availability first. Only open future slots can be offered.</p>
                            ) : null}
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                disabled={selectedOfferedSlotIds.length === 0 || offeringSlotsRequestId === request.id}
                                onClick={() => void offerSlots(request.id)}
                                className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                              >
                                {offeringSlotsRequestId === request.id ? "Offering..." : "Offer Selected Slots"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {canScheduleMentorship && !isCopyFlow ? (
                            <>
                              <select value={slotByRequestId[String(request.id)] || ""} onChange={(event) => setSlotByRequestId((prev) => ({ ...prev, [String(request.id)]: event.target.value }))} className="rounded border border-slate-300 px-2 py-1 text-xs">
                                <option value="">Select mentor slot</option>
                                {matchingSlots.map((slot) => <option key={slot.id} value={String(slot.id)}>#{slot.id} {new Date(slot.starts_at).toLocaleString()}</option>)}
                              </select>
                              <button type="button" disabled={!canAssignSlot} onClick={() => void scheduleRequest(request.id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-60">Assign Time</button>
                            </>
                          ) : null}
                          {canOperateMentorSessions ? (
                            <input
                              value={startNowMeetingLinkByRequestId[String(request.id)] || ""}
                              onChange={(event) => setStartNowMeetingLinkByRequestId((prev) => ({ ...prev, [String(request.id)]: event.target.value }))}
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                              placeholder={resolvedCallProvider === "zoom" ? "Zoom link override (optional)" : "Meeting link override (optional)"}
                            />
                          ) : null}
                          {canOperateMentorSessions ? (
                            <button
                              type="button"
                              disabled={!canOpenImmediateSession || startNowBusy}
                              onClick={() => void startRequestNow(request.id)}
                              className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-700 disabled:opacity-60"
                            >
                              {startNowBusy ? "Starting..." : "Start Scheduled Session"}
                            </button>
                          ) : null}
                          {canRejectRequest ? (
                            <button type="button" onClick={() => void updateRequestStatus(request.id, "rejected")} className="rounded border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700">Reject</button>
                          ) : null}
                          {canMarkComplete ? (
                            <button type="button" onClick={() => void updateRequestStatus(request.id, "completed")} className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-700">Complete</button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {filteredRequests.length === 0 ? <p className="text-sm text-slate-500">No mentorship requests.</p> : null}
                </div>

                {canGrantEntitlements ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <h3 className="font-semibold text-slate-800">Grant Entitlement</h3>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_120px_auto]">
                      <input value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)} className="rounded border border-slate-300 px-2 py-1" placeholder="User ID" />
                      <input type="number" min={1} value={grantSessions} onChange={(event) => setGrantSessions(event.target.value)} className="rounded border border-slate-300 px-2 py-1" placeholder="Sessions" />
                      <button type="button" disabled={!canGrantEntitlements} onClick={() => void grantEntitlement()} className="rounded bg-indigo-700 px-3 py-1 text-white disabled:opacity-60">Grant</button>
                    </div>
                  </div>
                ) : null}
              </section>

              <div className="space-y-6">
                {recentLearnerBookingCount > 0 ? (
                  <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold text-emerald-900">New Learner Bookings</h2>
                      <span className="rounded-full border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        {recentLearnerBookingCount}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {recentLearnerBookings.slice(0, 8).map((request) => {
                        const requestSession = sessionByRequestId[String(request.id)] || null;
                        const bookedByUserAt = requestMetaDate(request, "booked_by_user_at");
                        const scheduledFor = requestMetaDate(request, "scheduled_slot_starts_at");
                        return (
                          <a
                            key={`booking-alert-${request.id}`}
                            href={`#request-${request.id}`}
                            className="block rounded border border-emerald-200 bg-white p-3 text-xs transition-colors hover:bg-emerald-50/70"
                          >
                            <p className="font-semibold text-slate-900">Request #{request.id}</p>
                            <p className="mt-1 text-slate-600">Learner {request.user_id}</p>
                            {bookedByUserAt ? <p className="mt-1 text-emerald-700">Booked at: {formatDateTime(bookedByUserAt)}</p> : null}
                            {scheduledFor ? <p className="text-slate-600">Scheduled for: {formatDateTime(scheduledFor)}</p> : null}
                            {requestSession?.slot_id ? <p className="text-slate-500">Slot #{requestSession.slot_id}</p> : null}
                            <p className="mt-2 font-semibold text-emerald-800">Open main queue card</p>
                          </a>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">Upcoming Calls</h2>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      {upcomingSessions.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {upcomingSessions.map((session) => (
                      <div key={session.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                        <p className="font-semibold text-slate-800">Call #{session.id} | {session.status}</p>
                        <p className="text-slate-600">{new Date(session.starts_at).toLocaleString()} - {new Date(session.ends_at).toLocaleString()}</p>
                        <p className="text-slate-600">Learner: {session.user_id}</p>
                        <p className="text-slate-600">Platform: {mentorshipCallLabel(session.mode, session.call_provider)}</p>
                        {session.call_provider === "zoom_video_sdk" ? (
                          <Link href={`/mentorship/session/${session.id}`} className="text-emerald-700 hover:underline">
                            Open in-app room
                          </Link>
                        ) : session.meeting_link ? (
                          <a href={((canOperateMentorSessions || canScheduleMentorship) && session.provider_host_url) ? session.provider_host_url : session.meeting_link} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                            {session.call_provider === "zoom" ? "Join Zoom" : "Join meeting"}
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {upcomingSessions.length === 0 ? <p className="text-sm text-slate-500">No upcoming calls yet.</p> : null}
                  </div>
                </section>

                <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">Call Records</h2>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      {recordedSessions.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {recordedSessions.map((session) => (
                      <div key={session.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                        <p className="font-semibold text-slate-800">Call #{session.id} | {session.status}</p>
                        <p className="text-slate-600">{new Date(session.starts_at).toLocaleString()}</p>
                        <p className="text-slate-600">Learner: {session.user_id}</p>
                        <p className="text-slate-600">Platform: {mentorshipCallLabel(session.mode, session.call_provider)}</p>
                        {session.summary ? <p className="text-slate-600">Summary: {session.summary}</p> : null}
                        {session.call_provider === "zoom_video_sdk" ? (
                          <Link href={`/mentorship/session/${session.id}`} className="text-indigo-700 hover:underline">
                            Review in-app room
                          </Link>
                        ) : session.meeting_link ? (
                          <a href={session.meeting_link} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                            {session.call_provider === "zoom" ? "Open Zoom link" : "Open link"}
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {recordedSessions.length === 0 ? <p className="text-sm text-slate-500">No completed or past call records yet.</p> : null}
                  </div>
                </section>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            {normalizedPrefillMentorUserId ? (
              <>
                <h2 className="text-lg font-semibold text-slate-900">Book Mentorship Slot</h2>
                <p className="text-xs text-slate-600">
                  Choose a day, inspect that mentor&apos;s 20-minute slots, and book one directly. The booked slot is then visible
                  to both learner and mentor.
                </p>
                <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                  Mains Mentor was preselected from the mentors directory. You can still change the mentor before booking.
                </p>
                <input value={standaloneProviderId} onChange={(event) => setStandaloneProviderId(event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Mains Mentor user id" />
                {standaloneProviderId.trim() ? (
                  <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                    <span className={`rounded border px-2 py-0.5 font-semibold ${mentorStatusBadgeClass(selectedStandaloneMentorStatus)}`}>
                      Mains Mentor {mentorStatusLabel(selectedStandaloneMentorStatus)}
                    </span>
                    {selectedStandaloneMentorStatus?.next_available_at ? (
                      <p className="mt-1 text-slate-600">Next available: {formatDateTime(selectedStandaloneMentorStatus.next_available_at)}</p>
                    ) : null}
                  </div>
                ) : null}
                {standaloneProviderId.trim() ? (
                  <MentorAvailabilityCalendar
                    slots={selectedMentorSlots}
                    days={14}
                    title="Mentor Availability Before Booking"
                    description="Click a day to focus it, then select any open slot to book."
                    emptyLabel="This mentor has not published any future slots yet."
                    selectedDateKey={selectedMentorDateKey}
                    selectedSlotId={selectedMentorSlotId}
                    bookingSlotId={bookingSlotId}
                    onSelectDate={(dateKey) => setSelectedMentorDateKey(dateKey)}
                    onSelectSlot={(slot, dateKey) => {
                      setSelectedMentorDateKey(dateKey);
                      setSelectedMentorSlotId(slot.id);
                    }}
                    slotActionLabel="Book This Slot"
                  />
                ) : null}
                {selectedMentorDateKey ? (
                  <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      Selected day:{" "}
                      {selectedMentorDay
                        ? selectedMentorDay.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short", year: "numeric" })
                        : selectedMentorDateKey}
                    </p>
                    <p className="mt-1 text-slate-600">
                      {selectedMentorDay?.availableSlots || 0} open slot{selectedMentorDay?.availableSlots === 1 ? "" : "s"} on
                      this day.
                    </p>
                    {!selectedMentorDay || selectedMentorDay.slots.length === 0 ? (
                      <p className="mt-1 text-slate-500">No slots are available on this day. Pick another date from the calendar.</p>
                    ) : null}
                  </div>
                ) : null}
                {selectedMentorSlot ? (
                  <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <p className="font-semibold">Selected slot: {formatSlotTimeRange(selectedMentorSlot)}</p>
                    <p className="mt-1">
                      Mode: {selectedMentorSlot.mode} | Capacity {selectedMentorSlot.booked_count}/{selectedMentorSlot.max_bookings}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No slot selected yet. Pick any open slot from the calendar.</p>
                )}
                <RichTextField
                  label="Topic / context"
                  value={standaloneNote}
                  onChange={setStandaloneNote}
                  placeholder="Describe the issue, subject, or current problem before you book the slot."
                  helperText="This note is attached to the mentorship request."
                />
                <button
                  type="button"
                  disabled={!selectedMentorSlot || bookingSlotId !== null}
                  onClick={() => void bookStandaloneSlot()}
                  className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {bookingSlotId !== null ? "Booking..." : "Book Selected Slot"}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-900">Book New Mentorship</h2>
                <p className="text-sm text-slate-600">
                  New mentor bookings are now handled from each mentor&apos;s profile page so availability and booking stay on one
                  screen.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/mentors" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                    Open Mentors Directory
                  </Link>
                  <Link href="/mentorship/manage" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                    Refresh My Bookings
                  </Link>
                </div>
              </>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <h3 className="font-semibold text-slate-800">My entitlements</h3>
              <div className="mt-2 space-y-1">
                {entitlements.map((entry) => <div key={entry.id} className="rounded border border-slate-200 bg-white px-2 py-1">{entry.source} | Remaining: {entry.sessions_remaining}</div>)}
                {entitlements.length === 0 ? <p className="text-slate-500">No active entitlements.</p> : null}
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-900">My Mentorship Workflows</h2>
            <div className="space-y-2">
              {filteredRequests.map((request) => {
                const mentorStatus = mentorStatusByProviderId[request.provider_user_id] || null;
                const requestSession = sessionByRequestId[String(request.id)] || null;
                const requestSeries = request.series_id ? seriesById[String(request.series_id)] || null : null;
                const requestTest = request.test_collection_id ? testsById[String(request.test_collection_id)] || null : null;
                const requestSubmission = request.submission_id ? submissionById[String(request.submission_id)] || null : null;
                const isCopyFlow = isCopyEvaluationFlow(request, requestSubmission);
                const offeredSlots = offeredSlotsForRequest(request, slots);
                const requestAcceptingSlotId = acceptingSlotKey?.startsWith(`${request.id}:`)
                  ? Number(acceptingSlotKey.split(":")[1] || 0) || null
                  : null;
                const acceptedAt = requestMetaDate(request, "accepted_at");
                const bookedByUserAt = requestMetaDate(request, "booked_by_user_at");
                const mentorNotifiedAt = requestMetaDate(request, "mentor_notified_at");
                const scheduledFor = requestMetaDate(request, "scheduled_slot_starts_at");
                const scheduledByAdminAt = requestMetaDate(request, "scheduled_by_admin_at");

                return (
                  <div key={request.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-800">Request #{request.id}</p>
                        <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {isCopyFlow ? "Copy Evaluation + Mentorship" : "Direct Mentorship"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          {mentorshipStatusLabel(request.status)}
                        </span>
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${mentorStatusBadgeClass(mentorStatus)}`}>
                          Mains Mentor {mentorStatusLabel(mentorStatus)}
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-600">Mains Mentor: {request.provider_user_id}</p>
                    <p className="text-slate-600">Requested: {formatDateTime(request.requested_at)}</p>
                    <p className="text-slate-600">Preferred mode: {request.preferred_mode}</p>
                    {requestSeries ? <p className="text-slate-600">Series: {requestSeries.title}</p> : null}
                    {requestTest ? <p className="text-slate-600">Test: {requestTest.title}</p> : null}
                    {requestSubmission ? (
                      <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                        <p className="font-semibold text-slate-800">Submission #{requestSubmission.id}</p>
                        {requestSubmission.learner_note ? (
                          <div className="mt-1">
                            <p className="font-semibold text-slate-700">Learner note</p>
                            <RichTextContent value={requestSubmission.learner_note} className="text-[11px] text-slate-600 [&_p]:my-1" />
                          </div>
                        ) : null}
                        {requestSubmission.provider_note ? (
                          <div className="mt-1">
                            <p className="font-semibold text-slate-700">Mentor note</p>
                            <RichTextContent value={requestSubmission.provider_note} className="text-[11px] text-slate-600 [&_p]:my-1" />
                          </div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap gap-2">
                          {requestSubmission.answer_pdf_url ? (
                            <a href={requestSubmission.answer_pdf_url ?? undefined} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                              Answer PDF
                            </a>
                          ) : null}
                          {requestSubmission.checked_copy_pdf_url ? (
                            <a href={requestSubmission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                              Checked Copy
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {isCopyFlow ? (
                      <div className="mt-2">
                        <CopyEvaluationFlowStatus
                          steps={buildCopyEvaluationFlowSteps(requestSubmission, request, requestSession)}
                        />
                      </div>
                    ) : null}
                    {requestSubmission?.provider_eta_hours || requestSubmission?.provider_eta_text ? (
                      <p className="text-slate-600">
                        Checking ETA:
                        {requestSubmission.provider_eta_hours ? ` ${requestSubmission.provider_eta_hours} hour(s)` : ""}
                        {requestSubmission.provider_eta_text ? ` | ${requestSubmission.provider_eta_text}` : ""}
                      </p>
                    ) : null}
                    {acceptedAt ? <p className="text-emerald-700">Approved at: {formatDateTime(acceptedAt)}</p> : null}
                    {bookedByUserAt ? <p className="text-emerald-700">Booked by you at: {formatDateTime(bookedByUserAt)}</p> : null}
                    {scheduledFor ? <p className="text-emerald-700">Scheduled for: {formatDateTime(scheduledFor)}</p> : null}
                    {requestSession?.slot_id ? (
                      <p className="text-emerald-700">
                        Slot #{requestSession.slot_id}: {formatDateTime(requestSession.starts_at)} - {formatDateTime(requestSession.ends_at)}
                      </p>
                    ) : null}
                    {scheduledByAdminAt ? <p className="text-emerald-700">Assigned by admin: {formatDateTime(scheduledByAdminAt)}</p> : null}
                    {mentorNotifiedAt ? <p className="text-emerald-700">Mentor notified in dashboard: {formatDateTime(mentorNotifiedAt)}</p> : null}
                    {requestSession?.status === "live" ? (
                      <p className="text-emerald-700">
                        Mains Mentor is live now
                        {requestSession.call_provider === "zoom_video_sdk" ? (
                          <>
                            {" | "}
                            <Link href={`/mentorship/session/${requestSession.id}`} className="underline">
                              Open in-app room
                            </Link>
                          </>
                        ) : requestSession.meeting_link ? (
                          <>
                            {" | "}
                            <a href={(canOperateMentorSessions || canScheduleMentorship) && requestSession.provider_host_url ? requestSession.provider_host_url : requestSession.meeting_link} target="_blank" rel="noreferrer" className="underline">
                              {requestSession.call_provider === "zoom" ? "Join Zoom" : "Join meeting"}
                            </a>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {requestSession?.status === "completed" && requestSession.summary ? (
                      <p className="text-slate-600">Call summary: {requestSession.summary}</p>
                    ) : null}
                    {isCopyFlow && request.status === "requested" && requestSubmission?.status !== "checked" ? (
                      <p className="text-amber-700">
                        Waiting for the mentor to finish copy review before mentorship slots can be shared.
                      </p>
                    ) : null}
                    {isCopyFlow && request.status === "requested" && requestSubmission?.status === "checked" && offeredSlots.length === 0 ? (
                      <p className="text-amber-700">Copy review is complete. Waiting for the mentor to share mentorship slots.</p>
                    ) : null}
                    {offeredSlots.length > 0 ? (
                      <div className="mt-2 rounded border border-emerald-200 bg-emerald-50/60 p-3 text-[11px] text-slate-700">
                        <p className="font-semibold text-slate-900">Mentor Slot Options</p>
                        <p className="mt-1 text-slate-600">
                          {request.status === "requested"
                            ? "Accept one slot only. Once accepted, the workflow moves directly to the scheduled call stage."
                            : "Shared slot options remain visible here for reference."}
                        </p>
                        <div className="mt-2">
                          <MentorshipSlotOfferList
                            slots={offeredSlots}
                            acceptingSlotId={request.status === "requested" ? requestAcceptingSlotId : null}
                            onAccept={
                              request.status === "requested"
                                ? (slotId) => {
                                  void acceptOfferedSlot(request.id, slotId);
                                }
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                    {request.note ? (
                      <div className="mt-1">
                        <p className="font-semibold text-slate-700">Note</p>
                        <RichTextContent value={request.note} className="text-xs text-slate-600 [&_p]:my-1" />
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Link href={`/my-purchases/mentorship/${request.id}`} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                        Open receipt
                      </Link>
                      {request.status === "requested" || request.status === "scheduled" ? (
                        <button type="button" onClick={() => void updateRequestStatus(request.id, "cancelled")} className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] text-rose-700">Cancel</button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {filteredRequests.length === 0 ? <p className="text-sm text-slate-500">No requests yet.</p> : null}
            </div>

            <h2 className="pt-2 text-lg font-semibold text-slate-900">My Sessions</h2>
            <div className="space-y-2">
              {filteredSessions.map((session) => (
                <div key={session.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  <p className="font-semibold text-slate-800">Session #{session.id} | {session.status}</p>
                  <p className="text-slate-600">{new Date(session.starts_at).toLocaleString()} - {new Date(session.ends_at).toLocaleString()}</p>
                  <p className="text-slate-600">Mode: {session.mode}</p>
                  {session.call_provider === "zoom_video_sdk" ? (
                    <Link href={`/mentorship/session/${session.id}`} className="text-indigo-700 hover:underline">Open in-app room</Link>
                  ) : session.meeting_link ? (
                    <a href={(canOperateMentorSessions || canScheduleMentorship) && session.provider_host_url ? session.provider_host_url : session.meeting_link} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                      {session.call_provider === "zoom" ? "Join Zoom" : "Join meeting"}
                    </a>
                  ) : null}
                </div>
              ))}
              {filteredSessions.length === 0 ? <p className="text-sm text-slate-500">No sessions yet.</p> : null}
            </div>
          </section>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <h3 className="mb-1 inline-flex items-center gap-1 text-base font-semibold text-slate-900"><CalendarDays className="h-4 w-4" /> Recommended no-confusion flow</h3>
        <p>Pure mentorship stays direct: learner books a published slot from the mentor profile and the call is scheduled immediately.</p>
        <p className="mt-1">Copy evaluation + mentorship stays shared everywhere: copy submission -&gt; mentor ETA -&gt; checked copy -&gt; mentor offers slots -&gt; learner accepts one -&gt; audio/video call -&gt; completion.</p>
      </section>
    </div>
  );
}
