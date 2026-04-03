import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  MentorshipWorkflowStage,
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

const WORKFLOW_STAGE_ORDER: MentorshipWorkflowStage[] = [
  "submitted",
  "accepted",
  "payment_pending",
  "paid",
  "evaluating",
  "feedback_ready",
  "booking_open",
  "scheduled",
  "live",
  "completed",
  "cancelled",
  "expired",
];

const DIRECT_STAGE_ORDER: MentorshipWorkflowStage[] = [
  "submitted",
  "accepted",
  "payment_pending",
  "paid",
  "booking_open",
  "scheduled",
  "live",
  "completed",
  "cancelled",
  "expired",
];

const COPY_STAGE_ORDER: MentorshipWorkflowStage[] = [
  "submitted",
  "accepted",
  "payment_pending",
  "paid",
  "evaluating",
  "feedback_ready",
  "booking_open",
  "scheduled",
  "live",
  "completed",
  "cancelled",
  "expired",
];

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const isWorkflowStage = (value: string | null | undefined): value is MentorshipWorkflowStage =>
  Boolean(value) && WORKFLOW_STAGE_ORDER.includes(value as MentorshipWorkflowStage);

const stageIndex = (stage: MentorshipWorkflowStage, isCopyFlow: boolean): number => {
  const order = isCopyFlow ? COPY_STAGE_ORDER : DIRECT_STAGE_ORDER;
  const index = order.indexOf(stage);
  return index >= 0 ? index : 0;
};

const workflowStepState = (
  stepOrderIndex: number,
  currentStageIndex: number,
  currentStage: MentorshipWorkflowStage,
): WorkflowStepState => {
  if (currentStage === "completed") return "completed";
  if (stepOrderIndex < currentStageIndex) return "completed";
  if (stepOrderIndex === currentStageIndex) return "current";
  return "upcoming";
};

export const requestMetaDate = (request: MentorshipRequest | null | undefined, key: string): string | null =>
  request ? asText(request.meta?.[key]) : null;

