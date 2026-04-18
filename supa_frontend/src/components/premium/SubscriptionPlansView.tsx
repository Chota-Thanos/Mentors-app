"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import type { SubscriptionPlan, UserSubscriptionStatus } from "@/types/premium";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

export default function SubscriptionPlansView() {
  const { isAuthenticated } = useAuth();
  const { profileId } = useProfile();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [status, setStatus] = useState<UserSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*");
      
      if (error) throw error;
      setPlans(data || []);
      
      if (isAuthenticated) {
        const { data: statusData, error: statusError } = await supabase
          .from("subscriptions")
          .select("*, plan:subscription_plans(name)")
          .eq("user_id", profileId)
          .eq("status", "active")
          .single();
          
        if (statusError && statusError.code !== "PGRST116") throw statusError;
        setStatus(statusData as any);
      } else {
        setStatus(null);
      }
    } catch (error: unknown) {
      setPlans([]);
      setStatus(null);
      toast.error("Failed to load subscription data", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">Subscriptions</h1>
        <p className="mt-1 text-sm text-slate-600">
          Subscription workflows are scaffolded. Plan definitions and payment integration can be finalized next.
        </p>

        {status ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-slate-900">Your status: {status.status}</p>
            <p className="text-slate-600">
              {status.plan_name || status.plan_id || "No active paid plan"} {status.valid_until ? `· valid until ${new Date(status.valid_until).toLocaleString()}` : ""}
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Sign in to view your personal subscription status.
          </div>
        )}
      </section>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading plans...</div> : null}

      {!loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">{plan.name}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                  {plan.billing_cycle}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{plan.description || "Plan details will be finalized soon."}</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {plan.currency} {Number(plan.price || 0).toFixed(0)}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {plan.features.map((feature, index) => (
                  <li key={`${plan.id}-${index}`}>• {feature}</li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                onClick={() => toast.message("Subscription checkout will be connected in the next step.")}
              >
                Choose Plan
              </button>
            </article>
          ))}
          {plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
              No plans configured yet.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
