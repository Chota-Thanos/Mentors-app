import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  MentorshipSlot,
} from "@/types/premium";

export type CopyFlowStepStatus = "pending" | "completed";

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
  const scheduled =
    request?.status === "scheduled" ||
    session?.status === "scheduled" ||
    session?.status === "live" ||
    session?.status === "completed";
  const completed = request?.status === "completed" || session?.status === "completed";

  return [
    {
      key: "submitted",
      label: "Copy Submitted",
      status: submission ? "completed" : "pending",
    },
    {
      key: "eta",
      label: "Checking ETA",
      status:
        submission &&
        (Boolean(submission.provider_eta_hours) ||
          Boolean(submission.provider_eta_text) ||
          submission.status === "eta_declared" ||
          submission.status === "under_review" ||
          submission.status === "checked")
          ? "completed"
          : "pending",
    },
    {
      key: "checked",
      label: "Copy Checked",
      status: submission?.status === "checked" ? "completed" : "pending",
    },
    {
      key: "slots",
      label: "Mentor Slots",
      status: slotOffers.length > 0 || scheduled ? "completed" : "pending",
      detail:
        slotOffers.length > 0 && !scheduled
          ? `${slotOffers.length} option${slotOffers.length === 1 ? "" : "s"} shared`
          : null,
    },
    {
      key: "scheduled",
      label: "Call Scheduled",
      status: scheduled ? "completed" : "pending",
    },
    {
      key: "completed",
      label: "Call Completed",
      status: completed ? "completed" : "pending",
    },
  ];
};
