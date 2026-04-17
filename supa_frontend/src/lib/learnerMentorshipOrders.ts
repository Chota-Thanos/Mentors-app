/**
 * Loads learner mentorship data directly from Supabase (V2 schema).
 * No FastAPI backend calls — all CRUD via RLS-secured Supabase queries.
 */

import { createClient } from "@/lib/supabase/client";
import {
  normalizeMainsCopySubmission,
  normalizeMentorshipRequest,
  normalizeMentorshipSession,
} from "@/lib/mentorshipV2";

import type { MentorshipRequest, MentorshipSession } from "@/types/premium";

export interface LearnerMentorshipOrdersData {
  requests: MentorshipRequest[];
  sessions: MentorshipSession[];
  seriesById: Record<string, TestSeriesRow>;
  submissionsById: Record<string, SubmissionRow>;
  mentorNameById: Record<string, string>;
}

export interface TestSeriesRow {
  id: number;
  name: string;
  description?: string | null;
  series_kind: string;
  cover_image_url?: string | null;
  price?: number | null;
  is_paid: boolean;
  is_active: boolean;
}

export interface SubmissionRow {
  id: number;
  user_id: number;
  series_id?: number | null;
  mains_question_id?: number | null;
  answer_text: string;
  status: string;
  ai_score?: number | null;
  ai_feedback?: string | null;
  mentor_score?: number | null;
  mentor_feedback?: string | null;
  submitted_at: string;
  updated_at: string;
}

export async function loadLearnerMentorshipOrders(
  profileId: number,
): Promise<LearnerMentorshipOrdersData> {
  const supabase = createClient();

  // Fetch mentorship requests for this learner, joined with mentor profile
  const { data: requestsData, error: reqError } = await supabase
    .from("mentorship_requests")
    .select(`
      *,
      mentor:profiles!mentorship_requests_mentor_id_fkey(id, display_name, avatar_url)
    `)
    .eq("user_id", profileId)
    .order("requested_at", { ascending: false });

  if (reqError) throw reqError;
  const requests = (requestsData ?? []).map((row) => normalizeMentorshipRequest(row as Record<string, unknown>));

  // Fetch sessions for this learner
  const { data: sessionsData, error: sessError } = await supabase
    .from("mentorship_sessions")
    .select("*")
    .eq("user_id", profileId)
    .order("starts_at", { ascending: false });

  if (sessError) throw sessError;
  const sessions = (sessionsData ?? []).map((row) => normalizeMentorshipSession(row as Record<string, unknown>));

  // Gather unique series IDs referenced by requests
  const seriesIds = Array.from(
    new Set(
      requests
        .map((r) => r.series_id)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  );

  // Fetch test series rows
  let seriesById: Record<string, TestSeriesRow> = {};
  if (seriesIds.length > 0) {
    const { data: seriesData } = await supabase
      .from("test_series")
      .select("id, name, description, series_kind, cover_image_url, price, is_paid, is_active")
      .in("id", seriesIds);
    for (const row of seriesData ?? []) {
      seriesById[String((row as TestSeriesRow).id)] = row as TestSeriesRow;
    }
  }

  // Fetch mains submissions for this learner
  const { data: submissionsData } = await supabase
    .from("mains_test_copy_submissions")
    .select("*")
    .eq("user_id", profileId)
    .order("submitted_at", { ascending: false });

  const submissionsById: Record<string, SubmissionRow> = {};
  for (const row of submissionsData ?? []) {
    const normalized = normalizeMainsCopySubmission(row as Record<string, unknown>) as unknown as SubmissionRow;
    submissionsById[String(normalized.id)] = normalized;
  }

  const mentorNameById: Record<string, string> = {};
  for (const req of requests) {
    const rawReq = req as unknown as any;
    if (rawReq.mentor?.display_name) {
      mentorNameById[String(req.provider_user_id)] = rawReq.mentor.display_name;
    }
  }

  return {
    requests,
    sessions,
    seriesById,
    submissionsById,
    mentorNameById,
  };
}
