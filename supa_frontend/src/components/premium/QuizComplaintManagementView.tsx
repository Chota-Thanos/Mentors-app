"use client";

import axios from "axios";
import Link from "next/link";
import { ArrowUpRight, CircleCheckBig, Clock3, Inbox, Loader2, MessageSquareWarning, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import { useAuth } from "@/context/AuthContext";
import { isModeratorLike, isQuizMasterLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import type { QuizQuestionComplaint, QuizQuestionComplaintStatus } from "@/types/premium";

type ComplaintFilter = "all" | QuizQuestionComplaintStatus;

const FILTERS: ComplaintFilter[] = ["all", "received", "pending", "resolved"];

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

function formatDateTime(value?: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toLocaleString();
}

function statusLabel(value: ComplaintFilter): string {
  if (value === "all") return "All";
  if (value === "pending") return "Pending";
  if (value === "resolved") return "Resolved";
  return "Received";
}

function statusBadgeClass(status: QuizQuestionComplaintStatus): string {
  if (status === "pending") return "border-amber-300 bg-amber-50 text-amber-800";
  if (status === "resolved") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  return "border-sky-300 bg-sky-50 text-sky-800";
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p>
    </article>
  );
}

export default function QuizComplaintManagementView() {
  const { loading: authLoading, isAuthenticated, showLoginModal, user } = useAuth();
  const currentUserId = String(user?.id || "").trim();
  const workspaceSections = useMemo(
    () => getQuizMasterWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );
  const canManageComplaints = useMemo(
    () => isQuizMasterLike(user) || isModeratorLike(user),
    [user],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ComplaintFilter>("all");
  const [complaints, setComplaints] = useState<QuizQuestionComplaint[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadComplaints = useCallback(async () => {
    if (!isAuthenticated || !canManageComplaints) {
      setComplaints([]);
      setNoteDrafts({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await premiumApi.get<QuizQuestionComplaint[]>("/quiz-complaints/creator");
      const rows = Array.isArray(response.data) ? response.data : [];
      setComplaints(rows);
      setNoteDrafts(
        Object.fromEntries(
          rows.map((row) => [row.id, String(row.creator_note || "")]),
        ),
      );
    } catch (loadError: unknown) {
      const description = toError(loadError);
      setError(description);
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  }, [canManageComplaints, isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    void loadComplaints();
  }, [authLoading, isAuthenticated, loadComplaints]);

  const counts = useMemo(() => ({
    all: complaints.length,
    received: complaints.filter((row) => row.status === "received").length,
    pending: complaints.filter((row) => row.status === "pending").length,
    resolved: complaints.filter((row) => row.status === "resolved").length,
  }), [complaints]);

  const filteredComplaints = useMemo(() => {
    if (filter === "all") return complaints;
    return complaints.filter((row) => row.status === filter);
  }, [complaints, filter]);

  const syncComplaint = (updated: QuizQuestionComplaint) => {
    setComplaints((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setNoteDrafts((current) => ({
      ...current,
      [updated.id]: String(updated.creator_note || ""),
    }));
  };

  const updateComplaint = async (
    complaintId: number,
    payload: { status?: QuizQuestionComplaintStatus; creator_note?: string | null },
    successMessage: string,
  ) => {
    setSavingId(complaintId);
    try {
      const response = await premiumApi.patch<QuizQuestionComplaint>(`/quiz-complaints/${complaintId}`, payload);
      syncComplaint(response.data);
      toast.success(successMessage);
    } catch (updateError: unknown) {
      toast.error("Failed to update complaint", { description: toError(updateError) });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6">
      <RoleWorkspaceSidebar
        title="Prelims Expert Workspace"
        subtitle="Manage prelims programs, content delivery, and learner complaints."
        sections={workspaceSections}
        className="lg:self-start"
      />

      <div className="min-w-0 flex-1 space-y-6">
        <section className="rounded-[34px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(224,231,255,0.9),_transparent_34%),linear-gradient(180deg,_#ffffff,_#f8fafc)] p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-600">Question Complaints</p>
              <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl">Creator Complaint Desk</h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
                Review learner complaints from prelims result pages, inspect the exact question context, and move each case through received, pending, or resolved with a creator note.
              </p>
            </div>
            {isAuthenticated && canManageComplaints ? (
              <button
                type="button"
                onClick={() => void loadComplaints()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            ) : null}
          </div>
        </section>

        {authLoading || loading ? (
          <section className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-16">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </section>
        ) : null}

        {!authLoading && !loading && !isAuthenticated ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-bold text-amber-900">Sign in required</h2>
            <p className="mt-2 text-sm text-amber-800">
              Sign in with your Quiz Master account to manage learner complaints.
            </p>
            <button
              type="button"
              onClick={showLoginModal}
              className="mt-4 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Sign In
            </button>
          </section>
        ) : null}

        {!authLoading && !loading && isAuthenticated && !canManageComplaints ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
            <h2 className="text-lg font-bold text-rose-900">Quiz Master access required</h2>
            <p className="mt-2 text-sm text-rose-800">
              This page is reserved for creators who manage prelims test series and their question complaints.
            </p>
          </section>
        ) : null}

        {!authLoading && !loading && isAuthenticated && canManageComplaints ? (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <StatCard label="All Complaints" value={counts.all} />
              <StatCard label="Received" value={counts.received} />
              <StatCard label="Pending" value={counts.pending} />
              <StatCard label="Resolved" value={counts.resolved} />
            </section>

            <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Complaint buckets</p>
                  <p className="mt-2 text-lg font-black tracking-tight text-slate-950">Filter the current queue</p>
                </div>
                <div className="flex flex-wrap gap-2">
                {FILTERS.map((item) => {
                  const active = filter === item;
                  const count = item === "all" ? counts.all : counts[item];
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFilter(item)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? "border-indigo-950 bg-indigo-950 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      {statusLabel(item)} ({count})
                    </button>
                  );
                })}
                </div>
              </div>
              {error ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}
            </section>

            {filteredComplaints.length === 0 ? (
              <section className="rounded-[30px] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
                <div className="flex items-center gap-3">
                  {filter === "resolved" ? <CircleCheckBig className="h-5 w-5 text-emerald-600" /> : filter === "pending" ? <Clock3 className="h-5 w-5 text-amber-600" /> : <Inbox className="h-5 w-5 text-slate-500" />}
                  <span>No complaints are present in the {statusLabel(filter).toLowerCase()} bucket.</span>
                </div>
              </section>
            ) : (
              <section className="space-y-4">
                {filteredComplaints.map((complaint) => {
                  const noteDraft = String(noteDrafts[complaint.id] || "");
                  const noteUnchanged = noteDraft.trim() === String(complaint.creator_note || "").trim();
                  return (
                    <article key={complaint.id} className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-2xl font-black tracking-tight text-slate-950">
                              {complaint.collection_title || `Test #${complaint.collection_id}`} | Question {complaint.question_number}
                            </h2>
                            <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusBadgeClass(complaint.status)}`}>
                              {statusLabel(complaint.status)}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600">
                            Complaint #{complaint.id} | User {complaint.user_id} | Attempt #{complaint.attempt_id}
                          </p>
                          <p className="text-sm text-slate-600">
                            Received {formatDateTime(complaint.created_at)}
                            {complaint.resolved_at ? ` | Resolved ${formatDateTime(complaint.resolved_at)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/collections/${complaint.collection_id}`}
                            className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                          >
                            Open Test
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                          {complaint.series_id ? (
                            <Link
                              href={`/test-series/${complaint.series_id}/manage`}
                              className="inline-flex items-center gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"
                            >
                              <MessageSquareWarning className="h-4 w-4" />
                              Manage Series
                            </Link>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                        <div className="space-y-4">
                          <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Question</p>
                            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-800">{complaint.question_text}</p>
                          </div>

                          <div className="rounded-[26px] border border-rose-200 bg-rose-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">Learner Complaint</p>
                            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-rose-900">{complaint.complaint_text}</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                            <p>
                              <span className="font-semibold text-slate-900">Selected option:</span> {complaint.selected_option || "None"}
                            </p>
                            <p className="mt-2">
                              <span className="font-semibold text-slate-900">Correct answer:</span> {complaint.correct_answer || "n/a"}
                            </p>
                          </div>

                          <div className="rounded-[26px] border border-slate-200 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Creator Note</p>
                            <textarea
                              value={noteDraft}
                              onChange={(event) =>
                                setNoteDrafts((current) => ({
                                  ...current,
                                  [complaint.id]: event.target.value,
                                }))
                              }
                              rows={5}
                              placeholder="Add a note for the learner or internal resolution context."
                              className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(["received", "pending", "resolved"] as QuizQuestionComplaintStatus[]).map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  onClick={() => void updateComplaint(complaint.id, { status }, `Complaint marked ${statusLabel(status).toLowerCase()}`)}
                                  disabled={savingId === complaint.id || complaint.status === status}
                                  className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                                    complaint.status === status
                                      ? "border-indigo-950 bg-indigo-950 text-white"
                                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                                  } disabled:opacity-60`}
                                >
                                  {statusLabel(status)}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => void updateComplaint(complaint.id, { creator_note: noteDraft.trim() || null }, "Creator note saved")}
                                disabled={savingId === complaint.id || noteUnchanged}
                                className="rounded-2xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-60"
                              >
                                Save Note
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
