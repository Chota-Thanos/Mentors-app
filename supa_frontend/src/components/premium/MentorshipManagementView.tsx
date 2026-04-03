"use client";

import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, CreditCard, FileText, Mail, MessageSquareText, MessagesSquare, UserRound } from "lucide-react";
import { toast } from "sonner";

import WorkflowProgressTrack from "@/components/premium/WorkflowProgressTrack";
import MentorshipChatView from "@/components/premium/MentorshipChatView";
import RichTextContent from "@/components/ui/RichTextContent";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isMentorLike, isModeratorLike } from "@/lib/accessControl";
import { requestOfferedSlotIds } from "@/lib/copyEvaluationFlow";
import { buildMentorshipWorkflowSteps, mentorshipCurrentStatusLabel, mentorshipKindLabel, mentorshipNextActionLabel, resolveMentorshipWorkflowStage } from "@/lib/mentorshipOrderFlow";
import { premiumApi } from "@/lib/premiumApi";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import type { MainsCopySubmission, MentorshipMessage, MentorshipRequest, MentorshipSession, MentorshipSlot } from "@/types/premium";

interface MentorshipManagementViewProps {
  seriesId?: number | null;
  prefillMentorUserId?: string | null;
}

type Mode = "user" | "provider";
type QueueTab = "new_requests" | "active_conversations" | "upcoming_calls" | "completed";

interface DerivedRequestRow {
  request: MentorshipRequest;
  submission: MainsCopySubmission | null;
  session: MentorshipSession | null;
  offeredSlotCount: number;
  stage: string;
}

