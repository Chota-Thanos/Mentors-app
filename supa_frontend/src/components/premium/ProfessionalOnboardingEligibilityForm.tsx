"use client";
/* eslint-disable @next/next/no-img-element */

import axios from "axios";
import Link from "next/link";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
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

type RoleOption = {
  value: ProfessionalOnboardingDesiredRole;
  label: string;
  description: string;
  highlights: string[];
};

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "creator",
    label: "Quiz Master",
    description: "Prelims-focused content creators who can frame high-signal UPSC MCQs and programs.",
    highlights: [
      "Submit verified Prelims credentials and proof documents.",
      "Share subject focus areas, prior content experience, and a short public bio.",
      "Add a preparation strategy note that learners can read on your profile.",
    ],
  },
  {
    value: "mentor",
    label: "Mains Mentor",
    description: "Answer-writing evaluators who can review subjective copies and guide learners through Mains.",
    highlights: [
      "Submit verified Mains or interview credentials with marksheets.",
      "Add optional or GS expertise plus mentoring background.",
      "Upload a sample evaluation and intro video for review.",
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

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

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
    if (!form.phone.trim()) return "Active phone number is required.";
    if (!form.details.current_occupation?.trim()) return "Current occupation is required.";
    if (!form.details.professional_headshot) return "Upload a professional headshot before continuing.";
    return null;
  }
  if (step === 1) {
    if (!form.details.upsc_roll_number?.trim()) return "UPSC roll number is required.";
    if (!form.details.upsc_years?.trim()) return "UPSC year details are required.";
    if ((form.details.proof_documents || []).length === 0) return "Upload at least one official proof document.";
    if (desiredRole === "mentor") {
      if (form.details.mains_written_count === null || form.details.mains_written_count === undefined) return "Add the number of UPSC Mains written.";
      if (form.details.interview_faced_count === null || form.details.interview_faced_count === undefined) return "Add the number of UPSC interviews faced.";
    } else {
      if (form.details.prelims_cleared_count === null || form.details.prelims_cleared_count === undefined) return "Add the number of UPSC Prelims cleared.";
      if (!form.details.highest_prelims_score?.trim()) return "Highest Prelims score is required.";
    }
    return null;
  }
  if (step === 2) {
    if (desiredRole === "mentor") {
      if (!form.details.optional_subject?.trim() && (form.details.gs_preferences || []).length === 0) return "Add optional subject or at least one GS preference.";
      if (form.details.mentorship_years === null || form.details.mentorship_years === undefined) return "Mentorship years are required.";
    } else {
      if ((form.details.subject_focus || []).length === 0) return "Select at least one subject focus.";
      if (!form.details.content_experience?.trim()) return "Content experience is required.";
    }
    return null;
  }
  if (desiredRole === "mentor") {
    if (!form.details.sample_evaluation) return "Upload a sample evaluated Mains copy.";
    if (!form.details.intro_video_url?.trim()) return "Introduction video link is required.";
    return null;
  }
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
  const { user, isAuthenticated, loading } = useAuth();
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [applications, setApplications] = useState<ProfessionalOnboardingApplication[]>([]);
  const [desiredRole, setDesiredRole] = useState<ProfessionalOnboardingDesiredRole>("creator");
  const [stepIndex, setStepIndex] = useState(0);
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

  const loadMyApplications = async () => {
    if (!isAuthenticated) {
      setApplications([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const response = await premiumApi.get<ProfessionalOnboardingApplication[]>("/onboarding/applications/me");
      setApplications(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      setApplications([]);
      toast.error("Failed to load onboarding history", { description: toError(error) });
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
    const formData = new FormData();
    formData.append("asset_kind", assetKind);
    formData.append("file", file);
    const response = await premiumApi.post<ProfessionalOnboardingAsset>("/onboarding/assets/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return response.data;
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

    const payload: ProfessionalOnboardingDraftPayload = {
      desired_role: desiredRole,
      full_name: form.full_name.trim() || null,
      city: form.city.trim() || null,
      years_experience: parsedExperience,
      phone: form.phone.trim() || null,
      about: form.about.trim() || null,
      details: buildNormalizedDetails(),
    };

    setSavingDraft(true);
    try {
      await premiumApi.post("/onboarding/applications/draft", payload);
      toast.success("Draft saved", {
        description: completedSteps.length > 0 ? `${completedSteps.length} of ${stepLabels.length} steps are complete.` : "You can continue the form later.",
      });
      await loadMyApplications();
    } catch (error: unknown) {
      toast.error("Failed to save draft", { description: toError(error) });
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

    const payload: ProfessionalOnboardingApplicationPayload = {
      desired_role: desiredRole,
      full_name: form.full_name.trim(),
      city: form.city.trim() || null,
      years_experience: parsedExperience,
      phone: form.phone.trim(),
      about: form.about.trim() || null,
      details: buildNormalizedDetails(),
    };

    setSubmitting(true);
    try {
      await premiumApi.post("/onboarding/applications", payload);
      toast.success("Application submitted", {
        description: "Your role request is now waiting for moderator/admin approval.",
      });
      await loadMyApplications();
    } catch (error: unknown) {
      toast.error("Failed to submit application", { description: toError(error) });
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
    <div className="space-y-5">
      <section className="rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_#dbeafe,_transparent_28%),linear-gradient(135deg,#ffffff,#f8fafc)] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Application Portal</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Quiz Master / Mains Mentor Eligibility</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Fill the role-specific steps, upload the required proofs, and submit once. A moderator or admin will review the request and activate the role after approval.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {ROLE_OPTIONS.map((option) => {
            const active = option.value === desiredRole;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setDesiredRole(option.value)}
                aria-pressed={active}
                className={`rounded-2xl border px-4 py-3 text-left transition ${active ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold">{option.label}</p>
                  {active ? (
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                      Selected
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selectedRoleApplication ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Latest {roleConfig.label} Request</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[String(selectedRoleApplication.status).toLowerCase()] || "bg-slate-100 text-slate-700"}`}>
              {applicationStatusLabel(selectedRoleApplication)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {String(selectedRoleApplication.status || "").trim().toLowerCase() === "draft" ? "Saved" : "Submitted"}: {new Date(onboardingTimestamp(selectedRoleApplication)).toLocaleString()} | Requested role: {roleLabel(selectedRoleApplication.desired_role)}
          </p>
          <p className="mt-1 text-sm text-slate-600">{applicationStatusHint(selectedRoleApplication)}</p>
          {selectedRoleApplication.reviewer_note ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reviewer note</p>
              <RichTextContent value={selectedRoleApplication.reviewer_note} className="mt-2 text-sm text-slate-700 [&_p]:my-1" />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[28px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Step {stepIndex + 1} of {stepLabels.length}</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">
              {roleConfig.label}: {stepLabels[stepIndex]}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {stepLabels.map((label, index) => {
              const active = index === stepIndex;
              const done = completedSteps.includes(index);
              return (
                <button key={label} type="button" onClick={() => setStepIndex(index)} className="flex flex-col items-center gap-1">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-100 text-emerald-700" : active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {index + 1}
                  </span>
                  <span className={`text-[11px] font-medium ${active ? "text-slate-900" : "text-slate-500"}`}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Selected track</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-900">{roleConfig.label}</h3>
          <p className="mt-1 text-sm text-slate-600">{roleConfig.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {roleConfig.highlights.map((item) => (
              <span key={item} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {stepIndex === 0 ? (
            <>
              <div>
                <label className="text-sm font-semibold text-slate-700">Full name</label>
                <input value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} className={INPUT_CLASS} placeholder="As per government ID" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Email</label>
                <input value={userEmail} disabled className={`${INPUT_CLASS} bg-slate-50 text-slate-500`} />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Active phone number</label>
                <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className={INPUT_CLASS} placeholder="+91 90000 00000" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">City / location</label>
                <input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} className={INPUT_CLASS} placeholder="City" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Current occupation</label>
                <input value={form.details.current_occupation || ""} onChange={(event) => updateDetails("current_occupation", event.target.value)} className={INPUT_CLASS} placeholder="Current role / occupation" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Years of experience</label>
                <input value={form.years_experience} onChange={(event) => setForm((current) => ({ ...current, years_experience: event.target.value }))} className={INPUT_CLASS} type="number" min={0} placeholder="Optional general experience" />
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
                      <p className="text-sm font-semibold text-slate-900">Professional headshot</p>
                      <p className="text-xs text-slate-500">JPG, PNG, or WEBP. This image later becomes the public profile photo after approval.</p>
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
                <label className="text-sm font-semibold text-slate-700">UPSC Mains written</label>
                <input type="number" min={0} value={form.details.mains_written_count ?? ""} onChange={(event) => updateDetails("mains_written_count", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC interviews faced</label>
                <input type="number" min={0} value={form.details.interview_faced_count ?? ""} onChange={(event) => updateDetails("interview_faced_count", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC roll number</label>
                <input value={form.details.upsc_roll_number || ""} onChange={(event) => updateDetails("upsc_roll_number", event.target.value)} className={INPUT_CLASS} placeholder="Roll number used for verification" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Years / attempts</label>
                <input value={form.details.upsc_years || ""} onChange={(event) => updateDetails("upsc_years", event.target.value)} className={INPUT_CLASS} placeholder="Example: 2022, 2023, 2024" />
              </div>
            </>
          ) : null}

          {stepIndex === 1 && desiredRole === "creator" ? (
            <>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC Prelims cleared</label>
                <input type="number" min={0} value={form.details.prelims_cleared_count ?? ""} onChange={(event) => updateDetails("prelims_cleared_count", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Highest Prelims score</label>
                <input value={form.details.highest_prelims_score || ""} onChange={(event) => updateDetails("highest_prelims_score", event.target.value)} className={INPUT_CLASS} placeholder="Highest verified score" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">UPSC roll number</label>
                <input value={form.details.upsc_roll_number || ""} onChange={(event) => updateDetails("upsc_roll_number", event.target.value)} className={INPUT_CLASS} placeholder="Roll number used for verification" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Years / attempts</label>
                <input value={form.details.upsc_years || ""} onChange={(event) => updateDetails("upsc_years", event.target.value)} className={INPUT_CLASS} placeholder="Example: 2021, 2022, 2024" />
              </div>
            </>
          ) : null}

          {stepIndex === 1 ? (
            <div className="md:col-span-2">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="grow">
                    <p className="text-sm font-semibold text-slate-900">Official proof documents</p>
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
                <label className="text-sm font-semibold text-slate-700">Optional subject</label>
                <input value={form.details.optional_subject || ""} onChange={(event) => updateDetails("optional_subject", event.target.value)} className={INPUT_CLASS} placeholder="Optional subject you can evaluate" />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Mentorship years</label>
                <input type="number" min={0} value={form.details.mentorship_years ?? ""} onChange={(event) => updateDetails("mentorship_years", event.target.value === "" ? null : Number(event.target.value))} className={INPUT_CLASS} placeholder="Years spent teaching / mentoring" />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">GS preferences</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GS_OPTIONS.map((option) => {
                    const active = (form.details.gs_preferences || []).includes(option);
                    return (
                      <button key={option} type="button" onClick={() => toggleStringListValue("gs_preferences", option)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Past institute associations</label>
                <textarea value={(form.details.institute_associations || []).join("\n")} onChange={(event) => updateDetails("institute_associations", event.target.value.split("\n"))} className={TEXTAREA_CLASS} placeholder="One institute / mentorship association per line" />
              </div>
            </>
          ) : null}

          {stepIndex === 2 && desiredRole === "creator" ? (
            <>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Subject focus</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SUBJECT_FOCUS_OPTIONS.map((option) => {
                    const active = (form.details.subject_focus || []).includes(option);
                    return (
                      <button key={option} type="button" onClick={() => toggleStringListValue("subject_focus", option)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Content experience</label>
                <textarea value={form.details.content_experience || ""} onChange={(event) => updateDetails("content_experience", event.target.value)} className={TEXTAREA_CLASS} placeholder="Mention previous EdTech/test-series/content-writing work and the depth of your Prelims coverage." />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Short bio</label>
                <textarea value={form.details.short_bio || ""} onChange={(event) => updateDetails("short_bio", event.target.value)} className={TEXTAREA_CLASS} placeholder="Write a short public bio that can appear on your program cards." />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Preparation strategy</label>
                <textarea value={form.details.preparation_strategy || ""} onChange={(event) => updateDetails("preparation_strategy", event.target.value)} className={TEXTAREA_CLASS} placeholder="Add a longer preparation strategy note for learners. This can explain your approach, source discipline, revision method, and scoring framework." />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Additional note for reviewers</label>
                <textarea value={form.about} onChange={(event) => setForm((current) => ({ ...current, about: event.target.value }))} className={TEXTAREA_CLASS} placeholder="Optional note on your question-setting approach, availability, or editorial standards." />
              </div>
            </>
          ) : null}

          {stepIndex === 3 && desiredRole === "mentor" ? (
            <>
              <div className="md:col-span-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="grow">
                    <p className="text-sm font-semibold text-slate-900">Sample evaluated Mains copy</p>
                    <p className="text-xs text-slate-500">Upload one evaluated copy that shows the quality of your annotations and feedback.</p>
                  </div>
                  <label className="inline-flex cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                    {uploadButtonLabel(uploadingKey, "sample", "Upload sample copy")}
                    <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void handleSampleEvaluationUpload(event)} />
                  </label>
                </div>
                {form.details.sample_evaluation ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
                    {form.details.sample_evaluation.url ? <a href={form.details.sample_evaluation.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{form.details.sample_evaluation.file_name}</a> : <span className="font-semibold">{form.details.sample_evaluation.file_name}</span>}
                    <button type="button" onClick={() => updateDetails("sample_evaluation", null)} className="text-slate-400 hover:text-rose-600">Remove</button>
                  </div>
                ) : null}
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Introduction video link</label>
                <input value={form.details.intro_video_url || ""} onChange={(event) => updateDetails("intro_video_url", event.target.value)} className={INPUT_CLASS} placeholder="Short video URL explaining your evaluation approach" />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">Additional note for reviewers</label>
                <textarea value={form.about} onChange={(event) => setForm((current) => ({ ...current, about: event.target.value }))} className={TEXTAREA_CLASS} placeholder="Anything the moderator should know about your mentoring style, schedule, or review standards." />
              </div>
            </>
          ) : null}

        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="text-xs text-slate-500">
            Step {stepIndex + 1} of {stepLabels.length}. Completed: {completedSteps.length}/{stepLabels.length}.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={stepIndex === 0}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={savingDraft || submitting || roleApproved || rolePending}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              {rolePending ? "Pending under review" : savingDraft ? "Saving draft..." : selectedRoleApplication?.status === "draft" ? "Update draft" : "Save draft"}
            </button>
            {stepIndex < stepLabels.length - 1 ? (
              <button
                type="button"
                onClick={() => setStepIndex((current) => Math.min(stepLabels.length - 1, current + 1))}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Next step
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting || roleApproved}
                onClick={() => void submitApplication()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {roleApproved
                  ? `${roleConfig.label} already approved`
                  : submitting
                    ? "Submitting..."
                    : selectedRoleApplication?.status === "pending"
                      ? "Update pending request"
                      : selectedRoleApplication?.status === "rejected"
                        ? "Resubmit for review"
                        : "Submit for review"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
