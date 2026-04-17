"use client";

/**
 * V2 MyPurchasesView — fetches data directly from Supabase using profileId.
 * Replaces old API calls to /subscriptions/me and /programs/my/enrollments.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import LearnerMentorshipOrdersSection from "@/components/account/LearnerMentorshipOrdersSection";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";

interface SubscriptionRow {
  id: number;
  plan: string;
  status: string;
  start_date: string;
  end_date: string;
  subscription_plans?: { display_name: string } | null;
}

interface AccessRow {
  id: number;
  access_type: string;
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
  test_series_id?: number | null;
  collection_id?: number | null;
  payment_id?: number | null;
  test_series?: { id: number; name: string; series_kind: string } | null;
  premium_collections?: { id: number; name: string } | null;
  payments?: { amount: number; currency: string } | null;
}

export default function MyPurchasesView() {
  const supabase = createClient();
  const { isAuthenticated, loading: authLoading, showLoginModal } = useAuth();
  const { profileId, loading: profileLoading } = useProfile();

  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!isAuthenticated || !profileId) {
      setBusy(false);
      return;
    }

    let active = true;
    setBusy(true);

    const run = async () => {
      try {
        const [subRes, accessRes] = await Promise.all([
          // Active subscription
          supabase
            .from("subscriptions")
            .select("*, subscription_plans(display_name)")
            .eq("user_id", profileId)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),

          // Purchased access
          supabase
            .from("user_content_access")
            .select("id, access_type, granted_at, expires_at, is_active, test_series_id, collection_id, payment_id")
            .eq("user_id", profileId)
            .eq("is_active", true)
            .order("granted_at", { ascending: false }),
        ]);

        if (!active) return;
        setSubscription((subRes.data as SubscriptionRow | null) ?? null);
        const baseAccessRows = (accessRes.data ?? []) as unknown as AccessRow[];
        const testSeriesIds = Array.from(
          new Set(
            baseAccessRows
              .map((row) => Number(row.test_series_id || 0))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        );
        const collectionIds = Array.from(
          new Set(
            baseAccessRows
              .map((row) => Number((row as { collection_id?: number }).collection_id || 0))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        );
        const paymentIds = Array.from(
          new Set(
            baseAccessRows
              .map((row) => Number((row as { payment_id?: number }).payment_id || 0))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        );
        const testSeriesMap = new Map<number, { id: number; name: string; series_kind: string }>();
        const collectionMap = new Map<number, { id: number; name: string }>();
        const paymentMap = new Map<number, { amount: number; currency: string }>();
        if (testSeriesIds.length > 0) {
          const { data: seriesData } = await supabase
            .from("test_series")
            .select("id, name, series_kind")
            .in("id", testSeriesIds);
          for (const row of seriesData ?? []) {
            const id = Number((row as { id?: number }).id || 0);
            if (id > 0) {
              testSeriesMap.set(id, row as { id: number; name: string; series_kind: string });
            }
          }
        }
        if (collectionIds.length > 0) {
          const { data: collectionsData } = await supabase
            .from("premium_collections")
            .select("id, name")
            .in("id", collectionIds);
          for (const row of collectionsData ?? []) {
            const id = Number((row as { id?: number }).id || 0);
            if (id > 0) {
              collectionMap.set(id, row as { id: number; name: string });
            }
          }
        }
        if (paymentIds.length > 0) {
          const { data: paymentsData } = await supabase
            .from("payments")
            .select("id, amount, currency")
            .in("id", paymentIds);
          for (const row of paymentsData ?? []) {
            const id = Number((row as { id?: number }).id || 0);
            if (id > 0) {
              paymentMap.set(id, row as { amount: number; currency: string });
            }
          }
        }
        setAccessRows(
          baseAccessRows.map((row) => ({
            ...row,
            test_series: row.test_series_id ? testSeriesMap.get(Number(row.test_series_id)) || null : null,
            premium_collections: row.collection_id ? collectionMap.get(Number(row.collection_id)) || null : null,
            payments: row.payment_id ? paymentMap.get(Number(row.payment_id)) || null : null,
          })),
        );
      } catch (err) {
        toast.error("Failed to load purchases", {
          description: String((err as Error).message),
        });
      } finally {
        if (active) setBusy(false);
      }
    };

    void run();
    return () => { active = false; };
  }, [authLoading, profileLoading, isAuthenticated, profileId, supabase]);

  if (authLoading || profileLoading || busy) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Loading your purchases…
      </div>
    );
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

  const seriesAccess = accessRows.filter((r) => r.access_type === "test_series");
  const collectionAccess = accessRows.filter((r) => r.access_type === "collection");

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">My Purchases</h1>
        <p className="mt-1 text-sm text-slate-600">
          Subscription, series purchases, and mentorship — all in one place.
        </p>
      </section>

      {/* Subscription */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Subscription</h2>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {subscription ? (
            <>
              <p>
                Status:{" "}
                <span className="font-semibold capitalize">{subscription.status}</span>
              </p>
              <p>
                Plan:{" "}
                <span className="font-semibold">
                  {subscription.subscription_plans?.display_name ?? subscription.plan}
                </span>
              </p>
              <p>
                Valid Until:{" "}
                <span className="font-semibold">
                  {new Date(subscription.end_date).toLocaleDateString("en-IN")}
                </span>
              </p>
            </>
          ) : (
            <p className="text-slate-500">No active subscription.</p>
          )}
        </div>
        <Link
          href="/subscriptions"
          className="mt-3 inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {subscription ? "Manage Subscription" : "Upgrade Plan →"}
        </Link>
      </section>

      {/* Series Access */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Series Access</h2>
        <div className="mt-3 space-y-2">
          {seriesAccess.map((entry) => (
            <article
              key={entry.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            >
              <p className="font-semibold text-slate-900">
                {entry.test_series?.name ?? `Series #${entry.id}`}
              </p>
              <p className="text-xs text-slate-500 capitalize">
                {entry.test_series?.series_kind ?? "—"} ·{" "}
                Granted {new Date(entry.granted_at).toLocaleDateString("en-IN")}
              </p>
              {entry.expires_at && (
                <p className="text-xs text-slate-500">
                  Expires: {new Date(entry.expires_at).toLocaleDateString("en-IN")}
                </p>
              )}
              {entry.payments && (
                <p className="text-xs text-slate-500">
                  Paid: {entry.payments.currency} {entry.payments.amount}
                </p>
              )}
              <Link
                href={`/programs/${entry.test_series?.id ?? ""}`}
                className="mt-2 inline-flex text-xs font-medium text-indigo-600 hover:underline"
              >
                Go to Series →
              </Link>
            </article>
          ))}
          {seriesAccess.length === 0 && (
            <p className="text-sm text-slate-500">No series access yet.</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/programs/prelims"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Browse Prelims Series
          </Link>
          <Link
            href="/programs/mains"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Browse Mains Series
          </Link>
        </div>
      </section>

      {/* Collection Access */}
      {collectionAccess.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Test Pack Access</h2>
          <div className="mt-3 space-y-2">
            {collectionAccess.map((entry) => (
              <article
                key={entry.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
              >
                <p className="font-semibold text-slate-900">
                  {entry.premium_collections?.name ?? `Pack #${entry.id}`}
                </p>
                <p className="text-xs text-slate-500">
                  Granted {new Date(entry.granted_at).toLocaleDateString("en-IN")}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Mentorship */}
      <LearnerMentorshipOrdersSection />
    </div>
  );
}
