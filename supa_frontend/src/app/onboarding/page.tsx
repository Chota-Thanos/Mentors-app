"use client";

/**
 * V2 Onboarding — creates the profiles row on first login.
 * 
 * After Supabase auth, every user needs a profiles row before they can
 * use any feature. This page handles that creation step.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import AppLayout from "@/components/layouts/AppLayout";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user } = useAuth();
  const { profile, loading: profileLoading, refreshProfile } = useProfile();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // If profile already exists, redirect to dashboard
  if (!profileLoading && profile) {
    router.replace("/dashboard");
    return null;
  }

  // If not logged in, redirect to login
  if (!profileLoading && !user) {
    router.replace("/login");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    if (!fullName.trim()) {
      setError("Full name is required");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Create the profiles row — role defaults to 'user' via DB default
      const { error: insertError } = await supabase.from("profiles").insert({
        auth_user_id: user.id,
        display_name: fullName.trim(),
        email: user.email ?? "",
        phone: phone.trim() || null,
        city: city.trim() || null,
        role: "user",
        is_active: true,
      });

      if (insertError) throw insertError;

      // Refresh the profile in context
      await refreshProfile();
      router.replace("/dashboard");
    } catch (err) {
      setError(String((err as Error).message || "Failed to create profile"));
    } finally {
      setSubmitting(false);
    }
  };

  if (profileLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-slate-500">Loading…</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-2xl font-bold text-slate-900">
            Welcome to Mentors App
          </h1>
          <p className="mb-6 text-sm text-slate-500">
            Let's set up your profile to get started.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Phone (optional)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                City (optional)
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Delhi, Mumbai…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {submitting ? "Setting up…" : "Continue →"}
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
