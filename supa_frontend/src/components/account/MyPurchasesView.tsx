"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import LearnerMentorshipOrdersSection from "@/components/account/LearnerMentorshipOrdersSection";
import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
import type { TestSeries, TestSeriesEnrollment, UserSubscriptionStatus } from "@/types/premium";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

export default function MyPurchasesView() {
  const { isAuthenticated, loading, showLoginModal } = useAuth();
  const [busy, setBusy] = useState(true);
  const [subscription, setSubscription] = useState<UserSubscriptionStatus | null>(null);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);
  const [seriesTitleById, setSeriesTitleById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      setBusy(false);
      setSubscription(null);
      setEnrollments([]);
      setSeriesTitleById({});
      return;
    }

    let active = true;
    setBusy(true);

    const run = async () => {
      try {
        const [subscriptionRes, enrollmentRes] = await Promise.all([
          premiumApi.get<UserSubscriptionStatus>("/subscriptions/me"),
          premiumApi.get<TestSeriesEnrollment[]>("/test-series/my/enrollments"),
        ]);
        if (!active) return;

        const enrollmentRows = Array.isArray(enrollmentRes.data) ? enrollmentRes.data : [];
        setSubscription(subscriptionRes.data || null);
        setEnrollments(enrollmentRows);

        const uniqueSeriesIds = Array.from(new Set(enrollmentRows.map((row) => Number(row.series_id)).filter((id) => Number.isFinite(id) && id > 0)));
        if (uniqueSeriesIds.length === 0) {
          setSeriesTitleById({});
          return;
        }

        const responses = await Promise.allSettled(
          uniqueSeriesIds.map((seriesId) => premiumApi.get<TestSeries>(`/test-series/${seriesId}`)),
        );
        if (!active) return;

        const map: Record<string, string> = {};
        for (const result of responses) {
          if (result.status !== "fulfilled") continue;
          const row = result.value.data;
          const seriesId = Number(row?.id || 0);
          const title = String(row?.title || "").trim();
          if (seriesId > 0 && title) {
            map[String(seriesId)] = title;
          }
        }
        setSeriesTitleById(map);
      } catch (error: unknown) {
        if (!active) return;
        setSubscription(null);
        setEnrollments([]);
        setSeriesTitleById({});
        toast.error("Failed to load purchases", { description: toError(error) });
      } finally {
        if (active) setBusy(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [isAuthenticated, loading]);

  const activeEnrollments = useMemo(
    () => enrollments.filter((entry) => String(entry.status || "").toLowerCase() === "active"),
    [enrollments],
  );

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading your purchases...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm text-amber-800">Sign in to view your purchases.</p>
        <button
          type="button"
          onClick={showLoginModal}
          className="mt-3 rounded-md bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Login
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">My Purchases</h1>
        <p className="mt-1 text-sm text-slate-600">Subscription access, series purchases, and mentorship requests in one learner workspace.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Subscription</h2>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p>Status: <span className="font-semibold">{subscription?.status || "inactive"}</span></p>
          <p>Plan: <span className="font-semibold">{subscription?.plan_name || subscription?.plan_id || "No active plan"}</span></p>
          <p>Valid Until: <span className="font-semibold">{subscription?.valid_until ? new Date(subscription.valid_until).toLocaleString() : "n/a"}</span></p>
        </div>
        <Link href="/subscriptions" className="mt-3 inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
          Manage Subscription
        </Link>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Series Purchases & Access</h2>
        <div className="mt-3 space-y-2">
          {activeEnrollments.map((entry) => (
            <article key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">
                {seriesTitleById[String(entry.series_id)] || `Series #${entry.series_id}`}
              </p>
              <p>Status: {entry.status}</p>
              <p>Source: {entry.access_source}</p>
              <p>Subscribed Until: {entry.subscribed_until ? new Date(entry.subscribed_until).toLocaleString() : "n/a"}</p>
            </article>
          ))}
          {activeEnrollments.length === 0 ? <p className="text-sm text-slate-500">No active series purchases yet.</p> : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/test-series/prelims" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Browse Prelims Series
          </Link>
          <Link href="/test-series/mains" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Browse Mains Series
          </Link>
        </div>
      </section>

      <LearnerMentorshipOrdersSection />
    </div>
  );
}
