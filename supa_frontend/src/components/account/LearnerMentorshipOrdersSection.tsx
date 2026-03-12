"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import WorkflowProgressTrack from "@/components/premium/WorkflowProgressTrack";
import { loadLearnerMentorshipOrders, type LearnerMentorshipOrdersData } from "@/lib/learnerMentorshipOrders";
import {
  buildMentorshipWorkflowSteps,
  formatWorkflowDateTime,
  mentorshipCurrentStatusLabel,
  mentorshipKindLabel,
  mentorshipNextActionLabel,
} from "@/lib/mentorshipOrderFlow";
import { requestOfferedSlotIds } from "@/lib/copyEvaluationFlow";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

const statusTone = (label: string): string => {
  const normalized = label.toLowerCase();
  if (normalized.includes("completed")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("cancelled") || normalized.includes("rejected")) return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized.includes("live") || normalized.includes("allotted") || normalized.includes("booked")) return "border-sky-200 bg-sky-50 text-sky-800";
  if (normalized.includes("evaluation")) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
};

export default function LearnerMentorshipOrdersSection() {
  const [busy, setBusy] = useState(true);
  const [data, setData] = useState<LearnerMentorshipOrdersData | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      setBusy(true);
      try {
        const response = await loadLearnerMentorshipOrders();
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
  }, []);

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
    const map: Record<string, LearnerMentorshipOrdersData["tracking"]["mentorship_cycles"][number]> = {};
    for (const cycle of data?.tracking.mentorship_cycles || []) {
      map[String(cycle.request_id)] = cycle;
    }
    return map;
  }, [data]);

  if (busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship orders...</div>;
  }

  const requests = data?.requests || [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Mentorship Orders</h2>
          <p className="mt-1 text-sm text-slate-600">
            Track copy evaluation and mentorship workflows with delivery-style statuses and detailed receipts.
          </p>
        </div>
        <Link href="/mentorship/manage" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
          Open Mentorship Workspace
        </Link>
      </div>

      <div className="mt-4 space-y-4">
        {requests.map((request) => {
          const session = sessionByRequestId[String(request.id)] || null;
          const submission = request.submission_id ? data?.submissionsById[String(request.submission_id)] || null : null;
          const series = request.series_id ? data?.seriesById[String(request.series_id)] || null : null;
          const test = request.test_collection_id ? data?.testsById[String(request.test_collection_id)] || null : null;
          const cycle = cycleByRequestId[String(request.id)] || null;
          const mentorName = data?.mentorNameByUserId[request.provider_user_id] || request.provider_user_id;
          const offeredSlotCount = Math.max(requestOfferedSlotIds(request).length, cycle?.timeline.some((item) => item.key === "slot_offered") ? 1 : 0);
          const currentStatus = mentorshipCurrentStatusLabel(request, session, submission, offeredSlotCount);
          const nextAction = mentorshipNextActionLabel(request, session, submission, offeredSlotCount);
          const steps = buildMentorshipWorkflowSteps({
            request,
            session,
            submission,
            offeredSlotCount,
          });

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
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Mentor: <span className="font-semibold text-slate-800">{mentorName}</span>
                  </p>
                  <p className="text-sm text-slate-600">
                    Requested on <span className="font-semibold text-slate-800">{formatWorkflowDateTime(request.requested_at)}</span>
                  </p>
                  {series ? <p className="text-sm text-slate-600">Series: {series.title}</p> : null}
                  {test ? <p className="text-sm text-slate-600">Test: {test.title}</p> : null}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 xl:max-w-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Next action</p>
                  <p className="mt-2 font-semibold text-slate-900">{nextAction}</p>
                  {session?.starts_at ? <p className="mt-2 text-xs text-slate-500">Session window: {formatWorkflowDateTime(session.starts_at)}</p> : null}
                </div>
              </div>

              <div className="mt-4">
                <WorkflowProgressTrack steps={steps} />
              </div>

              {cycle?.issues.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {cycle.issues.slice(0, 3).map((issue, index) => (
                    <span key={`${request.id}-${issue.code}-${index}`} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800">
                      {issue.label}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/my-purchases/mentorship/${request.id}`} className="inline-flex rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                  Open Details
                </Link>
                {submission?.checked_copy_pdf_url ? (
                  <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    Checked Copy
                  </a>
                ) : null}
                {session?.meeting_link ? (
                  <a href={session.meeting_link} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                    Join / Open Session Link
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}

        {requests.length === 0 ? <p className="text-sm text-slate-500">No mentorship or copy-evaluation workflows yet.</p> : null}
      </div>
    </section>
  );
}