function requestUnreadCount(request: MentorshipRequest): number {
  const raw = Number(request.meta?.viewer_unread_message_count || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function buildRealtimeRequestFilter(requestIds: number[]): string | null {
  const ids = Array.from(new Set(requestIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (!ids.length) return null;
  if (ids.length === 1) return `request_id=eq.${ids[0]}`;
  return `request_id=in.(${ids.join(",")})`;
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function emailHandleToLabel(email?: string | null): string {
  const handle = String(email || "").split("@")[0]?.trim();
  if (!handle) return "";
  return handle
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function requestLabel(request: MentorshipRequest): string {
  const learnerName = typeof request.meta?.learner_name === "string" ? request.meta.learner_name.trim() : "";
  if (learnerName) return learnerName;
  const learnerEmail = typeof request.meta?.learner_email === "string" ? request.meta.learner_email.trim() : "";
  return emailHandleToLabel(learnerEmail) || "Learner";
}

function requestEmail(request: MentorshipRequest): string {
  return typeof request.meta?.learner_email === "string" ? request.meta.learner_email.trim() : "";
}

function titleCaseLabel(value?: string | null, fallback = "n/a"): string {
  const normalized = String(value || "")
    .trim()
    .replaceAll("_", " ");
  if (!normalized) return fallback;
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function initialsFromLabel(label?: string | null): string {
  const parts = String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "LR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function requestStatusBadgeClass(status?: string | null): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "requested") return "border-amber-300 bg-amber-50 text-amber-800";
  if (normalized === "accepted" || normalized === "scheduled" || normalized === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "rejected" || normalized === "cancelled" || normalized === "expired") {
    return "border-rose-300 bg-rose-50 text-rose-800";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function paymentStatusBadgeClass(status?: string | null): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "paid") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (normalized === "pending") return "border-amber-300 bg-amber-50 text-amber-800";
  if (normalized === "failed" || normalized === "refunded") return "border-rose-300 bg-rose-50 text-rose-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function sessionDurationMinutes(session: MentorshipSession): number | null {
  const start = new Date(session.starts_at).getTime();
  const end = new Date(session.ends_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

function plainTextExcerpt(value?: string | null, fallback = "No problem statement attached."): string {
  const normalized = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function canStartSessionImmediately(row: DerivedRequestRow): boolean {
  if (row.session) return false;
  if (row.request.status !== "accepted") return false;
  if (row.request.payment_amount > 0 && row.request.payment_status !== "paid") return false;
  return true;
}

function mergeMentorshipMessages(current: MentorshipMessage[], incoming: MentorshipMessage): MentorshipMessage[] {
  const next = [...current];
  const index = next.findIndex((message) => message.id === incoming.id);
  if (index >= 0) {
    next[index] = incoming;
  } else {
    next.push(incoming);
  }
  next.sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  return next;
}

export default function MentorshipManagementView({ seriesId }: MentorshipManagementViewProps) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const providerCapable = useMemo(() => isAdminLike(user) || isModeratorLike(user) || isMentorLike(user), [user]);
  const adminLike = useMemo(() => isAdminLike(user) || isModeratorLike(user), [user]);

  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const [tab, setTab] = useState<QueueTab>("new_requests");
  const [busy, setBusy] = useState(true);
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [sessions, setSessions] = useState<MentorshipSession[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, MainsCopySubmission>>({});
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MentorshipMessage[]>([]);
  const [slots, setSlots] = useState<MentorshipSlot[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [offerSlotIds, setOfferSlotIds] = useState<number[]>([]);
  const [etaText, setEtaText] = useState("");
  const [checkedCopyUrl, setCheckedCopyUrl] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [providerNote, setProviderNote] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!providerCapable) setModeOverride(null);
  }, [providerCapable]);

  const mode: Mode = providerCapable ? modeOverride ?? "provider" : "user";

  const load = async () => {
    if (!isAuthenticated) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const scope = mode === "provider" ? (adminLike ? "all" : "provider") : "me";
      const [requestRes, sessionRes] = await Promise.all([
        premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope } }),
        premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope } }),
      ]);
      let nextRequests = Array.isArray(requestRes.data) ? requestRes.data : [];
      if (seriesId) nextRequests = nextRequests.filter((row) => row.series_id === seriesId);
      const nextSessions = Array.isArray(sessionRes.data) ? sessionRes.data : [];
      const submissionIds = Array.from(new Set(nextRequests.map((row) => row.submission_id).filter(Boolean))) as number[];
      const fetched = await Promise.all(
        submissionIds.map(async (id) => {
          try {
            return [String(id), (await premiumApi.get<MainsCopySubmission>(`/copy-submissions/${id}`)).data] as const;
          } catch {
            return null;
          }
        }),
      );
      const nextSubmissions: Record<string, MainsCopySubmission> = {};
      for (const item of fetched) {
        if (!item) continue;
        nextSubmissions[item[0]] = item[1];
      }
      setRequests(nextRequests);
      setSessions(nextSessions);
      setSubmissions(nextSubmissions);
      setSelectedRequestId((current) => current && nextRequests.some((row) => row.id === current) ? current : nextRequests[0]?.id || null);
    } catch (error: unknown) {
      toast.error("Failed to load mentorship workspace", { description: toError(error) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, seriesId, isAuthenticated]);

  useEffect(() => {
    const requestIds = requests.map((request) => request.id);
    const filter = buildRealtimeRequestFilter(requestIds);
    if (!filter || !user?.id) return;
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`mentorship-queue-${mode}-${requestIds.join("-")}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mentorship_messages", filter },
        (payload) => {
          const row = payload.new as { request_id?: number; sender_user_id?: string } | undefined;
          const requestId = Number(row?.request_id || 0);
          if (requestId <= 0 || row?.sender_user_id === user.id || row?.sender_user_id === "system") return;
          setRequests((current) =>
            current.map((request) => {
              if (request.id !== requestId || request.id === selectedRequestId) return request;
              const nextUnread = requestUnreadCount(request) + 1;
              return {
                ...request,
                meta: { ...(request.meta || {}), viewer_unread_message_count: nextUnread, viewer_has_unread_messages: true },
              };
            }),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [mode, requests, selectedRequestId, user?.id]);

  const sessionByRequestId = useMemo(() => {
    const output: Record<string, MentorshipSession> = {};
    for (const row of sessions) output[String(row.request_id)] = row;
    return output;
  }, [sessions]);

  const derived = useMemo<DerivedRequestRow[]>(
    () =>
      requests.map((request) => {
        const submission = request.submission_id ? submissions[String(request.submission_id)] || null : null;
        const session = sessionByRequestId[String(request.id)] || null;
        const offeredSlotCount = Math.max(requestOfferedSlotIds(request).length, request.booking_open ? 1 : 0);
        const stage = resolveMentorshipWorkflowStage(request, session, submission, offeredSlotCount);
        return { request, submission, session, offeredSlotCount, stage };
      }),
    [requests, sessionByRequestId, submissions],
  );

  const queue = useMemo(() => {
    if (mode !== "provider") return derived;
    return derived.filter(({ request, stage }) => {
      if (tab === "new_requests") return request.status === "requested";
      if (tab === "active_conversations") return request.status === "accepted" || ["paid", "evaluating", "feedback_ready", "booking_open"].includes(stage);
      if (tab === "upcoming_calls") return ["scheduled", "live"].includes(stage);
      return ["completed", "cancelled", "expired"].includes(stage) || ["completed", "cancelled", "rejected", "expired"].includes(request.status);
    });
  }, [derived, mode, tab]);

  const queueCounts = useMemo(() => {
    const learnerCount = (rows: DerivedRequestRow[]) => new Set(rows.map((row) => row.request.user_id)).size;
    return {
      new_requests: learnerCount(derived.filter(({ request }) => request.status === "requested")),
      active_conversations: learnerCount(derived.filter(({ stage, request }) => request.status === "accepted" || ["paid", "evaluating", "feedback_ready", "booking_open"].includes(stage))),
      upcoming_calls: learnerCount(derived.filter(({ stage }) => ["scheduled", "live"].includes(stage))),
      completed: learnerCount(
        derived.filter(
          ({ request, stage }) =>
            ["completed", "cancelled", "expired"].includes(stage) ||
            ["completed", "cancelled", "rejected", "expired"].includes(request.status),
        ),
      ),
    };
  }, [derived]);

  const groupedQueue = useMemo(() => {
    const grouped = new Map<string, { latest: DerivedRequestRow; rows: DerivedRequestRow[] }>();
    for (const row of queue) {
      const existing = grouped.get(row.request.user_id);
      if (!existing) {
        grouped.set(row.request.user_id, { latest: row, rows: [row] });
        continue;
      }
      existing.rows.push(row);
      const currentLatestTime = new Date(existing.latest.request.requested_at).getTime();
      const nextTime = new Date(row.request.requested_at).getTime();
      if (nextTime >= currentLatestTime) existing.latest = row;
    }
    return Array.from(grouped.entries())
      .map(([userId, value]) => ({
        userId,
        ...value,
      }))
      .sort(
        (left, right) =>
          new Date(right.latest.request.requested_at).getTime() - new Date(left.latest.request.requested_at).getTime(),
      );
  }, [queue]);

  const selected = useMemo(() => {
    const source = mode === "provider" ? groupedQueue.map((entry) => entry.latest) : derived;
    return source.find((item) => item.request.id === selectedRequestId) || source[0] || null;
  }, [derived, mode, groupedQueue, selectedRequestId]);

  const selectedLearnerHistory = useMemo(
    () =>
      selected
        ? derived
          .filter((item) => item.request.user_id === selected.request.user_id)
          .sort((left, right) => new Date(right.request.requested_at).getTime() - new Date(left.request.requested_at).getTime())
          .slice(0, 5)
        : [],
    [derived, selected],
  );

  const selectedRequestIdValue = selected?.request.id || null;
  const selectedProviderUserId = selected?.request.provider_user_id || null;
  const selectedUnreadCount = selected ? requestUnreadCount(selected.request) : 0;

  useEffect(() => {
    if (!selectedRequestIdValue || !selectedProviderUserId) {
      setMessages([]);
      setSlots([]);
      return;
    }
    let active = true;
    Promise.all([
      premiumApi.get<MentorshipMessage[]>(`/mentorship/requests/${selectedRequestIdValue}/messages`),
      premiumApi.get<MentorshipSlot[]>("/mentorship/slots", { params: { provider_user_id: selectedProviderUserId, only_available: false } }),
    ]).then(([messageRes, slotRes]) => {
      if (!active) return;
      setMessages(Array.isArray(messageRes.data) ? messageRes.data : []);
      setSlots(Array.isArray(slotRes.data) ? slotRes.data : []);
      if (selected && requestUnreadCount(selected.request) > 0) {
        void premiumApi.post(`/mentorship/requests/${selectedRequestIdValue}/messages/read`).then(() => {
          if (!active) return;
          setRequests((current) =>
            current.map((row) =>
              row.id === selectedRequestIdValue
                ? {
                    ...row,
                    meta: { ...(row.meta || {}), viewer_unread_message_count: 0, viewer_has_unread_messages: false },
                  }
                : row,
            ),
          );
        }).catch(() => undefined);
      }
    }).catch(() => {
      if (!active) return;
      setMessages([]);
      setSlots([]);
    });
    return () => {
      active = false;
    };
  }, [selected, selectedProviderUserId, selectedRequestIdValue]);

  useEffect(() => {
    const submission = selected?.submission;
    setEtaText(submission?.provider_eta_text || "");
    setCheckedCopyUrl(submission?.checked_copy_pdf_url || "");
    setProviderNote(submission?.provider_note || "");
    setTotalMarks(submission?.total_marks !== null && submission?.total_marks !== undefined ? String(submission.total_marks) : "");
    setOfferSlotIds([]);
  }, [selected?.request.id, selected?.submission]);

  useEffect(() => {
    if (!selectedRequestIdValue) return;
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`mentor-request-${selectedRequestIdValue}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mentorship_messages",
          filter: `request_id=eq.${selectedRequestIdValue}`,
        },
        (payload) => {
          const row = payload.new as MentorshipMessage | undefined;
          if (!row?.id) return;
          setMessages((current) => mergeMentorshipMessages(current, row));
          if (String(row.sender_user_id || "") !== String(user?.id || "") && row.sender_user_id !== "system") {
            void premiumApi.post(`/mentorship/requests/${selectedRequestIdValue}/messages/read`).catch(() => undefined);
            setRequests((current) =>
              current.map((request) =>
                request.id === selectedRequestIdValue
                  ? {
                      ...request,
                      meta: { ...(request.meta || {}), viewer_unread_message_count: 0, viewer_has_unread_messages: false },
                    }
                  : request,
              ),
            );
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedRequestIdValue, user?.id]);

  const mutateRequest = async (requestId: number, status: "accepted" | "rejected") => {
    setActionBusy(`${status}-${requestId}`);
    try {
      await premiumApi.put(`/mentorship/requests/${requestId}/status`, { status });
      toast.success(status === "accepted" ? "Request accepted" : "Request rejected");
      await load();
    } catch (error: unknown) {
      toast.error("Request update failed", { description: toError(error) });
    } finally {
      setActionBusy(null);
    }
  };

  const sendMessage = async (requestId: number) => {
    if (!messageBody.trim()) return;
    setActionBusy(`chat-${requestId}`);
    try {
      const response = await premiumApi.post<MentorshipMessage>(`/mentorship/requests/${requestId}/messages`, { body: messageBody.trim() });
      setMessages((current) => mergeMentorshipMessages(current, response.data));
      setMessageBody("");
    } catch (error: unknown) {
      toast.error("Message failed", { description: toError(error) });
    } finally {
      setActionBusy(null);
    }
  };

  const offerSlots = async (requestId: number) => {
    if (!offerSlotIds.length) {
      toast.error("Select at least one slot.");
      return;
    }
    setActionBusy(`offer-${requestId}`);
    try {
      await premiumApi.post(`/mentorship/requests/${requestId}/offer-slots`, { slot_ids: offerSlotIds });
      toast.success("Slot booking opened");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to open slot booking", { description: toError(error) });
    } finally {
      setActionBusy(null);
    }
  };

  const startSessionNow = async (requestId: number) => {
    setActionBusy(`start-now-${requestId}`);
    try {
      const response = await premiumApi.post<MentorshipSession>(`/mentorship/requests/${requestId}/start-now`, {});
      toast.success("Session started");
      await load();
      if (response.data?.id) {
        router.push(`/mentorship/session/${response.data.id}?autojoin=1`);
      }
    } catch (error: unknown) {
      toast.error("Failed to start session", { description: toError(error) });
    } finally {
      setActionBusy(null);
    }
  };

  const saveEta = async (submissionId: number) => {
    setActionBusy(`eta-${submissionId}`);
    try {
      await premiumApi.put(`/copy-submissions/${submissionId}/eta`, { provider_eta_text: etaText || undefined, provider_note: providerNote || undefined });
      toast.success("ETA saved");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to save ETA", { description: toError(error) });
    } finally {
      setActionBusy(null);
    }
  };

  const submitEvaluation = async (submissionId: number) => {
    setActionBusy(`evaluation-${submissionId}`);
    try {
      await premiumApi.put(`/copy-submissions/${submissionId}/checked-copy`, {
        checked_copy_pdf_url: checkedCopyUrl || undefined,
        total_marks: totalMarks ? Number(totalMarks) : undefined,
        provider_note: providerNote || undefined,
      });
      toast.success("Evaluation submitted");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to submit evaluation", { description: toError(error) });
    } finally {
      setActionBusy(null);
    }
  };

  if (busy) return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship workspace...</div>;
  if (!isAuthenticated) return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Sign in to access mentorship.</div>;

  if (mode === "user") {
    return (
      <div className="space-y-4">
        {providerCapable ? <button type="button" onClick={() => setModeOverride("provider")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Open mentor queue</button> : null}
        {derived.map(({ request, submission, session, offeredSlotCount }) => (
          <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-lg font-semibold text-slate-900">Request #{request.id}</p>
            <p className="mt-1 text-sm text-slate-600">{mentorshipKindLabel(request, submission)}</p>
            <p className="mt-1 text-sm text-slate-600">{mentorshipCurrentStatusLabel(request, session, submission, offeredSlotCount)}</p>
            <p className="mt-1 text-sm text-slate-600">{mentorshipNextActionLabel(request, session, submission, offeredSlotCount)}</p>
            <p className="mt-3 text-sm text-slate-500">{plainTextExcerpt(request.note)}</p>
            <Link href={`/my-purchases/mentorship/${request.id}`} className="mt-4 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Open request</Link>
          </article>
        ))}
        {!derived.length ? <p className="text-sm text-slate-500">No mentorship requests yet.</p> : null}
      </div>
    );
  }

  const offerableSlots = slots.filter((slot) => new Date(slot.ends_at).getTime() > Date.now() && slot.is_active);
  const totalLearnersInDesk = new Set(derived.map((item) => item.request.user_id)).size;
  const selectedSession = selected?.session ?? null;
  const selectedSessionDuration = selectedSession ? sessionDurationMinutes(selectedSession) : null;
  const selectedLearnerName = selected ? requestLabel(selected.request) : "Learner";
  const selectedLearnerEmail = selected ? requestEmail(selected.request) : "";

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[30px] border border-[#d8def4] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.95),_rgba(255,255,255,1)_46%,_rgba(239,246,255,0.95)_100%)] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-[#1d3b8b]">Mentorship Desk</p>
            <p className="mt-3 text-sm text-slate-600">Review learner requests, reply in chat, and move accepted requests into payment or live session.</p>
          </div>
          <button type="button" onClick={() => setModeOverride("user")} className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700">
            Open learner view
          </button>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <article className="rounded-[28px] bg-[#0b1c5a] p-6 text-white shadow-lg shadow-[#0b1c5a]/15">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">Learners In Desk</p>
                <p className="mt-3 text-5xl font-black tracking-tight">{totalLearnersInDesk}</p>
              </div>
              <div className="rounded-[22px] bg-white/10 p-4 text-white">
                <UserRound className="h-8 w-8" />
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">New Requests</p>
                <p className="mt-2 text-2xl font-black">{queueCounts.new_requests}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Active</p>
                <p className="mt-2 text-2xl font-black">{queueCounts.active_conversations}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Upcoming</p>
                <p className="mt-2 text-2xl font-black">{queueCounts.upcoming_calls}</p>
              </div>
            </div>
          </article>

          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-[24px] border border-sky-200 bg-sky-100/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-2xl bg-white/70 p-3 text-sky-700">
                  <MessagesSquare className="h-6 w-6" />
                </div>
                <p className="text-4xl font-black tracking-tight text-[#091a4a]">{queueCounts.new_requests}</p>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-sky-900">New Requests</p>
              <p className="mt-2 text-sm text-slate-600">Learners waiting for an accept or reject decision.</p>
            </article>
            <article className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                  <CreditCard className="h-6 w-6" />
                </div>
                <p className="text-4xl font-black tracking-tight text-[#091a4a]">{queueCounts.active_conversations}</p>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Active Conversations</p>
              <p className="mt-2 text-sm text-slate-600">Paid work moving through review, feedback, or booking open.</p>
            </article>
            <article className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                  <CalendarDays className="h-6 w-6" />
                </div>
                <p className="text-4xl font-black tracking-tight text-[#091a4a]">{queueCounts.upcoming_calls}</p>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Scheduled Sessions</p>
              <p className="mt-2 text-sm text-slate-600">Learners already booked into live or scheduled consultations.</p>
            </article>
            <article className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-[#091a4a]">
                  <FileText className="h-6 w-6" />
                </div>
                <p className="text-4xl font-black tracking-tight text-[#091a4a]">{queueCounts.completed}</p>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Completed Work</p>
              <p className="mt-2 text-sm text-slate-600">Archived mentorship requests and evaluations.</p>
            </article>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {(["new_requests", "active_conversations", "upcoming_calls", "completed"] as QueueTab[]).map((value) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === value ? "bg-[#091a4a] text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            {value.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())} ({queueCounts[value]})
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-xl font-black tracking-tight text-slate-900">Learner Queue</h2>
            <p className="mt-1 text-sm text-slate-500">Each learner appears once here. Open the card to manage the latest request and see recent history.</p>
          </div>
          <div className="mt-5 space-y-3">
            {groupedQueue.map(({ userId, latest, rows }) => {
              const active = selected?.request.id === latest.request.id;
              const learnerName = requestLabel(latest.request);
              const learnerEmail = requestEmail(latest.request);
              const unreadCount = rows.reduce((total, row) => total + requestUnreadCount(row.request), 0);
              return (
                <button key={userId} type="button" onClick={() => setSelectedRequestId(latest.request.id)} className={`w-full rounded-[24px] border p-4 text-left transition-colors ${active ? "border-[#091a4a] bg-[#091a4a] text-white" : "border-slate-200 bg-slate-50/80 text-slate-900 hover:bg-slate-100"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${active ? "bg-white/10 text-white" : "bg-sky-100 text-[#091a4a]"}`}>
                      {initialsFromLabel(learnerName || learnerEmail)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-base font-black tracking-tight">{learnerName}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {unreadCount > 0 ? (
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${active ? "border-emerald-200/30 bg-emerald-300/15 text-emerald-100" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
                              {unreadCount === 1 ? "1 new reply" : `${unreadCount} new replies`}
                            </span>
                          ) : null}
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${active ? "border-white/20 bg-white/10 text-slate-100" : requestStatusBadgeClass(latest.request.status)}`}>
                            {titleCaseLabel(latest.request.status)}
                          </span>
                        </div>
                      </div>
                      <p className={`mt-1 truncate text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>{learnerEmail || mentorshipKindLabel(latest.request, latest.submission)}</p>
                      <p className={`mt-2 text-xs ${active ? "text-slate-200" : "text-slate-600"}`}>{mentorshipCurrentStatusLabel(latest.request, latest.session, latest.submission, latest.offeredSlotCount)}</p>
                      <p className={`mt-2 line-clamp-2 text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>{plainTextExcerpt(latest.request.note)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${active ? "border-white/20 bg-white/10 text-slate-100" : paymentStatusBadgeClass(latest.request.payment_status)}`}>
                          {titleCaseLabel(latest.request.payment_status)}
                        </span>
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${active ? "border-white/20 bg-white/10 text-slate-100" : "border-slate-200 bg-white text-slate-600"}`}>
                          {rows.length} request{rows.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {groupedQueue.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No learners in this queue.</p> : null}
          </div>
        </div>

        <div className="space-y-6">
          {!selected ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Select a request.</div> : (
            <>
              <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Learner workspace</p>
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-lg font-black text-[#091a4a]">
                        {initialsFromLabel(selectedLearnerName || selectedLearnerEmail)}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-3xl font-black tracking-tight text-slate-900">{selectedLearnerName}</h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                          {selectedLearnerEmail ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                              <Mail className="h-4 w-4" />
                              {selectedLearnerEmail}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                            <MessageSquareText className="h-4 w-4" />
                            {mentorshipKindLabel(selected.request, selected.submission)}
                          </span>
                          {selectedUnreadCount > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-800">
                              <MessagesSquare className="h-4 w-4" />
                              {selectedUnreadCount === 1 ? "1 unread learner reply" : `${selectedUnreadCount} unread learner replies`}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-500">This workspace keeps the learner’s latest request, payment state, session controls, and message thread together.</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Payment Summary</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${paymentStatusBadgeClass(selected.request.payment_status)}`}>
                        {titleCaseLabel(selected.request.payment_status)}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${requestStatusBadgeClass(selected.request.status)}`}>
                        {titleCaseLabel(selected.request.status)}
                      </span>
                    </div>
                    <p className="mt-3">
                      Amount: <span className="font-semibold text-slate-900">{selected.request.payment_currency} {selected.request.payment_amount.toLocaleString()}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-5"><WorkflowProgressTrack steps={buildMentorshipWorkflowSteps({ request: selected.request, session: selected.session, submission: selected.submission, offeredSlotCount: selected.offeredSlotCount })} /></div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Request Focus</p>
                    <p className="mt-2 font-semibold text-slate-900">{mentorshipKindLabel(selected.request, selected.submission)}</p>
                    <p className="mt-1 text-sm text-slate-500">Preferred mode: {titleCaseLabel(selected.request.preferred_mode)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Current Status</p>
                    <p className="mt-2 font-semibold text-slate-900">{mentorshipCurrentStatusLabel(selected.request, selected.session, selected.submission, selected.offeredSlotCount)}</p>
                    <p className="mt-1 text-sm text-slate-500">{mentorshipNextActionLabel(selected.request, selected.session, selected.submission, selected.offeredSlotCount)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Request History</p>
                    <p className="mt-2 font-semibold text-slate-900">{selectedLearnerHistory.length} learner request{selectedLearnerHistory.length === 1 ? "" : "s"}</p>
                  </div>
                </div>

                <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Problem Statement</p>
                  <div className="mt-3 text-sm text-slate-700">
                    <RichTextContent value={selected.request.note || "No problem statement attached."} className="[&_p]:my-1 whitespace-pre-wrap" />
                  </div>
                  {selected.request.preferred_timing ? <p className="mt-3 text-sm text-slate-600">Preferred timing: <span className="font-semibold text-slate-900">{selected.request.preferred_timing}</span></p> : null}
                </div>

                <div className="mt-5 rounded-[24px] border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Learner Request History</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {selectedLearnerHistory.map((item) => (
                      <div key={item.request.id} className={`min-w-[180px] rounded-2xl border px-3 py-3 text-left text-xs ${selected.request.id === item.request.id ? "border-[#091a4a] bg-[#091a4a] text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                        <button type="button" onClick={() => setSelectedRequestId(item.request.id)} className="w-full text-left">
                          <p className="font-semibold">{titleCaseLabel(item.request.status)}</p>
                          <p className={`mt-1 ${selected.request.id === item.request.id ? "text-slate-200" : "text-slate-500"}`}>{new Date(item.request.requested_at).toLocaleString()}</p>
                        </button>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canStartSessionImmediately(item) ? (
                            <button
                              type="button"
                              onClick={() => void startSessionNow(item.request.id)}
                              disabled={actionBusy !== null}
                              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${selected.request.id === item.request.id ? "bg-white text-[#091a4a]" : "bg-emerald-600 text-white"} disabled:opacity-60`}
                            >
                              Start Now
                            </button>
                          ) : null}
                          {item.session ? (
                            <button
                              type="button"
                              onClick={() => router.push(`/mentorship/session/${item.session!.id}?autojoin=1`)}
                              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${selected.request.id === item.request.id ? "border-white/20 text-white" : "border-slate-300 text-slate-700"}`}
                            >
                              {item.session.status === "live" ? "Join Call" : "Open Call"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <MentorshipChatView
                    mode={mode}
                    request={selected.request}
                    session={selected.session}
                    submission={selected.submission}
                    messages={messages}
                    actionBusy={actionBusy}
                    offerableSlots={offerableSlots}
                    
                    onSendMessage={(body) => sendMessage(selected.request.id)}
                    
                    onMutateRequest={(status) => mutateRequest(selected.request.id, status)}
                    
                    onStartSession={() => startSessionNow(selected.request.id)}
                    
                    onOfferSlots={(slotIds) => {
                      setOfferSlotIds(slotIds);
                      // Since MentorshipChatView uses a separate state, we should pass it in or call it directly.
                      // Wait, offerSlots function in MentorshipManagementView uses the `offerSlotIds` state.
                      // Let's modify the local offerSlots function to take an argument if needed, or update state first.
                    }}
                    
                    onPayClick={() => {
                        // The user will pay here
                        router.push(`/my-purchases/mentorship/${selected.request.id}`);
                    }}
                    
                    onJoinSession={(sessionId) => {
                       router.push(`/mentorship/session/${sessionId}?autojoin=1`);
                    }}
                  />

                {selected.submission && mode === "provider" ? (
                <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm mt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-2xl font-black tracking-tight text-slate-900">Evaluation Workspace</h3>
                      <p className="mt-1 text-sm text-slate-500">Set the ETA, upload the checked copy, and leave learner-facing feedback here.</p>
                    </div>
                    {selected.submission.answer_pdf_url ? <a href={selected.submission.answer_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700">Open Learner Copy <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></a> : null}
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <input value={etaText} onChange={(event) => setEtaText(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Evaluation ETA" />
                    <input value={totalMarks} onChange={(event) => setTotalMarks(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Total marks" />
                    <input value={checkedCopyUrl} onChange={(event) => setCheckedCopyUrl(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm md:col-span-2" placeholder="Checked copy URL" />
                    <textarea value={providerNote} onChange={(event) => setProviderNote(event.target.value)} className="min-h-[140px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm md:col-span-2" placeholder="Strengths, weaknesses, answer quality, and next-step advice" />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button type="button" onClick={() => void saveEta(selected.submission!.id)} disabled={actionBusy !== null} className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60">Save ETA</button>
                    <button type="button" onClick={() => void submitEvaluation(selected.submission!.id)} disabled={actionBusy !== null} className="rounded-full bg-[#091a4a] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Submit Evaluation</button>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
