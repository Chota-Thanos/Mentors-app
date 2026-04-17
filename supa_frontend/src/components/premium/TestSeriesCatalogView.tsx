"use client";

import axios from "axios";
import { ChevronDown, Search, SlidersHorizontal, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useExamContext } from "@/context/ExamContext";
import { profilesApi } from "@/lib/backendServices";
import { premiumApi } from "@/lib/premiumApi";
import { richTextToPlainText } from "@/lib/richText";
import type {
  TestSeriesAccessType,
  TestSeriesDiscoverySeries,
} from "@/types/premium";

interface TestSeriesCatalogViewProps {
  testKind: "prelims" | "mains";
  title: string;
  description: string;
  listingMode?: "series";
}

type SortOption = "popular" | "highest_rated" | "newest" | "price_low" | "price_high";

const ACCESS_FILTERS: Array<{ value: "all" | TestSeriesAccessType; label: string }> = [
  { value: "all", label: "All access" },
  { value: "free", label: "Free" },
  { value: "subscription", label: "Subscription" },
  { value: "paid", label: "Paid" },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "popular", label: "Most Popular" },
  { value: "highest_rated", label: "Highest Rated" },
  { value: "newest", label: "Newest" },
  { value: "price_low", label: "Price: Low to High" },
  { value: "price_high", label: "Price: High to Low" },
];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function matchesExamIds(examIds: number[] | undefined | null, examId: number | null): boolean {
  if (!examId) return true;
  // An empty exam_ids array means the item is available to all exams
  if (!Array.isArray(examIds) || examIds.length === 0) return true;
  return examIds.includes(examId);
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function formatListingPrice(value?: number | null): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "Free";
  return `\u20B9${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function textExcerpt(value?: string | null, fallback = "Series details will appear here once the provider adds a description."): string {
  const plain = richTextToPlainText(value || "").trim();
  return plain || fallback;
}

function reviewSummaryMeta(meta: Record<string, unknown> | null | undefined): { average: number; total: number } {
  const summary = ((meta || {}) as Record<string, unknown>).review_summary as Record<string, unknown> | undefined;
  const average = Number(summary?.average_rating || 0);
  const total = Number(summary?.total_reviews || 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function sortRows(rows: TestSeriesDiscoverySeries[], sortBy: SortOption): TestSeriesDiscoverySeries[] {
  const nextRows = [...rows];
  nextRows.sort((left, right) => {
    const leftReview = reviewSummaryMeta(left.provider_profile?.meta);
    const rightReview = reviewSummaryMeta(right.provider_profile?.meta);
    const leftPrice = Number(left.series.price || 0);
    const rightPrice = Number(right.series.price || 0);
    const leftCreated = new Date(left.series.created_at || 0).getTime();
    const rightCreated = new Date(right.series.created_at || 0).getTime();
    const leftTests = Number(left.series.test_count || 0);
    const rightTests = Number(right.series.test_count || 0);

    if (sortBy === "highest_rated") {
      return (
        rightReview.average - leftReview.average
        || rightReview.total - leftReview.total
        || rightTests - leftTests
        || rightCreated - leftCreated
      );
    }

    if (sortBy === "newest") {
      return rightCreated - leftCreated || rightTests - leftTests || rightReview.total - leftReview.total;
    }

    if (sortBy === "price_low") {
      return leftPrice - rightPrice || rightReview.total - leftReview.total || rightCreated - leftCreated;
    }

    if (sortBy === "price_high") {
      return rightPrice - leftPrice || rightReview.total - leftReview.total || rightCreated - leftCreated;
    }

    const leftPopularity =
      leftReview.total * 100
      + leftReview.average * 10
      + leftTests * 4
      + (left.provider_profile?.is_verified ? 15 : 0);
    const rightPopularity =
      rightReview.total * 100
      + rightReview.average * 10
      + rightTests * 4
      + (right.provider_profile?.is_verified ? 15 : 0);

    return rightPopularity - leftPopularity || rightCreated - leftCreated;
  });

  return nextRows;
}

function RatingStrip({ value }: { value: number }) {
  const rounded = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="flex items-center gap-0.5 text-[#d68a1a]" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={`${value}-${index}`}
          className={cn("h-3.5 w-3.5", index < rounded ? "fill-current" : "fill-transparent text-[#e7c98f]")}
        />
      ))}
    </span>
  );
}

function SeriesBadge({
  label,
  tone,
}: {
  label: string;
  tone: "blue" | "mint" | "gold" | "neutral";
}) {
  const toneClass =
    tone === "blue"
      ? "border-[#cfdafb] bg-[#173aa9] text-white"
      : tone === "mint"
        ? "border-[#c9eee6] bg-[#eaf8f4] text-[#176a5c]"
        : tone === "gold"
          ? "border-[#f0ddb1] bg-[#fff3d8] text-[#80520d]"
          : "border-[#d5dced] bg-white text-[#5e6885]";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}

function CatalogFilters({
  search,
  onSearchChange,
  categoryId,
  onCategoryChange,
  categoryOptions,
  accessType,
  onAccessTypeChange,
  minPrice,
  onMinPriceChange,
  maxPrice,
  onMaxPriceChange,
  onlyFree,
  onOnlyFreeChange,
  onReset,
  compact = false,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  categoryId: string;
  onCategoryChange: (value: string) => void;
  categoryOptions: Array<{ id: number; label: string }>;
  accessType: "all" | TestSeriesAccessType;
  onAccessTypeChange: (value: "all" | TestSeriesAccessType) => void;
  minPrice: string;
  onMinPriceChange: (value: string) => void;
  maxPrice: string;
  onMaxPriceChange: (value: string) => void;
  onlyFree: boolean;
  onOnlyFreeChange: (value: boolean) => void;
  onReset: () => void;
  compact?: boolean;
}) {
  const shellClass = compact
    ? "rounded-[28px] border border-[#dbe3f6] bg-white/95 p-4 shadow-[0_18px_45px_rgba(16,31,74,0.07)]"
    : "rounded-[30px] border border-[#dbe3f6] bg-white/95 p-5 shadow-[0_20px_50px_rgba(16,31,74,0.08)]";
  const inputClass =
    "w-full rounded-[18px] border border-[#d4dced] bg-white px-3 py-3 text-sm text-[#1f2a44] outline-none transition focus:border-[#173aa9]";

  return (
    <div className={shellClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6d7690]">Refine Catalog</p>
          <h2 className="mt-1 font-sans text-[26px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">
            Filter results
          </h2>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-[12px] font-semibold text-[#173aa9] transition hover:text-[#12308c]"
        >
          Reset
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Search</span>
          <span className="flex items-center gap-2 rounded-[18px] border border-[#d4dced] bg-[#f8faff] px-3 py-3">
            <Search className="h-4 w-4 text-[#7a85a5]" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by series or mentor"
              className="w-full bg-transparent text-sm text-[#1f2a44] outline-none placeholder:text-[#7a85a5]"
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Category</span>
          <select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)} className={inputClass}>
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Access</span>
          <select
            value={accessType}
            onChange={(event) => onAccessTypeChange(event.target.value as "all" | TestSeriesAccessType)}
            className={inputClass}
          >
            {ACCESS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Min price</span>
            <input
              value={minPrice}
              onChange={(event) => onMinPriceChange(event.target.value)}
              type="number"
              min={0}
              placeholder="0"
              className={inputClass}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Max price</span>
            <input
              value={maxPrice}
              onChange={(event) => onMaxPriceChange(event.target.value)}
              type="number"
              min={0}
              placeholder="5000"
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex items-center justify-between rounded-[20px] border border-[#dbe3f6] bg-[linear-gradient(180deg,#f9fbff_0%,#f2f6ff_100%)] px-4 py-3">
          <span>
            <span className="block text-sm font-semibold text-[#1d2945]">Free only</span>
            <span className="mt-1 block text-xs leading-5 text-[#6d7690]">Show only free series in this catalog.</span>
          </span>
          <input
            type="checkbox"
            checked={onlyFree}
            onChange={(event) => onOnlyFreeChange(event.target.checked)}
            className="h-4 w-4 accent-[#173aa9]"
          />
        </label>
      </div>
    </div>
  );
}

function SeriesCard({
  row,
  isMains,
}: {
  row: TestSeriesDiscoverySeries;
  isMains: boolean;
}) {
  const { series, provider_profile: profile, category_labels } = row;
  const review = reviewSummaryMeta(profile?.meta);
  const cover = series.cover_image_url || "";
  const providerName = profile?.display_name || (isMains ? "Mentors App Mains Faculty" : "Mentors App Prelims Faculty");
  const providerLine = profile?.headline || profile?.role || (isMains ? "Mains writing mentor" : "Objective practice mentor");
  const providerBio = textExcerpt(profile?.bio, "");
  const categoryLine = category_labels.filter(Boolean).slice(0, 3).join(", ");
  const isPremium = series.access_type !== "free";
  const isPopular = review.total >= 12 && review.average >= 4.2;

  return (
    <article className="overflow-hidden rounded-[30px] border border-[#dbe3f6] bg-white shadow-[0_18px_44px_rgba(16,31,74,0.06)]">
      <div className="grid gap-5 p-5 lg:grid-cols-[220px_minmax(0,1fr)_190px] lg:p-6">
        <Link
          href={`/programs/${series.id}`}
          className="relative block h-[180px] overflow-hidden rounded-[24px] border border-[#d9e2f4] bg-[#eef3ff]"
        >
          {cover ? (
            <Image
              src={cover}
              alt={series.title}
              fill
              unoptimized
              sizes="(max-width: 1024px) 100vw, 220px"
              className="object-cover"
            />
          ) : (
            <div
              className={cn(
                "flex h-full items-end bg-gradient-to-br px-5 py-5",
                isMains ? "from-[#fff5e7] via-[#fffaf3] to-[#f5f1ff]" : "from-[#edf2ff] via-[#f9fbff] to-[#eef9f6]",
              )}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6d7690]">
                  {isMains ? "Mains Track" : "Prelims Track"}
                </p>
                <p className="mt-2 font-sans text-[28px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">
                  {series.test_count || 0}
                </p>
                <p className="mt-1 text-sm text-[#5e6885]">tests inside this program</p>
              </div>
            </div>
          )}
        </Link>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {isPremium ? <SeriesBadge label="Premium" tone="blue" /> : <SeriesBadge label="Free Access" tone="mint" />}
            {isPopular ? <SeriesBadge label="Popular" tone="gold" /> : null}
            {profile?.is_verified ? <SeriesBadge label="Verified Mentor" tone="neutral" /> : null}
            <SeriesBadge label={isMains ? "Answer Writing" : "MCQ Series"} tone="neutral" />
          </div>

          <Link href={`/programs/${series.id}`} className="block">
            <h3 className="mt-4 font-sans text-[28px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#141b2d] transition hover:text-[#173aa9]">
              {series.title}
            </h3>
          </Link>
          <p className="mt-2 text-[14px] font-medium text-[#17328f]">{providerName}</p>

          {review.total > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-[#9b650d]">{review.average.toFixed(1)}</span>
              <RatingStrip value={review.average} />
              <span className="text-[#6d7690]">({formatCompactNumber(review.total)} reviews)</span>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#6d7690]">{profile?.is_verified ? "Verified mentor-led series" : "Freshly published series"}</p>
          )}

          <p className="mt-4 line-clamp-3 text-[14px] leading-7 text-[#5f6883]">{textExcerpt(series.description)}</p>

          <div className="mt-4 rounded-[22px] bg-[linear-gradient(180deg,#f8faff_0%,#f2f6ff_100%)] px-4 py-3">
            <p className="text-[13px] font-semibold text-[#1d2945]">
              {series.test_count || 0} tests
              {providerLine ? ` · ${providerLine}` : ""}
            </p>
            {categoryLine ? <p className="mt-1 text-[13px] leading-6 text-[#6d7690]">{categoryLine}</p> : null}
            {providerBio ? <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-[#6d7690]">{providerBio}</p> : null}
          </div>

          <p className="mt-4 text-[28px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d] lg:hidden">
            {formatListingPrice(series.price)}
          </p>

          <div className="mt-4 flex flex-wrap gap-3 lg:hidden">
            <Link
              href={`/programs/${series.id}`}
              className="inline-flex items-center justify-center rounded-full bg-[#173aa9] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.2)]"
            >
              Open Program
            </Link>
            {profile ? (
              <Link
                href={`/profiles/${profile.user_id}`}
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-[13px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)]"
              >
                Mentor Profile
              </Link>
            ) : null}
          </div>
        </div>

        <div className="hidden rounded-[24px] bg-[linear-gradient(180deg,#f8faff_0%,#f1f6ff_100%)] p-5 lg:flex lg:flex-col lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Starting Access</p>
            <p className="mt-3 font-sans text-[34px] font-semibold leading-none tracking-[-0.06em] text-[#141b2d]">
              {formatListingPrice(series.price)}
            </p>
            <p className="mt-2 text-[12px] leading-6 text-[#6d7690]">
              {series.access_type === "free" ? "Start instantly from the detail page." : `Access type: ${series.access_type}`}
            </p>
          </div>

          <div className="space-y-2">
            <Link
              href={`/programs/${series.id}`}
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#173aa9] px-4 text-[13px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.2)]"
            >
              Open Program
            </Link>
            {profile ? (
              <Link
                href={`/profiles/${profile.user_id}`}
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white px-4 text-[13px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)]"
              >
                Mentor Profile
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function TestSeriesCatalogView({
  testKind,
  title,
  description,
}: TestSeriesCatalogViewProps) {
  const { globalExamId } = useExamContext();
  const [seriesRows, setSeriesRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accessType, setAccessType] = useState<"all" | TestSeriesAccessType>("all");
  const [onlyFree, setOnlyFree] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("popular");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const isMains = testKind === "mains";

  useEffect(() => {
    let active = true;

    const loadRows = async () => {
      setLoading(true);
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        let query = supabase
          .from("test_series")
          .select(`
            id, name, description, price, is_paid, cover_image_url, series_kind, created_at,
            creator_id,
            program_units(id)
          `)
          .eq("is_active", true)
          .eq("is_public", true);

        if (isMains) {
          query = query.eq("series_kind", "mains");
        } else {
          query = query.neq("series_kind", "mains");
        }

        if (search.trim()) {
          query = query.ilike("name", `%${search.trim()}%`);
        }
        if (accessType === "free" || onlyFree) {
          query = query.eq("is_paid", false);
        } else if (accessType === "paid") {
          query = query.eq("is_paid", true);
        }
        
        if (minPrice.trim() && !isNaN(Number(minPrice))) {
          query = query.gte("price", Number(minPrice));
        }
        if (maxPrice.trim() && !isNaN(Number(maxPrice))) {
          query = query.lte("price", Number(maxPrice));
        }

        const { data, error } = await query;
        if (error) throw error;
        
        if (!active) return;

        const creatorIds = Array.from(
          new Set((data || []).map((row: any) => Number(row.creator_id)).filter((id) => Number.isFinite(id) && id > 0)),
        );
        const creators = creatorIds.length
          ? new Map((await profilesApi.batch(creatorIds)).map((row) => [row.id, row]))
          : new Map<number, { display_name?: string }>();
        
        const mappedRows = (data || []).map((row: any) => ({
          series: {
             id: row.id,
             title: row.name || "",
             description: row.description || "",
             price: Number(row.price || 0),
             access_type: row.is_paid ? "paid" : "free",
             cover_image_url: row.cover_image_url || "",
             test_count: row.program_units?.length || 0,
             created_at: row.created_at,
             exam_ids: [],
          },
          provider_profile: {
             display_name: creators.get(Number(row.creator_id))?.display_name || "Faculty",
             is_verified: false,
             meta: {},
          },
          category_labels: [row.series_kind],
          category_ids: [],
        }));

        setSeriesRows(mappedRows);
      } catch (error: unknown) {
        if (!active) return;
        setSeriesRows([]);
        toast.error("Failed to load programs", { description: String((error as any).message || error) });
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadRows();

    return () => {
      active = false;
    };
  }, [accessType, categoryId, isMains, maxPrice, minPrice, onlyFree, search, globalExamId]);

  const categoryOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of seriesRows) {
      row.category_ids.forEach((id: number, index: number) => {
        const label = row.category_labels[index] || `Category ${id}`;
        if (!map.has(id)) map.set(id, label);
      });
    }

    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [seriesRows]);

  const sortedRows = useMemo(() => sortRows(seriesRows, sortBy), [seriesRows, sortBy]);

  const summary = useMemo(() => {
    const providerIds = new Set<string>();
    let freeCount = 0;
    let ratedCount = 0;

    for (const row of seriesRows) {
      if (row.provider_profile?.user_id) providerIds.add(row.provider_profile.user_id);
      if (row.series.access_type === "free" || Number(row.series.price || 0) <= 0) freeCount += 1;
      if (reviewSummaryMeta(row.provider_profile?.meta).total > 0) ratedCount += 1;
    }

    return {
      providerCount: providerIds.size,
      freeCount,
      ratedCount,
    };
  }, [seriesRows]);

  const resetFilters = () => {
    setSearch("");
    setCategoryId("");
    setAccessType("all");
    setOnlyFree(false);
    setMinPrice("");
    setMaxPrice("");
  };

  return (
    <div className="space-y-8 bg-[#f6f8ff] pb-2 text-[#192133]">
      <section className="relative overflow-hidden rounded-[34px] border border-[#dde5f7] bg-[linear-gradient(135deg,#ffffff_0%,#f2f5ff_58%,#eef9f6_100%)] px-5 py-6 shadow-[0_22px_55px_rgba(9,26,74,0.08)] sm:px-7 sm:py-8 lg:px-10 lg:py-10">
        <div className="absolute right-[-6rem] top-[-5rem] h-52 w-52 rounded-full bg-[#d9e4ff]/70 blur-3xl" />
        <div className="absolute bottom-[-7rem] left-[-4rem] h-56 w-56 rounded-full bg-[#d7f5ef]/70 blur-3xl" />
        <div className="relative max-w-4xl">
            <p className="inline-flex items-center rounded-full border border-[#cbd8fb] bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#304a92]">
              {isMains ? "Mains Catalog" : "Prelims Catalog"}
            </p>
            <h1 className="mt-4 max-w-3xl font-sans text-[38px] font-semibold leading-[0.94] tracking-[-0.07em] text-[#1235ae] sm:text-[48px] lg:text-[58px]">
              All {title}
            </h1>
            <p className="mt-5 max-w-3xl text-[14px] leading-7 text-[#6d7690] sm:text-[15px]">{description}</p>

            <div className="mt-6 flex flex-wrap gap-2">
              <SeriesBadge label={`${sortedRows.length} results`} tone="neutral" />
              <SeriesBadge label={`${summary.providerCount} mentors`} tone="neutral" />
              <SeriesBadge label={`${summary.freeCount} free`} tone="mint" />
              {summary.ratedCount > 0 ? <SeriesBadge label={`${summary.ratedCount} rated`} tone="gold" /> : null}
            </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)] lg:items-start">
        <div className="hidden lg:sticky lg:top-24 lg:block">
          <CatalogFilters
            search={search}
            onSearchChange={setSearch}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            categoryOptions={categoryOptions}
            accessType={accessType}
            onAccessTypeChange={setAccessType}
            minPrice={minPrice}
            onMinPriceChange={setMinPrice}
            maxPrice={maxPrice}
            onMaxPriceChange={setMaxPrice}
            onlyFree={onlyFree}
            onOnlyFreeChange={setOnlyFree}
            onReset={resetFilters}
          />
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] lg:hidden">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((value) => !value)}
              className="inline-flex h-[56px] items-center justify-center gap-2 rounded-full bg-white px-5 text-[13px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)]"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filter
            </button>

            <label className="block rounded-[20px] border border-[#dbe3f6] bg-white px-4 py-2 shadow-[0_14px_28px_rgba(21,31,76,0.06)]">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Sort by</span>
              <span className="mt-1 flex items-center justify-between gap-2">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="w-full appearance-none bg-transparent text-[13px] font-semibold text-[#1d2945] outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-4 w-4 text-[#7a85a5]" />
              </span>
            </label>
          </div>

          {mobileFiltersOpen ? (
            <div className="lg:hidden">
              <CatalogFilters
                search={search}
                onSearchChange={setSearch}
                categoryId={categoryId}
                onCategoryChange={setCategoryId}
                categoryOptions={categoryOptions}
                accessType={accessType}
                onAccessTypeChange={setAccessType}
                minPrice={minPrice}
                onMinPriceChange={setMinPrice}
                maxPrice={maxPrice}
                onMaxPriceChange={setMaxPrice}
                onlyFree={onlyFree}
                onOnlyFreeChange={setOnlyFree}
                onReset={resetFilters}
                compact
              />
            </div>
          ) : null}

          <div className="hidden lg:flex lg:items-center lg:justify-between lg:rounded-[28px] lg:border lg:border-[#dbe3f6] lg:bg-white lg:p-4 lg:shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Results</p>
              <p className="mt-1 text-[15px] font-semibold text-[#1d2945]">
                {loading ? "Refreshing results..." : `${sortedRows.length} programs available`}
              </p>
            </div>

            <label className="flex min-w-[250px] items-center justify-between gap-3 rounded-[18px] border border-[#d4dced] bg-[#f8faff] px-4 py-3">
              <span className="text-[13px] font-semibold text-[#1d2945]">Sort by</span>
              <div className="relative flex-1">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="w-full appearance-none bg-transparent pr-7 text-right text-[13px] font-semibold text-[#1d2945] outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a85a5]" />
              </div>
            </label>
          </div>

          {loading ? (
            <div className="rounded-[28px] border border-[#dbe3f6] bg-white p-6 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
              <p className="text-sm font-medium text-[#5f6883]">Loading series catalog...</p>
            </div>
          ) : null}

          {!loading && sortedRows.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[#cfd7ea] bg-white p-10 text-center shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
              <h2 className="font-sans text-[32px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">
                No matching programs right now
              </h2>
              <p className="mt-3 text-[14px] leading-7 text-[#6d7690]">Try clearing one or more filters to broaden the result set.</p>
            </div>
          ) : null}

          {!loading && sortedRows.length > 0 ? (
            <div className="space-y-4">
              {sortedRows.map((row) => (
                <SeriesCard key={row.series.id} row={row} isMains={isMains} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
