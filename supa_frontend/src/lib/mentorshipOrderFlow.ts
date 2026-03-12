import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
} from "@/types/premium";

import { isCopyEvaluationFlow } from "@/lib/copyEvaluationFlow";

export type WorkflowStepState = "completed" | "current" | "upcoming";

export interface WorkflowStep {
  key: string;
  label: string;
  state: WorkflowStepState;
  detail?: string | null;
  at?: string | null;
}

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

export const requestMetaDate = (request: MentorshipRequest | null | undefined, key: string): string | null =>
  request ? asText(request.meta?.[key]) : null;

export const formatWorkflowDateTime = (value?: string | null): string => {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const firstIncompleteIndex = (values: boolean[]): number => {
  const index = values.findIndex((value) => !value);
  return index === -1 ? values.length - 1 : index;
};

const toStepState = (index: number, currentIndex: number, completed: boolean): WorkflowStepState => {
  if (completed) return "completed";
  if (index === currentIndex) return "current";
  return "upcoming";
};

export const mentorshipKindLabel = (
  request: MentorshipRequest | null | undefined,
  submission?: MainsCopySubmission | null,
): string => (isCopyEvaluationFlow(request, submission) ? "Copy Evaluation + Mentorship" : "Direct Mentorship");

export const mentorshipCurrentStatusLabel = (
  request: MentorshipRequest | null | undefined,
  session?: MentorshipSession | null,
  submission?: MainsCopySubmission | null,
  offeredSlotCount = 0,
): string => {
  if (!request) return "Status unavailable";
  if (request.status === "cancelled") return "Request cancelled";
  if (request.status === "rejected") return "Request rejected";
  if (session?.status === "live") return "Mentorship session live";
  if (request.status === "completed" || session?.status === "completed") return "Mentorship session completed";

  if (isCopyEvaluationFlow(request, submission)) {
    if (request.status === "scheduled" || session?.status === "scheduled") return "Mentorship allotted";
    if (submission?.status === "checked") {
      return offeredSlotCount > 0 ? "Mentorship slot shared" : "Evaluation done";
    }
    if (submission?.status === "under_review" || submission?.status === "eta_declared") return "Evaluation in progress";
    return "Copy submitted";
  }

  if (request.status === "scheduled" || session?.status === "scheduled") return "Mentorship allotted";
  if (requestMetaDate(request, "booked_by_user_at")) return "Slot booked";
  return "Request submitted";
};

export const mentorshipNextActionLabel = (
  request: MentorshipRequest | null | undefined,
  session?: MentorshipSession | null,
  submission?: MainsCopySubmission | null,
  offeredSlotCount = 0,
): string => {
  if (!request) return "Open the detail page to inspect this workflow.";
  if (request.status === "cancelled" || request.status === "rejected") return "No further action pending.";
  if (session?.status === "live") return "Join or complete the live mentorship session.";
  if (request.status === "completed" || session?.status === "completed") return "Workflow completed.";

  if (isCopyEvaluationFlow(request, submission)) {
    if (submission?.status !== "checked") return "Waiting for the mentor to finish evaluation.";
    if (offeredSlotCount === 0 && request.status === "requested") return "Waiting for the mentor to allot mentorship slots.";
    if (offeredSlotCount > 0 && request.status === "requested") return "Accept one allotted mentorship slot.";
  }

  if (request.status === "scheduled" || session?.status === "scheduled") return "Attend the scheduled mentorship session.";
  if (requestMetaDate(request, "booked_by_user_at")) return "Wait for the scheduled session window.";
  return "Wait for the mentor-side workflow to progress.";
};

export const buildMentorshipWorkflowSteps = ({
  request,
  session,
  submission,
  offeredSlotCount = 0,
}: {
  request: MentorshipRequest;
  session?: MentorshipSession | null;
  submission?: MainsCopySubmission | null;
  offeredSlotCount?: number;
}): WorkflowStep[] => {
  const scheduledFor = requestMetaDate(request, "scheduled_slot_starts_at") || session?.starts_at || null;
  const acceptedAt = requestMetaDate(request, "accepted_at");
  const bookedByUserAt = requestMetaDate(request, "booked_by_user_at");
  const completedAt = requestMetaDate(request, "completed_at") || session?.updated_at || null;
  const liveAt = session?.status === "live" ? session.starts_at : null;
  const isCopyFlow = isCopyEvaluationFlow(request, submission);

  if (isCopyFlow) {
    const completedFlags = [
      Boolean(submission),
      Boolean(
        submission &&
          (submission.provider_eta_hours ||
            submission.provider_eta_text ||
            submission.status === "eta_declared" ||
            submission.status === "under_review" ||
            submission.status === "checked"),
      ),
      submission?.status === "checked",
      Boolean(
        request.status === "scheduled" ||
          request.status === "completed" ||
          session?.status === "scheduled" ||
          session?.status === "live" ||
          session?.status === "completed" ||
          offeredSlotCount > 0,
      ),
      Boolean(request.status === "completed" || session?.status === "completed"),
    ];

    const currentIndex = firstIncompleteIndex(completedFlags);

    return [
      {
        key: "copy_submitted",
        label: "Copy Submitted",
        state: toStepState(0, currentIndex, completedFlags[0]),
        at: submission?.submitted_at || request.requested_at,
      },
      {
        key: "evaluation_progress",
        label: "Evaluation In Progress",
        state: toStepState(1, currentIndex, completedFlags[1]),
        at: submission?.eta_set_at || acceptedAt,
        detail: submission?.provider_eta_text || (submission?.provider_eta_hours ? `${submission.provider_eta_hours} hour ETA` : null),
      },
      {
        key: "evaluation_done",
        label: "Evaluation Done",
        state: toStepState(2, currentIndex, completedFlags[2]),
        at: submission?.checked_at || null,
        detail: submission?.total_marks !== null && submission?.total_marks !== undefined ? `Marks: ${submission.total_marks}` : null,
      },
      {
        key: "mentorship_allotted",
        label: "Mentorship Allotted",
        state: toStepState(3, currentIndex, completedFlags[3]),
        at: scheduledFor || bookedByUserAt,
        detail:
          request.status === "scheduled" || session?.status === "scheduled"
            ? "Session scheduled"
            : offeredSlotCount > 0
              ? `${offeredSlotCount} slot option${offeredSlotCount === 1 ? "" : "s"} shared`
              : null,
      },
      {
        key: "session_completed",
        label: "Session Completed",
        state: toStepState(4, currentIndex, completedFlags[4]),
        at: completedAt,
      },
    ];
  }

  const completedFlags = [
    true,
    Boolean(bookedByUserAt || request.scheduled_slot_id || request.status === "scheduled" || request.status === "completed"),
    Boolean(request.status === "scheduled" || request.status === "completed" || session?.status === "scheduled" || session?.status === "live" || session?.status === "completed"),
    Boolean(session?.status === "live" || session?.status === "completed"),
    Boolean(request.status === "completed" || session?.status === "completed"),
  ];
  const currentIndex = firstIncompleteIndex(completedFlags);

  return [
    {
      key: "request_submitted",
      label: "Request Submitted",
      state: toStepState(0, currentIndex, completedFlags[0]),
      at: request.requested_at,
    },
    {
      key: "slot_booked",
      label: "Slot Booked",
      state: toStepState(1, currentIndex, completedFlags[1]),
      at: bookedByUserAt || acceptedAt,
    },
    {
      key: "mentorship_allotted",
      label: "Mentorship Allotted",
      state: toStepState(2, currentIndex, completedFlags[2]),
      at: scheduledFor,
      detail: scheduledFor ? "Session timing confirmed" : null,
    },
    {
      key: "session_live",
      label: "Session Live",
      state: toStepState(3, currentIndex, completedFlags[3]),
      at: liveAt,
    },
    {
      key: "session_completed",
      label: "Session Completed",
      state: toStepState(4, currentIndex, completedFlags[4]),
      at: completedAt,
    },
  ];
};
