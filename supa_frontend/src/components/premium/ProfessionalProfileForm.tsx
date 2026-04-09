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
  PremiumExam,
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
const normalizeExamIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const output: number[] = [];
  value.forEach((item) => {
    const parsed = Number(item);
    if (Number.isFinite(parsed) && parsed > 0 && !output.includes(parsed)) {
      output.push(parsed);
    }
  });
  return output;
};

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
  const [mentorshipPrice, setMentorshipPrice] = useState("");
  const [copyEvaluationPrice, setCopyEvaluationPrice] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [responseTimeText, setResponseTimeText] = useState("");
  const [examFocus, setExamFocus] = useState("");
  const [availableExams, setAvailableExams] = useState<PremiumExam[]>([]);
  const [selectedExamIds, setSelectedExamIds] = useState<number[]>([]);
  const [studentsMentored, setStudentsMentored] = useState("");
  const [sessionsCompleted, setSessionsCompleted] = useState("");
  const [defaultCallProvider, setDefaultCallProvider] = useState<MentorshipCallProvider>("custom");
  const [zoomMeetingLink, setZoomMeetingLink] = useState("");
  const [callSetupNote, setCallSetupNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const isMentorProfile = role === "mentor";
  const achievementRows = useMemo(() => parseList(achievements), [achievements]);
  const specializationRows = useMemo(() => parseList(specializationTags), [specializationTags]);
  const languageRows = useMemo(() => parseList(languages), [languages]);
  const toggleExamId = (examId: number) => {
    setSelectedExamIds((prev) =>
      prev.includes(examId) ? prev.filter((item) => item !== examId) : [...prev, examId],
    );
  };

  useEffect(() => {
    if (loading) {
      return;
    }

    let active = true;

    const loadExams = async () => {
      if (!isAuthenticated || !canEdit) {
        if (active) setAvailableExams([]);
        return;
      }
      try {
        const response = await premiumApi.get<PremiumExam[]>("/exams", { params: { active_only: true } });
        if (!active) return;
        setAvailableExams(Array.isArray(response.data) ? response.data : []);
      } catch (error: unknown) {
        if (active) {
          toast.error("Failed to load exams", { description: toError(error) });
        }
      }
    };

    void loadExams();
    return () => {
      active = false;
    };
  }, [loading, canEdit, isAuthenticated]);

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
        setMentorshipPrice(
          meta.mentorship_price !== undefined && meta.mentorship_price !== null ? String(meta.mentorship_price) : "",
        );
        setCopyEvaluationPrice(
          meta.copy_evaluation_price !== undefined && meta.copy_evaluation_price !== null ? String(meta.copy_evaluation_price) : "",
        );
        setCurrency(asText(meta.currency) || "INR");
        setResponseTimeText(asText(meta.response_time_text));
        setExamFocus(asText(meta.exam_focus));
        setSelectedExamIds(
          normalizeExamIds(profile.exam_ids).length > 0
            ? normalizeExamIds(profile.exam_ids)
            : normalizeExamIds(meta.exam_ids),
        );
        setStudentsMentored(
          meta.students_mentored !== undefined && meta.students_mentored !== null ? String(meta.students_mentored) : "",
        );
        setSessionsCompleted(
          meta.sessions_completed !== undefined && meta.sessions_completed !== null ? String(meta.sessions_completed) : "",
        );
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
          setMentorshipPrice("");
          setCopyEvaluationPrice("");
          setCurrency("INR");
          setResponseTimeText("");
          setExamFocus("");
          setSelectedExamIds([]);
          setStudentsMentored("");
          setSessionsCompleted("");
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
        exam_ids: selectedExamIds,
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
          mentorship_price: isMentorProfile && mentorshipPrice.trim() ? Number(mentorshipPrice) : 0,
          copy_evaluation_price: isMentorProfile && copyEvaluationPrice.trim() ? Number(copyEvaluationPrice) : 0,
          currency: isMentorProfile ? currency.trim().toUpperCase() || "INR" : null,
          response_time_text: isMentorProfile ? responseTimeText.trim() || null : null,
          exam_focus: isMentorProfile ? examFocus.trim() || null : null,
          students_mentored: isMentorProfile && studentsMentored.trim() ? Number(studentsMentored) : null,
          sessions_completed: isMentorProfile && sessionsCompleted.trim() ? Number(sessionsCompleted) : null,
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
    return <div className="rounded-[32px] border border-[#eadcf8] bg-[#fcf7ff] p-6 text-sm text-[#6c6088] shadow-[0_24px_50px_-38px_rgba(84,54,191,0.45)]">Loading profile form...</div>;
  }

  if (!isAuthenticated) {
    return <div className="rounded-[32px] border border-[#eadcf8] bg-[#fcf7ff] p-6 text-sm text-[#6c6088] shadow-[0_24px_50px_-38px_rgba(84,54,191,0.45)]">Sign in to edit professional profile.</div>;
  }

  if (!canEdit) {
    return (
      <div className="rounded-[32px] border border-[#eadcf8] bg-[#fcf7ff] p-6 shadow-[0_24px_50px_-38px_rgba(84,54,191,0.45)]">
        <h1 className="text-2xl font-semibold text-[#24113d]">Profile form is role-restricted</h1>
        <p className="mt-2 text-sm leading-6 text-[#6c6088]">
          This form is for Quiz Master and Mains Mentor roles. Users can still browse mentors and programs.
        </p>
      </div>
    );
  }

  const shellClass = "space-y-5 rounded-[36px] border border-[#ecdffc] bg-[linear-gradient(180deg,#fcf7ff_0%,#f7efff_100%)] p-4 shadow-[0_32px_80px_-40px_rgba(84,54,191,0.35)] md:p-6";
  const cardClass = "rounded-[30px] border border-[#eadcf8] bg-[#fff9ff]/92 p-5 shadow-[0_24px_50px_-40px_rgba(84,54,191,0.45)]";
  const titleClass = "text-[1.85rem] font-semibold leading-tight text-[#24113d]";
  const eyebrowClass = "text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7c5cb7]";
  const inputClass = "w-full rounded-[18px] border border-[#dbcdf3] bg-white/95 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#4256d0] focus:ring-4 focus:ring-[#e1dcff]";
  const textareaClass = `${inputClass} min-h-[120px]`;
  const pillClass = (selected: boolean, tone: "indigo" | "mint" = "indigo") =>
    `rounded-full border px-4 py-2 text-sm font-semibold transition ${
      selected
        ? tone === "mint"
          ? "border-[#8fe3d5] bg-[#8feee0] text-[#0f6a60]"
          : "border-[#3f53cd] bg-[#4459cf] text-white shadow-[0_12px_22px_-16px_rgba(68,89,207,0.8)]"
        : "border-[#d9c9f4] bg-[#efe2ff] text-[#6b52a6]"
    }`;

  return (
    <div className={shellClass}>
      <section className="rounded-[34px] bg-[linear-gradient(180deg,#faf4ff_0%,#f5ebff_100%)] px-5 py-6 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className={eyebrowClass}>MentorHub</p>
            <h1 className="mt-3 text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-[#2b1847] md:text-[4rem]">
              Settings &amp; Availability
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#675b83]">
              Manage your public mentor presence, scheduling preferences, and learner-facing profile content from one
              place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[#d9c9f4] bg-[#efe2ff] px-4 py-2 text-sm font-semibold text-[#5f4698]">
              {roleOptionLabel(role)}
            </span>
            <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${isPublic ? "border-[#8fe3d5] bg-[#8feee0] text-[#0f6a60]" : "border-[#d9c9f4] bg-[#f2e8ff] text-[#6a54a0]"}`}>
              {isPublic ? "Public profile" : "Private profile"}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className={cardClass}>
          <p className={eyebrowClass}>Profile Identity</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                className={inputClass}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {roleOptionLabel(option)}
                  </option>
                ))}
              </select>
            </FormFieldShell>

            <FormFieldShell label="Display name">
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={inputClass} placeholder="Display name" />
            </FormFieldShell>

            <FormFieldShell label="Headline" className="md:col-span-2">
              <input value={headline} onChange={(event) => setHeadline(event.target.value)} className={inputClass} placeholder="Headline (e.g. UPSC mentor, 8+ years mentoring)" />
            </FormFieldShell>

            <RichTextField
              label="Professional bio"
              value={bio}
              onChange={setBio}
              className="md:col-span-2"
              placeholder="Write a crisp public introduction, teaching approach, and credibility summary."
              helperText="This is the first block learners read on your profile."
            />

            <FormFieldShell label="Years of experience">
              <input type="number" min={0} value={yearsExperience} onChange={(event) => setYearsExperience(event.target.value)} className={inputClass} placeholder="Years of experience" />
            </FormFieldShell>

            <FormFieldShell label="City">
              <input value={city} onChange={(event) => setCity(event.target.value)} className={inputClass} placeholder="City" />
            </FormFieldShell>
          </div>
        </section>

        <section className={cardClass}>
          <p className={eyebrowClass}>Automation &amp; Preferences</p>
          <h2 className={`${titleClass} mt-2 text-[2rem]`}>Learner-facing settings</h2>
          <p className="mt-2 text-sm leading-6 text-[#675b83]">
            Keep the mentor experience simple: decide how the profile is shown, how mentorship calls open, and whether
            direct copy evaluation is available.
          </p>

          <div className="mt-5 space-y-4">
            <div className="rounded-[24px] border border-[#e4d6f7] bg-[#f8efff] p-4">
              <p className={eyebrowClass}>Profile visibility</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setIsPublic(true)} className={pillClass(isPublic, "mint")}>
                  Public
                </button>
                <button type="button" onClick={() => setIsPublic(false)} className={pillClass(!isPublic)}>
                  Private
                </button>
              </div>
            </div>

            {isMentorProfile ? (
              <div className="rounded-[24px] border border-[#e4d6f7] bg-[#f8efff] p-4">
                <p className={eyebrowClass}>Mentorship call setup</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["custom", "zoom"] as MentorshipCallProvider[]).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => setDefaultCallProvider(provider)}
                      className={pillClass(defaultCallProvider === provider)}
                    >
                      {provider === "zoom" ? "Zoom" : "Custom link"}
                    </button>
                  ))}
                </div>
                <div className="mt-4 space-y-4">
                  <FormFieldShell label="Reusable meeting link">
                    <input
                      value={zoomMeetingLink}
                      onChange={(event) => setZoomMeetingLink(event.target.value)}
                      className={inputClass}
                      placeholder="https://zoom.us/j/... or custom meeting link"
                    />
                  </FormFieldShell>
                  <RichTextField
                    label="Call setup note"
                    value={callSetupNote}
                    onChange={setCallSetupNote}
                    placeholder="Explain how learners should join, prepare, or recover if the primary link fails."
                    helperText="This copy appears anywhere the learner sees your session handoff rules."
                  />
                </div>
              </div>
            ) : null}

            {isMentorProfile ? (
              <div className="rounded-[24px] border border-[#e4d6f7] bg-[#f8efff] p-4">
                <p className={eyebrowClass}>Copy evaluation</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCopyEvaluationEnabled(true)}
                    className={pillClass(copyEvaluationEnabled, "mint")}
                  >
                    Available
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyEvaluationEnabled(false)}
                    className={pillClass(!copyEvaluationEnabled)}
                  >
                    Unavailable
                  </button>
                </div>
                <RichTextField
                  label="Copy evaluation note"
                  value={copyEvaluationNote}
                  onChange={setCopyEvaluationNote}
                  className="mt-4"
                  placeholder="Set expectations for evaluation scope, turnaround, and follow-up mentorship."
                  helperText="Learners see this before they submit a copy directly from your public profile."
                />
              </div>
            ) : null}

            {isMentorProfile ? (
              <div className="rounded-[24px] border border-[#e4d6f7] bg-[#f8efff] p-4">
                <p className={eyebrowClass}>Pricing &amp; response</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <FormFieldShell label="Mentorship only price">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={mentorshipPrice}
                      onChange={(event) => setMentorshipPrice(event.target.value)}
                      className={inputClass}
                      placeholder="e.g. 1499"
                    />
                  </FormFieldShell>
                  <FormFieldShell label="Evaluation + mentorship price">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={copyEvaluationPrice}
                      onChange={(event) => setCopyEvaluationPrice(event.target.value)}
                      className={inputClass}
                      placeholder="e.g. 2499"
                    />
                  </FormFieldShell>
                  <FormFieldShell label="Currency">
                    <input value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass} placeholder="INR" />
                  </FormFieldShell>
                  <FormFieldShell label="Response time copy">
                    <input
                      value={responseTimeText}
                      onChange={(event) => setResponseTimeText(event.target.value)}
                      className={inputClass}
                      placeholder="Usually replies within 2 hours"
                    />
                  </FormFieldShell>
                </div>
              </div>
            ) : null}

            <div className="rounded-[24px] border border-[#e4d6f7] bg-[#f8efff] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className={eyebrowClass}>Target exams</p>
                <span className="text-xs text-[#6b5f83]">This profile is discoverable under one or more exams.</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {availableExams.length === 0 ? (
                  <span className="text-sm text-[#6b5f83]">No active exams available.</span>
                ) : availableExams.map((exam) => (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => toggleExamId(exam.id)}
                    className={pillClass(selectedExamIds.includes(exam.id))}
                  >
                    {exam.name}
                  </button>
                ))}
              </div>
            </div>

            {isMentorProfile ? (
              <div className="rounded-[24px] border border-[#e4d6f7] bg-[#f8efff] p-4">
                <p className={eyebrowClass}>Public trust stats</p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <FormFieldShell label="Exam focus note">
                    <input value={examFocus} onChange={(event) => setExamFocus(event.target.value)} className={inputClass} placeholder="Optional note on your strongest areas inside the selected exams" />
                  </FormFieldShell>
                  <FormFieldShell label="Students mentored">
                    <input type="number" min={0} value={studentsMentored} onChange={(event) => setStudentsMentored(event.target.value)} className={inputClass} placeholder="1200" />
                  </FormFieldShell>
                  <FormFieldShell label="Sessions completed">
                    <input type="number" min={0} value={sessionsCompleted} onChange={(event) => setSessionsCompleted(event.target.value)} className={inputClass} placeholder="3400" />
                  </FormFieldShell>
                </div>
              </div>
            ) : null}

            {isMentorProfile ? (
              <div className="rounded-[24px] border border-[#d6caf3] bg-white/80 p-4">
                <p className={eyebrowClass}>Availability calendar</p>
                <p className="mt-2 text-sm leading-6 text-[#675b83]">
                  Day-wise availability, slot publishing, and learner booking windows are managed in the dedicated
                  mentorship workspace.
                </p>
                <Link
                  href="/mentorship/manage"
                  className="mt-4 inline-flex rounded-full border border-[#3f53cd] bg-[#4459cf] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_22px_-16px_rgba(68,89,207,0.8)]"
                >
                  Open availability workspace
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section className={cardClass}>
          <p className={eyebrowClass}>Contact &amp; Proof</p>
          <div className="mt-4 grid gap-4">
            <FormFieldShell label="Profile image URL">
              <input value={profileImageUrl} onChange={(event) => setProfileImageUrl(event.target.value)} className={inputClass} placeholder="Profile image URL" />
            </FormFieldShell>

            <FormFieldShell label="Public contact URL">
              <input value={contactUrl} onChange={(event) => setContactUrl(event.target.value)} className={inputClass} placeholder="Public contact URL" />
            </FormFieldShell>

            <FormFieldShell label="Public email">
              <input value={publicEmail} onChange={(event) => setPublicEmail(event.target.value)} className={inputClass} placeholder="Public email" />
            </FormFieldShell>

            <FormFieldShell label="Authenticity proof URL">
              <input value={authenticityProofUrl} onChange={(event) => setAuthenticityProofUrl(event.target.value)} className={inputClass} placeholder="Official profile, certificate page, or proof link" />
            </FormFieldShell>

            <RichTextField
              label="Verification note"
              value={authenticityNote}
              onChange={setAuthenticityNote}
              placeholder="Explain the context behind your credentials, proof links, and public trust signals."
              helperText="Keep this factual and short."
            />
          </div>
        </section>

        <section className={cardClass}>
          <p className={eyebrowClass}>Public Profile Content</p>
          <h2 className={`${titleClass} mt-2 text-[2rem]`}>Highlights learners will see</h2>
          <p className="mt-2 text-sm leading-6 text-[#675b83]">
            Keep this section clean and scannable. These fields shape the public card, mentor profile summary, and trust
            layer.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {achievementRows.slice(0, 3).map((item) => (
              <span key={item} className="rounded-full border border-[#8fe3d5] bg-[#8feee0] px-3 py-1.5 text-xs font-semibold text-[#0f6a60]">
                {item}
              </span>
            ))}
            {achievementRows.length === 0 ? (
              <span className="rounded-full border border-[#d9c9f4] bg-[#efe2ff] px-3 py-1.5 text-xs font-semibold text-[#6b52a6]">
                Add achievements below
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <FormFieldShell label="Specialization tags">
              <textarea value={specializationTags} onChange={(event) => setSpecializationTags(event.target.value)} className={textareaClass} rows={5} placeholder="One specialization tag per line" />
            </FormFieldShell>

            <FormFieldShell label="Languages">
              <textarea value={languages} onChange={(event) => setLanguages(event.target.value)} className={textareaClass} rows={5} placeholder="One language per line" />
            </FormFieldShell>

            <FormFieldShell label="Highlights shown on cards">
              <textarea value={highlights} onChange={(event) => setHighlights(event.target.value)} className={textareaClass} rows={5} placeholder="Short highlight per line" />
            </FormFieldShell>

            <FormFieldShell label="Credentials">
              <textarea value={credentials} onChange={(event) => setCredentials(event.target.value)} className={textareaClass} rows={5} placeholder="One credential per line" />
            </FormFieldShell>

            <FormFieldShell label="Achievements" className="md:col-span-2">
              <textarea value={achievements} onChange={(event) => setAchievements(event.target.value)} className={textareaClass} rows={5} placeholder="One achievement per line" />
            </FormFieldShell>

            <FormFieldShell label="Technical / service specifications" className="md:col-span-2">
              <textarea value={serviceSpecifications} onChange={(event) => setServiceSpecifications(event.target.value)} className={textareaClass} rows={5} placeholder="One service specification per line" />
            </FormFieldShell>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {specializationRows.slice(0, 4).map((item) => (
              <span key={item} className="rounded-full border border-[#d9c9f4] bg-[#efe2ff] px-3 py-1.5 text-xs font-semibold text-[#6b52a6]">
                {item}
              </span>
            ))}
            {languageRows.slice(0, 3).map((item) => (
              <span key={item} className="rounded-full border border-[#d9c9f4] bg-white px-3 py-1.5 text-xs font-semibold text-[#5f5b73]">
                {item}
              </span>
            ))}
          </div>
        </section>
      </div>

      <div className={`${cardClass} sticky bottom-4`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className={eyebrowClass}>Save</p>
            <p className="mt-2 text-sm leading-6 text-[#675b83]">
              Save all profile, call setup, and public content changes together.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={saving}
            className="inline-flex min-w-[240px] items-center justify-center rounded-full border border-[#3f53cd] bg-[#4459cf] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_22px_-16px_rgba(68,89,207,0.8)] transition disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save All Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
