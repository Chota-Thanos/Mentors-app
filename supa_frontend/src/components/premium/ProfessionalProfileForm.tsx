"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import {
  isAdminLike,
  isCreatorLike,
  isMentorLike,
  isModeratorLike,
  isProviderLike,
} from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import FormFieldShell from "@/components/ui/FormFieldShell";
import RichTextField from "@/components/ui/RichTextField";
import type {
  MentorshipCallProvider,
  ProfessionalProfile,
  ProfessionalProfilePayload,
  ProfessionalProfileRole,
} from "@/types/premium";

const ROLE_OPTIONS: ProfessionalProfileRole[] = ["provider", "mentor"];

const roleOptionLabel = (role: ProfessionalProfileRole): string => {
  if (role === "mentor") return "Mains Mentor";
  if (role === "creator" || role === "provider" || role === "institute") return "Quiz Master";
  return toDisplayRoleLabel(role);
};

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

const parseList = (value: string): string[] =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

const stringifyList = (value?: string[] | null): string => (value || []).join("\n");

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const normalizeCallProvider = (value: unknown, zoomMeetingLink?: unknown): MentorshipCallProvider => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "zoom") return "zoom";
  if (typeof zoomMeetingLink === "string" && zoomMeetingLink.trim()) return "zoom";
  return "custom";
};

const normalizeEditableRole = (
  value: string | null | undefined,
  fallback: ProfessionalProfileRole = "provider",
): ProfessionalProfileRole => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mentor" || normalized === "mains_mentor" || normalized === "mainsmentor") {
    return "mentor";
  }
  if (normalized === "provider" || normalized === "institute" || normalized === "creator") {
    return "provider";
  }
  if (normalized === "quiz_master" || normalized === "quizmaster") {
    return "provider";
  }
  return fallback;
};

