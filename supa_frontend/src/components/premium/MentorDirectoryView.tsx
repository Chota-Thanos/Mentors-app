"use client";

import axios from "axios";
import { ArrowRight, CalendarDays, Check, MapPin, RefreshCcw, Search, SlidersHorizontal, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type { MentorAvailabilityStatus, ProfessionalProfile } from "@/types/premium";

type AvailabilityFilter = "all" | "available" | "soon";
type ServiceFilter = "all" | "mentorship" | "copy_review";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
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
      className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-[#000666] text-white shadow-[0_12px_24px_rgba(0,6,102,0.14)]" : "bg-white text-[#454652]"
      }`}
    >
      {children}
    </button>
  );
}

export default function MentorDirectoryView() {
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
      const response = await premiumApi.get<ProfessionalProfile[]>("/mentors/public", {
        params: { only_verified: false, limit: 200 },
      });
      const mentorRows = Array.isArray(response.data) ? response.data : [];
      setRows(mentorRows);

      const providerUserIds = mentorRows
        .map((row) => String(row.user_id || "").trim())
        .filter((value, index, arr) => value && arr.indexOf(value) === index);

      if (providerUserIds.length === 0) {
        setMentorStatusByUserId({});
      } else {
        try {
          const statusResponse = await premiumApi.get<MentorAvailabilityStatus[]>("/mentorship/mentors/status", {
            params: {
              provider_user_ids: providerUserIds.join(","),
              include_offline: true,
              limit: Math.min(providerUserIds.length, 500),
            },
          });
          const nextStatusMap: Record<string, MentorAvailabilityStatus> = {};
          for (const row of Array.isArray(statusResponse.data) ? statusResponse.data : []) {
            const providerUserId = String(row.provider_user_id || "").trim();
            if (!providerUserId) continue;
            nextStatusMap[providerUserId] = row;
          }
          setMentorStatusByUserId(nextStatusMap);
        } catch {
          setMentorStatusByUserId({});
        }
      }
    } catch (error: unknown) {
      setRows([]);
      setMentorStatusByUserId({});
      toast.error("Failed to load mentors", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  }, []);

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
        const haystack = [
          row.display_name,
          row.headline || "",
          row.city || "",
          row.specialization_tags.join(" "),
          row.highlights.join(" "),
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
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-[#f8f9fb]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#767683]">Mentor Discovery</p>
            <h1 className="mt-2 font-sans text-4xl font-extrabold tracking-tight text-[#000666]">Find mentors</h1>
            <p className="mt-2 text-base text-[#454652]">Curated mains expertise for a request-led workflow.</p>
          </div>

          <div className="flex w-full max-w-xl items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-[1.25rem] bg-[#eef2f5] px-4 py-3 shadow-[0_12px_24px_rgba(25,28,30,0.04)]">
              <Search className="h-4 w-4 text-[#767683]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or subject..."
                className="w-full bg-transparent text-sm font-medium text-[#191c1e] outline-none placeholder:text-[#767683]"
              />
            </label>
            <button
              type="button"
              onClick={() => setVerifiedOnly((prev) => !prev)}
              className={`inline-flex h-14 w-14 items-center justify-center rounded-[1.15rem] shadow-[0_12px_24px_rgba(0,6,102,0.12)] transition-colors ${
                verifiedOnly ? "bg-[#000666] text-white" : "bg-white text-[#000666]"
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
          <div className="sticky top-24 space-y-5 rounded-[1.75rem] bg-[#f2f4f6] p-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#767683]">Service Type</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterButton active={serviceFilter === "all"} onClick={() => setServiceFilter("all")}>All</FilterButton>
                <FilterButton active={serviceFilter === "mentorship"} onClick={() => setServiceFilter("mentorship")}>Mentorship</FilterButton>
                <FilterButton active={serviceFilter === "copy_review"} onClick={() => setServiceFilter("copy_review")}>Copy Review</FilterButton>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#767683]">Availability</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterButton active={availabilityFilter === "all"} onClick={() => setAvailabilityFilter("all")}>All</FilterButton>
                <FilterButton active={availabilityFilter === "available"} onClick={() => setAvailabilityFilter("available")}>Available Now</FilterButton>
                <FilterButton active={availabilityFilter === "soon"} onClick={() => setAvailabilityFilter("soon")}>Next Slot</FilterButton>
              </div>
            </div>

            <label className="flex items-center justify-between rounded-[1.2rem] bg-white px-4 py-3">
              <span className="text-sm font-semibold text-[#191c1e]">Verified only</span>
              <button
                type="button"
                onClick={() => setVerifiedOnly((prev) => !prev)}
                className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${verifiedOnly ? "bg-[#000666]" : "bg-[#c6c5d4]"}`}
              >
                <span className={`h-5 w-5 rounded-full bg-white transition-transform ${verifiedOnly ? "translate-x-5" : ""}`} />
              </button>
            </label>

            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#000666]"
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

            <div className="flex items-center gap-3 text-sm font-semibold text-[#454652]">
              <span>{filteredRows.length} mentors</span>
              <button type="button" onClick={() => void loadMentors()} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[#000666]">
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>

          {loading ? <div className="rounded-[1.75rem] bg-white p-6 text-sm text-[#454652]">Loading mentors...</div> : null}

          {!loading && filteredRows.length === 0 ? (
            <div className="rounded-[1.75rem] bg-white p-10 text-center shadow-[0_12px_32px_rgba(25,28,30,0.05)]">
              <h2 className="font-sans text-2xl font-extrabold tracking-tight text-[#000666]">No mentors matched these filters.</h2>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 inline-flex rounded-xl bg-[#000666] px-5 py-3 text-sm font-bold text-white"
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
                  <article key={mentor.user_id} className="rounded-[2rem] bg-white p-6 shadow-[0_14px_36px_rgba(25,28,30,0.06)]">
                    <div className="flex flex-col gap-6 md:flex-row">
                      <div className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-[1.35rem] bg-[#edf1f4] shadow-[0_12px_24px_rgba(25,28,30,0.08)] md:h-32 md:w-32">
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
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#e0e0ff] to-[#8df5e4] text-2xl font-black text-[#000666]">
                            {initialsFromLabel(mentor.display_name)}
                          </div>
                        )}

                        {mentor.is_verified ? (
                          <div className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#8df5e4] shadow-[0_10px_18px_rgba(25,28,30,0.12)]">
                            <Check className="h-5 w-5 text-[#00201c]" />
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1 space-y-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <h2 className="font-sans text-3xl font-extrabold tracking-tight text-[#000666]">{mentor.display_name}</h2>
                            <p className="mt-1 text-base font-medium text-[#454652]">{mentor.headline || "Mains Mentor"}</p>
                            {mentor.city ? (
                              <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[#767683]">
                                <MapPin className="h-4 w-4" />
                                {mentor.city}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2 text-left md:text-right">
                            <p className="font-sans text-3xl font-extrabold tracking-tight text-[#000666]">
                              {price || "Request"}
                              {price ? <span className="ml-1 text-sm font-medium text-[#767683]">start</span> : null}
                            </p>
                            <div className="flex items-center gap-1 text-[#c98c00] md:justify-end">
                              <Star className="h-4 w-4 fill-current" />
                              <span className="text-sm font-bold">{review.total > 0 ? review.average.toFixed(1) : "New"}</span>
                              {review.total > 0 ? <span className="text-xs font-medium text-[#767683]">({review.total})</span> : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {badgeGroup.map((tag) => (
                            <span key={`${mentor.user_id}-${tag}`} className="rounded-full bg-[#8df5e4] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#005048]">
                              {tag}
                            </span>
                          ))}
                          {copyEvaluationEnabled(mentor) ? (
                            <span className="rounded-full bg-[#eef2f5] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#454652]">
                              Copy Evaluation + Mentorship
                            </span>
                          ) : null}
                        </div>

                        <p className="text-sm italic leading-7 text-[#454652]">&ldquo;{cleanSnippet(mentor.bio)}&rdquo;</p>

                        <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-full bg-[#eef2f5] px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#454652]">
                              {mentorStatusLabel(status)}
                            </span>
                            {availabilityText ? (
                              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#006b5f]">
                                <CalendarDays className="h-4 w-4" />
                                {availabilityText}
                              </span>
                            ) : null}
                          </div>

                          <Link
                            href={`/profiles/${mentor.user_id}`}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#000666] to-[#1a237e] px-6 py-3 text-sm font-bold text-white shadow-[0_14px_28px_rgba(0,6,102,0.16)] transition-transform hover:scale-[1.02]"
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
