"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import WorkflowProgressTrack from "@/components/premium/WorkflowProgressTrack";
import RichTextContent from "@/components/ui/RichTextContent";
import { loadLearnerMentorshipOrders, type LearnerMentorshipOrdersData } from "@/lib/learnerMentorshipOrders";
import {
  buildMentorshipWorkflowSteps,
  formatWorkflowDateTime,
  mentorshipCurrentStatusLabel,
  mentorshipKindLabel,
  mentorshipNextActionLabel,
  requestMetaDate,
} from "@/lib/mentorshipOrderFlow";
import { requestOfferedSlotIds } from "@/lib/copyEvaluationFlow";

interface MentorshipOrderDetailClientProps {
  requestId: number;
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

export default function MentorshipOrderDetailClient({ requestId }: MentorshipOrderDetailClientProps) {
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
        toast.error("Failed to load mentorship order", { description: toError(error) });
      } finally {
        if (active) setBusy(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [requestId]);

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
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship order...</div>;
  }

  const request = (data?.requests || []).find((row) => row.id === requestId) || null;
  if (!request) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-slate-900">Mentorship order not found</h1>
        <p className="mt-2 text-sm text-slate-600">This request is not present in your current learner workflow list.</p>
        <Link href="/my-purchases" className="mt-4 inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          Back to My Purchases
        </Link>
      </div>
    );
  }

  const session = sessionByRequestId[String(request.id)] || null;
  const submission = request.submission_id ? data?.submissionsById[String(request.submission_id)] || null : null;
  const series = request.series_id ? data?.seriesById[String(request.series_id)] || null : null;
  const test = request.test_collection_id ? data?.testsById[String(request.test_collection_id)] || null : null;
  const cycle = cycleByRequestId[String(request.id)] || null;
  const mentorName = data?.mentorNameByUserId[request.provider_user_id] || request.provider_user_id;
  const offeredSlotCount = Math.max(requestOfferedSlotIds(request).length, cycle?.timeline.some((item) => item.key === "slot_offered") ? 1 : 0);
  const currentStatus = mentorshipCurrentStatusLabel(request, session, submission, offeredSlotCount);
  const nextAction = mentorshipNextActionLabel(request, session, submission, offeredSlotCount);
  const steps = buildMentorshipWorkflowSteps({ request, session, submission, offeredSlotCount });

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Mentorship receipt</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Request #{request.id}</h1>
            <p className="mt-2 text-sm text-slate-600">{mentorshipKindLabel(request, submission)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current status</p>
            <p className="mt-2 text-lg font-bold text-slate-900">{currentStatus}</p>
            <p className="mt-1 text-slate-600">{nextAction}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Delivery tracker</h2>
        <div className="mt-4">
          <WorkflowProgressTrack steps={steps} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Order details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Mentor</p>
              <p className="mt-2 font-semibold text-slate-900">{mentorName}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Requested</p>
              <p className="mt-2 font-semibold text-slate-900">{formatWorkflowDateTime(request.requested_at)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Series</p>
              <p className="mt-2 font-semibold text-slate-900">{series?.title || "Direct mentor workflow"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Test / Session mode</p>
              <p className="mt-2 font-semibold text-slate-900">{test?.title || request.preferred_mode}</p>
            </div>
          </div>

          {request.note ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Learner note</p>
              <div className="mt-2 text-sm text-slate-700">
                <RichTextContent value={request.note} className="[&_p]:my-1" />
              </div>
            </div>
          ) : null}

          {submission ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Copy evaluation package</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <p>Status: <span className="font-semibold text-slate-900">{submission.status}</span></p>
                {submission.provider_eta_text || submission.provider_eta_hours ? (
                  <p>
                    ETA: <span className="font-semibold text-slate-900">{submission.provider_eta_text || `${submission.provider_eta_hours} hour(s)`}</span>
                  </p>
                ) : null}
                {submission.total_marks !== null && submission.total_marks !== undefined ? (
                  <p>Marks awarded: <span className="font-semibold text-slate-900">{submission.total_marks}</span></p>
                ) : null}
                {submission.provider_note ? (
                  <div>
                    <p className="font-semibold text-slate-900">Mentor note</p>
                    <div className="mt-1">
                      <RichTextContent value={submission.provider_note} className="[&_p]:my-1" />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {submission.answer_pdf_url ? (
                    <a href={submission.answer_pdf_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                      Answer PDF
                    </a>
                  ) : null}
                  {submission.checked_copy_pdf_url ? (
                    <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      Checked Copy
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Timeline and session</h2>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Key timestamps</p>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p>Accepted: <span className="font-semibold text-slate-900">{formatWorkflowDateTime(requestMetaDate(request, "accepted_at"))}</span></p>
              <p>Booked by learner: <span className="font-semibold text-slate-900">{formatWorkflowDateTime(requestMetaDate(request, "booked_by_user_at"))}</span></p>
              <p>Scheduled for: <span className="font-semibold text-slate-900">{formatWorkflowDateTime(requestMetaDate(request, "scheduled_slot_starts_at") || session?.starts_at || null)}</span></p>
              <p>Completed: <span className="font-semibold text-slate-900">{formatWorkflowDateTime(requestMetaDate(request, "completed_at") || session?.updated_at || null)}</span></p>
            </div>
          </div>

          {session ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Session record</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <p>Status: <span className="font-semibold text-slate-900">{session.status}</span></p>
                <p>Window: <span className="font-semibold text-slate-900">{formatWorkflowDateTime(session.starts_at)} - {formatWorkflowDateTime(session.ends_at)}</span></p>
                <p>Mode: <span className="font-semibold text-slate-900">{session.mode}</span></p>
                {session.summary ? <p>Summary: <span className="font-semibold text-slate-900">{session.summary}</span></p> : null}
                {session.meeting_link ? (
                  <a href={session.meeting_link} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Join / Open Session Link
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Timeline</p>
            <div className="mt-3 space-y-3">
              {(cycle?.timeline || []).map((item, index) => (
                <div key={`${item.key}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">{item.label}</p>
                  {item.at ? <p className="mt-1 text-xs text-slate-500">{formatWorkflowDateTime(item.at)}</p> : null}
                  {item.detail ? <p className="mt-1 text-sm text-slate-600">{item.detail}</p> : null}
                </div>
              ))}
              {(!cycle || cycle.timeline.length === 0) ? <p className="text-sm text-slate-500">No timeline events recorded yet.</p> : null}
            </div>
          </div>

          {cycle?.issues.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Workflow issues</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {cycle.issues.map((issue, index) => (
                  <span key={`${issue.code}-${index}`} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-[11px] font-semibold text-amber-800">
                    {issue.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
