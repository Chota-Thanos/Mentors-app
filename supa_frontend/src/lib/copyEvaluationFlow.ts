import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  MentorshipSlot,
  MentorshipWorkflowStage,
} from "@/types/premium";

export type CopyFlowStepStatus = "pending" | "completed" | "current";

export interface CopyFlowStep {
  key: string;
  label: string;
  status: CopyFlowStepStatus;
  detail?: string | null;
}

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

export const requestMetaText = (request: MentorshipRequest | null | undefined, key: string): string | null =>
  request ? asText(request.meta?.[key]) : null;

export const requestOfferedSlotIds = (request: MentorshipRequest | null | undefined): number[] => {
  const raw = request?.meta?.offered_slot_ids;
  if (!Array.isArray(raw)) return [];
  const output: number[] = [];
  for (const item of raw) {
    const value = Number(item);
    if (!Number.isFinite(value) || value <= 0 || output.includes(value)) continue;
    output.push(value);
  }
  return output;
};

export const offeredSlotsForRequest = (
  request: MentorshipRequest | null | undefined,
  slots: MentorshipSlot[],
): MentorshipSlot[] => {
  const offeredIds = requestOfferedSlotIds(request);
  if (offeredIds.length === 0) return [];
  const byId = new Map<number, MentorshipSlot>();
  for (const slot of slots) {
    byId.set(slot.id, slot);
  }
  return offeredIds
    .map((slotId) => byId.get(slotId) || null)
    .filter((slot): slot is MentorshipSlot => Boolean(slot));
};

export const isCopyEvaluationFlow = (
  request: MentorshipRequest | null | undefined,
  submission?: MainsCopySubmission | null,
): boolean => {
  if (submission) return true;
  if (!request) return false;
  return Boolean(request.submission_id) || String(request.meta?.flow_kind || "").trim() === "copy_evaluation";
};

export const buildCopyEvaluationFlowSteps = (
  submission?: MainsCopySubmission | null,
  request?: MentorshipRequest | null,
  session?: MentorshipSession | null,
): CopyFlowStep[] => {
  const slotOffers = requestOfferedSlotIds(request);
  const requestedStage = request?.workflow_stage;
  let stage: MentorshipWorkflowStage = "submitted";
  if (requestedStage) {
    stage = requestedStage;
  } else if (request?.status === "cancelled" || request?.status === "rejected") {
    stage = "cancelled";
  } else if (request?.status === "completed" || session?.status === "completed") {
    stage = "completed";
  } else if (session?.status === "live") {
    stage = "live";
  } else if (request?.status === "scheduled" || session?.status === "scheduled") {
    stage = "scheduled";
  } else if (submission?.status === "checked") {
    stage = request?.booking_open || slotOffers.length > 0 ? "booking_open" : "feedback_ready";
  } else if (submission?.status === "under_review" || submission?.status === "eta_declared" || submission?.eta_set_at) {
    stage = "evaluating";
  }

  const stepOrder: MentorshipWorkflowStage[] = [
    "submitted",
    "evaluating",
    "feedback_ready",
    "booking_open",
    "scheduled",
    "live",
    "completed",
  ];
  const currentStage = stage === "cancelled" ? "submitted" : stage;
  const currentIndex = Math.max(stepOrder.indexOf(currentStage), 0);

  return [
    {
      key: "submitted",
      label: "Submitted",
      status: stage === "completed" || currentIndex > 0 ? "completed" : currentIndex === 0 ? "current" : "pending",
    },
    {
      key: "evaluating",
      label: "Under Review",
      status: stage === "completed" || currentIndex > 1 ? "completed" : currentIndex === 1 ? "current" : "pending",
      detail:
        submission?.provider_eta_text ||
        (submission?.provider_eta_hours ? `${submission.provider_eta_hours} hour ETA` : null),
    },
    {
      key: "feedback_ready",
      label: "Feedback Ready",
      status: stage === "completed" || currentIndex > 2 ? "completed" : currentIndex === 2 ? "current" : "pending",
      detail:
        submission?.total_marks !== null && submission?.total_marks !== undefined
          ? `Marks: ${submission.total_marks}`
          : null,
    },
    {
      key: "booking_open",
      label: "Book Session",
      status: stage === "completed" || currentIndex > 3 ? "completed" : currentIndex === 3 ? "current" : "pending",
      detail: request?.booking_open ? "Choose a published mentor slot." : "Waiting for mentor availability.",
    },
    {
      key: "scheduled",
      label: "Scheduled",
      status: stage === "completed" || currentIndex > 4 ? "completed" : currentIndex === 4 ? "current" : "pending",
    },
    {
      key: "live",
      label: "Live",
      status: stage === "completed" || currentIndex > 5 ? "completed" : currentIndex === 5 ? "current" : "pending",
    },
    {
      key: "completed",
      label: "Completed",
      status: stage === "completed" ? "completed" : currentIndex === 6 ? "current" : "pending",
    },
  ];
};
