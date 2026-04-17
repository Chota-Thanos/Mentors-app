"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import WorkflowProgressTrack from "@/components/premium/WorkflowProgressTrack";
import { useProfile } from "@/context/ProfileContext";
import { loadLearnerMentorshipOrders, type LearnerMentorshipOrdersData } from "@/lib/learnerMentorshipOrders";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import type { MainsCopySubmission } from "@/types/premium";
import {
  buildMentorshipWorkflowSteps,
  formatWorkflowDateTime,
  mentorshipCurrentStatusLabel,
  mentorshipKindLabel,
  mentorshipNextActionLabel,
  resolveMentorshipWorkflowStage,
} from "@/lib/mentorshipOrderFlow";
import { requestOfferedSlotIds } from "@/lib/copyEvaluationFlow";

function toError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const statusTone = (label: string): string => {
  const normalized = label.toLowerCase();
  if (normalized.includes("completed")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("closed") || normalized.includes("cancelled")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("live") || normalized.includes("scheduled") || normalized.includes("book session")) return "border-sky-200 bg-sky-50 text-sky-800";
  if (normalized.includes("review") || normalized.includes("feedback")) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
};

type LearnerFilter = "all" | "action" | "evaluation" | "session" | "closed";

function plainTextExcerpt(value?: string | null, fallback = "No problem statement attached."): string {
  const normalized = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function unreadMentorUpdates(request: LearnerMentorshipOrdersData["requests"][number]): number {
  const rawValue = Number(request.meta?.viewer_unread_message_count || 0);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
}

function buildRealtimeRequestFilter(requestIds: number[]): string | null {
  const ids = Array.from(new Set(requestIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (!ids.length) return null;
  if (ids.length === 1) return `request_id=eq.${ids[0]}`;
  return `request_id=in.(${ids.join(",")})`;
}

export default function LearnerMentorshipOrdersSection() {
  const [busy, setBusy] = useState(true);
  const [data, setData] = useState<LearnerMentorshipOrdersData | null>(null);
  const [filter, setFilter] = useState<LearnerFilter>("all");
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);

  const { profileId } = useProfile();

  const reload = async (pid: number) => {
    const resp = await loadLearnerMentorshipOrders(pid);
    setData(resp);
    return resp;
  };

  useEffect(() => {
    if (!profileId) return;
    let active = true;

    void (async () => {
      setBusy(true);
      try {
        const response = await loadLearnerMentorshipOrders(profileId);
        if (!active) return;
        setData(response);
      } catch (error: unknown) {
        if (!active) return;
        setData(null);
        toast.error("Failed to load mentorship workflows", { description: toError(error) });
      } finally {
        if (active) setBusy(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [profileId]);

  useEffect(() => {
    const requestIds = (data?.requests || []).map((request) => request.id);
    const filter = buildRealtimeRequestFilter(requestIds);
    if (!filter) return;
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`learner-mentorship-orders-${requestIds.join("-")}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mentorship_messages", filter },
        (payload) => {
          const row = payload.new as { request_id?: number; sender_id?: number } | undefined;
          const requestId = Number(row?.request_id || 0);
          if (requestId <= 0) return;
          setData((current) => {
            if (!current) return current;
            return {
              ...current,
              requests: current.requests.map((request) => {
                if (request.id !== requestId || String(row?.sender_id || "") === String(request.user_id)) {
                  return request;
                }
                const nextUnread = unreadMentorUpdates(request) + 1;
                return {
                  ...request,
                  meta: { ...(request.meta || {}), viewer_unread_message_count: nextUnread, viewer_has_unread_messages: true },
                };
              }),
            };
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data?.requests]);

  const sessionByRequestId = useMemo(() => {
    const map: Record<string, LearnerMentorshipOrdersData["sessions"][number]> = {};
    for (const session of data?.sessions || []) {
      const key = String(session.request_id);
      const existing = map[key];
      if (!existing || (existing.status !== "live" && session.status === "live")) {
        map[key] = session;
      }
    }
    return map;
  }, [data]);

  const cycleByRequestId = useMemo(() => {
    return {} as Record<string, any>;
  }, []);

  if (busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship orders...</div>;
  }

  const requests = data?.requests || [];
    const requestRows = requests.map((request) => {
    const session = sessionByRequestId[String(request.id)] || null;
    const submission = (request.submission_id ? data?.submissionsById[String(request.submission_id)] || null : null) as MainsCopySubmission | null;
    const series = request.series_id ? data?.seriesById[String(request.series_id)] || null : null;
    const test = null; // testsById removed in V2
    const mentorName = data?.mentorNameById[String(request.provider_user_id)] || "Mentor";
    const offeredSlotCount = Math.max(requestOfferedSlotIds(request).length, request.booking_open ? 1 : 0);
    const currentStatus = mentorshipCurrentStatusLabel(request, session as any, submission, offeredSlotCount);
    const nextAction = mentorshipNextActionLabel(request, session as any, submission, offeredSlotCount);
    const steps = buildMentorshipWorkflowSteps({
      request,
      session: session as any,
      submission,
      offeredSlotCount,
    });
    const stage = resolveMentorshipWorkflowStage(request, session as any, submission, offeredSlotCount);
    const needsPayment = request.status === "accepted" && request.payment_status !== "paid";
    const hasSessionPhase = Boolean(session) || ["booking_open", "scheduled", "live"].includes(stage);
    const isClosed = ["completed", "cancelled", "expired"].includes(stage) || ["completed", "cancelled", "rejected", "expired"].includes(request.status);
    const unreadUpdates = unreadMentorUpdates(request);
    const needsAction = needsPayment || stage === "booking_open" || Boolean(session?.join_available) || request.status === "rejected" || unreadUpdates > 0;
    const primaryHref = session?.join_available
      ? `/mentorship/session/${session.id}?autojoin=1`
      : needsPayment
        ? `/my-purchases/mentorship/${request.id}?autopay=1`
        : `/my-purchases/mentorship/${request.id}`;
    const primaryLabel = request.status === "rejected"
      ? "Explore mentors"
      : session?.join_available
        ? session.status === "live" ? "Join live call" : "Join call"
        : needsPayment
          ? "Pay now"
          : stage === "booking_open"
            ? "Select slot"
            : submission?.checked_copy_pdf_url
              ? "View feedback"
              : "Open request";
    return {
      request,
      submission,
      session,
      series,
      test,
      mentorName,
      offeredSlotCount,
      currentStatus,
      nextAction,
      steps,
      stage,
      needsAction,
      hasSessionPhase,
      isClosed,
      primaryHref,
      primaryLabel,
      unreadUpdates,
    };
  });

  const counts = {
    all: requestRows.length,
    action: requestRows.filter((row) => row.needsAction).length,
    evaluation: requestRows.filter((row) => Boolean(row.submission)).length,
    session: requestRows.filter((row) => row.hasSessionPhase).length,
    closed: requestRows.filter((row) => row.isClosed).length,
  };

  const filteredRows = requestRows.filter((row) => {
    if (filter === "action") return row.needsAction;
    if (filter === "evaluation") return Boolean(row.submission);
    if (filter === "session") return row.hasSessionPhase;
    if (filter === "closed") return row.isClosed;
    return true;
  });

  const handleCancelRequest = async (requestId: number) => {
    if (typeof window !== "undefined" && !window.confirm("Cancel this mentorship request?")) return;
    if (!profileId) return;
    setActionBusyId(requestId);
    try {
      const supabase = createSupabaseClient();
      await supabase.from("mentorship_requests").update({ status: "cancelled" }).eq("id", requestId);
      const response = await reload(profileId);
      setData(response);
      toast.success("Mentorship request cancelled");
    } catch (error: unknown) {
      toast.error("Failed to cancel request", { description: toError(error) });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDeleteRequest = async (requestId: number) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this mentorship request from your workspace?")) return;
    if (!profileId) return;
    setActionBusyId(requestId);
    try {
      const supabase = createSupabaseClient();
      await supabase.from("mentorship_requests").delete().eq("id", requestId);
      const response = await reload(profileId);
      setData(response);
      toast.success("Mentorship request deleted");
    } catch (error: unknown) {
      toast.error("Failed to delete request", { description: toError(error) });
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Mentorship Requests</h2>
          <p className="mt-1 text-sm text-slate-500">Track mentor replies, payment steps, slots, and live session updates in one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Back to Dashboard
          </Link>
          <Link href="/mentors" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            New Request
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["all", "All"],
          ["action", "Needs action"],
          ["evaluation", "Evaluations"],
          ["session", "Sessions"],
          ["closed", "Closed"],
        ] as Array<[LearnerFilter, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            {label} ({counts[value]})
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {filteredRows.map(({ request, submission, session, series, test, mentorName, currentStatus, nextAction, steps, primaryHref, primaryLabel, unreadUpdates }) => {
          const canCancelRequest = !["cancelled", "rejected", "expired", "completed"].includes(request.status) && session?.status !== "live";
          const canDeleteRequest = ["cancelled", "rejected", "expired", "completed"].includes(request.status) && session?.status !== "live";
          return (
            <article key={request.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-slate-900">Request #{request.id}</p>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${statusTone(currentStatus)}`}>
                      {currentStatus}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                      {mentorshipKindLabel(request, submission)}
                    </span>
                    {unreadUpdates > 0 ? (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">
                        {unreadUpdates} new mentor update{unreadUpdates === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Mentor: <span className="font-semibold text-slate-800">{mentorName}</span>
                  </p>
                  <p className="text-sm text-slate-600">
                    Requested on <span className="font-semibold text-slate-800">{formatWorkflowDateTime(request.requested_at)}</span>
                  </p>
                  {series ? <p className="text-sm text-slate-600">Series: {series.name}</p> : null}

                  <p className="mt-2 text-sm text-slate-500">{plainTextExcerpt(request.note)}</p>
                </div>

                <p className="text-sm font-semibold text-slate-900 xl:max-w-sm">{nextAction}</p>
              </div>

              <div className="mt-4">
                <WorkflowProgressTrack steps={steps} />
              </div>


              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={request.status === "rejected" ? "/mentors" : primaryHref} className="inline-flex rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                  {primaryLabel}
                </Link>
                <Link href={`/my-purchases/mentorship/${request.id}`} className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  Open details
                </Link>
                {canCancelRequest ? (
                  <button
                    type="button"
                    onClick={() => void handleCancelRequest(request.id)}
                    disabled={actionBusyId === request.id}
                    className="inline-flex rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-60"
                  >
                    {actionBusyId === request.id ? "Working..." : "Cancel"}
                  </button>
                ) : null}
                {canDeleteRequest ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteRequest(request.id)}
                    disabled={actionBusyId === request.id}
                    className="inline-flex rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-60"
                  >
                    {actionBusyId === request.id ? "Working..." : "Delete"}
                  </button>
                ) : null}
                {submission?.checked_copy_pdf_url ? (
                  <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    Checked Copy
                  </a>
                ) : null}
                {session?.join_available ? (
                  <Link href={`/mentorship/session/${session.id}?autojoin=1`} className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                    {session.status === "live" ? "Join live call" : "Join call"}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}

        {filteredRows.length === 0 ? <p className="text-sm text-slate-500">No mentorship requests match this view yet.</p> : null}
      </div>
    </section>
  );
}
