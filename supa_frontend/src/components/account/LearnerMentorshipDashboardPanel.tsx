"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { requestOfferedSlotIds } from "@/lib/copyEvaluationFlow";
import { loadLearnerMentorshipOrders, type LearnerMentorshipOrdersData } from "@/lib/learnerMentorshipOrders";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/context/ProfileContext";
import type { MainsCopySubmission } from "@/types/premium";
import {
  formatWorkflowDateTime,
  mentorshipCurrentStatusLabel,
  mentorshipKindLabel,
  mentorshipNextActionLabel,
  resolveMentorshipWorkflowStage,
} from "@/lib/mentorshipOrderFlow";

type DashboardRequestRow = {
  id: number;
  mentorName: string;
  kind: string;
  status: string;
  nextAction: string;
  requestedAt: string;
  href: string;
  needsAction: boolean;
  hasEvaluation: boolean;
  hasSession: boolean;
  requestStatus: string;
  paymentStatus: string;
  stage: string;
  unreadUpdates: number;
};

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function toneClass(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("completed")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("cancelled") || normalized.includes("rejected") || normalized.includes("expired")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("payment")) return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized.includes("scheduled") || normalized.includes("session") || normalized.includes("live")) return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
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

export default function LearnerMentorshipDashboardPanel() {
  const [busy, setBusy] = useState(true);
  const [data, setData] = useState<LearnerMentorshipOrdersData | null>(null);

  const { profileId } = useProfile();

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!profileId) return;
      setBusy(true);
      try {
        const response = await loadLearnerMentorshipOrders(profileId);
        if (!active) return;
        setData(response);
      } catch (error: unknown) {
        if (!active) return;
        setData(null);
        toast.error("Failed to load mentorship requests", { description: toError(error) });
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
      .channel(`learner-mentorship-dashboard-${requestIds.join("-")}`)
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
      const current = map[key];
      if (!current || (current.status !== "live" && session.status === "live")) {
        map[key] = session;
      }
    }
    return map;
  }, [data]);

  const cycleByRequestId = useMemo(() => {
    return {} as Record<string, any>;
  }, []);

  const rows = useMemo<DashboardRequestRow[]>(() => {
    return (data?.requests || [])
      .map((request) => {
        const session = sessionByRequestId[String(request.id)] || null;
        const cycle = cycleByRequestId[String(request.id)] || null;
        const submission = (request.submission_id ? data?.submissionsById[String(request.submission_id)] || null : null) as MainsCopySubmission | null;
        const offeredSlotCount = Math.max(requestOfferedSlotIds(request).length, request.booking_open ? 1 : 0);
        const stage = resolveMentorshipWorkflowStage(request, session, submission, offeredSlotCount);
        const needsPayment = request.status === "accepted" && request.payment_status !== "paid";
        return {
          id: request.id,
          mentorName: data?.mentorNameById[String(request.provider_user_id)] || "Mentor",
          kind: mentorshipKindLabel(request, submission),
          status: mentorshipCurrentStatusLabel(request, session as any, submission, offeredSlotCount),
          nextAction: mentorshipNextActionLabel(request, session as any, submission, offeredSlotCount),
          requestedAt: request.requested_at,
          href: session?.join_available
            ? `/mentorship/session/${session.id}?autojoin=1`
            : needsPayment
              ? `/my-purchases/mentorship/${request.id}?autopay=1`
              : `/my-purchases/mentorship/${request.id}`,
          needsAction:
            needsPayment
            || stage === "booking_open"
            || Boolean(session?.join_available)
            || request.status === "rejected"
            || unreadMentorUpdates(request) > 0,
          hasEvaluation: Boolean(submission) && ["paid", "evaluating", "feedback_ready"].includes(stage),
          hasSession: Boolean(session) && ["scheduled", "live"].includes(session.status),
          requestStatus: request.status,
          paymentStatus: String(request.payment_status || ""),
          stage,
          unreadUpdates: unreadMentorUpdates(request),
        };
      })
      .sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());
  }, [cycleByRequestId, data, sessionByRequestId]);

  const summary = useMemo(
    () => ({
      pending: rows.filter((row) => row.requestStatus === "requested").length,
      payment: rows.filter((row) => row.requestStatus === "accepted" && row.paymentStatus !== "paid").length,
      evaluation: rows.filter((row) => row.hasEvaluation).length,
      session: rows.filter((row) => row.hasSession).length,
      updates: rows.filter((row) => row.unreadUpdates > 0).length,
    }),
    [rows],
  );

  const actionRows = useMemo(() => rows.filter((row) => row.needsAction).slice(0, 2), [rows]);
  const latestRows = useMemo(() => rows.slice(0, 3), [rows]);

  if (busy) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship summary...</section>;
  }

  return (
    <section className="space-y-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Mentorship</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Requests summary</h2>
          <p className="mt-2 text-sm text-slate-600">See what needs payment, what has mentor updates, and what is ready to join next.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/requests" className="inline-flex rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">
            Open Requests Page
          </Link>
          <Link href="/mentors" className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800">
            New Request
          </Link>
        </div>
      </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Pending Requests", value: summary.pending, detail: "Awaiting mentor response" },
          { label: "Awaiting Payment", value: summary.payment, detail: "Accepted and ready to continue" },
          { label: "Evaluations", value: summary.evaluation, detail: "Copy review in progress" },
          { label: "Upcoming Sessions", value: summary.session, detail: "Scheduled or live now" },
          { label: "New Updates", value: summary.updates, detail: "Unread mentor messages" },
        ].map((item) => (
          <article key={item.label} className="rounded-[1.4rem] bg-slate-50 p-4">
            <p className="text-3xl font-black text-slate-900">{String(item.value).padStart(2, "0")}</p>
            <p className="mt-3 text-sm font-semibold text-slate-900">{item.label}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[1.5rem] bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-black tracking-tight text-slate-900">Needs attention</h3>
            {actionRows.length ? <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{actionRows.length} active</span> : null}
          </div>
          <div className="mt-4 space-y-3">
            {actionRows.length ? actionRows.map((row) => (
              <article key={`action-${row.id}`} className="rounded-[1.2rem] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{row.mentorName}</p>
                    <p className="text-xs text-slate-500">{row.kind}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${toneClass(row.status)}`}>
                    {row.status}
                  </span>
                </div>
                {row.unreadUpdates > 0 ? (
                  <p className="mt-3 text-xs font-semibold text-sky-700">{row.unreadUpdates} new mentor update{row.unreadUpdates === 1 ? "" : "s"}</p>
                ) : null}
                <p className="mt-3 text-sm font-semibold text-slate-900">{row.nextAction}</p>
                <div className="mt-3">
                  <Link href={row.href} className="inline-flex rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                    Open Request
                  </Link>
                </div>
              </article>
            )) : <p className="text-sm text-slate-500">No request needs action right now.</p>}
          </div>
        </div>

        <div className="rounded-[1.5rem] bg-slate-50 p-4">
          <h3 className="text-base font-black tracking-tight text-slate-900">Latest requests</h3>
          <div className="mt-4 space-y-3">
            {latestRows.length ? latestRows.map((row) => (
              <article key={`latest-${row.id}`} className="rounded-[1.2rem] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">Request #{row.id}</p>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${toneClass(row.status)}`}>
                    {row.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{row.mentorName}</p>
                <p className="text-xs text-slate-500">{row.kind}</p>
                {row.unreadUpdates > 0 ? <p className="mt-2 text-xs font-semibold text-sky-700">{row.unreadUpdates} new mentor update{row.unreadUpdates === 1 ? "" : "s"}</p> : null}
                <p className="mt-2 text-xs text-slate-500">{formatWorkflowDateTime(row.requestedAt)}</p>
              </article>
            )) : <p className="text-sm text-slate-500">No mentorship requests created yet.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
