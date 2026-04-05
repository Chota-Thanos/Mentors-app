import { premiumApi } from "@/lib/premiumApi";
import type {
  LifecycleTrackingPayload,
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  ProfessionalPublicProfileDetail,
  TestSeries,
  TestSeriesTest,
} from "@/types/premium";

export interface LearnerMentorshipOrdersData {
  requests: MentorshipRequest[];
  sessions: MentorshipSession[];
  tracking: LifecycleTrackingPayload;
  seriesById: Record<string, TestSeries>;
  testsById: Record<string, TestSeriesTest>;
  submissionsById: Record<string, MainsCopySubmission>;
  mentorNameByUserId: Record<string, string>;
}

const emptyTracking: LifecycleTrackingPayload = {
  generated_at: "",
  summary: {
    users: 0,
    mentorship_cycles: 0,
    pending_mentorship: 0,
    scheduled_mentorship: 0,
    completed_mentorship: 0,
    pending_copy_checks: 0,
    delayed_items: 0,
    technical_issues: 0,
  },
  mentorship_cycles: [],
  user_rows: [],
};

async function fetchRecordMap<T extends { id: number }>(
  ids: number[],
  fetcher: (id: number) => Promise<T>,
): Promise<Record<string, T>> {
  if (ids.length === 0) return {};
  const results = await Promise.allSettled(ids.map((id) => fetcher(id)));
  const output: Record<string, T> = {};
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const row = result.value;
    if (row?.id) output[String(row.id)] = row;
  }
  return output;
}

async function fetchMentorNameMap(providerUserIds: string[]): Promise<Record<string, string>> {
  if (providerUserIds.length === 0) return {};
  const results = await Promise.allSettled(
    providerUserIds.map((userId) => premiumApi.get<ProfessionalPublicProfileDetail>(`/profiles/${userId}/detail`)),
  );
  const output: Record<string, string> = {};
  for (let index = 0; index < results.length; index += 1) {
    const userId = providerUserIds[index];
    const result = results[index];
    if (result.status !== "fulfilled") continue;
    const displayName = String(result.value.data?.profile?.display_name || "").trim();
    if (displayName) output[userId] = displayName;
  }
  return output;
}

export async function loadLearnerMentorshipOrders(): Promise<LearnerMentorshipOrdersData> {
  const [requestsResponse, sessionsResponse, trackingResponse] = await Promise.all([
    premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "me" } }),
    premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope: "me" } }),
    premiumApi.get<LifecycleTrackingPayload>("/lifecycle/tracking", { params: { scope: "me", limit_cycles: 200, limit_users: 1 } }),
  ]);

  const requests = Array.isArray(requestsResponse.data) ? requestsResponse.data : [];
  const sessions = Array.isArray(sessionsResponse.data) ? sessionsResponse.data : [];
  const tracking = trackingResponse.data || emptyTracking;

  const seriesIds = Array.from(
    new Set(
      requests
        .map((row) => Number(row.series_id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
  const testIds = Array.from(
    new Set(
      requests
        .map((row) => Number(row.test_collection_id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
  const submissionIds = Array.from(
    new Set(
      requests
        .map((row) => Number(row.submission_id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
  const providerUserIds = Array.from(
    new Set(
      requests
        .map((row) => String(row.provider_user_id || "").trim())
        .filter(Boolean),
    ),
  );

  const [seriesById, testsById, submissionsById, mentorNameByUserId] = await Promise.all([
    fetchRecordMap(seriesIds, async (id) => (await premiumApi.get<TestSeries>(`/programs/${id}`)).data),
    fetchRecordMap(testIds, async (id) => (await premiumApi.get<TestSeriesTest>(`/tests/${id}`)).data),
    fetchRecordMap(submissionIds, async (id) => (await premiumApi.get<MainsCopySubmission>(`/copy-submissions/${id}`)).data),
    fetchMentorNameMap(providerUserIds),
  ]);

  return {
    requests,
    sessions,
    tracking,
    seriesById,
    testsById,
    submissionsById,
    mentorNameByUserId,
  };
}
