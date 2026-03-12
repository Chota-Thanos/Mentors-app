"use client";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isModeratorLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import RichTextContent from "@/components/ui/RichTextContent";
import RichTextField from "@/components/ui/RichTextField";
import type { ProfessionalOnboardingApplication, ProfessionalOnboardingStatus } from "@/types/premium";

type StatusFilter = ProfessionalOnboardingStatus | "all";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

export default function OnboardingReviewQueue() {
  const { user, loading, isAuthenticated } = useAuth();
  const canReview = useMemo(() => isAdminLike(user) || isModeratorLike(user), [user]);
  const [busy, setBusy] = useState(true);
  const [rows, setRows] = useState<ProfessionalOnboardingApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<number | null>(null);

  const loadRows = async () => {
    if (!isAuthenticated || !canReview) {
      setRows([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const response = await premiumApi.get<ProfessionalOnboardingApplication[]>("/admin/onboarding/applications", {
        params: {
          status: statusFilter,
          limit: 300,
        },
      });
      setRows(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      setRows([]);
      toast.error("Failed to load onboarding queue", { description: toError(error) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated, canReview, statusFilter]);

  const reviewApplication = async (applicationId: number, action: "approve" | "reject") => {
    setProcessingId(applicationId);
    try {
      await premiumApi.put(`/admin/onboarding/applications/${applicationId}/review`, {
        action,
        reviewer_note: toNullableRichText(noteById[String(applicationId)] || ""),
      });
      toast.success(action === "approve" ? "Application approved" : "Application rejected");
      setNoteById((prev) => ({ ...prev, [String(applicationId)]: "" }));
      await loadRows();
    } catch (error: unknown) {
      toast.error("Failed to review application", { description: toError(error) });
    } finally {
      setProcessingId(null);
    }
  };

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading onboarding queue...</div>;
  }

  if (!isAuthenticated) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Sign in required.</div>;
  }

  if (!canReview) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-900">Access restricted</h1>
        <p className="mt-2 text-sm text-amber-800">
          Only moderator/admin roles can review onboarding requests.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">Onboarding Review Queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review Quiz Master and Mains Mentor onboarding requests and approve or reject with note.
        </p>

        <div className="mt-3 inline-flex rounded-md border border-slate-300 p-1 text-xs">
          {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded px-2 py-1 ${statusFilter === status ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              {status}
            </button>
          ))}
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
          No onboarding requests found for current filter.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Request #{row.id} | {toDisplayRoleLabel(row.desired_role)} | {row.status}</p>
                  <p className="text-xs text-slate-500">
                    {row.full_name} ({row.email_snapshot || row.user_id}) | {new Date(row.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                <p><span className="font-semibold">City:</span> {row.city || "n/a"}</p>
                <p><span className="font-semibold">Experience:</span> {row.years_experience ?? "n/a"}</p>
                <p><span className="font-semibold">Phone:</span> {row.phone || "n/a"}</p>
              </div>
              {row.about ? (
                <RichTextContent value={row.about} className="mt-2 text-sm text-slate-700" />
              ) : (
                <p className="mt-2 text-sm text-slate-700">No additional details provided.</p>
              )}

              {row.status === "pending" ? (
                <div className="mt-3 space-y-2">
                  <RichTextField
                    label="Reviewer note"
                    value={noteById[String(row.id)] || ""}
                    onChange={(value) => setNoteById((prev) => ({ ...prev, [String(row.id)]: value }))}
                    placeholder="Leave guidance, missing requirements, or approval context for the applicant."
                    helperText="Visible to the applicant after review."
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={processingId === row.id}
                      onClick={() => void reviewApplication(row.id, "approve")}
                      className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={processingId === row.id}
                      onClick={() => void reviewApplication(row.id, "reject")}
                      className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  <p>Reviewed by: {row.reviewer_user_id || "n/a"}</p>
                  <p>Reviewed at: {row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : "n/a"}</p>
                  {row.reviewer_note ? (
                    <div className="mt-2">
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Note</p>
                      <RichTextContent value={row.reviewer_note} className="mt-1 text-xs text-slate-700 [&_p]:my-1" />
                    </div>
                  ) : null}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
