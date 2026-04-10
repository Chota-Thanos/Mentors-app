"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Star } from "lucide-react";

import { premiumApi } from "@/lib/premiumApi";
import type { ProfessionalProfile, TestSeriesDiscoverySeries } from "@/types/premium";

type RailMode = "prelims" | "mains" | "mentors";
type MixedItem =
  | { kind: "prelims"; row: TestSeriesDiscoverySeries }
  | { kind: "mains"; row: TestSeriesDiscoverySeries }
  | { kind: "mentors"; row: ProfessionalProfile };

function toErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message || "Failed to load featured content.");
  }
  return "Failed to load featured content.";
}

function textExcerpt(value: string | null | undefined, fallback = "", max = 120): string {
  const text = String(value || fallback || "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function initialsFromLabel(value: string): string {
  const parts = String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "UP";
}

function formatListingPrice(value: number): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "Free";
  return `INR ${amount.toLocaleString("en-IN")}`;
}

function mentorPriceLabel(profile: ProfessionalProfile): string | null {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const amount = Number(meta.mentorship_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `INR ${amount.toLocaleString("en-IN")}`;
}

function mentorReviewMeta(profile: ProfessionalProfile): { average: number; total: number } {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const reviewSummary = (meta.review_summary || {}) as Record<string, unknown>;
  return {
    average: Number(reviewSummary.average_rating || 0) || 0,
    total: Number(reviewSummary.total_reviews || 0) || 0,
  };
}

async function fetchPrograms(mode: "prelims" | "mains", limit: number): Promise<TestSeriesDiscoverySeries[]> {
  const response = await premiumApi.get<TestSeriesDiscoverySeries[]>("/programs-discovery/series", {
    params: { limit, series_kind: mode === "mains" ? "mains" : "quiz" },
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchMentors(limit: number): Promise<ProfessionalProfile[]> {
  const response = await premiumApi.get<ProfessionalProfile[]>("/mentors/public", {
    params: { only_verified: true, limit },
  });
  return Array.isArray(response.data) ? response.data : [];
}

function SeriesCard({
  row,
  mode,
  eyebrow,
}: {
  row: TestSeriesDiscoverySeries;
  mode: "prelims" | "mains";
  eyebrow?: string;
}) {
  const { series, provider_profile: profile, category_labels } = row;
  const providerName = profile?.display_name || (mode === "mains" ? "Mains Faculty" : "Prelims Faculty");
  const cover = series.cover_image_url || "";
  const categoryLine = category_labels.filter(Boolean).slice(0, 2).join(", ");
  const accessLine = series.access_type === "free" || Number(series.price || 0) <= 0 ? "Free" : String(series.access_type || "").toLowerCase();

  return (
    <article className="min-w-[280px] max-w-[280px] snap-start rounded-[24px] border border-[#dce3fb] bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
      <Link href={`/programs/${series.id}`} className="block overflow-hidden rounded-[18px] border border-[#e3e8fb] bg-[#eef3ff]">
        {cover ? (
          <Image
            src={cover}
            alt={series.title}
            width={560}
            height={360}
            unoptimized
            className="h-[168px] w-full object-cover"
          />
        ) : (
          <div className={`flex h-[168px] items-center justify-center bg-[linear-gradient(135deg,${mode === "mains" ? "#f6ead7,#fff7ef" : "#eef3ff,#ffffff"})]`}>
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5f7aa9]">
                {mode === "mains" ? "Mains" : "Prelims"}
              </p>
              <p className="mt-2 text-[14px] font-semibold text-[#182033]">{series.test_count || 0} tests</p>
            </div>
          </div>
        )}
      </Link>

      <div className="mt-4">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f7aa9]">{eyebrow}</p>
        ) : null}
        <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">{series.title}</p>
        <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{providerName}</p>
        <p className="mt-2 text-[12px] leading-6 text-[#6c7590]">{textExcerpt(series.description, "Structured preparation track.")}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1739ac]">
          {accessLine}
        </span>
        {categoryLine ? (
          <span className="rounded-full bg-[#f5f7fc] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#65708f]">
            {categoryLine}
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[15px] font-semibold text-[#091a4a]">{formatListingPrice(series.price)}</p>
        <Link
          href={`/programs/${series.id}`}
          className="inline-flex items-center gap-1 rounded-full bg-[#173aa9] px-4 py-2 text-[12px] font-semibold text-white"
        >
          View Program
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function MentorCard({ mentor, eyebrow }: { mentor: ProfessionalProfile; eyebrow?: string }) {
  const review = mentorReviewMeta(mentor);
  const badge = mentor.specialization_tags[0] || mentor.credentials[0] || mentor.highlights[0] || "Verified Mentor";
  const fee = mentorPriceLabel(mentor);

  return (
    <article className="min-w-[280px] max-w-[280px] snap-start rounded-[24px] border border-[#dce3fb] bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
      <div className="relative overflow-hidden rounded-[18px] border border-[#e3e8fb] bg-[#eef3ff]">
        {mentor.profile_image_url ? (
          <Image
            src={mentor.profile_image_url}
            alt={mentor.display_name}
            width={560}
            height={360}
            unoptimized
            className="h-[168px] w-full object-cover"
          />
        ) : (
          <div className="flex h-[168px] items-center justify-center bg-[linear-gradient(135deg,#e0e0ff_0%,#8df5e4_100%)] text-[34px] font-black text-[#000666]">
            {initialsFromLabel(mentor.display_name)}
          </div>
        )}
        <div className="absolute right-3 top-3 rounded-full bg-[#8df5e4] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#003a34]">
          {badge}
        </div>
      </div>

      <div className="mt-4">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f7aa9]">{eyebrow}</p>
        ) : null}
        <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">{mentor.display_name}</p>
        <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{mentor.headline || "Mentor"}</p>
        <p className="mt-2 text-[12px] leading-6 text-[#6c7590]">{textExcerpt(mentor.bio, "Structured mentorship for UPSC aspirants.")}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {review.total > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1cf] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7c5500]">
            <Star className="h-3 w-3 fill-current" />
            {review.average.toFixed(1)}
          </span>
        ) : null}
        {mentor.specialization_tags.slice(0, 1).map((tag) => (
          <span key={`${mentor.user_id}-${tag}`} className="rounded-full bg-[#eef4ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1739ac]">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-[#091a4a]">{fee ? `Starts ${fee}` : "Request first"}</p>
        <Link
          href={`/profiles/${mentor.user_id}`}
          className="inline-flex items-center gap-1 rounded-full bg-[#173aa9] px-4 py-2 text-[12px] font-semibold text-white"
        >
          View Mentor
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function MixedCard({ item }: { item: MixedItem }) {
  if (item.kind === "mentors") {
    return <MentorCard mentor={item.row} eyebrow="Featured Mentor" />;
  }
  return (
    <SeriesCard
      row={item.row}
      mode={item.kind}
      eyebrow={item.kind === "mains" ? "Featured Mains Program" : "Featured Prelims Program"}
    />
  );
}

export default function FeaturedContentRail({
  mode,
  title,
  subtitle,
  browseHref,
  className = "",
  limit = 6,
}: {
  mode: RailMode;
  title: string;
  subtitle?: string;
  browseHref: string;
  className?: string;
  limit?: number;
}) {
  const [programRows, setProgramRows] = useState<TestSeriesDiscoverySeries[]>([]);
  const [mentorRows, setMentorRows] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        if (mode === "mentors") {
          const data = await fetchMentors(limit);
          if (!active) return;
          setMentorRows(data);
          setProgramRows([]);
        } else {
          const data = await fetchPrograms(mode, limit);
          if (!active) return;
          setProgramRows(data);
          setMentorRows([]);
        }
      } catch (loadError: unknown) {
        if (!active) return;
        setProgramRows([]);
        setMentorRows([]);
        setError(toErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [limit, mode]);

  const hasRows = useMemo(
    () => (mode === "mentors" ? mentorRows.length > 0 : programRows.length > 0),
    [mentorRows.length, mode, programRows.length],
  );

  return (
    <section className={className}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-[22px] font-black tracking-tight text-[#091a4a]">{title}</h3>
          {subtitle ? <p className="mt-1 text-[13px] leading-6 text-[#6c7590]">{subtitle}</p> : null}
        </div>
        <Link href={browseHref} className="shrink-0 text-[13px] font-semibold text-[#1739ac]">
          Browse all
        </Link>
      </div>

      {loading ? (
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-[320px] min-w-[280px] animate-pulse rounded-[24px] border border-[#dce3fb] bg-white/70" />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-[#d5dcf2] bg-white px-4 py-6 text-sm text-[#7b86a4]">
          {error}
        </div>
      ) : null}

      {!loading && !error && hasRows ? (
        <div className="mt-4 flex snap-x gap-4 overflow-x-auto pb-2">
          {mode === "mentors"
            ? mentorRows.map((mentor) => <MentorCard key={mentor.user_id} mentor={mentor} />)
            : programRows.map((row) => <SeriesCard key={row.series.id} row={row} mode={mode} />)}
        </div>
      ) : null}
    </section>
  );
}

export function FeaturedMixedRail({
  title,
  subtitle,
  className = "",
  limitPerMode = 2,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  limitPerMode?: number;
}) {
  const [prelimsRows, setPrelimsRows] = useState<TestSeriesDiscoverySeries[]>([]);
  const [mainsRows, setMainsRows] = useState<TestSeriesDiscoverySeries[]>([]);
  const [mentorRows, setMentorRows] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [prelims, mains, mentors] = await Promise.all([
          fetchPrograms("prelims", limitPerMode),
          fetchPrograms("mains", limitPerMode),
          fetchMentors(limitPerMode),
        ]);
        if (!active) return;
        setPrelimsRows(prelims);
        setMainsRows(mains);
        setMentorRows(mentors);
      } catch (loadError: unknown) {
        if (!active) return;
        setPrelimsRows([]);
        setMainsRows([]);
        setMentorRows([]);
        setError(toErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [limitPerMode]);

  const items = useMemo<MixedItem[]>(() => {
    const output: MixedItem[] = [];
    const maxLength = Math.max(prelimsRows.length, mainsRows.length, mentorRows.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (prelimsRows[index]) output.push({ kind: "prelims", row: prelimsRows[index] });
      if (mainsRows[index]) output.push({ kind: "mains", row: mainsRows[index] });
      if (mentorRows[index]) output.push({ kind: "mentors", row: mentorRows[index] });
    }
    return output;
  }, [mainsRows, mentorRows, prelimsRows]);

  return (
    <section className={className}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-[22px] font-black tracking-tight text-[#091a4a]">{title}</h3>
          {subtitle ? <p className="mt-1 text-[13px] leading-6 text-[#6c7590]">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold text-[#1739ac]">
          <Link href="/programs/prelims">Prelims</Link>
          <Link href="/programs/mains">Mains</Link>
          <Link href="/mentors/discover">Mentors</Link>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-[320px] min-w-[280px] animate-pulse rounded-[24px] border border-[#dce3fb] bg-white/70" />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <div className="mt-4 rounded-[18px] border border-dashed border-[#d5dcf2] bg-white px-4 py-6 text-sm text-[#7b86a4]">
          {error}
        </div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="mt-4 flex snap-x gap-4 overflow-x-auto pb-2">
          {items.map((item, index) => (
            <MixedCard key={`${item.kind}-${item.kind === "mentors" ? item.row.user_id : item.row.series.id}-${index}`} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
