"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import RichTextContent from "@/components/ui/RichTextContent";
import RichTextField from "@/components/ui/RichTextField";
import type {
  ProfessionalOnboardingApplication,
  ProfessionalOnboardingApplicationPayload,
  ProfessionalOnboardingDesiredRole,
} from "@/types/premium";

const ROLE_OPTIONS: Array<{ value: ProfessionalOnboardingDesiredRole; label: string; hint: string }> = [
  {
    value: "creator",
    label: "Quiz Master",
    hint: "Create and publish Prelims tests and Prelims programs after approval.",
  },
  {
    value: "mentor",
    label: "Mains Mentor",
    hint: "Create Mains programs and run mentorship workflows after approval.",
  },
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function roleLabel(value: string): string {
  return toDisplayRoleLabel(value);
}

function applicationStatusLabel(application: ProfessionalOnboardingApplication): string {
  const status = String(application.status || "").trim().toLowerCase();
  const requestedRole = roleLabel(String(application.desired_role || ""));
  if (status === "approved") return `${requestedRole} Access Active`;
  if (status === "pending") return "Under Review";
  if (status === "rejected") return "Changes Required";
  return String(application.status || "unknown");
}

function applicationStatusHint(application: ProfessionalOnboardingApplication): string {
  const status = String(application.status || "").trim().toLowerCase();
  const requestedRole = roleLabel(String(application.desired_role || ""));
  if (status === "approved") {
    return `${requestedRole} access is approved. Use Dashboard and Professional Profile to manage your workflows.`;
  }
  if (status === "pending") {
    return "Your onboarding request is in moderation review.";
  }
  if (status === "rejected") {
    return "Update details and resubmit for approval.";
  }
  return "Status is being processed.";
}

export default function ProfessionalOnboardingForm() {
  const { user, isAuthenticated, loading } = useAuth();
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [applications, setApplications] = useState<ProfessionalOnboardingApplication[]>([]);

  const [desiredRole, setDesiredRole] = useState<ProfessionalOnboardingDesiredRole>("creator");
  const [fullName, setFullName] = useState("");
  const [city, setCity] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [phone, setPhone] = useState("");
  const [about, setAbout] = useState("");

  const latestApplication = useMemo(
    () => (applications.length > 0 ? applications[0] : null),
    [applications],
  );

  const loadMyApplications = async () => {
    if (!isAuthenticated) {
      setApplications([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const response = await premiumApi.get<ProfessionalOnboardingApplication[]>("/onboarding/applications/me");
      const rows = Array.isArray(response.data) ? response.data : [];
      setApplications(rows);
      if (rows.length > 0) {
        const latest = rows[0];
        if (!fullName.trim()) setFullName(latest.full_name || String(user?.email || "").split("@")[0] || "");
        if (!city.trim()) setCity(latest.city || "");
        if (!yearsExperience.trim()) {
          setYearsExperience(latest.years_experience !== null && latest.years_experience !== undefined ? String(latest.years_experience) : "");
        }
        if (!phone.trim()) setPhone(latest.phone || "");
        if (!about.trim()) setAbout(latest.about || "");
        const nextRole = String(latest.desired_role || "").toLowerCase();
        if (nextRole === "mentor" || nextRole === "creator") {
          setDesiredRole(nextRole);
        }
      } else if (!fullName.trim()) {
        setFullName(String(user?.email || "").split("@")[0] || "");
      }
    } catch (error: unknown) {
      toast.error("Failed to load onboarding history", { description: toError(error) });
      setApplications([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    void loadMyApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated]);

  const submitApplication = async () => {
    if (!isAuthenticated) {
      toast.error("Sign in is required.");
      return;
    }
    const safeName = fullName.trim();
    if (!safeName) {
      toast.error("Full name is required.");
      return;
    }
    const parsedExperience = yearsExperience.trim() ? Number(yearsExperience.trim()) : null;
    if (parsedExperience !== null && (!Number.isFinite(parsedExperience) || parsedExperience < 0)) {
      toast.error("Years of experience must be a valid non-negative number.");
      return;
    }

    const payload: ProfessionalOnboardingApplicationPayload = {
      desired_role: desiredRole,
      full_name: safeName,
      city: city.trim() || null,
      years_experience: parsedExperience,
      phone: phone.trim(),
      about: toNullableRichText(about),
      details: {
        proof_documents: [],
        gs_preferences: [],
        institute_associations: [],
        subject_focus: [],
        sample_mcqs: [],
      },
    };

    setSubmitting(true);
    try {
      await premiumApi.post("/onboarding/applications", payload);
      toast.success("Onboarding form submitted", {
        description: "Your request is now visible to moderators/admin for review.",
      });
      await loadMyApplications();
    } catch (error: unknown) {
      toast.error("Failed to submit onboarding form", { description: toError(error) });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading onboarding...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-900">Sign in required</h1>
        <p className="mt-2 text-sm text-amber-800">
          Anyone can access this page, but submitting onboarding requires login.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900"
        >
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">Quiz Master / Mains Mentor Onboarding</h1>
        <p className="mt-1 text-sm text-slate-600">
          Submit your details for moderation review. Each role requires a separate application, and approvals are additive on your account.
        </p>
      </section>

      {latestApplication ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Latest Request</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[String(latestApplication.status).toLowerCase()] || "bg-slate-100 text-slate-700"}`}>
              {applicationStatusLabel(latestApplication)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Submitted: {new Date(latestApplication.created_at).toLocaleString()} | Role requested: {roleLabel(String(latestApplication.desired_role || ""))}
          </p>
          <p className="mt-1 text-xs text-slate-600">{applicationStatusHint(latestApplication)}</p>
          {latestApplication.reviewer_note ? (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reviewer note</p>
              <RichTextContent value={latestApplication.reviewer_note} className="mt-1 text-xs text-slate-700 [&_p]:my-1" />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={desiredRole}
            onChange={(event) => setDesiredRole(event.target.value as ProfessionalOnboardingDesiredRole)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Full name"
          />
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="City"
          />
          <input
            type="number"
            min={0}
            value={yearsExperience}
            onChange={(event) => setYearsExperience(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Years of experience"
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            placeholder="Phone / WhatsApp (optional)"
          />
          <RichTextField
            label="Application summary"
            value={about}
            onChange={setAbout}
            className="md:col-span-2"
            placeholder="Describe your background, domain strength, mentoring or teaching experience, and why you are applying."
            helperText="This is the main narrative section moderators review."
          />
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Selected role scope: {ROLE_OPTIONS.find((option) => option.value === desiredRole)?.hint}
        </p>

        <div className="mt-4">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submitApplication()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit For Review"}
          </button>
        </div>
      </section>
    </div>
  );
}
