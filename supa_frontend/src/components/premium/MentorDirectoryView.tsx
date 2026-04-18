"use client";

import { ArrowRight, CalendarDays, Check, MapPin, RefreshCcw, Search, SlidersHorizontal, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useExamContext } from "@/context/ExamContext";
import type { MentorAvailabilityStatus, ProfessionalProfile } from "@/types/premium";

type AvailabilityFilter = "all" | "available" | "soon";
type ServiceFilter = "all" | "mentorship" | "copy_review";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function initialsFromLabel(label: string): string {
  const tokens = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return "MM";
  return tokens.map((token) => token.charAt(0).toUpperCase()).join("");
}

function cleanSnippet(value?: string | null, fallback = "Structured mains guidance with request-first approval and follow-up chat."): string {
  const normalized = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length > 165 ? `${normalized.slice(0, 162)}...` : normalized;
}

function copyEvaluationEnabled(profile: ProfessionalProfile): boolean {
  return Boolean((profile.meta || {})?.copy_evaluation_enabled);
}

function mentorPriceLabel(profile: ProfessionalProfile): string | null {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const currency = String(meta.currency || "INR").trim().toUpperCase() || "INR";
  const amount = Number(meta.mentorship_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `${currency} ${amount.toLocaleString()}`;
}

function reviewSummaryMeta(profile: ProfessionalProfile): { average: number; total: number } {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const reviewSummary = (meta.review_summary || {}) as Record<string, unknown>;
  const average = Number(reviewSummary.average_rating || 0);
  const total = Number(reviewSummary.total_reviews || 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function mentorStatusLabel(status?: MentorAvailabilityStatus | null): string {
  if (!status) return "Profile active";
  if (status.live_session_id) return "Live now";
  if (status.status === "available_now") return "Available now";
  if (status.status === "busy") return "Busy";
  return "Offline";
}

function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusRank(status?: MentorAvailabilityStatus | null): number {
  if (!status) return 3;
  if (status.live_session_id) return 0;
  if (status.status === "available_now") return 1;
  if (status.status === "busy") return 2;
  return 3;
}

function statusToneClass(status?: MentorAvailabilityStatus | null): string {
  if (status?.live_session_id) return "border-[#c9eee6] bg-[#eaf8f4] text-[#176a5c]";
  if (status?.status === "available_now") return "border-[#c9eee6] bg-[#eaf8f4] text-[#176a5c]";
  if (status?.status === "busy") return "border-[#f0ddb1] bg-[#fff3d8] text-[#80520d]";
  return "border-[#dbe3f6] bg-[#f6f8ff] text-[#5e6885]";
}

function matchesExamIds(examIds: number[] | undefined | null, examId: number | null): boolean {
  if (!examId) return true;
  // An empty exam_ids array means the item is available to all exams
  if (!Array.isArray(examIds) || examIds.length === 0) return true;
  return examIds.includes(examId);
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
        active
          ? "bg-[#173aa9] text-white shadow-[0_14px_28px_rgba(23,58,169,0.18)]"
          : "border border-[#dbe3f6] bg-white text-[#5f6883]"
      }`}
    >
      {children}
    </button>
  );
}

export default function MentorDirectoryView() {
  const { globalExamId, globalExamName } = useExamContext();
  const [rows, setRows] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  const [mentorStatusByUserId, setMentorStatusByUserId] = useState<Record<string, MentorAvailabilityStatus>>({});

  const loadMentors = useCallback(async () => {
    setLoading(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { data, error: fetchError } = await supabase
        .from("creator_profiles")
        .select(`
          *,
          profile:profiles!creator_profiles_user_id_fkey(
            id, display_name, avatar_url, bio, role, is_active, is_verified, creator_exam_ids, highlights
          ),
          exams:creator_profile_exams(exam_id)
        `)
        .eq("is_public", true)
        .eq("is_active", true);

      if (fetchError) throw fetchError;

      const { data: profileFallbackData } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, bio, role, is_active, is_verified, creator_exam_ids, highlights, created_at, updated_at")
        .eq("role", "mains_expert")
        .eq("is_active", true);

      const creatorMentorRows = (data || [])
        .map((row: any) => {
          const profile = row.profile || {};
          const baseRole = String(profile.role || "").trim().toLowerCase();
          const meta = asRecord(row.social_links);
          const professionalRole = String(
            meta.professional_role || (baseRole === "mains_expert" ? "mentor" : ""),
          ).trim().toLowerCase();

          if (professionalRole !== "mentor" && baseRole !== "mains_expert") return null;

          const joinedExamIds = Array.isArray(row.exams)
            ? row.exams.map((e: any) => Number(e.exam_id)).filter((v: number) => Number.isFinite(v))
            : [];
          const profileExamIds = Array.isArray(profile.creator_exam_ids)
            ? profile.creator_exam_ids.map(Number).filter((v: number) => Number.isFinite(v))
            : [];
          const examIds = Array.from(new Set([...joinedExamIds, ...profileExamIds]));
            
          const highlights = Array.isArray(row.highlights) ? row.highlights : [];
          
          return {
            id: row.id,
            user_id: String(row.user_id),
            role: professionalRole || "mentor",
            display_name: row.display_name || profile.display_name || "Verified Mentor",
            profile_image_url: row.profile_image_url || profile.avatar_url || "",
            headline: row.headline || highlights[0] || "Mains Expert",
            bio: row.bio || profile.bio || "",
            specialization_tags: Array.isArray(row.specialization_tags) ? row.specialization_tags : [],
            credentials: Array.isArray(row.credentials) ? row.credentials : [],
            highlights,
            languages: Array.isArray(row.languages) ? row.languages : [],
            experiences: [],
            meta,
            exam_ids: examIds,
            is_verified: !!row.is_verified || !!profile.is_verified,
            is_public: !!row.is_public,
            is_active: !!row.is_active,
            city: row.city || "",
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        })
        .filter(Boolean) as unknown as ProfessionalProfile[];

      const creatorMentorIds = new Set(creatorMentorRows.map((row) => String(row.user_id)));
      const fallbackMentorRows = (profileFallbackData || [])
        .filter((row: any) => !creatorMentorIds.has(String(row.id)))
        .map((row: any) => {
          const rawHighlights = Array.isArray(row.highlights) ? row.highlights : [];
          const highlightLabels = rawHighlights.map((item: any) => (typeof item === "string" ? item : item?.label)).filter(Boolean);
          const examIds = Array.isArray(row.creator_exam_ids)
            ? row.creator_exam_ids.map(Number).filter((value: number) => Number.isFinite(value))
            : [];
          return {
            id: Number(row.id),
            user_id: String(row.id),
            role: "mentor",
            display_name: row.display_name || "Verified Mentor",
            profile_image_url: row.avatar_url || "",
            headline: highlightLabels[0] || "Mains Expert",
            bio: row.bio || "",
            specialization_tags: highlightLabels,
            credentials: [],
            highlights: rawHighlights,
            languages: [],
            experiences: [],
            meta: { professional_role: "mentor" },
            exam_ids: examIds,
            is_verified: !!row.is_verified,
            is_public: true,
            is_active: !!row.is_active,
            city: "",
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || null,
          };
        }) as unknown as ProfessionalProfile[];

      const mentorRows = [...creatorMentorRows, ...fallbackMentorRows]
        .filter((row: any) => matchesExamIds(row.exam_ids, globalExamId)) as unknown as ProfessionalProfile[];

      setRows(mentorRows);

      const mentorIds = mentorRows
        .map((row) => String(row.user_id || "").trim())
        .filter((value, index, arr) => value && arr.indexOf(value) === index);

      if (mentorIds.length === 0) {
        setMentorStatusByUserId({});
      } else {
        const nowIso = new Date().toISOString();
        const { data: slotData } = await supabase
          .from("mentorship_slots")
          .select("mentor_id, starts_at, ends_at, booked_count, max_bookings, updated_at")
          .in("mentor_id", mentorIds.map(Number))
          .eq("is_active", true)
          .gte("ends_at", nowIso)
          .order("starts_at", { ascending: true });

        const nextStatusMap: Record<string, MentorAvailabilityStatus> = {};
        for (const mentorId of mentorIds) {
          const rowsForMentor = (slotData || []).filter((slot: any) => String(slot.mentor_id) === mentorId);
          const openSlots = rowsForMentor.filter((slot: any) => Number(slot.booked_count || 0) < Number(slot.max_bookings || 1));
          const activeNow = openSlots.filter((slot: any) => slot.starts_at <= nowIso && slot.ends_at >= nowIso);
          const nextSlot = openSlots[0] || null;
          nextStatusMap[mentorId] = {
            provider_user_id: mentorId,
            status: activeNow.length > 0 ? "available_now" : nextSlot ? "offline" : "offline",
            available_now: activeNow.length > 0,
            busy_now: false,
            active_slots_now: activeNow.length,
            next_available_at: nextSlot?.starts_at ?? null,
            live_session_id: null,
            updated_at: nextSlot?.updated_at ?? nowIso,
          };
        }
        setMentorStatusByUserId(nextStatusMap);
      }
    } catch (error: unknown) {
      setRows([]);
      setMentorStatusByUserId({});
      toast.error("Failed to load mentors", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  }, [globalExamId]);

  useEffect(() => {
    void loadMentors();
  }, [loadMentors]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (verifiedOnly && !row.is_verified) return false;
        if (serviceFilter === "copy_review" && !copyEvaluationEnabled(row)) return false;

        const status = mentorStatusByUserId[row.user_id] || null;
        if (availabilityFilter === "available" && status?.status !== "available_now" && !status?.live_session_id) return false;
        if (availabilityFilter === "soon" && !status?.next_available_at) return false;

        if (!needle) return true;
        const highlightLabels = row.highlights.map((h: any) => typeof h === "string" ? h : h.label);
        const haystack = [
          row.display_name,
          row.headline || "",
          row.city || "",
          row.specialization_tags.join(" "),
          highlightLabels.join(" "),
          row.credentials.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => {
        const leftStatus = mentorStatusByUserId[left.user_id] || null;
        const rightStatus = mentorStatusByUserId[right.user_id] || null;
        const leftRank = statusRank(leftStatus);
        const rightRank = statusRank(rightStatus);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.display_name.localeCompare(right.display_name);
      });
  }, [availabilityFilter, mentorStatusByUserId, rows, search, serviceFilter, verifiedOnly]);

  const resetFilters = () => {
    setSearch("");
    setVerifiedOnly(false);
    setAvailabilityFilter("all");
    setServiceFilter("all");
  };

  return (
    <div className="space-y-8 bg-[#f6f8ff] text-[#192133]">
      <section className="relative overflow-hidden rounded-[34px] border border-[#dde5f7] bg-[linear-gradient(135deg,#ffffff_0%,#f2f5ff_58%,#eef9f6_100%)] px-5 py-6 shadow-[0_22px_55px_rgba(9,26,74,0.08)] sm:px-7 sm:py-8 lg:px-10 lg:py-10">
        <div className="absolute right-[-5rem] top-[-4rem] h-48 w-48 rounded-full bg-[#d9e4ff]/70 blur-3xl" />
        <div className="absolute bottom-[-6rem] left-[-4rem] h-52 w-52 rounded-full bg-[#d7f5ef]/70 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Mentor Discovery</p>
            <h1 className="mt-3 font-sans text-[38px] font-semibold leading-[0.94] tracking-[-0.07em] text-[#1235ae] sm:text-[48px] lg:text-[58px]">
              Find mentors
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#6d7690]">
              Curated mains expertise for a request-led workflow, with verified filters, live availability, and clear service paths.
            </p>
            {globalExamName ? (
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5f7aa9]">Exam scope: {globalExamName}</p>
            ) : null}
          </div>

          <div className="flex w-full max-w-xl items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-[22px] border border-[#dbe3f6] bg-white px-4 py-3 shadow-[0_14px_28px_rgba(21,31,76,0.06)]">
              <Search className="h-4 w-4 text-[#7a85a5]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or subject..."
                className="w-full bg-transparent text-sm font-medium text-[#1d2945] outline-none placeholder:text-[#7a85a5]"
              />
            </label>
            <button
              type="button"
              onClick={() => setVerifiedOnly((prev) => !prev)}
              className={`inline-flex h-14 w-14 items-center justify-center rounded-[20px] shadow-[0_12px_24px_rgba(23,58,169,0.12)] transition-colors ${
                verifiedOnly ? "bg-[#173aa9] text-white" : "bg-white text-[#173aa9]"
              }`}
              aria-label="Toggle verified mentors"
            >
              <SlidersHorizontal className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-5 rounded-[30px] border border-[#dbe3f6] bg-white/95 p-6 shadow-[0_20px_50px_rgba(16,31,74,0.08)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Service Type</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterButton active={serviceFilter === "all"} onClick={() => setServiceFilter("all")}>All</FilterButton>
                <FilterButton active={serviceFilter === "mentorship"} onClick={() => setServiceFilter("mentorship")}>Mentorship</FilterButton>
                <FilterButton active={serviceFilter === "copy_review"} onClick={() => setServiceFilter("copy_review")}>Copy Review</FilterButton>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Availability</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterButton active={availabilityFilter === "all"} onClick={() => setAvailabilityFilter("all")}>All</FilterButton>
                <FilterButton active={availabilityFilter === "available"} onClick={() => setAvailabilityFilter("available")}>Available Now</FilterButton>
                <FilterButton active={availabilityFilter === "soon"} onClick={() => setAvailabilityFilter("soon")}>Next Slot</FilterButton>
              </div>
            </div>

            <label className="flex items-center justify-between rounded-[20px] bg-[linear-gradient(180deg,#f9fbff_0%,#f2f6ff_100%)] px-4 py-3">
              <span className="text-sm font-semibold text-[#1d2945]">Verified only</span>
              <button
                type="button"
                onClick={() => setVerifiedOnly((prev) => !prev)}
                className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${verifiedOnly ? "bg-[#173aa9]" : "bg-[#c6cfe6]"}`}
              >
                <span className={`h-5 w-5 rounded-full bg-white transition-transform ${verifiedOnly ? "translate-x-5" : ""}`} />
              </button>
            </label>

            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#173aa9] px-4 py-3 text-[13px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.18)]"
            >
              Reset filters
            </button>
          </div>
        </aside>

        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 lg:hidden">
              <FilterButton active={serviceFilter === "all"} onClick={() => setServiceFilter("all")}>All</FilterButton>
              <FilterButton active={serviceFilter === "copy_review"} onClick={() => setServiceFilter("copy_review")}>Copy Review</FilterButton>
              <FilterButton active={availabilityFilter === "available"} onClick={() => setAvailabilityFilter(availabilityFilter === "available" ? "all" : "available")}>
                Available Now
              </FilterButton>
            </div>

            <div className="flex items-center gap-3 text-sm font-semibold text-[#5f6883]">
              <span>{filteredRows.length} mentors</span>
              <button
                type="button"
                onClick={() => void loadMentors()}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.06)]"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>

          {loading ? <div className="rounded-[28px] border border-[#dbe3f6] bg-white p-6 text-sm text-[#5f6883]">Loading mentors...</div> : null}

          {!loading && filteredRows.length === 0 ? (
            <div className="rounded-[28px] border border-[#dbe3f6] bg-white p-10 text-center shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
              <h2 className="font-sans text-[32px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">No mentors matched these filters.</h2>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 inline-flex rounded-full bg-[#173aa9] px-5 py-3 text-[13px] font-semibold text-white"
              >
                Reset Filters
              </button>
            </div>
          ) : null}

          {!loading ? (
            <div className="space-y-5">
              {filteredRows.map((mentor) => {
                const status = mentorStatusByUserId[mentor.user_id] || null;
                const review = reviewSummaryMeta(mentor);
                const availabilityText = status?.next_available_at ? formatDateTime(status.next_available_at) : null;
                const badgeGroup = mentor.specialization_tags.slice(0, 2);
                const price = mentorPriceLabel(mentor);

                return (
                  <article key={mentor.user_id} className="rounded-[30px] border border-[#dbe3f6] bg-white p-6 shadow-[0_18px_40px_rgba(16,31,74,0.06)]">
                    <div className="flex flex-col gap-6 md:flex-row">
                      <div className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-[24px] bg-[#edf2ff] shadow-[0_12px_24px_rgba(21,31,76,0.08)] md:h-32 md:w-32">
                        {mentor.profile_image_url ? (
                          <Image
                            src={mentor.profile_image_url}
                            alt={mentor.display_name}
                            fill
                            unoptimized
                            sizes="128px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#edf2ff_0%,#f9fbff_56%,#eaf8f4_100%)] font-sans text-2xl font-semibold tracking-[-0.05em] text-[#1235ae]">
                            {initialsFromLabel(mentor.display_name)}
                          </div>
                        )}

                        {mentor.is_verified ? (
                          <div className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-full border border-white bg-[#173aa9] shadow-[0_10px_18px_rgba(23,58,169,0.18)]">
                            <Check className="h-5 w-5 text-white" />
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1 space-y-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <h2 className="font-sans text-[32px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">{mentor.display_name}</h2>
                            <p className="mt-2 text-[15px] font-medium text-[#17328f]">{mentor.headline || "Mains Mentor"}</p>
                            {mentor.city ? (
                              <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[#6d7690]">
                                <MapPin className="h-4 w-4" />
                                {mentor.city}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2 text-left md:text-right">
                            <p className="font-sans text-[32px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">
                              {price || "Request"}
                              {price ? <span className="ml-1 text-sm font-medium text-[#6d7690]">start</span> : null}
                            </p>
                            <div className="flex items-center gap-1 text-[#9b650d] md:justify-end">
                              <Star className="h-4 w-4 fill-current" />
                              <span className="text-sm font-bold">{review.total > 0 ? review.average.toFixed(1) : "New"}</span>
                              {review.total > 0 ? <span className="text-xs font-medium text-[#6d7690]">({review.total})</span> : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {badgeGroup.map((tag) => (
                            <span key={`${mentor.user_id}-${tag}`} className="rounded-full border border-[#c9eee6] bg-[#eaf8f4] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#176a5c]">
                              {tag}
                            </span>
                          ))}
                          {copyEvaluationEnabled(mentor) ? (
                            <span className="rounded-full border border-[#dbe3f6] bg-[#f6f8ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5e6885]">
                              Copy Evaluation + Mentorship
                            </span>
                          ) : null}
                        </div>

                        <p className="text-[14px] leading-7 text-[#5f6883]">&ldquo;{cleanSnippet(mentor.bio)}&rdquo;</p>

                        <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className={`rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusToneClass(status)}`}>
                              {mentorStatusLabel(status)}
                            </span>
                            {availabilityText ? (
                              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#176a5c]">
                                <CalendarDays className="h-4 w-4" />
                                {availabilityText}
                              </span>
                            ) : null}
                          </div>

                          <Link
                            href={`/profiles/${mentor.user_id}`}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#173aa9] px-6 py-3 text-[13px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.18)] transition hover:bg-[#15328f]"
                          >
                            View Profile
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
