import type {
  MainsCopySubmission,
  MentorshipMessage,
  MentorshipRequest,
  MentorshipSession,
  MentorshipSlot,
} from "@/types/premium";

type AnyRow = Record<string, any>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asNumberOrNull = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

export const dbMentorshipMode = (mode?: string | null): "video" | "chat" | "call" => {
  if (mode === "audio" || mode === "call") return "call";
  if (mode === "chat") return "chat";
  return "video";
};

export function normalizeMentorshipRequest(row: AnyRow): MentorshipRequest {
  const meta = asRecord(row.meta);
  const submissionId = asNumberOrNull(row.submission_id ?? meta.submission_id);
  const paymentAmount = Number(row.payment_amount ?? 0);

  return {
    ...row,
    user_id: String(row.user_id ?? ""),
    provider_user_id: String(row.provider_user_id ?? row.mentor_id ?? ""),
    submission_id: submissionId,
    test_collection_id: asNumberOrNull(row.test_collection_id ?? meta.test_collection_id),
    service_type:
      row.service_type ??
      meta.service_type ??
      (submissionId ? "copy_evaluation_and_mentorship" : "mentorship_only"),
    payment_status: row.payment_status ?? "paid",
    payment_amount: Number.isFinite(paymentAmount) ? paymentAmount : 0,
    payment_currency: row.payment_currency ?? "INR",
    workflow_stage: row.workflow_stage ?? (row.status === "scheduled" ? "scheduled" : undefined),
    booking_open: Boolean(row.booking_open ?? row.scheduled_slot_id),
    booking_opened_at: row.booking_opened_at ?? null,
    accepted_at: row.accepted_at ?? (row.status === "scheduled" ? row.updated_at : null),
    feedback_ready_at: row.feedback_ready_at ?? null,
    meta,
  } as MentorshipRequest;
}

export function normalizeMentorshipSession(row: AnyRow): MentorshipSession {
  return {
    ...row,
    user_id: String(row.user_id ?? ""),
    provider_user_id: String(row.provider_user_id ?? row.mentor_id ?? ""),
    mode: row.mode === "call" ? "audio" : row.mode ?? "video",
    call_provider: row.call_provider ?? (row.meeting_link ? "custom" : "zoom_video_sdk"),
    join_available: row.join_available ?? ["scheduled", "live"].includes(String(row.status || "")),
  } as MentorshipSession;
}

export function normalizeMentorshipSlot(row: AnyRow): MentorshipSlot {
  return {
    ...row,
    provider_user_id: String(row.provider_user_id ?? row.mentor_id ?? ""),
    mode: row.mode === "call" ? "audio" : row.mode ?? "video",
    call_provider: row.call_provider ?? (row.meeting_link ? "custom" : "zoom_video_sdk"),
  } as MentorshipSlot;
}

export function normalizeMentorshipMessage(row: AnyRow): MentorshipMessage {
  return {
    ...row,
    sender_user_id: String(row.sender_user_id ?? row.sender_id ?? ""),
  } as MentorshipMessage;
}

export function normalizeMainsCopySubmission(row: AnyRow): MainsCopySubmission {
  const status = String(row.status || "submitted");
  return {
    ...row,
    user_id: String(row.user_id ?? ""),
    test_collection_id: row.test_collection_id ?? row.collection_id ?? null,
    submission_mode: row.submission_mode ?? (row.answer_pdf_url ? "pdf" : "digital_text"),
    status: status === "evaluated" || status === "returned" ? "checked" : status,
    provider_note: row.provider_note ?? row.evaluator_note ?? row.evaluation_text ?? null,
    checked_at: row.checked_at ?? row.evaluated_at ?? row.ai_evaluated_at ?? null,
    eta_set_at: row.eta_set_at ?? null,
    question_responses: Array.isArray(row.question_responses) ? row.question_responses : [],
    question_marks: Array.isArray(row.question_marks) ? row.question_marks : [],
  } as MainsCopySubmission;
}