export const formatWorkflowDateTime = (value?: string | null): string => {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

export const workflowStageSortIndex = (stage: MentorshipWorkflowStage): number => WORKFLOW_STAGE_ORDER.indexOf(stage);

export const workflowStageLabel = (stage: MentorshipWorkflowStage): string => {
  if (stage === "submitted") return "Submitted";
  if (stage === "accepted") return "Accepted";
  if (stage === "payment_pending") return "Payment Pending";
  if (stage === "paid") return "Paid";
  if (stage === "evaluating") return "Under Review";
  if (stage === "feedback_ready") return "Feedback Ready";
  if (stage === "booking_open") return "Select Slot";
  if (stage === "scheduled") return "Scheduled";
  if (stage === "live") return "Live";
  if (stage === "completed") return "Completed";
  if (stage === "expired") return "Expired";
  return "Workflow Closed";
};

export const mentorshipKindLabel = (
  request: MentorshipRequest | null | undefined,
  submission?: MainsCopySubmission | null,
): string => (isCopyEvaluationFlow(request, submission) ? "Evaluation + Mentorship" : "Mentorship Only");

export const resolveMentorshipWorkflowStage = (
  request: MentorshipRequest | null | undefined,
  session?: MentorshipSession | null,
  submission?: MainsCopySubmission | null,
  offeredSlotCount = 0,
): MentorshipWorkflowStage => {
  if (!request) return "submitted";
  const requestedStage = isWorkflowStage(request.workflow_stage) ? request.workflow_stage : null;
  if (request.status === "cancelled" || request.status === "rejected") return "cancelled";
  if (request.status === "expired") return "expired";
  if (request.status === "completed" || session?.status === "completed") return "completed";
  if (session?.status === "live") return "live";
  if (request.status === "scheduled" || session?.status === "scheduled") return "scheduled";
  if (requestedStage === "cancelled" || requestedStage === "expired") return requestedStage;

  const copyFlow = isCopyEvaluationFlow(request, submission);
  if (request.status === "accepted" || request.accepted_at) {
    if (request.payment_status === "paid") {
      if (copyFlow) {
        if (submission?.status === "checked" || request.feedback_ready_at) {
          return request.booking_open || offeredSlotCount > 0 ? "booking_open" : "feedback_ready";
        }
        if (
          submission?.status === "under_review" ||
          submission?.status === "eta_declared" ||
          Boolean(submission?.eta_set_at) ||
          Boolean(requestMetaDate(request, "copy_eta_set_at"))
        ) {
          return "evaluating";
        }
        return request.booking_open || offeredSlotCount > 0 ? "booking_open" : "paid";
      }
      if (request.booking_open || offeredSlotCount > 0 || Boolean(request.booking_opened_at)) return "booking_open";
      return requestedStage === "paid" ? "paid" : "paid";
    }
    return "payment_pending";
  }

  if (requestedStage) return requestedStage;
  return "submitted";
};

export const mentorshipCurrentStatusLabel = (
  request: MentorshipRequest | null | undefined,
  session?: MentorshipSession | null,
  submission?: MainsCopySubmission | null,
  offeredSlotCount = 0,
): string => {
  if (!request) return "Status unavailable";
  if (request.status === "rejected") return "Request Rejected";
  if (request.status === "cancelled") return "Request Cancelled";
  if (request.status === "expired") return "Request Expired";
  return workflowStageLabel(resolveMentorshipWorkflowStage(request, session, submission, offeredSlotCount));
};

export const mentorshipNextActionLabel = (
  request: MentorshipRequest | null | undefined,
  session?: MentorshipSession | null,
  submission?: MainsCopySubmission | null,
  offeredSlotCount = 0,
): string => {
  if (!request) return "Open the detail page to inspect this workflow.";
  if (request.status === "rejected") return "Review the mentor response and request another mentor if needed.";
  if (request.status === "cancelled") return "This request was cancelled.";
  if (request.status === "expired") return "This request expired. Create a new request to continue.";

  const stage = resolveMentorshipWorkflowStage(request, session, submission, offeredSlotCount);
  if (stage === "submitted") return "The mentor will review the request and reply in chat.";
  if (stage === "accepted") return "The mentor accepted the request.";
  if (stage === "payment_pending") return "Complete payment to unlock the next step.";
  if (stage === "paid" && isCopyEvaluationFlow(request, submission)) return "Payment is complete. The mentor will start the evaluation.";
  if (stage === "paid") return "Payment is complete. Waiting for slot options to open.";
  if (stage === "evaluating") return "The mentor is evaluating your copy.";
  if (stage === "feedback_ready") return "Feedback is ready. Wait for slot booking to open.";
  if (stage === "booking_open") return "Select a time slot for the mentorship session.";
  if (stage === "scheduled") {
    return session?.join_available ? "Join the session at the scheduled time." : "The session is booked. Join access will appear here.";
  }
  if (stage === "live") return session?.join_available ? "Open the live session now." : "The session is live.";
  if (stage === "completed") return "This mentorship workflow is complete.";
  return "No further action is pending.";
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
  const copyFlow = isCopyEvaluationFlow(request, submission);
  const stage = resolveMentorshipWorkflowStage(request, session, submission, offeredSlotCount);
  const displayStage = stage === "cancelled" || stage === "expired" ? "submitted" : stage;
  const currentIndex = stageIndex(displayStage, copyFlow);
  const scheduledFor = requestMetaDate(request, "scheduled_slot_starts_at") || session?.starts_at || null;
  const completedAt = requestMetaDate(request, "completed_at") || session?.live_ended_at || session?.updated_at || null;
  const liveAt = session?.live_started_at || (session?.status === "live" ? session.starts_at : null);

  if (copyFlow) {
    return [
      {
        key: "submitted",
        label: "Submitted",
        state: workflowStepState(0, currentIndex, stage),
        at: submission?.submitted_at || request.requested_at,
      },
      {
        key: "accepted",
        label: "Accepted",
        state: workflowStepState(1, currentIndex, stage),
        at: request.accepted_at || requestMetaDate(request, "accepted_at"),
      },
      {
        key: "payment_pending",
        label: "Pay",
        state: workflowStepState(2, currentIndex, stage),
        at: requestMetaDate(request, "payment_paid_at"),
        detail: `${request.payment_currency} ${request.payment_amount.toLocaleString()}`,
      },
      {
        key: "evaluating",
        label: "Under Review",
        state: workflowStepState(4, currentIndex, stage),
        at: submission?.eta_set_at || requestMetaDate(request, "copy_eta_set_at"),
        detail:
          submission?.provider_eta_text ||
          (submission?.provider_eta_hours ? `${submission.provider_eta_hours} hour ETA` : null),
      },
      {
        key: "feedback_ready",
        label: "Feedback Ready",
        state: workflowStepState(5, currentIndex, stage),
        at: request.feedback_ready_at || submission?.checked_at || null,
        detail:
          submission?.total_marks !== null && submission?.total_marks !== undefined
            ? `Marks: ${submission.total_marks}`
            : null,
      },
      {
        key: "booking_open",
        label: "Select Slot",
        state: workflowStepState(6, currentIndex, stage),
        at: request.booking_opened_at || request.feedback_ready_at || null,
      },
      {
        key: "scheduled",
        label: "Scheduled",
        state: workflowStepState(7, currentIndex, stage),
        at: scheduledFor,
      },
      {
        key: "live",
        label: "Live",
        state: workflowStepState(8, currentIndex, stage),
        at: liveAt,
      },
      {
        key: "completed",
        label: "Completed",
        state: workflowStepState(9, currentIndex, stage),
        at: completedAt,
      },
    ];
  }

  return [
    {
      key: "submitted",
      label: "Submitted",
      state: workflowStepState(0, currentIndex, stage),
      at: request.requested_at,
    },
    {
      key: "accepted",
      label: "Accepted",
      state: workflowStepState(1, currentIndex, stage),
      at: request.accepted_at || requestMetaDate(request, "accepted_at"),
    },
    {
      key: "payment_pending",
      label: "Pay",
      state: workflowStepState(2, currentIndex, stage),
      at: requestMetaDate(request, "payment_paid_at"),
      detail: `${request.payment_currency} ${request.payment_amount.toLocaleString()}`,
    },
    {
      key: "booking_open",
      label: "Select Slot",
      state: workflowStepState(4, currentIndex, stage),
      at: request.booking_opened_at || requestMetaDate(request, "booking_opened_at"),
    },
    {
      key: "scheduled",
      label: "Scheduled",
      state: workflowStepState(5, currentIndex, stage),
      at: scheduledFor,
    },
    {
      key: "live",
      label: "Live",
      state: workflowStepState(6, currentIndex, stage),
      at: liveAt,
    },
    {
      key: "completed",
      label: "Completed",
      state: workflowStepState(7, currentIndex, stage),
      at: completedAt,
    },
  ];
};
