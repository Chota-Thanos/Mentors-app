"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { isAdminLike, isModeratorLike } from "@/lib/accessControl";
import { createClient } from "@/lib/supabase/client";
import { toNullableRichText } from "@/lib/richText";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import RichTextContent from "@/components/ui/RichTextContent";
import RichTextField from "@/components/ui/RichTextField";
import type {
  ProfessionalOnboardingApplication,
  ProfessionalOnboardingAsset,
  ProfessionalOnboardingDetails,
  ProfessionalOnboardingStatus,
  QuizMasterSampleMcq,
} from "@/types/premium";

type StatusFilter = ProfessionalOnboardingStatus | "all";

function AssetChips({ assets }: { assets: ProfessionalOnboardingAsset[] }) {
  if (!assets.length) return <p className="text-xs text-slate-500">No files attached.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset) => (
        <a
          key={`${asset.bucket}/${asset.path}`}
          href={asset.url || undefined}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300"
        >
          {asset.file_name}
        </a>
      ))}
    </div>
  );
}

function McqPreview({ mcq, index }: { mcq: QuizMasterSampleMcq; index: number }) {
  if (!mcq.question && !(mcq.options || []).length && !mcq.explanation) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MCQ {index + 1}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{mcq.question || "No question provided."}</p>
      <div className="mt-2 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
        {(mcq.options || []).map((option, optionIndex) => (
          <p key={`${mcq.question}-${optionIndex}`}>
            <span className="font-semibold">{String.fromCharCode(65 + optionIndex)}.</span> {option}
          </p>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-600"><span className="font-semibold">Correct:</span> {mcq.correct_option || "n/a"}</p>
      <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">Explanation:</span> {mcq.explanation || "n/a"}</p>
    </div>
  );
}

function ApplicationDetails({ row }: { row: ProfessionalOnboardingApplication }) {
  const details = row.details as ProfessionalOnboardingDetails;
  const role = String(row.desired_role || "").trim().toLowerCase();
  const headshot = details.professional_headshot || null;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basic Profile</p>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {headshot?.url ? <img src={headshot.url} alt={`${row.full_name} headshot`} className="h-36 w-full rounded-2xl object-cover" /> : <div className="flex h-36 items-center justify-center rounded-2xl bg-white text-xs text-slate-400">No headshot</div>}
          <p><span className="font-semibold">Name:</span> {row.full_name}</p>
          <p><span className="font-semibold">Email:</span> {row.email_snapshot || row.user_id}</p>
          <p><span className="font-semibold">Phone:</span> {row.phone_link ? <a href={row.phone_link} className="text-slate-900 underline">{row.phone}</a> : row.phone || "n/a"}</p>
          <p><span className="font-semibold">City:</span> {row.city || "n/a"}</p>
          <p><span className="font-semibold">Occupation:</span> {details.current_occupation || "n/a"}</p>
          <p><span className="font-semibold">Experience:</span> {row.years_experience ?? "n/a"}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">UPSC Credentials</p>
          <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
            <p><span className="font-semibold">Roll number:</span> {details.upsc_roll_number || "n/a"}</p>
            <p><span className="font-semibold">Years:</span> {details.upsc_years || "n/a"}</p>
            {role === "mentor" ? (
              <>
                <p><span className="font-semibold">Mains written:</span> {details.mains_written_count ?? "n/a"}</p>
                <p><span className="font-semibold">Interviews faced:</span> {details.interview_faced_count ?? "n/a"}</p>
              </>
            ) : (
              <>
                <p><span className="font-semibold">Prelims cleared:</span> {details.prelims_cleared_count ?? "n/a"}</p>
                <p><span className="font-semibold">Highest score:</span> {details.highest_prelims_score || "n/a"}</p>
              </>
            )}
          </div>
          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Proof Documents</p>
            <AssetChips assets={details.proof_documents || []} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domain Expertise</p>
          {role === "mentor" ? (
            <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              <p><span className="font-semibold">Optional subject:</span> {details.optional_subject || "n/a"}</p>
              <p><span className="font-semibold">Mentorship years:</span> {details.mentorship_years ?? "n/a"}</p>
              <p className="md:col-span-2"><span className="font-semibold">GS preferences:</span> {(details.gs_preferences || []).join(", ") || "n/a"}</p>
              <p className="md:col-span-2"><span className="font-semibold">Institutes:</span> {(details.institute_associations || []).join(", ") || "n/a"}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p><span className="font-semibold">Subject focus:</span> {(details.subject_focus || []).join(", ") || "n/a"}</p>
              <p><span className="font-semibold">Content experience:</span> {details.content_experience || "n/a"}</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skill Assessment</p>
          {role === "mentor" ? (
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p><span className="font-semibold">Intro video:</span> {details.intro_video_url ? <a href={details.intro_video_url} target="_blank" rel="noreferrer" className="underline">{details.intro_video_url}</a> : "n/a"}</p>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sample Evaluation</p>
                <AssetChips assets={details.sample_evaluation ? [details.sample_evaluation] : []} />
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {(details.sample_mcqs || []).map((mcq, index) => (
                <McqPreview key={`${row.id}-mcq-${index}`} mcq={mcq} index={index} />
              ))}
            </div>
          )}
        </div>

        {row.about ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applicant Note</p>
            <RichTextContent value={row.about} className="mt-2 text-sm text-slate-700" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function OnboardingReviewQueue() {
  const { user, loading, isAuthenticated } = useAuth();
  const { profileId } = useProfile();
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
      const supabase = createClient();
      // Explicit join to resolve ambiguity between user_id and reviewed_by foreign keys
      let query = supabase.from("creator_applications").select("*, profiles:profiles!creator_applications_user_id_fkey(*)");
      
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      
      const { data, error } = await query.order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      
      const mapped = (data || []).map(row => {
        const user = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
          id: row.id,
          user_id: String(row.user_id),
          desired_role: (row.applied_roles || [])[0] || "creator",
          full_name: row.full_name,
          about: row.bio || "",
          city: "",
          years_experience: row.experience ? parseInt(row.experience, 10) || null : null,
          phone: "",
          status: row.status,
          details: row.social_links as any || { proof_documents: [], gs_preferences: [], institute_associations: [], subject_focus: [], sample_mcqs: [] },
          reviewer_note: row.reviewer_note,
          created_at: row.created_at,
          updated_at: row.updated_at,
          email_snapshot: user?.email || "",
          meta: {}
        };
      }) as any[];
      
      setRows(mapped);
    } catch (error: any) {
      console.error("Onboarding queue fetch error:", error);
      setRows([]);
      const msg = error?.message || String(error);
      toast.error("Failed to load onboarding queue", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated, canReview, statusFilter]);

  const reviewApplication = async (applicationId: number, action: "approve" | "reject" | "request_changes") => {
    if (!isAuthenticated || !profileId) return;
    setProcessingId(applicationId);
    try {
      const supabase = createClient();
      if (action === "approve") {
        const { data: rpcData, error: rpcError } = await supabase.rpc("approve_expert_application", {
          target_app_id: applicationId,
          target_reviewer_note: noteById[String(applicationId)] || ""
        });

        if (rpcError) {
          console.error("Expert approval RPC failed:", rpcError);
          toast.error(`Approval failed: ${rpcError.message}`);
          return;
        }

        toast.success(`Application approved! User role upgraded to ${rpcData?.new_role || "expert"}.`);
      } else {
        // Standard updates for rejection or change requests
        const finalStatus = action === "request_changes" ? "rejected" : "rejected"; // request_changes logic remains same for now
        const { error } = await supabase.from("creator_applications").update({
          status: action === "request_changes" ? "pending" : "rejected", // Adjust based on flow
          reviewer_note: toNullableRichText(noteById[String(applicationId)] || ""),
          reviewed_by: profileId,
          reviewed_at: new Date().toISOString()
        }).eq("id", applicationId);

        if (error) throw error;
        toast.success(action === "request_changes" ? "Changes requested" : "Application rejected");
      }

      toast.success(
        action === "approve"
          ? "Application approved"
          : action === "request_changes"
            ? "Changes requested from applicant"
            : "Application rejected",
      );
      setNoteById((prev) => ({ ...prev, [String(applicationId)]: "" }));
      await loadRows();
    } catch (error: unknown) {
      toast.error("Failed to review application", { description: String(error) });
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
              <ApplicationDetails row={row} />

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
                      onClick={() => void reviewApplication(row.id, "request_changes")}
                      className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-60"
                    >
                      Request Info
                    </button>
                    <button
                      type="button"
                      disabled={processingId === row.id}
                      onClick={() => void reviewApplication(row.id, "reject")}
                      className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                    >
                      Hard Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  <p>Reviewed by: {row.reviewer_user_id || "n/a"}</p>
                  <p>Reviewed at: {row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : "n/a"}</p>
                  {row.status === "approved" && (
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <button
                        type="button"
                        disabled={processingId === row.id}
                        onClick={() => void reviewApplication(row.id, "approve")}
                        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        {processingId === row.id ? "Syncing..." : "Sync Profile Role"}
                      </button>
                    </div>
                  )}
                  {row.reviewer_note ? (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="font-semibold uppercase tracking-wide text-slate-500 text-[10px]">Note</p>
                      <RichTextContent value={row.reviewer_note} className="mt-1 text-xs text-slate-700" />
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
