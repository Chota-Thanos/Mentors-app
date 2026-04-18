"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCcw,
  Star,
  MessageSquare,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { isAdminLike, isProviderLike, isModeratorLike } from "@/lib/accessControl";
import type {
  ProfessionalProfileReview,
  ProfessionalProfileReviewSummary,
  TestSeries,
} from "@/types/premium";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function initialsFromLabel(label: string): string {
  const tokens = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return "LL";
  return tokens.map((t) => t.charAt(0).toUpperCase()).join("");
}

function StarRow({ rating, max = 5 }: { rating: number; max?: number }) {
  const filled = Math.max(0, Math.min(max, Math.round(rating)));
  return (
    <div className="flex items-center gap-0.5 text-amber-400">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < filled ? "fill-current" : "text-slate-200"}`}
        />
      ))}
    </div>
  );
}

function RatingBar({ count, total, label }: { count: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 text-right text-xs font-bold text-slate-600">{label}</span>
      <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" />
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-semibold text-slate-500">{count}</span>
    </div>
  );
}

function ReviewCard({ review }: { review: ProfessionalProfileReview }) {
  return (
    <article className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-black text-indigo-800">
            {initialsFromLabel(review.reviewer_label || "L")}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">{review.reviewer_label || "Learner"}</p>
            <p className="text-xs text-slate-400">{formatDate(review.created_at)}</p>
          </div>
        </div>
        <StarRow rating={review.rating} />
      </div>
      {review.title ? (
        <p className="mt-4 text-sm font-semibold text-slate-800">{review.title}</p>
      ) : null}
      {review.comment ? (
        <p className="mt-2 text-sm leading-7 text-slate-600">{review.comment}</p>
      ) : null}
    </article>
  );
}

export default function PrelimsSeriesReviewsView({ seriesId }: { seriesId: number }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const { profileId } = useProfile();
  const adminLike = useMemo(() => isAdminLike(user), [user]);
  const providerLike = useMemo(() => isProviderLike(user), [user]);
  const moderatorLike = useMemo(() => isModeratorLike(user), [user]);

  const workspaceSections = useMemo(
    () => getQuizMasterWorkspaceSections(user?.id || undefined),
    [user?.id],
  );

  const [busy, setBusy] = useState(true);
  const [series, setSeries] = useState<TestSeries | null>(null);
  const [reviews, setReviews] = useState<ProfessionalProfileReview[]>([]);
  const [summary, setSummary] = useState<ProfessionalProfileReviewSummary | null>(null);
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);

  const canAccess = useMemo(() => {
    if (!series) return false;
    if (adminLike || moderatorLike) return true;
    if (!profileId) return false;
    return providerLike && series.creator_id === profileId;
  }, [series, adminLike, moderatorLike, providerLike, profileId]);

  const loadData = async () => {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: seriesData, error: seriesError } = await supabase
        .from("test_series")
        .select("*")
        .eq("id", seriesId)
        .single();
        
      if (seriesError) throw seriesError;
      
      const fetchedSeries = {
        ...seriesData,
        title: seriesData.name,
      };
      setSeries(fetchedSeries);

      const targetProfileId = seriesData.creator_id;
      if (!targetProfileId) {
        setReviews([]);
        setSummary(null);
        return;
      }

      const { data: reviewsData, error: reviewsError } = await supabase
        .from("creator_profile_reviews")
        .select(`
          *,
          reviewer:profiles!reviewer_id (
            display_name
          )
        `)
        .eq("creator_profile_id", targetProfileId)
        .order("created_at", { ascending: false });

      if (reviewsError) throw reviewsError;

      const normalizedReviews: ProfessionalProfileReview[] = (reviewsData || []).map(r => ({
        id: Number(r.id),
        rating: r.rating,
        comment: r.comment,
        reviewer_label: r.reviewer?.display_name || "learner",
        created_at: r.created_at,
      } as any));

      setReviews(normalizedReviews);

      // Compute summary
      const total = normalizedReviews.length;
      if (total > 0) {
        const sum = normalizedReviews.reduce((acc, r) => acc + r.rating, 0);
        const counts = [0, 0, 0, 0, 0, 0];
        normalizedReviews.forEach(r => { counts[r.rating] = (counts[r.rating] || 0) + 1; });
        
        setSummary({
          average_rating: sum / total,
          total_reviews: total,
          rating_5: counts[5],
          rating_4: counts[4],
          rating_3: counts[3],
          rating_2: counts[2],
          rating_1: counts[1],
        });
      } else {
        setSummary(null);
      }
    } catch (error: unknown) {
      toast.error("Failed to load reviews", { description: toError(error) });
      setSeries(null);
      setReviews([]);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setBusy(false);
      return;
    }
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, authLoading, isAuthenticated]);

  const filteredReviews = useMemo(
    () =>
      ratingFilter !== null
        ? reviews.filter((r) => r.rating === ratingFilter)
        : reviews,
    [reviews, ratingFilter],
  );

  const averageRating = useMemo(
    () =>
      summary?.average_rating ??
      (reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0),
    [summary, reviews],
  );

  if (authLoading || busy) {
    return (
      <div className="flex items-center justify-center rounded-[32px] border border-slate-200 bg-white p-16">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Sign in to view reviews.
      </div>
    );
  }

  if (!series) {
    return (
      <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Series not found or inaccessible.
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You do not have access to this series&apos; reviews.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
      <RoleWorkspaceSidebar
        title="Prelims Expert Workspace"
        subtitle="Program control, quiz authoring, and learner analytics."
        sections={workspaceSections}
        className="lg:self-start"
      />

      <div className="min-w-0 flex-1 space-y-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[34px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-full opacity-40 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.15),_transparent_50%)]" />
          <div className="relative">
            <HistoryBackButton
              fallbackHref={`/programs/${seriesId}/manage`}
              label="Back to workspace"
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              iconClassName="h-3 w-3"
            />
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-amber-600">
              Reviews & Ratings
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl text-balance">
              {series.title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
              Learner reviews for your creator profile. These ratings reflect the quality of your
              programs and mentorship, and they appear publicly on your profile page.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
              {series.creator_id && (
                <Link
                  href={`/profiles/${series.creator_id}`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <UserCheck className="h-4 w-4" />
                  Public Profile
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Rating summary */}
        {reviews.length > 0 && (
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
              {/* Big average */}
              <div className="flex flex-col items-center justify-center rounded-[22px] bg-amber-50 p-6 text-center min-w-[130px]">
                <p className="text-5xl font-black tracking-tight text-amber-900">
                  {averageRating.toFixed(1)}
                </p>
                <StarRow rating={averageRating} />
                <p className="mt-2 text-xs font-bold text-amber-700">
                  {reviews.length} review{reviews.length !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Bar breakdown */}
              <div className="flex flex-col justify-center gap-2.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count =
                    summary
                      ? star === 5
                        ? summary.rating_5
                        : star === 4
                        ? summary.rating_4
                        : star === 3
                        ? summary.rating_3
                        : star === 2
                        ? summary.rating_2
                        : summary.rating_1
                      : reviews.filter((r) => r.rating === star).length;
                  return (
                    <RatingBar
                      key={star}
                      label={String(star)}
                      count={count}
                      total={summary?.total_reviews ?? reviews.length}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Filter tabs */}
        {reviews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRatingFilter(null)}
              className={`rounded-2xl border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition ${
                ratingFilter === null
                  ? "border-indigo-950 bg-indigo-950 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
              }`}
            >
              All ({reviews.length})
            </button>
            {[5, 4, 3, 2, 1].map((star) => {
              const count = reviews.filter((r) => r.rating === star).length;
              if (count === 0) return null;
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingFilter(ratingFilter === star ? null : star)}
                  className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2 text-xs font-bold transition ${
                    ratingFilter === star
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-300"
                  }`}
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                  {star} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Review list */}
        {filteredReviews.length === 0 ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <MessageSquare className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-5 text-lg font-bold text-slate-800">No reviews yet</p>
            <p className="mt-2 max-w-sm mx-auto text-sm text-slate-500">
              Learner reviews for your creator profile will appear here once they start rating
              your programs and mentorship sessions.
            </p>
            {series.creator_id && (
              <Link
                href={`/profiles/${series.creator_id}`}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-indigo-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 transition"
              >
                View Public Profile
              </Link>
            )}
          </section>
        ) : (
          <section className="space-y-4">
            {filteredReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
