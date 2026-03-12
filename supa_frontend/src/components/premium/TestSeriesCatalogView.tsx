"use client";

import axios from "axios";
import { ArrowRight, BookOpen, IndianRupee, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
import { richTextToPlainText } from "@/lib/richText";
import type {
  TestSeriesAccessType,
  TestSeriesDiscoverySeries,
  TestSeriesDiscoveryTest,
} from "@/types/premium";

interface TestSeriesCatalogViewProps {
  testKind: "prelims" | "mains";
  title: string;
  description: string;
  listingMode?: "test" | "series";
}

const reviewSummaryMeta = (meta: Record<string, unknown> | null | undefined): { average: number; total: number } => {
  const summary = ((meta || {}) as Record<string, unknown>).review_summary as Record<string, unknown> | undefined;
  const average = Number(summary?.average_rating || 0);
  const total = Number(summary?.total_reviews || 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    total: Number.isFinite(total) ? total : 0,
  };
};

const ACCESS_FILTERS: Array<{ value: "all" | TestSeriesAccessType; label: string }> = [
  { value: "all", label: "All Access Types" },
  { value: "free", label: "Free" },
  { value: "subscription", label: "Subscription" },
  { value: "paid", label: "Paid" },
];

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function formatPrice(value?: number | null): string {
  const amount = Number(value || 0);
  if (amount <= 0) return "Free";
  return `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;
}

function accessTone(accessType: TestSeriesAccessType): string {
  if (accessType === "free") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (accessType === "subscription") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function initialsFromLabel(label: string): string {
  const tokens = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return "UP";
  return tokens.map((token) => token.charAt(0).toUpperCase()).join("");
}

function textExcerpt(value?: string | null, fallback = "No description provided yet."): string {
  const plain = richTextToPlainText(value || "").trim();
  return plain || fallback;
}

export default function TestSeriesCatalogView({
  testKind,
  title,
  description,
  listingMode = "test",
}: TestSeriesCatalogViewProps) {
  const { isAuthenticated } = useAuth();
  const isMains = testKind === "mains";

  const [testRows, setTestRows] = useState<TestSeriesDiscoveryTest[]>([]);
  const [seriesRows, setSeriesRows] = useState<TestSeriesDiscoverySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accessType, setAccessType] = useState<"all" | TestSeriesAccessType>("all");
  const [onlyFree, setOnlyFree] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [enrollingSeriesId, setEnrollingSeriesId] = useState<number | null>(null);

  const activeRows = useMemo(
    () => (listingMode === "series" ? seriesRows : testRows),
    [listingMode, seriesRows, testRows],
  );

  const loadRows = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { limit: 200 };
      if (search.trim()) params.search = search.trim();
      if (categoryId.trim()) params.category_id = Number(categoryId);
      if (accessType !== "all") params.access_type = accessType;
      if (onlyFree) params.only_free = true;
      if (minPrice.trim()) params.min_price = Number(minPrice);
      if (maxPrice.trim()) params.max_price = Number(maxPrice);

      if (listingMode === "series") {
        params.series_kind = testKind === "mains" ? "mains" : "quiz";
        const response = await premiumApi.get<TestSeriesDiscoverySeries[]>("/test-series-discovery/series", { params });
        setSeriesRows(Array.isArray(response.data) ? response.data : []);
        setTestRows([]);
      } else {
        params.test_kind = testKind;
        const response = await premiumApi.get<TestSeriesDiscoveryTest[]>("/test-series-discovery/tests", { params });
        setTestRows(Array.isArray(response.data) ? response.data : []);
        setSeriesRows([]);
      }
    } catch (error: unknown) {
      setSeriesRows([]);
      setTestRows([]);
      toast.error("Failed to load test series", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testKind, listingMode, search, categoryId, accessType, onlyFree, minPrice, maxPrice]);

  const categoryOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of activeRows) {
      row.category_ids.forEach((id, index) => {
        const label = row.category_labels[index] || `Category ${id}`;
        if (!map.has(id)) map.set(id, label);
      });
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [activeRows]);

  const summary = useMemo(() => {
    const providerIds = new Set<string>();
    let freeCount = 0;

    if (listingMode === "series") {
      for (const row of seriesRows) {
        if (row.provider_profile?.user_id) providerIds.add(row.provider_profile.user_id);
        if (row.series.access_type === "free" || Number(row.series.price || 0) <= 0) freeCount += 1;
      }
    } else {
      for (const row of testRows) {
        if (row.provider_profile?.user_id) providerIds.add(row.provider_profile.user_id);
        if (row.series.access_type === "free" || Number(row.test.price || 0) <= 0) freeCount += 1;
      }
    }

    return {
      providerCount: providerIds.size,
      freeCount,
    };
  }, [listingMode, seriesRows, testRows]);

  const enrollInSeries = async (seriesId: number) => {
    if (!isAuthenticated) {
      toast.error("Sign in required to enroll.");
      return;
    }
    setEnrollingSeriesId(seriesId);
    try {
      await premiumApi.post(`/test-series/${seriesId}/enroll`, { access_source: "self_service" });
      toast.success("Enrolled successfully");
    } catch (error: unknown) {
      toast.error("Failed to enroll", { description: toError(error) });
    } finally {
      setEnrollingSeriesId(null);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setCategoryId("");
    setAccessType("all");
    setOnlyFree(false);
    setMinPrice("");
    setMaxPrice("");
  };

  const searchPlaceholder = listingMode === "series" ? "Search by series or mentor name" : "Search by test or series title";
  const resultLabel = listingMode === "series" ? "series" : "test";
  const heroGradient = isMains ? "from-amber-50 via-white to-emerald-50" : "from-sky-50 via-white to-amber-50";
  const heroBorder = isMains ? "border-amber-200/80" : "border-sky-200/80";
  const heroBadge = isMains ? "border-amber-200 bg-white/85 text-amber-800" : "border-sky-200 bg-white/85 text-sky-800";
  const heroStatTint = isMains ? "border-amber-100 bg-white/80" : "border-sky-100 bg-white/80";
  const providerPanelTint = isMains ? "border-amber-100 bg-amber-50/70" : "border-sky-100 bg-sky-50/70";
  const avatarTint = isMains ? "bg-amber-200 text-amber-900" : "bg-sky-200 text-sky-900";

  return (
    <div className="space-y-6">
      <section className={cn("relative overflow-hidden rounded-[2rem] border bg-gradient-to-br p-6 shadow-sm sm:p-8", heroGradient, heroBorder)}>
        <div className={cn("absolute -right-12 top-0 h-40 w-40 rounded-full blur-3xl", isMains ? "bg-amber-200/60" : "bg-sky-200/60")} />
        <div className={cn("absolute bottom-0 left-0 h-36 w-36 rounded-full blur-3xl", isMains ? "bg-emerald-100/80" : "bg-amber-100/80")} />

        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-end">
          <div className="space-y-4">
            <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.25em]", heroBadge)}>
              <Sparkles className="h-3.5 w-3.5" />
              {listingMode === "series" ? "Curated series" : "Exam-ready papers"}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                {isMains ? "Write / Review / Improve" : "Attempt / Analyze / Repeat"}
              </p>
              <h1 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold", isMains ? "border-amber-200 bg-amber-100 text-amber-900" : "border-sky-200 bg-sky-100 text-sky-900")}>
                <BookOpen className="h-3.5 w-3.5" />
                {listingMode === "series" ? "Structured learning paths" : "Paper-level discovery"}
              </span>
              <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold", isMains ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
                <ShieldCheck className="h-3.5 w-3.5" />
                {isAuthenticated ? "Self-serve enrollment available" : "Sign in to unlock enrollment"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn("rounded-[1.5rem] border p-4 shadow-sm backdrop-blur", heroStatTint)}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Live results</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{activeRows.length}</p>
              <p className="mt-1 text-sm text-slate-600">Published {resultLabel}{activeRows.length === 1 ? "" : "s"} in this catalog.</p>
            </div>
            <div className={cn("rounded-[1.5rem] border p-4 shadow-sm backdrop-blur", heroStatTint)}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Focus areas</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{categoryOptions.length}</p>
              <p className="mt-1 text-sm text-slate-600">Category filters derived from the current result set.</p>
            </div>
            <div className={cn("rounded-[1.5rem] border p-4 shadow-sm backdrop-blur", heroStatTint)}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Providers</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{summary.providerCount}</p>
              <p className="mt-1 text-sm text-slate-600">Profiles connected to the visible catalog entries.</p>
            </div>
            <div className={cn("rounded-[1.5rem] border p-4 shadow-sm backdrop-blur", heroStatTint)}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Free options</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{summary.freeCount}</p>
              <p className="mt-1 text-sm text-slate-600">Entries currently discoverable without checkout.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white/95 p-5 shadow-sm backdrop-blur sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-600">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Refine catalog
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-slate-900">Find the right {resultLabel} faster</h2>
            <p className="mt-1 text-sm text-slate-600">Use search, category, access, and price filters to narrow the visible catalog.</p>
          </div>

          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Reset filters
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Search</span>
            <span className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm transition focus-within:border-slate-400 focus-within:bg-white">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder={searchPlaceholder}
              />
            </span>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Category</span>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400 focus:bg-white"
            >
              <option value="">All Categories</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Access type</span>
            <select
              value={accessType}
              onChange={(event) => setAccessType(event.target.value as "all" | TestSeriesAccessType)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400 focus:bg-white"
            >
              {ACCESS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Min price</span>
            <span className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm transition focus-within:border-slate-400 focus-within:bg-white">
              <IndianRupee className="h-4 w-4 text-slate-400" />
              <input
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                type="number"
                min={0}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Minimum price"
              />
            </span>
          </label>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Max price</span>
            <span className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm transition focus-within:border-slate-400 focus-within:bg-white">
              <IndianRupee className="h-4 w-4 text-slate-400" />
              <input
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                type="number"
                min={0}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Maximum price"
              />
            </span>
          </label>

          <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Quick filter</span>
              <span className="mt-1 block text-sm font-semibold text-slate-900">Show free options only</span>
            </span>
            <input type="checkbox" checked={onlyFree} onChange={(event) => setOnlyFree(event.target.checked)} className="h-4 w-4 accent-slate-900" />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing <span className="font-semibold text-slate-800">{activeRows.length}</span> {resultLabel}
            {activeRows.length === 1 ? "" : "s"} after current filters.
          </p>
          <p>{isMains ? "Mains journeys focus on writing flow and mentorship visibility." : "Prelims papers stay optimized for quick objective-practice discovery."}</p>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className={cn("h-2.5 w-2.5 animate-pulse rounded-full", isMains ? "bg-amber-500" : "bg-sky-500")} />
            Loading curated {resultLabel}s...
          </div>
        </div>
      ) : null}

      {!loading && activeRows.length === 0 ? (
        <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <div className={cn("mx-auto flex h-12 w-12 items-center justify-center rounded-2xl", isMains ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800")}>
            <Sparkles className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">No matching {resultLabel}s right now</h3>
          <p className="mt-2 text-sm text-slate-500">Try clearing one or more filters to broaden the visible catalog.</p>
        </div>
      ) : null}

      {!loading && activeRows.length > 0 ? (
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Catalog results</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              {activeRows.length} {resultLabel}
              {activeRows.length === 1 ? "" : "s"} ready to explore
            </h2>
          </div>
          <p className="hidden text-sm text-slate-500 md:block">Responsive cards optimized for quick browsing.</p>
        </div>
      ) : null}

      {!loading && listingMode === "series" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {seriesRows.map((row) => {
            const series = row.series;
            const profile = row.provider_profile;
            const review = profile ? reviewSummaryMeta(profile.meta) : { average: 0, total: 0 };
            const thumbnail = series.cover_image_url || "";
            return (
              <article
                key={series.id}
                className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="grid gap-0 md:grid-cols-[220px_1fr]">
                  <div className="relative min-h-[240px] overflow-hidden bg-slate-100">
                    {thumbnail ? (
                      <Image
                        src={thumbnail}
                        alt={series.title}
                        fill
                        unoptimized
                        sizes="(max-width: 768px) 100vw, 220px"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className={cn("flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br px-6 text-center", isMains ? "from-amber-100 via-white to-emerald-50" : "from-sky-100 via-white to-amber-50")}>
                        <BookOpen className="h-8 w-8 text-slate-500" />
                        <p className="text-sm font-semibold text-slate-700">Curated {series.series_kind === "mains" ? "mains" : "prelims"} series</p>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/15 to-transparent" />

                    <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                      <span className={cn("rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] backdrop-blur", series.series_kind === "mains" ? "border-amber-200/70 bg-amber-100/90 text-amber-900" : "border-sky-200/70 bg-sky-100/90 text-sky-900")}>
                        {series.series_kind === "mains" ? "Mains series" : "Prelims series"}
                      </span>
                      <span className={cn("rounded-full border px-3 py-1 text-[11px] font-semibold capitalize backdrop-blur", accessTone(series.access_type))}>
                        {series.access_type}
                      </span>
                    </div>

                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
                      <div className="rounded-2xl bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Entry</p>
                        <p className="mt-1 text-sm font-black text-slate-900">{formatPrice(series.price)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-900/85 px-3 py-2 text-right text-white shadow-lg backdrop-blur">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Included</p>
                        <p className="mt-1 text-sm font-black">{series.test_count} test{series.test_count === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                          {series.access_type === "free" ? "Open access" : "Guided premium access"}
                        </p>
                        <h2 className="mt-2 text-xl font-black tracking-tight text-slate-900">{series.title}</h2>
                      </div>
                      {review.total > 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right shadow-sm">
                          <p className="flex items-center justify-end gap-1 text-sm font-bold text-slate-900">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            {review.average.toFixed(1)}
                          </p>
                          <p className="text-[11px] text-slate-500">{review.total} review{review.total === 1 ? "" : "s"}</p>
                        </div>
                      ) : null}
                    </div>

                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{textExcerpt(series.description)}</p>

                    {row.category_ids.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {row.category_ids.map((id, index) => (
                          <span key={`${series.id}-cat-${id}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                            {row.category_labels[index] || `Category ${id}`}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {profile ? (
                      <div className={cn("mt-4 rounded-[1.5rem] border p-4", providerPanelTint)}>
                        <div className="flex items-start gap-3">
                          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black", avatarTint)}>
                            {initialsFromLabel(profile.display_name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-bold text-slate-900">{profile.display_name}</p>
                              {profile.is_verified ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Verified</span> : null}
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{profile.headline || profile.role}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {review.total > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                  {review.average.toFixed(1)} / {review.total}
                                </span>
                              ) : null}
                              {profile.years_experience ? <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{profile.years_experience}+ years experience</span> : null}
                            </div>
                          </div>
                        </div>
                        {profile.highlights.length > 0 ? (
                          <ul className="mt-3 space-y-1 text-xs text-slate-600">
                            {profile.highlights.slice(0, 2).map((highlight, idx) => (
                              <li key={`${profile.user_id}-${idx}`}>- {highlight}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap gap-2">
                      {profile ? (
                        <Link href={`/profiles/${profile.user_id}`} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                          View Profile
                        </Link>
                      ) : null}
                      <Link href={`/test-series/${series.id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
                        Open Series
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void enrollInSeries(series.id)}
                        disabled={enrollingSeriesId === series.id}
                        className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {enrollingSeriesId === series.id ? "Enrolling..." : "Enroll"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && listingMode === "test" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {testRows.map((row) => {
            const test = row.test;
            const series = row.series;
            const profile = row.provider_profile;
            const review = profile ? reviewSummaryMeta(profile.meta) : { average: 0, total: 0 };
            const startHref = test.test_kind === "mains" ? `/collections/${test.id}/mains-test` : `/collections/${test.id}/test`;
            const thumbnail = test.thumbnail_url || series.cover_image_url || "";
            return (
              <article
                key={`${series.id}-${test.id}`}
                className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="relative min-h-[220px] overflow-hidden bg-slate-100">
                    {thumbnail ? (
                      <Image
                        src={thumbnail}
                        alt={test.title}
                        fill
                        unoptimized
                        sizes="(max-width: 1024px) 100vw, 560px"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className={cn("flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br px-6 text-center", isMains ? "from-amber-100 via-white to-emerald-50" : "from-sky-100 via-white to-amber-50")}>
                        <BookOpen className="h-8 w-8 text-slate-500" />
                        <p className="text-sm font-semibold text-slate-700">Mock paper cover coming soon</p>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/15 to-transparent" />

                    <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                      <span className={cn("rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] backdrop-blur", test.test_kind === "mains" ? "border-amber-200/70 bg-amber-100/90 text-amber-900" : "border-sky-200/70 bg-sky-100/90 text-sky-900")}>
                        {test.test_label}
                      </span>
                      <span className={cn("rounded-full border px-3 py-1 text-[11px] font-semibold capitalize backdrop-blur", accessTone(series.access_type))}>
                        {series.access_type}
                      </span>
                    </div>

                    <div className="absolute bottom-4 left-4 right-4 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Price</p>
                        <p className="mt-1 text-sm font-black text-slate-900">{formatPrice(test.price)}</p>
                      </div>
                      <div className="rounded-2xl bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Questions</p>
                        <p className="mt-1 text-sm font-black text-slate-900">{test.question_count || 0}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-900/85 px-3 py-2 text-white shadow-lg backdrop-blur">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Series</p>
                        <p className="mt-1 text-sm font-black">#{Math.max(test.series_order || 1, 1)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Inside {series.title}</p>
                        <h2 className="mt-2 text-xl font-black tracking-tight text-slate-900">{test.title}</h2>
                      </div>
                      {review.total > 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right shadow-sm">
                          <p className="flex items-center justify-end gap-1 text-sm font-bold text-slate-900">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            {review.average.toFixed(1)}
                          </p>
                          <p className="text-[11px] text-slate-500">{review.total} review{review.total === 1 ? "" : "s"}</p>
                        </div>
                      ) : null}
                    </div>

                    <p className="mt-3 text-sm font-medium text-slate-500">Series: {series.title}</p>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                      {textExcerpt(test.description || series.description)}
                    </p>

                    {row.category_ids.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {row.category_ids.map((id, index) => (
                          <span key={`${test.id}-cat-${id}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                            {row.category_labels[index] || `Category ${id}`}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {profile ? (
                      <div className={cn("mt-4 rounded-[1.5rem] border p-4", providerPanelTint)}>
                        <div className="flex items-start gap-3">
                          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black", avatarTint)}>
                            {initialsFromLabel(profile.display_name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-bold text-slate-900">{profile.display_name}</p>
                              {profile.is_verified ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Verified</span> : null}
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{profile.headline || profile.role}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {profile.years_experience ? <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{profile.years_experience}+ years experience</span> : null}
                              {review.total > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                  {review.average.toFixed(1)} / {review.total}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        {profile.highlights.length > 0 ? (
                          <ul className="mt-3 space-y-1 text-xs text-slate-600">
                            {profile.highlights.slice(0, 2).map((highlight, idx) => (
                              <li key={`${profile.user_id}-${idx}`}>- {highlight}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap gap-2">
                      {profile ? (
                        <Link href={`/profiles/${profile.user_id}`} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                          View Profile
                        </Link>
                      ) : null}
                      <Link href={`/test-series/${series.id}`} className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                        Open Series
                      </Link>
                      <Link href={startHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
                        {test.test_kind === "mains" ? "Open Writing Desk" : "Start Test"}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void enrollInSeries(series.id)}
                        disabled={enrollingSeriesId === series.id}
                        className="inline-flex items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {enrollingSeriesId === series.id ? "Enrolling..." : "Enroll"}
                      </button>
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

