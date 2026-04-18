"use client";
/* eslint-disable @next/next/no-img-element */

import axios from "axios";
import Link from "next/link";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import RichTextContent from "@/components/ui/RichTextContent";
import type {
  ProfessionalOnboardingApplication,
  ProfessionalOnboardingApplicationPayload,
  ProfessionalOnboardingDraftPayload,
  ProfessionalOnboardingAsset,
  ProfessionalOnboardingDesiredRole,
  ProfessionalOnboardingDetails,
  QuizMasterSampleMcq,
} from "@/types/premium";

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

type RoleOption = {
  value: ProfessionalOnboardingDesiredRole;
  label: string;
  description: string;
  highlights: string[];
};

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "creator",
    label: "Prelims Expert (Quiz Master)",
    description: "Frame high-signal UPSC MCQs and create Prelims programs for serious aspirants.",
    highlights: [
      "Provision: Create and sell Prelims Programs & MCQs.",
      "Eligibility: Cleared UPSC Prelims (Roll Number required).",
      "Upload subject focus areas and a preparation strategy note.",
    ],
  },
  {
    value: "mentor",
    label: "Mains Expert (Mains Mentor)",
    description: "Provide active mentorship, evaluate subjective copies, and run Mains guidance programs.",
    highlights: [
      "Provision: Sell Mains Programs, Mentorship & Copy Evaluation.",
      "Eligibility: Cleared UPSC Mains or faced Interview (Marksheet required).",
      "Upload sample evaluations and an intro video for review.",
    ],
  },
];

