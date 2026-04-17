"use client";

/**
 * V2 Supabase query hooks — typed against the new schema.
 *
 * All user_id queries use profileId (number) from useProfile(),
 * NOT the raw auth UUID.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { profilesApi } from "@/lib/backendServices";
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
  Profile,
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

async function loadProfilesByIds(ids: number[]): Promise<Map<number, Profile>> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return new Map();
  const rows = await profilesApi.batch(uniqueIds);
  return new Map(rows.map((row) => [Number(row.id), row as Profile]));
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
      .select("*")
      .eq("is_active", true)
      .eq("is_public", true)
      .order("created_at", { ascending: false });
    if (type) q = q.eq("collection_type", type);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as PremiumCollection[];
    const creators = await loadProfilesByIds(rows.map((row) => row.creator_id));
    return rows.map((row) => ({
      ...row,
      creator: creators.get(row.creator_id) ?? row.creator,
    }));
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
    const creator = data?.creator_id ? (await loadProfilesByIds([Number(data.creator_id)])).get(Number(data.creator_id)) : null;
    return { ...(data as unknown as PremiumCollection), creator: creator ?? data?.creator };
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
        exams:test_series_exams(exam:exams(id,name,slug))
      `)
      .eq("is_active", true)
      .eq("is_public", true)
      .order("created_at", { ascending: false });
    if (kind) q = q.eq("series_kind", kind);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as TestSeries[];
    const creators = await loadProfilesByIds(rows.map((row) => row.creator_id));
    return rows.map((row) => ({
      ...row,
      creator: creators.get(row.creator_id) ?? row.creator,
    }));
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
        exams:test_series_exams(exam:exams(id,name,slug)),
        program_units(
          *,
          steps:program_unit_steps(*)
        )
      `)
      .eq("id", id)
      .single();
    if (error) throw error;
    const creator = data?.creator_id ? (await loadProfilesByIds([Number(data.creator_id)])).get(Number(data.creator_id)) : null;
    return { ...(data as unknown as TestSeries), creator: creator ?? data?.creator };
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
      .select("*")
      .eq(field, profileId)
      .order("requested_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<MentorshipRequest & { user?: unknown; mentor?: unknown }>;
    const profileIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [Number(row.user_id || 0), Number(row.mentor_id || 0)])
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    const profiles = profileIds.length > 0 ? await profilesApi.batch(profileIds) : [];
    const profileMap = new Map(profiles.map((row) => [row.id, row]));
    return rows.map((row) => {
      const userProfile = profileMap.get(Number(row.user_id || 0));
      const mentorProfile = profileMap.get(Number(row.mentor_id || 0));
      return {
        ...row,
        user: userProfile
          ? {
              id: userProfile.id,
              display_name: userProfile.display_name,
              avatar_url: userProfile.avatar_url,
            }
          : null,
        mentor: mentorProfile
          ? {
              id: mentorProfile.id,
              display_name: mentorProfile.display_name,
              avatar_url: mentorProfile.avatar_url,
            }
          : null,
      } as MentorshipRequest;
    });
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