export default function ProfessionalProfileForm() {
  const { user, loading, isAuthenticated } = useAuth();
  const userEmail = String(user?.email || "").trim();
  const canEdit = useMemo(
    () =>
      isAdminLike(user) ||
      isModeratorLike(user) ||
      isProviderLike(user) ||
      isCreatorLike(user) ||
      isMentorLike(user),
    [user],
  );
  const defaultProfileRole = useMemo(
    () =>
      ((isCreatorLike(user) && "provider") ||
        (isProviderLike(user) && "provider") ||
        (isMentorLike(user) && "mentor") ||
        "provider") as ProfessionalProfileRole,
    [user],
  );

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<ProfessionalProfileRole>("mentor");
  const [displayName, setDisplayName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [city, setCity] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [contactUrl, setContactUrl] = useState("");
  const [publicEmail, setPublicEmail] = useState("");
  const [specializationTags, setSpecializationTags] = useState("");
  const [languages, setLanguages] = useState("");
  const [highlights, setHighlights] = useState("");
  const [credentials, setCredentials] = useState("");
  const [achievements, setAchievements] = useState("");
  const [serviceSpecifications, setServiceSpecifications] = useState("");
  const [authenticityProofUrl, setAuthenticityProofUrl] = useState("");
  const [authenticityNote, setAuthenticityNote] = useState("");
  const [copyEvaluationEnabled, setCopyEvaluationEnabled] = useState(true);
  const [copyEvaluationNote, setCopyEvaluationNote] = useState("");
  const [defaultCallProvider, setDefaultCallProvider] = useState<MentorshipCallProvider>("custom");
  const [zoomMeetingLink, setZoomMeetingLink] = useState("");
  const [callSetupNote, setCallSetupNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const isMentorProfile = role === "mentor";

  useEffect(() => {
    if (loading) {
      return;
    }

    let active = true;

    const loadProfile = async () => {
      if (!isAuthenticated || !canEdit) {
        if (active) setBusy(false);
        return;
      }
      if (active) setBusy(true);
      try {
        const response = await premiumApi.get<ProfessionalProfile>("/profiles/me");
        if (!active) return;
        const profile = response.data;
        const normalizedRole = normalizeEditableRole(profile.role, defaultProfileRole);
        setRole(normalizedRole);
        setDisplayName(profile.display_name || "");
        setHeadline(profile.headline || "");
        setBio(profile.bio || "");
        setYearsExperience(profile.years_experience ? String(profile.years_experience) : "");
        setCity(profile.city || "");
        setProfileImageUrl(profile.profile_image_url || "");
        setContactUrl(profile.contact_url || "");
        setPublicEmail(profile.public_email || "");
        setSpecializationTags(stringifyList(profile.specialization_tags));
        setLanguages(stringifyList(profile.languages));
        setHighlights(stringifyList(profile.highlights));
        setCredentials(stringifyList(profile.credentials));
        setIsPublic(profile.is_public);
        const meta = (profile.meta || {}) as Record<string, unknown>;
        setAchievements(stringifyList(Array.isArray(meta.achievements) ? (meta.achievements as string[]) : []));
        setServiceSpecifications(
          stringifyList(Array.isArray(meta.service_specifications) ? (meta.service_specifications as string[]) : []),
        );
        setAuthenticityProofUrl(asText(meta.authenticity_proof_url));
        setAuthenticityNote(asText(meta.authenticity_note));
        setDefaultCallProvider(
          normalizeCallProvider(meta.mentorship_default_call_provider, meta.mentorship_zoom_meeting_link),
        );
        setZoomMeetingLink(asText(meta.mentorship_zoom_meeting_link));
        setCallSetupNote(asText(meta.mentorship_call_setup_note));
        setCopyEvaluationEnabled(
          Object.prototype.hasOwnProperty.call(meta, "copy_evaluation_enabled")
            ? Boolean(meta.copy_evaluation_enabled)
            : normalizedRole === "mentor",
        );
        setCopyEvaluationNote(asText(meta.copy_evaluation_note));
      } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const inferredRole = defaultProfileRole;
          if (!active) return;
          setRole(inferredRole);
          setDisplayName(String(userEmail).split("@")[0] || "");
          setDefaultCallProvider("custom");
          setZoomMeetingLink("");
          setCallSetupNote("");
          setCopyEvaluationEnabled(inferredRole === "mentor");
          setCopyEvaluationNote("");
        } else {
          if (active) {
            toast.error("Failed to load profile", { description: toError(error) });
          }
        }
      } finally {
        if (active) setBusy(false);
      }
    };

    void loadProfile();
    return () => {
      active = false;
    };
  }, [loading, canEdit, isAuthenticated, defaultProfileRole, userEmail]);

  const saveProfile = async () => {
    if (!displayName.trim()) {
      toast.error("Display name is required.");
      return;
    }
    setSaving(true);
    try {
        const payload: ProfessionalProfilePayload = {
        role,
        display_name: displayName.trim(),
        headline: headline.trim() || null,
        bio: toNullableRichText(bio),
        years_experience: yearsExperience.trim() ? Number(yearsExperience) : null,
        city: city.trim() || null,
        profile_image_url: profileImageUrl.trim() || null,
        contact_url: contactUrl.trim() || null,
        public_email: publicEmail.trim() || null,
        specialization_tags: parseList(specializationTags),
        languages: parseList(languages),
        highlights: parseList(highlights),
        credentials: parseList(credentials),
        is_public: isPublic,
        meta: {
          achievements: parseList(achievements),
          service_specifications: parseList(serviceSpecifications),
          authenticity_proof_url: authenticityProofUrl.trim() || null,
          authenticity_note: toNullableRichText(authenticityNote),
          mentorship_default_call_provider: isMentorProfile ? defaultCallProvider : null,
          mentorship_zoom_meeting_link: isMentorProfile ? zoomMeetingLink.trim() || null : null,
          mentorship_call_setup_note: isMentorProfile ? toNullableRichText(callSetupNote) : null,
          copy_evaluation_enabled: isMentorProfile ? copyEvaluationEnabled : null,
          copy_evaluation_configured: isMentorProfile ? true : null,
          copy_evaluation_note: isMentorProfile ? toNullableRichText(copyEvaluationNote) : null,
        },
      };
      await premiumApi.put("/profiles/me", payload);
      toast.success("Professional profile saved");
    } catch (error: unknown) {
      toast.error("Failed to save profile", { description: toError(error) });
    } finally {
      setSaving(false);
    }
  };

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading profile form...</div>;
  }

  if (!isAuthenticated) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Sign in to edit professional profile.</div>;
  }

  if (!canEdit) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-900">Profile form is role-restricted</h1>
        <p className="mt-2 text-sm text-amber-800">
          This form is for Quiz Master and Mains Mentor roles. Users can still browse mentors and test series.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">Quiz Master / Mains Mentor Professional Profile</h1>
        <p className="mt-1 text-sm text-slate-600">
          These details appear on public professional cards for users. Keep highlights factual and trustworthy.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <FormFieldShell label="Profile role">
            <select
              value={role}
              onChange={(event) => {
                const nextRole = normalizeEditableRole(event.target.value, "mentor");
                setRole(nextRole);
                if (nextRole === "mentor") {
                  setCopyEvaluationEnabled(true);
                }
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {roleOptionLabel(option)}
                </option>
              ))}
            </select>
          </FormFieldShell>
          <FormFieldShell label="Display name">
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Display name" />
          </FormFieldShell>
          <FormFieldShell label="Headline" className="md:col-span-2">
            <input value={headline} onChange={(event) => setHeadline(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Headline (e.g. UPSC mentor, 8+ years mentoring)" />
          </FormFieldShell>
          <RichTextField
            label="Professional bio"
            value={bio}
            onChange={setBio}
            className="md:col-span-2"
            placeholder="Write a crisp public introduction, teaching approach, and credibility summary."
            helperText="This is the main profile description learners read first."
          />
          <FormFieldShell label="Years of experience">
            <input type="number" min={0} value={yearsExperience} onChange={(event) => setYearsExperience(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Years of experience" />
          </FormFieldShell>
          <FormFieldShell label="City">
            <input value={city} onChange={(event) => setCity(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="City" />
          </FormFieldShell>
          <FormFieldShell label="Profile image URL" className="md:col-span-2">
            <input value={profileImageUrl} onChange={(event) => setProfileImageUrl(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Profile image URL" />
          </FormFieldShell>
          <FormFieldShell label="Public contact URL">
            <input value={contactUrl} onChange={(event) => setContactUrl(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Public contact URL (optional)" />
          </FormFieldShell>
          <FormFieldShell label="Public email">
            <input value={publicEmail} onChange={(event) => setPublicEmail(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Public email (optional)" />
          </FormFieldShell>
          <FormFieldShell label="Specialization tags">
            <textarea value={specializationTags} onChange={(event) => setSpecializationTags(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={4} placeholder="Specialization tags (one per line)" />
          </FormFieldShell>
          <FormFieldShell label="Languages">
            <textarea value={languages} onChange={(event) => setLanguages(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={4} placeholder="Languages (one per line)" />
          </FormFieldShell>
          <FormFieldShell label="Highlights shown on cards">
            <textarea value={highlights} onChange={(event) => setHighlights(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={5} placeholder="Highlights shown on cards (one per line)" />
          </FormFieldShell>
          <FormFieldShell label="Credentials">
            <textarea value={credentials} onChange={(event) => setCredentials(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={5} placeholder="Credentials (one per line)" />
          </FormFieldShell>
          <FormFieldShell label="Achievements" className="md:col-span-2">
            <textarea value={achievements} onChange={(event) => setAchievements(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={4} placeholder="Achievements (one per line)" />
          </FormFieldShell>
          <FormFieldShell label="Technical / service specifications" className="md:col-span-2">
            <textarea value={serviceSpecifications} onChange={(event) => setServiceSpecifications(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={4} placeholder="Technical/service specifications (one per line)" />
          </FormFieldShell>
          <FormFieldShell label="Authenticity proof URL" className="md:col-span-2">
            <input value={authenticityProofUrl} onChange={(event) => setAuthenticityProofUrl(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Authenticity proof URL (official profile, certificate page, etc.)" />
          </FormFieldShell>
          <RichTextField
            label="Verification note"
            value={authenticityNote}
            onChange={setAuthenticityNote}
            className="md:col-span-2"
            placeholder="Add verification context, credential explanation, or official reference details."
            helperText="Use this to explain how learners should interpret your proof links and claims."
          />
          {isMentorProfile ? (
            <div className="rounded-md border border-sky-200 bg-sky-50/50 p-3 md:col-span-2">
              <p className="text-sm font-semibold text-slate-900">Mentorship Call Setup</p>
              <p className="mt-1 text-xs text-slate-600">
                Choose how audio and video calls should be opened when learners book mentorship slots or accept offered sessions.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <FormFieldShell label="Default call platform">
                  <select
                    value={defaultCallProvider}
                    onChange={(event) => setDefaultCallProvider(event.target.value as MentorshipCallProvider)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="custom">Custom link / manual setup</option>
                    <option value="zoom">Zoom</option>
                  </select>
                </FormFieldShell>
                <FormFieldShell label="Reusable Zoom meeting link">
                  <input
                    value={zoomMeetingLink}
                    onChange={(event) => setZoomMeetingLink(event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="https://zoom.us/j/..."
                  />
                </FormFieldShell>
                <RichTextField
                  label="Call setup note"
                  value={callSetupNote}
                  onChange={setCallSetupNote}
                  className="md:col-span-2"
                  placeholder="Add join instructions, backup rules, or how learners should prepare for audio/video sessions."
                  helperText="Shown on public mentor surfaces to explain how calls will happen."
                />
              </div>
            </div>
          ) : null}
          {isMentorProfile ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 md:col-span-2">
              <p className="text-sm font-semibold text-slate-900">Copy Evaluation Service Availability</p>
              <p className="mt-1 text-xs text-slate-600">
                Control whether learners can send copies directly from your mentor profile for evaluation plus mentorship.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <FormFieldShell label="Service status">
                  <select
                    value={copyEvaluationEnabled ? "available" : "unavailable"}
                    onChange={(event) => setCopyEvaluationEnabled(event.target.value === "available")}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="available">Available for copy evaluation</option>
                    <option value="unavailable">Unavailable for copy evaluation</option>
                  </select>
                </FormFieldShell>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  {copyEvaluationEnabled
                    ? "Learners will see the direct copy evaluation form on your public mentor profile."
                    : "Learners will not see the direct copy evaluation form on your public mentor profile."}
                </div>
                <RichTextField
                  label="Copy evaluation note"
                  value={copyEvaluationNote}
                  onChange={setCopyEvaluationNote}
                  className="md:col-span-2"
                  placeholder="Set expectations for evaluation scope, turnaround style, or mentorship follow-up."
                  helperText="This note appears on your direct copy evaluation panel."
                />
              </div>
            </div>
          ) : null}
        </div>

        {isMentorProfile ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">Mentorship Operations</p>
            <p className="mt-1 text-xs text-slate-600">
              Availability scheduling, mentorship scope, and call records are managed from the mentorship workspace so
              the mentor-facing flow stays in one place.
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              Direct copy evaluation + mentorship is enabled by default for Mains Mentor profiles unless you turn it off in Mentorship Manage.
            </p>
            <Link
              href="/mentorship/manage"
              className="mt-3 inline-flex rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-700"
            >
              Open Mentorship Manage
            </Link>
          </div>
        ) : null}

        <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
          Show this profile publicly
        </label>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </section>
    </div>
  );
}
