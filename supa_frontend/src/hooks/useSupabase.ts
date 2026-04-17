"use client";

/**
 * V2 Supabase query hooks — typed against the new schema.
 *
 * All user_id queries use profileId (number) from useProfile(),
 * NOT the raw auth UUID.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/context/ProfileContext";
import type {
  Category,
  CategoryDomain,
  Exam,
  PremiumCollection,
  TestSeries,
  AiUsageQuota,
  UserPerformanceSnapshot,
  UserWeakArea,
  Subscription,
  Payment,
  MentorshipRequest,
} from "@/types/db";

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

function useFetch<T>(fetcher: () => Promise<T | null>): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err?.message || err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, loading, error, refetch };
}

// ── Categories ────────────────────────────────────────────────────────────────

export function useCategories(domain?: CategoryDomain) {
  const supabase = createClient();
  return useFetch<Category[]>(async () => {
    let q = supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (domain) q = q.eq("domain", domain);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Category[];
  });
}

export function useExams() {
  const supabase = createClient();
  return useFetch<Exam[]>(async () => {
    const { data, error } = await supabase
      .from("exams")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (error) throw error;
    return (data ?? []) as Exam[];
  });
}

// ── Collections ───────────────────────────────────────────────────────────────

export function usePublicCollections(type?: 'prelims' | 'mains' | 'mixed') {
  const supabase = createClient();
  return useFetch<PremiumCollection[]>(async () => {
    let q = supabase
      .from("premium_collections")
      .select("*, creator:profiles(id,display_name,avatar_url)")
      .eq("is_active", true)
      .eq("is_public", true)
      .order("created_at", { ascending: false });
    if (type) q = q.eq("collection_type", type);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as PremiumCollection[];
  });
}

export function useCollection(id: number | null) {
  const supabase = createClient();
  return useFetch<PremiumCollection>(async () => {
    if (!id) return null;
    const { data, error } = await supabase
      .from("premium_collections")
      .select(`
        *,
        creator:profiles(id,display_name,avatar_url,role),
        items:premium_collection_items(
          *,
          quiz:quizzes(*),
          passage_quiz:passage_quizzes(*,passage_questions(*)),
          mains_question:mains_questions(*),
          category:categories(id,name,domain)
        )
      `)
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as unknown as PremiumCollection;
  });
}

// ── Test Series ───────────────────────────────────────────────────────────────

export function usePublicTestSeries(kind?: 'prelims' | 'mains' | 'hybrid') {
  const supabase = createClient();
  return useFetch<TestSeries[]>(async () => {
    let q = supabase
      .from("test_series")
      .select(`
        *,
        creator:profiles(id,display_name,avatar_url),
        exams:test_series_exams(exam:exams(id,name,slug))
      `)
      .eq("is_active", true)
      .eq("is_public", true)
      .order("created_at", { ascending: false });
    if (kind) q = q.eq("series_kind", kind);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as TestSeries[];
  });
}

export function useTestSeries(id: number | null) {
  const supabase = createClient();
  return useFetch<TestSeries>(async () => {
    if (!id) return null;
    const { data, error } = await supabase
      .from("test_series")
      .select(`
        *,
        creator:profiles(id,display_name,avatar_url,role),
        exams:test_series_exams(exam:exams(id,name,slug)),
        program_units(
          *,
          steps:program_unit_steps(*)
        )
      `)
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as unknown as TestSeries;
  });
}

// ── Creator: owned content ────────────────────────────────────────────────────

export function useMyCollections() {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<PremiumCollection[]>(async () => {
    if (!profileId) return [];
    const { data, error } = await supabase
      .from("premium_collections")
      .select("*")
      .eq("creator_id", profileId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as PremiumCollection[];
  });
}

export function useMyTestSeries() {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<TestSeries[]>(async () => {
    if (!profileId) return [];
    const { data, error } = await supabase
      .from("test_series")
      .select("*")
      .eq("creator_id", profileId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as TestSeries[];
  });
}

// ── AI Quota ──────────────────────────────────────────────────────────────────

export function useAiQuota() {
  const { aiQuizApi } = require("@/lib/api");
  return useFetch(() => aiQuizApi.getQuota());
}

// ── Subscription ──────────────────────────────────────────────────────────────

export function useMySubscription() {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<Subscription | null>(async () => {
    if (!profileId) return null;
    const { data } = await supabase
      .from("subscriptions")
      .select("*, plan_details:subscription_plans(*)")
      .eq("user_id", profileId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as unknown as Subscription | null;
  });
}

// ── Payment history ───────────────────────────────────────────────────────────

export function useMyPayments() {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<Payment[]>(async () => {
    if (!profileId) return [];
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("user_id", profileId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Payment[];
  });
}

// ── Mentorship ────────────────────────────────────────────────────────────────

export function useMyMentorshipRequests(asMentor = false) {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<MentorshipRequest[]>(async () => {
    if (!profileId) return [];
    const field = asMentor ? "mentor_id" : "user_id";
    const { data, error } = await supabase
      .from("mentorship_requests")
      .select(`
        *,
        user:profiles!mentorship_requests_user_id_fkey(id,display_name,avatar_url),
        mentor:profiles!mentorship_requests_mentor_id_fkey(id,display_name,avatar_url)
      `)
      .eq(field, profileId)
      .order("requested_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as MentorshipRequest[];
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export function useMyPerformance() {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<UserPerformanceSnapshot[]>(async () => {
    if (!profileId) return [];
    const { data, error } = await supabase
      .from("user_performance_snapshots")
      .select("*, category:categories(id,name,domain)")
      .eq("user_id", profileId)
      .order("accuracy", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as UserPerformanceSnapshot[];
  });
}

export function useMyWeakAreas() {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<UserWeakArea[]>(async () => {
    if (!profileId) return [];
    const { data, error } = await supabase
      .from("user_weak_areas")
      .select("*, category:categories(id,name,domain)")
      .eq("user_id", profileId)
      .order("accuracy", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as UserWeakArea[];
  });
}

// ── Access check ──────────────────────────────────────────────────────────────

export function useHasAccess(
  type: "test_series" | "collection",
  id: number | null,
) {
  const supabase = createClient();
  const { profileId } = useProfile();
  return useFetch<boolean>(async () => {
    if (!profileId || !id) return false;
    const field = type === "test_series" ? "test_series_id" : "collection_id";
    const { data } = await supabase
      .from("user_content_access")
      .select("id")
      .eq("user_id", profileId)
      .eq(field, id)
      .eq("is_active", true)
      .maybeSingle();
    return !!data;
  });
}
