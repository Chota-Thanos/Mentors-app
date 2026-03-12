"use client";

import axios from "axios";
import { ArrowRight, MapPin, RefreshCcw, Search, ShieldCheck, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type { MentorAvailabilityStatus, ProfessionalProfile } from "@/types/premium";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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

function textExcerpt(value?: string | null, fallback = "Profile details will be updated soon."): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

const mentorStatusLabel = (status?: MentorAvailabilityStatus | null): string => {
  if (!status) return "Status unavailable";
  if (status.status === "available_now") return "Available Now";
  if (status.status === "busy") return "Busy";
  return "Offline";
};

const mentorStatusBadgeClass = (status?: MentorAvailabilityStatus | null): string => {
  if (!status) return "border-slate-200 bg-slate-100 text-slate-700";
  if (status.status === "available_now") return "border-emerald-200 bg-emerald-100 text-emerald-800";
  if (status.status === "busy") return "border-amber-200 bg-amber-100 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
};

const formatDateTime = (value?: string | null): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const reviewSummaryMeta = (profile: ProfessionalProfile): { average: number; total: number } => {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const reviewSummary = (meta.review_summary || {}) as Record<string, unknown>;
  const average = Number(reviewSummary.average_rating || 0);
  const total = Number(reviewSummary.total_reviews || 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    total: Number.isFinite(total) ? total : 0,
  };
};

const copyEvaluationEnabled = (profile: ProfessionalProfile): boolean =>
  Boolean((profile.meta || {})?.copy_evaluation_enabled);

export default function MentorDirectoryView() {
  const [rows, setRows] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [mentorStatusByUserId, setMentorStatusByUserId] = useState<Record<string, MentorAvailabilityStatus>>({});

  const loadMentors = async () => {
    setLoading(true);
    try {
      const response = await premiumApi.get<ProfessionalProfile[]>("/mentors/public", {
        params: { only_verified: verifiedOnly, limit: 200 },
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
          const statusMap: Record<string, MentorAvailabilityStatus> = {};
          for (const row of Array.isArray(statusResponse.data) ? statusResponse.data : []) {
            const providerUserId = String(row.provider_user_id || "").trim();
            if (!providerUserId) continue;
            statusMap[providerUserId] = row;
          }
          setMentorStatusByUserId(statusMap);
        } catch {
          setMentorStatusByUserId({});
        }
      }
    } catch (error: unknown) {
      setRows([]);
      setMentorStatusByUserId({});
      toast.error("Failed to load mains mentors", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMentors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedOnly]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.display_name,
        row.headline || "",
        row.city || "",
        row.specialization_tags.join(" "),
        row.highlights.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search]);

  const summary = useMemo(() => {
    let verifiedCount = 0;
    let copyEvalCount = 0;
    let availableNowCount = 0;

    for (const row of filteredRows) {
      if (row.is_verified) verifiedCount += 1;
      if (copyEvaluationEnabled(row)) copyEvalCount += 1;
      if (mentorStatusByUserId[row.user_id]?.status === "available_now") availableNowCount += 1;
    }

    return {
      verifiedCount,
      copyEvalCount,
      availableNowCount,
    };
  }, [filteredRows, mentorStatusByUserId]);

  const resetFilters = () => {
    setSearch("");
    setVerifiedOnly(false);
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-6 shadow-sm sm:p-8">
        <div className="absolute -right-12 top-0 h-40 w-40 rounded-full bg-emerald-200/60 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-36 w-36 rounded-full bg-sky-100/80 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-end">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-bold uppercase tracking-[0.25em] text-emerald-800">
              <Sparkles className="h-3.5 w-3.5" />
              Mentor discovery
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">Guide / Evaluate / Mentor</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Mains Mentor Directory</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                Browse verified Mains Mentor profiles, highlights, and specialization areas before requesting mentorship.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-900">
                <ShieldCheck className="h-3.5 w-3.5" />
                Verified and public mentor profiles
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-900">
                <Star className="h-3.5 w-3.5" />
                Copy-evaluation capable mentors are clearly tagged
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.5rem] border border-emerald-100 bg-white/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Visible mentors</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{filteredRows.length}</p>
              <p className="mt-1 text-sm text-slate-600">Profiles matching the current search and verification filter.</p>
            </div>
            <div className="rounded-[1.5rem] border border-emerald-100 bg-white/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Verified</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{summary.verifiedCount}</p>
              <p className="mt-1 text-sm text-slate-600">Mentors carrying the verified badge in the current result set.</p>
            </div>
            <div className="rounded-[1.5rem] border border-emerald-100 bg-white/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Copy evaluation</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{summary.copyEvalCount}</p>
              <p className="mt-1 text-sm text-slate-600">Mentors accepting direct answer-copy submissions from profile.</p>
            </div>
            <div className="rounded-[1.5rem] border border-emerald-100 bg-white/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Available now</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{summary.availableNowCount}</p>
              <p className="mt-1 text-sm text-slate-600">Mentors currently marked available in the live status feed.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white/95 p-5 shadow-sm backdrop-blur sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-600">
              <Search className="h-3.5 w-3.5" />
              Search mentors
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-slate-900">Filter by name, city, or specialization</h2>
            <p className="mt-1 text-sm text-slate-600">Use search and the verified toggle to focus the mentor list.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Reset filters
            </button>
            <button
              type="button"
              onClick={() => void loadMentors()}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Search</span>
            <span className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm transition focus-within:border-slate-400 focus-within:bg-white">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Search mains mentor name, city, specialization"
              />
            </span>
          </label>

          <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm md:min-w-[220px]">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Quick filter</span>
              <span className="mt-1 block text-sm font-semibold text-slate-900">Verified only</span>
            </span>
            <input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} className="h-4 w-4 accent-slate-900" />
          </label>
        </div>

        <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
          Mentors with the <span className="font-semibold text-emerald-700">Copy Eval + Mentorship</span> tag accept direct answer-copy submission from their profile page.
        </p>
      </section>

      {loading ? (
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            Loading mains mentors...
          </div>
        </div>
      ) : null}

      {!loading && filteredRows.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
            <Sparkles className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">No mains mentors found for current filters</h3>
          <p className="mt-2 text-sm text-slate-500">Try clearing the search or verified-only filter to broaden the result set.</p>
        </div>
      ) : null}

      {!loading && filteredRows.length > 0 ? (
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Directory results</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{filteredRows.length} mentor profiles ready to explore</h2>
          </div>
          <p className="hidden text-sm text-slate-500 md:block">Cards surface live status, review summary, and direct actions.</p>
        </div>
      ) : null}

      {!loading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map((mentor) => {
            const mentorStatus = mentorStatusByUserId[mentor.user_id] || null;
            const nextAvailableAt = formatDateTime(mentorStatus?.next_available_at || null);
            const review = reviewSummaryMeta(mentor);

            return (
              <article
                key={mentor.user_id}
                className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="h-24 bg-gradient-to-r from-slate-900 via-emerald-700 to-sky-500" />
                <div className="px-5 pb-5 pt-0">
                  <div className="-mt-10 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="relative h-20 w-20 overflow-hidden rounded-[1.5rem] border-4 border-white bg-slate-100 shadow-lg">
                        {mentor.profile_image_url ? (
                          <Image
                            src={mentor.profile_image_url}
                            alt={mentor.display_name}
                            fill
                            unoptimized
                            sizes="80px"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-100 to-sky-100 text-lg font-black text-slate-900">
                            {initialsFromLabel(mentor.display_name)}
                          </div>
                        )}
                      </div>

                      <div className="pt-11">
                        <p className="text-lg font-black tracking-tight text-slate-900">{mentor.display_name}</p>
                        <p className="text-sm text-slate-500">{mentor.headline || "Mains Mentor"}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-4">
                      {mentor.is_verified ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Verified</span>
                      ) : null}
                      <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]", mentorStatusBadgeClass(mentorStatus))}>
                        {mentorStatusLabel(mentorStatus)}
                      </span>
                    </div>
                  </div>

                  {nextAvailableAt ? (
                    <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                      Next available: {nextAvailableAt}
                    </p>
                  ) : null}

                  <p className="mt-4 text-sm leading-6 text-slate-600">{textExcerpt(mentor.bio)}</p>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    {mentor.years_experience ? <span className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">{mentor.years_experience}+ years</span> : null}
                    {mentor.city ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                        <MapPin className="h-3.5 w-3.5" />
                        {mentor.city}
                      </span>
                    ) : null}
                    {review.total > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {review.average.toFixed(1)} / {review.total}
                      </span>
                    ) : null}
                    {copyEvaluationEnabled(mentor) ? <span className="rounded-full bg-emerald-100 px-3 py-1.5 font-semibold text-emerald-700">Copy Eval + Mentorship</span> : null}
                    {mentor.languages.slice(0, 2).map((language) => (
                      <span key={`${mentor.user_id}-${language}`} className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
                        {language}
                      </span>
                    ))}
                  </div>

                  {mentor.specialization_tags.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {mentor.specialization_tags.slice(0, 4).map((tag) => (
                        <span key={`${mentor.user_id}-${tag}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {(mentor.highlights.length > 0 || mentor.credentials.length > 0) ? (
                    <div className="mt-4 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                      {mentor.highlights.length > 0 ? (
                        <ul className="space-y-1 text-xs text-slate-600">
                          {mentor.highlights.slice(0, 3).map((highlight, index) => (
                            <li key={`${mentor.user_id}-highlight-${index}`}>- {highlight}</li>
                          ))}
                        </ul>
                      ) : null}
                      {mentor.credentials.length > 0 ? (
                        <p className={cn("text-xs text-slate-500", mentor.highlights.length > 0 ? "mt-3" : "")}>
                          Credentials: {mentor.credentials.slice(0, 2).join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link href={`/profiles/${mentor.user_id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
                      Availability & Book
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    {copyEvaluationEnabled(mentor) ? (
                      <Link
                        href={`/profiles/${mentor.user_id}#direct-copy-evaluation`}
                        className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        Send Copy
                      </Link>
                    ) : null}
                    {mentor.contact_url ? (
                      <a
                        href={mentor.contact_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        Contact
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