const MENTOR_STEP_LABELS = ["Profile", "UPSC", "Domain", "Skills"];
const CREATOR_STEP_LABELS = ["Profile", "UPSC", "Domain"];
const GS_OPTIONS = ["GS1", "GS2", "GS3", "GS4", "Essay"];
const SUBJECT_FOCUS_OPTIONS = ["Polity", "Economy", "Geography", "Environment", "History", "Science & Tech", "Current Affairs"];
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};
const INPUT_CLASS = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400";
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[120px]`;

type EditableMcq = {
  question: string;
  options: string[];
  correct_option: "A" | "B" | "C" | "D";
  explanation: string;
};

type EditableDetails = Omit<ProfessionalOnboardingDetails, "sample_mcqs"> & {
  sample_mcqs: EditableMcq[];
};

type EditableForm = {
  full_name: string;
  city: string;
  years_experience: string;
  phone: string;
  about: string;
  details: EditableDetails;
};

function normalizeRole(value: string | null | undefined): ProfessionalOnboardingDesiredRole {
  return String(value || "").trim().toLowerCase() === "mentor" ? "mentor" : "creator";
}

function roleLabel(value: string | null | undefined): string {
  return toDisplayRoleLabel(value);
}

function createEmptyMcq(): EditableMcq {
  return {
    question: "",
    options: ["", "", "", ""],
    correct_option: "A",
    explanation: "",
  };
}

function createEmptyDetails(): EditableDetails {
  return {
    current_occupation: "",
    professional_headshot: null,
    upsc_roll_number: "",
    upsc_years: "",
    proof_documents: [],
    mains_written_count: null,
    interview_faced_count: null,
    prelims_cleared_count: null,
    highest_prelims_score: "",
    optional_subject: "",
    gs_preferences: [],
    mentorship_years: null,
    institute_associations: [],
    sample_evaluation: null,
    intro_video_url: "",
    subject_focus: [],
    content_experience: "",
    short_bio: "",
    preparation_strategy: "",
    sample_mcqs: Array.from({ length: 5 }, () => createEmptyMcq()),
  };
}

function getStepLabelsForRole(desiredRole: ProfessionalOnboardingDesiredRole): string[] {
  return desiredRole === "creator" ? CREATOR_STEP_LABELS : MENTOR_STEP_LABELS;
}

function buildFormFromApplication(
  application: ProfessionalOnboardingApplication | null,
  userEmail: string,
  desiredRole: ProfessionalOnboardingDesiredRole,
): EditableForm {
  const details = application?.details || createEmptyDetails();
  const sampleMcqs = (details.sample_mcqs || []).map((mcq): EditableMcq => ({
    question: String(mcq.question || ""),
    options: Array.isArray(mcq.options) ? [...mcq.options, "", "", "", ""].slice(0, 4).map((option) => String(option || "")) : ["", "", "", ""],
    correct_option: (mcq.correct_option === "B" || mcq.correct_option === "C" || mcq.correct_option === "D" ? mcq.correct_option : "A"),
    explanation: String(mcq.explanation || ""),
  }));
  while (sampleMcqs.length < 5) sampleMcqs.push(createEmptyMcq());

  return {
    full_name: String(application?.full_name || userEmail.split("@")[0] || "").trim(),
    city: String(application?.city || "").trim(),
    years_experience:
      application?.years_experience !== null && application?.years_experience !== undefined
        ? String(application.years_experience)
        : desiredRole === "mentor" && details.mentorship_years !== null && details.mentorship_years !== undefined
          ? String(details.mentorship_years)
          : "",
    phone: String(application?.phone || "").trim(),
    about: String(application?.about || "").trim(),
    details: {
      ...createEmptyDetails(),
      ...details,
      current_occupation: String(details.current_occupation || ""),
      upsc_roll_number: String(details.upsc_roll_number || ""),
      upsc_years: String(details.upsc_years || ""),
      highest_prelims_score: String(details.highest_prelims_score || ""),
      optional_subject: String(details.optional_subject || ""),
      intro_video_url: String(details.intro_video_url || ""),
      content_experience: String(details.content_experience || ""),
      short_bio: String(details.short_bio || ""),
      preparation_strategy: String(details.preparation_strategy || ""),
      proof_documents: Array.isArray(details.proof_documents) ? details.proof_documents : [],
      gs_preferences: Array.isArray(details.gs_preferences) ? details.gs_preferences : [],
      institute_associations: Array.isArray(details.institute_associations) ? details.institute_associations : [],
      subject_focus: Array.isArray(details.subject_focus) ? details.subject_focus : [],
      sample_mcqs: sampleMcqs,
    },
  };
}

function applicationStatusLabel(application: ProfessionalOnboardingApplication): string {
  const status = String(application.status || "").trim().toLowerCase();
  const requestedRole = roleLabel(String(application.desired_role || ""));
  if (status === "approved") return `${requestedRole} Access Active`;
  if (status === "pending") return "Under Review";
  if (status === "draft") return "Draft Saved";
  if (status === "rejected") return "Changes Required";
  return String(application.status || "unknown");
}

function applicationStatusHint(application: ProfessionalOnboardingApplication): string {
  const status = String(application.status || "").trim().toLowerCase();
  const requestedRole = roleLabel(String(application.desired_role || ""));
  if (status === "approved") {
    return `${requestedRole} access is approved. The profile has been synced and the role is now live on your account.`;
  }
  if (status === "pending") {
    return "Your application is waiting for moderator/admin review. You can still update and resubmit the same role request.";
  }
  if (status === "draft") {
    return "This draft is saved on your account. Complete the remaining steps and submit when you are ready for review.";
  }
  if (status === "rejected") {
    return "Review the moderator note, update the missing fields, and resubmit the same role.";
  }
  return "Status is being processed.";
}

function trimList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function uploadButtonLabel(uploadingKey: string | null, target: string, fallback: string): string {
  return uploadingKey === target ? "Uploading..." : fallback;
}

function getOnboardingStepValidationMessage(
  form: EditableForm,
  desiredRole: ProfessionalOnboardingDesiredRole,
  step: number,
): string | null {
  if (step === 0) {
    if (!form.full_name.trim()) return "Full name is required.";
    if (!form.about.trim()) return "Application summary / description is required.";
    return null;
  }
  // All other steps are optional
  return null;
}

function getCompletedOnboardingSteps(
  form: EditableForm,
  desiredRole: ProfessionalOnboardingDesiredRole,
): number[] {
  return getStepLabelsForRole(desiredRole).reduce<number[]>((output, _label, index) => {
    if (!getOnboardingStepValidationMessage(form, desiredRole, index)) output.push(index);
    return output;
  }, []);
}

function onboardingTimestamp(application: ProfessionalOnboardingApplication): string {
  return String(application.updated_at || application.created_at || "").trim();
}

export default function ProfessionalOnboardingEligibilityForm() {
  const searchParams = useSearchParams();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { profileId, loading: profileLoading } = useProfile();
  
  const loading = authLoading || profileLoading;
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [applications, setApplications] = useState<ProfessionalOnboardingApplication[]>([]);
  const [desiredRole, setDesiredRole] = useState<ProfessionalOnboardingDesiredRole>("creator");
  const [stepIndex, setStepIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditableForm>(() => buildFormFromApplication(null, "", "creator"));

  const userEmail = String(user?.email || "").trim();
  const roleConfig = useMemo(() => ROLE_OPTIONS.find((item) => item.value === desiredRole) || ROLE_OPTIONS[0], [desiredRole]);
  const selectedRoleApplication = useMemo(
    () => applications.find((application) => normalizeRole(String(application.desired_role || "")) === desiredRole) || null,
    [applications, desiredRole],
  );
  const roleApproved = String(selectedRoleApplication?.status || "").trim().toLowerCase() === "approved";
  const rolePending = String(selectedRoleApplication?.status || "").trim().toLowerCase() === "pending";
  const stepLabels = useMemo(() => getStepLabelsForRole(desiredRole), [desiredRole]);
  const completedSteps = useMemo(() => getCompletedOnboardingSteps(form, desiredRole), [form, desiredRole]);

  // Default to non-editing if we have a pending application
  useEffect(() => {
    if (!loading && selectedRoleApplication) {
      const status = String(selectedRoleApplication.status || "").toLowerCase();
      if (status === "pending" || status === "approved") {
        setIsEditing(false);
      } else {
        setIsEditing(true);
      }
    }
  }, [loading, selectedRoleApplication]);

  // Pre-select role from search params
  useEffect(() => {
    const roleParam = searchParams.get("role");
    if (roleParam === "mentor") {
      setDesiredRole("mentor");
    } else if (roleParam === "creator") {
      setDesiredRole("creator");
    }
  }, [searchParams]);


  const loadMyApplications = async () => {
    if (!isAuthenticated || !user?.id) {
      setApplications([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("creator_applications")
        .select("*")
        .eq("user_id", profileId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      const mapped = (data || []).map(row => ({
        id: row.id,
        user_id: String(row.user_id),
        desired_role: (row.applied_roles || [])[0] || "creator",
        full_name: row.full_name,
        about: row.bio || "",
        city: "",
        years_experience: row.experience ? parseInt(row.experience, 10) || null : null,
        phone: "",
        status: row.status,
        details: row.social_links as ProfessionalOnboardingDetails || createEmptyDetails(),
        reviewer_note: row.reviewer_note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        meta: {}
      })) as any[];
      
      setApplications(mapped);
    } catch (error: unknown) {
      setApplications([]);
      toast.error("Failed to load onboarding history", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    void loadMyApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated]);

  useEffect(() => {
    const nextForm = buildFormFromApplication(selectedRoleApplication, userEmail, desiredRole);
    setForm(nextForm);
    const nextCompletedSteps = getCompletedOnboardingSteps(nextForm, desiredRole);
    const nextStepLabels = getStepLabelsForRole(desiredRole);
    const firstIncompleteStep = nextStepLabels.findIndex((_label, index) => !nextCompletedSteps.includes(index));
    setStepIndex(firstIncompleteStep === -1 ? nextStepLabels.length - 1 : firstIncompleteStep);
  }, [selectedRoleApplication, userEmail, desiredRole]);

  const updateDetails = <K extends keyof EditableDetails>(key: K, value: EditableDetails[K]) => {
    setForm((current) => ({
      ...current,
      details: {
        ...current.details,
        [key]: value,
      },
    }));
  };

  const toggleStringListValue = (key: "gs_preferences" | "subject_focus", value: string) => {
    const currentValues = key === "gs_preferences" ? form.details.gs_preferences : form.details.subject_focus;
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    updateDetails(key, nextValues);
  };

  const uploadAsset = async (file: File, assetKind: "headshot" | "proof_document" | "sample_evaluation") => {
    const supabase = createClient();
    const ext = file.name.split('.').pop() || 'tmp';
    const filePath = `onboarding/${user?.id || 'anon'}_${Date.now()}_${assetKind}.${ext}`;
    
    const { data, error } = await supabase.storage.from("public_assets").upload(filePath, file);
    if (error) throw error;
    
    const { data: urlData } = supabase.storage.from("public_assets").getPublicUrl(filePath);
    return { url: urlData.publicUrl, path: filePath, file_name: file.name } as ProfessionalOnboardingAsset;
  };

  const handleHeadshotUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingKey("headshot");
    try {
      const asset = await uploadAsset(file, "headshot");
      updateDetails("professional_headshot", asset);
      toast.success("Headshot uploaded");
    } catch (error: unknown) {
      toast.error("Failed to upload headshot", { description: toError(error) });
    } finally {
      setUploadingKey(null);
    }
  };

  const handleProofUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;
    setUploadingKey("proofs");
    try {
      const uploaded = await Promise.all(files.map((file) => uploadAsset(file, "proof_document")));
      updateDetails("proof_documents", [...(form.details.proof_documents || []), ...uploaded]);
      toast.success("Proof documents uploaded");
    } catch (error: unknown) {
      toast.error("Failed to upload proof documents", { description: toError(error) });
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSampleEvaluationUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingKey("sample");
    try {
      const asset = await uploadAsset(file, "sample_evaluation");
      updateDetails("sample_evaluation", asset);
      toast.success("Sample copy uploaded");
    } catch (error: unknown) {
      toast.error("Failed to upload sample copy", { description: toError(error) });
    } finally {
      setUploadingKey(null);
    }
  };

  const validateStep = (step: number): string | null => {
    return getOnboardingStepValidationMessage(form, desiredRole, step);
  };

  const parseYearsExperience = (): number | null => {
    const trimmed = form.years_experience.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("Years of experience must be a valid non-negative number.");
    }
    return parsed;
  };

  const buildNormalizedDetails = (): ProfessionalOnboardingDetails => ({
    ...form.details,
    current_occupation: form.details.current_occupation?.trim() || null,
    upsc_roll_number: form.details.upsc_roll_number?.trim() || null,
    upsc_years: form.details.upsc_years?.trim() || null,
    highest_prelims_score: form.details.highest_prelims_score?.trim() || null,
    optional_subject: form.details.optional_subject?.trim() || null,
    intro_video_url: form.details.intro_video_url?.trim() || null,
    content_experience: form.details.content_experience?.trim() || null,
    short_bio: form.details.short_bio?.trim() || null,
    preparation_strategy: form.details.preparation_strategy?.trim() || null,
    institute_associations: trimList(form.details.institute_associations || []),
    gs_preferences: trimList(form.details.gs_preferences || []),
    subject_focus: trimList(form.details.subject_focus || []),
    sample_mcqs: form.details.sample_mcqs.map(
      (mcq): QuizMasterSampleMcq => ({
        question: mcq.question.trim(),
        options: mcq.options.map((option) => option.trim()),
        correct_option: mcq.correct_option,
        explanation: mcq.explanation.trim(),
      }),
    ),
  });

  const saveDraft = async () => {
    if (!isAuthenticated) {
      toast.error("Sign in is required.");
      return;
    }
    if (roleApproved) {
      toast.error("This role is already approved.");
      return;
    }
    if (rolePending) {
      toast.error("A pending request is already under review for this role.");
      return;
    }

    let parsedExperience: number | null;
    try {
      parsedExperience = parseYearsExperience();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Invalid years of experience value.");
      return;
    }

    if (!profileId) {
      toast.error("Profile context missing.");
      return;
    }

    setSavingDraft(true);
    try {
      const supabase = createClient();
      const normalizedDetails = buildNormalizedDetails();
      
      const payload = {
        user_id: profileId,
        applied_roles: [desiredRole],
        full_name: form.full_name.trim() || user?.email?.split("@")[0] || "Unknown",
        bio: form.about.trim() || null,
        experience: parsedExperience !== null ? String(parsedExperience) : null,
        social_links: normalizedDetails as any,
        status: "pending" // Saved drafts aren't fully supported in schema, so we keep status pending
      };

      const { error } = await supabase.from("creator_applications").insert(payload);
      if (error) throw error;

      toast.success("Draft saved", {
        description: completedSteps.length > 0 ? `${completedSteps.length} of ${stepLabels.length} steps are complete.` : "You can continue the form later.",
      });
      await loadMyApplications();
    } catch (error: unknown) {
      toast.error("Failed to save draft", { description: String(error) });
    } finally {
      setSavingDraft(false);
    }
  };

  const submitApplication = async () => {
    if (!isAuthenticated) {
      toast.error("Sign in is required.");
      return;
    }

    for (let index = 0; index < stepLabels.length; index += 1) {
      const reason = validateStep(index);
      if (reason) {
        setStepIndex(index);
        toast.error(reason);
        return;
      }
    }

    let parsedExperience: number | null;
    try {
      parsedExperience = parseYearsExperience();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Invalid years of experience value.");
      return;
    }

    if (!profileId) {
      toast.error("Profile context missing.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const normalizedDetails = buildNormalizedDetails();
      
      const payload = {
        user_id: profileId,
        applied_roles: [desiredRole],
        full_name: form.full_name.trim() || user?.email?.split("@")[0] || "Unknown",
        bio: form.about.trim() || null,
        experience: parsedExperience !== null ? String(parsedExperience) : null,
        social_links: normalizedDetails as any,
        status: "pending"
      };

      const { error } = await supabase.from("creator_applications").insert(payload);
      if (error) throw error;

      toast.success("Application submitted", {
        description: "Your role request is now waiting for moderator/admin approval.",
      });
      await loadMyApplications();
    } catch (error: unknown) {
      toast.error("Failed to submit application", { description: String(error) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading onboarding...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-900">Sign in required</h1>
        <p className="mt-2 text-sm text-amber-800">Submitting eligibility forms requires an authenticated account.</p>
        <Link href="/login" className="mt-4 inline-flex rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900">
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-20">
      {/* --- Premium Header Section --- */}
      <section className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm transition-all hover:shadow-md">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-50/50 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-indigo-50/30 blur-3xl" />
        
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-600">
            <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            Teacher Portal
          </div>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
            Join our <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Expert Network</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Share your expertise with thousands of serious UPSC aspirants. Apply for specialized mentoring or content creation roles.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            {ROLE_OPTIONS.map((option) => {
              const active = option.value === desiredRole;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setDesiredRole(option.value);
                    if (!selectedRoleApplication) setIsEditing(true);
                  }}
                  className={`relative flex min-w-[240px] flex-col rounded-2xl border p-5 transition-all duration-300 ${
                    active 
                      ? "border-blue-600 bg-slate-900 text-white shadow-xl shadow-blue-900/10 ring-4 ring-blue-50" 
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <p className={`text-xs font-bold uppercase tracking-widest ${active ? "text-blue-400" : "text-slate-500"}`}>
                    {option.value === "creator" ? "Prelims" : "Mains"}
                  </p>
                  <p className="mt-1 text-lg font-bold">{option.label}</p>
                  {active && (
                    <div className="mt-3 flex gap-1">
                      <div className="h-1 w-8 rounded-full bg-blue-500" />
                      <div className="h-1 w-2 rounded-full bg-blue-400/50" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* --- Application Flow Logic --- */}
      {selectedRoleApplication && !isEditing ? (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
            <div className={`h-2 w-full ${selectedRoleApplication.status === "approved" ? "bg-emerald-500" : selectedRoleApplication.status === "pending" ? "bg-amber-500" : "bg-rose-500"}`} />
            
            <div className="p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Application Status</p>
                  <h2 className="text-3xl font-black text-slate-900">
                    {applicationStatusLabel(selectedRoleApplication)}
                  </h2>
                </div>
                <button
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-900 transition hover:bg-slate-50 hover:shadow-sm"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  Edit Application
                </button>
              </div>

              <div className="mt-8 rounded-3xl bg-slate-50 p-6 md:p-8">
                <p className="text-lg font-medium leading-relaxed text-slate-700">
                  {applicationStatusHint(selectedRoleApplication)}
                </p>
                
                {selectedRoleApplication.reviewer_note && (
                  <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/30 p-5">
                    <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-600">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                      Moderator Note
                    </p>
                    <RichTextContent value={selectedRoleApplication.reviewer_note} className="mt-3 text-slate-700" />
                  </div>
                )}
              </div>

              <div className="mt-8 flex items-center gap-6 border-t border-slate-100 pt-8 text-sm text-slate-500">
                <div>
                  <p className="font-bold text-slate-900">Submitted On</p>
                  <p>{new Date(onboardingTimestamp(selectedRoleApplication)).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                <div>
                  <p className="font-bold text-slate-900">Reference ID</p>
                  <p>#{selectedRoleApplication.id}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
            {/* --- Stepper Header --- */}
            <div className="border-b border-slate-100 bg-slate-50/50 px-8 py-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Step {stepIndex + 1} of {stepLabels.length}</p>
                  <h3 className="text-xl font-bold text-slate-900">{stepLabels[stepIndex]} Details</h3>
                </div>
                
                <div className="hidden items-center gap-3 md:flex">
                  {stepLabels.map((_, idx) => (
                    <div 
                      key={idx}
                      className={`h-1.5 w-12 rounded-full transition-all duration-300 ${idx === stepIndex ? "bg-blue-600" : idx < stepIndex || completedSteps.includes(idx) ? "bg-emerald-400" : "bg-slate-200"}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="p-8">
              {/* --- Form Section --- */}
<div className="mt-5 grid gap-4 md:grid-cols-2">
          {stepIndex === 0 ? (
            <>
              <div>
                <label className="text-sm font-semibold text-slate-700">Full name <span className="text-rose-500">*</span></label>
                <input value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} className={INPUT_CLASS} placeholder="As per government ID" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Email (Verified)</label>
                <input value={userEmail} disabled className={`${INPUT_CLASS} bg-slate-50 text-slate-500`} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Application summary / Description <span className="text-rose-500">*</span></label>
                <textarea 
                  value={form.about} 
                  onChange={(event) => setForm((current) => ({ ...current, about: event.target.value }))} 
                  className={TEXTAREA_CLASS} 
                  placeholder="Describe your background, domain strength, mentoring or teaching experience, and why you are applying." 
                />
                <p className="mt-1 text-xs text-slate-500">This is the main narrative section moderators review. Please provide sufficient detail.</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Phone (optional)</label>
                <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={INPUT_CLASS} placeholder="+91 90000 00000" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">City / location (optional)</label>
                <input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} className={INPUT_CLASS} placeholder="City" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Current occupation (optional)</label>
                <input value={form.details.current_occupation || ""} onChange={(event) => updateDetails("current_occupation", event.target.value)} className={INPUT_CLASS} placeholder="Current role / occupation" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Years of experience (optional)</label>
                <input value={form.years_experience} onChange={(event) => setForm((current) => ({ ...current, years_experience: event.target.value }))} className={INPUT_CLASS} type="number" min={0} placeholder="Total mentoring/teaching years" />
              </div>
              <div className="md:col-span-2">
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-4">
                    {form.details.professional_headshot?.url ? (
                      <img src={form.details.professional_headshot.url} alt="Headshot preview" className="h-20 w-20 rounded-2xl object-cover" />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-xs text-slate-400">No image</div>
                    )}
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-900">Professional headshot (optional)</p>
                      <p className="text-xs text-slate-500">JPG, PNG, or WEBP. Becomes your profile photo after approval.</p>
                      <label className="inline-flex cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                        {uploadButtonLabel(uploadingKey, "headshot", "Upload headshot")}
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void handleHeadshotUpload(event)} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {stepIndex === 1 && desiredRole === "mentor" ? (
            <>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC Mains written (optional)</label>
                <input type="number" min={0} value={form.details.mains_written_count ?? ""} onChange={(event) => updateDetails("mains_written_count", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC interviews faced (optional)</label>
                <input type="number" min={0} value={form.details.interview_faced_count ?? ""} onChange={(event) => updateDetails("interview_faced_count", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC roll number (optional)</label>
                <input value={form.details.upsc_roll_number || ""} onChange={(event) => updateDetails("upsc_roll_number", event.target.value)} className={INPUT_CLASS} placeholder="Roll number used for verification" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Years / attempts (optional)</label>
                <input value={form.details.upsc_years || ""} onChange={(event) => updateDetails("upsc_years", event.target.value)} className={INPUT_CLASS} placeholder="Example: 2022, 2023, 2024" />
              </div>
            </>
          ) : null}

          {stepIndex === 1 && desiredRole === "creator" ? (
            <>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC Prelims cleared (optional)</label>
                <input type="number" min={0} value={form.details.prelims_cleared_count ?? ""} onChange={(event) => updateDetails("prelims_cleared_count", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Highest Prelims score (optional)</label>
                <input value={form.details.highest_prelims_score || ""} onChange={(event) => updateDetails("highest_prelims_score", event.target.value)} className={INPUT_CLASS} placeholder="Highest verified score" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC roll number (optional)</label>
                <input value={form.details.upsc_roll_number || ""} onChange={(event) => updateDetails("upsc_roll_number", event.target.value)} className={INPUT_CLASS} placeholder="Roll number used for verification" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Years / attempts (optional)</label>
                <input value={form.details.upsc_years || ""} onChange={(event) => updateDetails("upsc_years", event.target.value)} className={INPUT_CLASS} placeholder="Example: 2021, 2022, 2024" />
              </div>
            </>
          ) : null}

          {stepIndex === 1 ? (
            <div className="md:col-span-2">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="grow">
                    <p className="text-sm font-semibold text-slate-900">Official proof documents (optional)</p>
                    <p className="text-xs text-slate-500">Upload official marksheets or stage proofs used for moderator verification.</p>
                  </div>
                  <label className="inline-flex cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                    {uploadButtonLabel(uploadingKey, "proofs", "Add documents")}
                    <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => void handleProofUpload(event)} />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(form.details.proof_documents || []).map((asset, index) => (
                    <div key={`${asset.path}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
                      {asset.url ? <a href={asset.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{asset.file_name}</a> : <span className="font-semibold">{asset.file_name}</span>}
                      <button type="button" onClick={() => updateDetails("proof_documents", (form.details.proof_documents || []).filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-rose-600">Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {stepIndex === 2 && desiredRole === "mentor" ? (
            <>
              <div>
                <label className="text-sm font-bold text-slate-700">Optional subject (optional)</label>
                <input value={form.details.optional_subject || ""} onChange={(event) => updateDetails("optional_subject", event.target.value)} className={INPUT_CLASS} placeholder="Optional subject for evaluation" />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700">Mentorship years (optional)</label>
                <input type="number" min={0} value={form.details.mentorship_years ?? ""} onChange={(event) => updateDetails("mentorship_years", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="Total active mentoring years" />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-bold text-slate-700">GS preferences (optional)</label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {GS_OPTIONS.map((option) => {
                    const active = (form.details.gs_preferences || []).includes(option);
                    return (
                      <button 
                        key={option} 
                        type="button" 
                        onClick={() => toggleStringListValue("gs_preferences", option)} 
                        className={`rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
                          active 
                            ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-200" 
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Past institute associations (optional)</label>
                <textarea 
                  value={(form.details.institute_associations || []).join("\n")} 
                  onChange={(event) => updateDetails("institute_associations", event.target.value.split("\n"))} 
                  className={TEXTAREA_CLASS} 
                  placeholder="Example: Vision IAS, ForumIAS (One per line)" 
                />
              </div>
            </>
          ) : null}

          {stepIndex === 2 && desiredRole === "creator" ? (
            <>
              <div className="md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Subject focus (optional)</label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUBJECT_FOCUS_OPTIONS.map((option) => {
                    const active = (form.details.subject_focus || []).includes(option);
                    return (
                      <button 
                        key={option} 
                        type="button" 
                        onClick={() => toggleStringListValue("subject_focus", option)} 
                        className={`rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
                          active 
                            ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-200" 
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Content experience (optional)</label>
                <textarea value={form.details.content_experience || ""} onChange={(event) => updateDetails("content_experience", event.target.value)} className={TEXTAREA_CLASS} placeholder="Describe your experience in question framing or content writing." />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Public bio card (optional)</label>
                <textarea value={form.details.short_bio || ""} onChange={(event) => updateDetails("short_bio", event.target.value)} className={TEXTAREA_CLASS} placeholder="A short bio that learners see on your programs." />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-bold text-slate-700">Preparation strategy (optional)</label>
                <textarea value={form.details.preparation_strategy || ""} onChange={(event) => updateDetails("preparation_strategy", event.target.value)} className={TEXTAREA_CLASS} placeholder="Explain your approach to UPSC preparation." />
              </div>
            </>
          ) : null}

              {/* --- Step 3 (Mains Mentor Only) --- */}
              {stepIndex === 3 && desiredRole === "mentor" ? (
                <>
                  <div className="md:col-span-2">
                    <div className="rounded-[32px] border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <h4 className="text-lg font-bold text-slate-900">Sample evaluated Mains copy (optional)</h4>
                      <p className="mt-1 text-sm text-slate-500">Upload one evaluated copy that shows the quality of your feedback.</p>
                      
                      <div className="mt-6 flex flex-col items-center gap-4">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-slate-900 px-8 py-3 text-sm font-black text-white shadow-lg transition hover:bg-black hover:scale-[1.02] active:scale-95">
                          {uploadButtonLabel(uploadingKey, "sample", "Select PDF File")}
                          <input type="file" accept="application/pdf" className="hidden" onChange={(event) => void handleSampleEvaluationUpload(event)} />
                        </label>
                        
                        {form.details.sample_evaluation && (
                          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 pr-4 shadow-sm">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-600">
                              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18V4c0-1.1.9-2 2-2h5l5 5v11c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2z" /></svg>
                            </div>
                            <span className="text-sm font-bold text-slate-700">{form.details.sample_evaluation.file_name}</span>
                            <button type="button" onClick={() => updateDetails("sample_evaluation", null)} className="ml-2 text-slate-400 hover:text-rose-600">
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-bold text-slate-700">Introduction video link (optional)</label>
                    <input value={form.details.intro_video_url || ""} onChange={(event) => updateDetails("intro_video_url", event.target.value)} className={INPUT_CLASS} placeholder="YouTube or Drive link" />
                  </div>
                </>
              ) : null}

              {/* --- Step Navigation Footer --- */}
              <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-8 md:col-span-2">
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={stepIndex === 0}
                    onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={savingDraft || submitting || roleApproved || rolePending}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    {savingDraft ? "Saving..." : "Save Progress"}
                  </button>
                </div>
                
                {stepIndex < stepLabels.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStepIndex((current) => Math.min(stepLabels.length - 1, current + 1))}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl bg-blue-600 px-8 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 hover:shadow-xl active:scale-95"
                  >
                    Next Step
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={submitting || roleApproved}
                    onClick={() => void submitApplication()}
                    className="inline-flex h-12 items-center gap-2 rounded-2xl bg-slate-900 px-10 text-sm font-black text-white shadow-xl transition hover:bg-black hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {submitting ? "Submitting..." : "Complete Application"}
                  </button>
                )}
              </div>
            </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
