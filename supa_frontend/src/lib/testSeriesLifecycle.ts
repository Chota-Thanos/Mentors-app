export type LifecycleStepKey =
  | "discover"
  | "enrolled"
  | "attempted"
  | "copy_submitted"
  | "copy_checked"
  | "mentorship_requested"
  | "mentorship_scheduled"
  | "mentorship_completed";

export type LifecycleStepStatus = "locked" | "ready" | "in_progress" | "completed";

export interface UserLifecycleMetrics {
  enrolled: boolean;
  attempted_tests: number;
  copy_submissions: number;
  copy_checked: number;
  mentorship_requests: number;
  mentorship_scheduled: number;
  mentorship_completed: number;
}

export interface LifecycleStepState {
  key: LifecycleStepKey;
  label: string;
  description: string;
  status: LifecycleStepStatus;
  value: number;
}

const baseSteps: Array<Omit<LifecycleStepState, "status" | "value">> = [
  {
    key: "discover",
    label: "Discover Series",
    description: "Browse the test series and understand the roadmap.",
  },
  {
    key: "enrolled",
    label: "Enroll",
    description: "Get access through subscription or enrollment.",
  },
  {
    key: "attempted",
    label: "Attempt Tests",
    description: "Start writing mains answers or attempting quizzes.",
  },
  {
    key: "copy_submitted",
    label: "Submit Copy",
    description: "Upload answer copy PDF for provider review.",
  },
  {
    key: "copy_checked",
    label: "Checked + Marks",
    description: "Receive checked copy with question-wise marks.",
  },
  {
    key: "mentorship_requested",
    label: "Request Mentorship",
    description: "Raise a one-to-one mentorship request.",
  },
  {
    key: "mentorship_scheduled",
    label: "Session Scheduled",
    description: "Get an assigned slot and meeting details.",
  },
  {
    key: "mentorship_completed",
    label: "Mentorship Completed",
    description: "Close learning loop and repeat from next test.",
  },
];

const stepValue = (metrics: UserLifecycleMetrics, key: LifecycleStepKey): number => {
  switch (key) {
    case "discover":
      return 1;
    case "enrolled":
      return metrics.enrolled ? 1 : 0;
    case "attempted":
      return metrics.attempted_tests;
    case "copy_submitted":
      return metrics.copy_submissions;
    case "copy_checked":
      return metrics.copy_checked;
    case "mentorship_requested":
      return metrics.mentorship_requests;
    case "mentorship_scheduled":
      return metrics.mentorship_scheduled;
    case "mentorship_completed":
      return metrics.mentorship_completed;
    default:
      return 0;
  }
};

const isCompleted = (metrics: UserLifecycleMetrics, key: LifecycleStepKey): boolean => stepValue(metrics, key) > 0;

export const buildLifecycleSteps = (metrics: UserLifecycleMetrics): LifecycleStepState[] => {
  let priorCompleted = true;
  return baseSteps.map((step) => {
    const value = stepValue(metrics, step.key);
    let status: LifecycleStepStatus = "locked";
    if (value > 0) {
      status = "completed";
      priorCompleted = true;
    } else if (priorCompleted) {
      status = "ready";
      priorCompleted = false;
    } else {
      status = "locked";
    }

    if (status === "ready" && step.key === "copy_submitted" && metrics.attempted_tests > 0) {
      status = "in_progress";
    }
    if (status === "ready" && step.key === "copy_checked" && metrics.copy_submissions > 0) {
      status = "in_progress";
    }
    if (status === "ready" && step.key === "mentorship_scheduled" && metrics.mentorship_requests > 0) {
      status = "in_progress";
    }
    if (status === "ready" && step.key === "mentorship_completed" && metrics.mentorship_scheduled > 0) {
      status = "in_progress";
    }

    return {
      ...step,
      status,
      value,
    };
  });
};

export const lifecycleCompletionPercent = (metrics: UserLifecycleMetrics): number => {
  const steps = baseSteps.length;
  let done = 0;
  for (const step of baseSteps) {
    if (isCompleted(metrics, step.key)) done += 1;
  }
  return Math.round((done / steps) * 100);
};
