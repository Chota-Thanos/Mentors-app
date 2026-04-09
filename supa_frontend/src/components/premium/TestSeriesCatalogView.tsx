"use client";

import axios from "axios";
import { ChevronDown, Info, Search, SlidersHorizontal, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useExamContext } from "@/context/ExamContext";
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
    <span className="flex items-center gap-0.5 text-amber-500" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={`${value}-${index}`}
          className={cn("h-3.5 w-3.5", index < rounded ? "fill-current" : "fill-transparent text-amber-300")}
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
  tone: "violet" | "mint" | "gold" | "neutral";
}) {
  const toneClass =
    tone === "violet"
      ? "border-violet-200 bg-violet-700 text-white"
      : tone === "mint"
        ? "border-teal-200 bg-teal-100 text-teal-900"
        : tone === "gold"
          ? "border-amber-200 bg-amber-100 text-amber-900"
          : "border-slate-200 bg-slate-100 text-slate-700";

  return <span className={cn("inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-bold", toneClass)}>{label}</span>;
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
    ? "rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
    : "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm";
  const inputClass =
    "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-500";

  return (
    <div className={shellClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Filter</p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-slate-900">Refine results</h2>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-sm font-semibold text-violet-700 transition hover:text-violet-900"
        >
          Reset
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search</span>
          <span className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by series or mentor"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Category</span>
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
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Access</span>
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
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Min price</span>
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
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Max price</span>
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

        <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold text-slate-900">Free only</span>
            <span className="mt-1 block text-xs text-slate-500">Show only free series in the list.</span>
          </span>
          <input
            type="checkbox"
            checked={onlyFree}
            onChange={(event) => onOnlyFreeChange(event.target.checked)}
            className="h-4 w-4 accent-violet-700"
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
    <article className="border-b border-slate-200 p-4 last:border-b-0 sm:p-5">
      <div className="grid gap-4 grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_170px]">
        <Link href={`/programs/${series.id}`} className="relative block h-[112px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-[140px] lg:h-[160px]">
          {cover ? (
            <Image
              src={cover}
              alt={series.title}
              fill
              unoptimized
              sizes="(max-width: 640px) 112px, (max-width: 1024px) 140px, 240px"
              className="object-cover"
            />
          ) : (
            <div className={cn(
              "flex h-full items-center justify-center bg-gradient-to-br px-4 text-center",
              isMains ? "from-amber-100 via-white to-rose-50" : "from-violet-100 via-white to-sky-50",
            )}>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">{isMains ? "Mains" : "Prelims"}</p>
                <p className="mt-2 text-sm font-bold text-slate-800">{series.test_count || 0} test{series.test_count === 1 ? "" : "s"}</p>
              </div>
            </div>
          )}
        </Link>

        <div className="min-w-0">
          <Link href={`/programs/${series.id}`} className="block">
            <h3 className="text-lg font-black leading-6 text-slate-900 transition hover:text-violet-700 sm:text-xl">
              {series.title}
            </h3>
          </Link>
          <p className="mt-1 text-sm text-slate-600">{providerName}</p>

          {review.total > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-amber-700">{review.average.toFixed(1)}</span>
              <RatingStrip value={review.average} />
              <span className="text-slate-500">({formatCompactNumber(review.total)})</span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{profile?.is_verified ? "Verified mentor" : "Newly added series"}</p>
          )}

          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{textExcerpt(series.description)}</p>

          <p className="mt-2 text-sm text-slate-500">
            {series.test_count || 0} tests
            {providerLine ? ` \u00B7 ${providerLine}` : ""}
            {categoryLine ? ` \u00B7 ${categoryLine}` : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isPremium ? <SeriesBadge label="Premium" tone="violet" /> : <SeriesBadge label="Free access" tone="mint" />}
            {isPopular ? <SeriesBadge label="Popular" tone="mint" /> : null}
            {profile?.is_verified ? <SeriesBadge label="Verified" tone="gold" /> : null}
            <SeriesBadge label={isMains ? "Answer-writing" : "MCQ series"} tone="neutral" />
          </div>

          {providerBio ? (
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{providerBio}</p>
          ) : null}

          <p className="mt-3 text-xl font-black text-slate-900 lg:hidden">{formatListingPrice(series.price)}</p>
        </div>

        <div className="hidden lg:flex lg:flex-col lg:items-end lg:justify-between">
          <div className="text-right">
            <p className="text-2xl font-black tracking-tight text-slate-900">{formatListingPrice(series.price)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {series.access_type === "free" ? "Start instantly" : series.access_type}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2">
            <Link
              href={`/programs/${series.id}`}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-violet-700 px-4 text-sm font-bold text-violet-700 transition hover:bg-violet-50"
            >
              Open series
            </Link>
            {profile ? (
              <Link
                href={`/profiles/${profile.user_id}`}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Mentor profile
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 lg:hidden">
        <Link
          href={`/programs/${series.id}`}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-violet-700 px-4 text-sm font-bold text-violet-700 transition hover:bg-violet-50"
        >
          Open series
        </Link>
      </div>
    </article>
  );
}

export default function TestSeriesCatalogView({
  testKind,
  title,
  description,
}: TestSeriesCatalogViewProps) {
  const { isAuthenticated } = useAuth();
  const { globalExamId, globalExamName, isLoading: examLoading } = useExamContext();
  const [seriesRows, setSeriesRows] = useState<TestSeriesDiscoverySeries[]>([]);
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
        const params: Record<string, unknown> = {
          limit: 200,
          series_kind: isMains ? "mains" : "quiz",
        };

        if (search.trim()) params.search = search.trim();
        if (categoryId.trim()) params.category_id = Number(categoryId);
        if (accessType !== "all") params.access_type = accessType;
        if (onlyFree) params.only_free = true;
        if (minPrice.trim()) params.min_price = Number(minPrice);
        if (maxPrice.trim()) params.max_price = Number(maxPrice);
        
        // Pass the global exam context to backend
        if (globalExamId !== null) params.exam_id = globalExamId;

        const response = await premiumApi.get<TestSeriesDiscoverySeries[]>("/programs-discovery/series", { params });
        if (!active) return;
        setSeriesRows(Array.isArray(response.data) ? response.data : []);
      } catch (error: unknown) {
        if (!active) return;
        setSeriesRows([]);
        toast.error("Failed to load programs", { description: toError(error) });
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
      row.category_ids.forEach((id, index) => {
        const label = row.category_labels[index] || `Category ${id}`;
        if (!map.has(id)) map.set(id, label);
      });
    }

    return [...map.entries()]
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
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Catalog</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-[2.35rem]">
              All {title}
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
            <div className="mt-4 rounded-3xl border border-violet-100 bg-violet-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-violet-700">Exam Scope</p>
              <p className="mt-1 text-lg font-black tracking-tight text-slate-900">
                {examLoading ? "Loading exam preference..." : globalExamName || "All Exams"}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {globalExamName
                  ? "Programs in this directory are filtered to the selected exam."
                  : "Programs in this directory are showing across all exams."}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700">
                <Info className="h-5 w-5" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">
                  Browse by mentor, price, and category before opening the full series detail.
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {isAuthenticated
                    ? "Your access continues on the detail page, where the full test roadmap and mentor actions are available."
                    : "You can inspect the full series structure first and sign in later to activate access."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <SeriesBadge label={`${sortedRows.length} results`} tone="neutral" />
            <SeriesBadge label={`${summary.providerCount} mentors`} tone="neutral" />
            <SeriesBadge label={`${summary.freeCount} free`} tone="mint" />
            {summary.ratedCount > 0 ? <SeriesBadge label={`${summary.ratedCount} rated`} tone="gold" /> : null}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)] lg:items-start">
        <div className="hidden lg:block lg:sticky lg:top-24">
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
              className="inline-flex h-[58px] items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 shadow-sm"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filter
            </button>

            <label className="block rounded-2xl border border-slate-300 bg-white px-4 py-2 shadow-sm">
              <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Sort by</span>
              <span className="mt-1 flex items-center justify-between gap-2">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="w-full appearance-none bg-transparent text-sm font-semibold text-slate-900 outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-4 w-4 text-slate-400" />
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

          <div className="hidden lg:flex lg:items-center lg:justify-between lg:rounded-3xl lg:border lg:border-slate-200 lg:bg-white lg:p-4 lg:shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Results</p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {loading ? "Refreshing results..." : `${sortedRows.length} series available`}
              </p>
            </div>

            <label className="flex min-w-[240px] items-center justify-between gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">Sort by</span>
              <div className="relative flex-1">
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="w-full appearance-none bg-transparent pr-7 text-right text-sm font-bold text-slate-900 outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </label>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-600">Loading series catalog...</p>
            </div>
          ) : null}

          {!loading && sortedRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
              <h2 className="text-xl font-black text-slate-900">No matching series right now</h2>
              <p className="mt-2 text-sm text-slate-500">Try clearing one or more filters to broaden the result set.</p>
            </div>
          ) : null}

          {!loading && sortedRows.length > 0 ? (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
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
