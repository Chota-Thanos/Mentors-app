import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
} from "@/types/premium";

import { mentorshipCurrentStatusLabel } from "@/lib/mentorshipOrderFlow";

export type MainsTestSectionKey = "question_paper" | "evaluation" | "mentorship";
export type MainsTestSectionTone = "slate" | "amber" | "emerald" | "indigo";

export interface MainsTestSectionStatus {
  key: MainsTestSectionKey;
  label: string;
  status: string;
  detail: string;
  tone: MainsTestSectionTone;
}

export interface MainsTestFlowSummary {
  latestSubmission: MainsCopySubmission | null;
  latestRequest: MentorshipRequest | null;
  latestSession: MentorshipSession | null;
  activeSection: MainsTestSectionKey;
  overallStatus: string;
  sections: Record<MainsTestSectionKey, MainsTestSectionStatus>;
}

const parseDate = (value?: string | null): number => {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const latestSubmissionForTest = (submissions: MainsCopySubmission[]): MainsCopySubmission | null => {
  if (submissions.length === 0) return null;
  return [...submissions].sort((left, right) => {
    const delta = parseDate(right.submitted_at) - parseDate(left.submitted_at);
    if (delta !== 0) return delta;
    return right.id - left.id;
  })[0] || null;
};

export const linkedRequestForSubmission = (
  submission: MainsCopySubmission | null,
  requests: MentorshipRequest[],
): MentorshipRequest | null => {
  if (!submission) return null;
  return requests.find((request) => Number(request.submission_id || 0) === submission.id) || null;
};

export const linkedSessionForRequest = (
  request: MentorshipRequest | null,
  sessions: MentorshipSession[],
): MentorshipSession | null => {
  if (!request) return null;
  return sessions.find((session) => session.request_id === request.id) || null;
};

export const resolveMainsTestFlowSummary = ({
  submissions,
  requests,
  sessions,
}: {
  submissions: MainsCopySubmission[];
  requests: MentorshipRequest[];
  sessions: MentorshipSession[];
}): MainsTestFlowSummary => {
  const latestSubmission = latestSubmissionForTest(submissions);
  const latestRequest = linkedRequestForSubmission(latestSubmission, requests);
  const latestSession = linkedSessionForRequest(latestRequest, sessions);

  const questionPaper: MainsTestSectionStatus = {
    key: "question_paper",
    label: "Question Paper",
    status: latestSubmission ? "Ready" : "Start here",
    detail: latestSubmission ? "Paper is unlocked and at least one answer copy was submitted." : "Read the paper, then submit one PDF or question-wise answer copy.",
    tone: latestSubmission ? "emerald" : "slate",
  };

  let evaluation: MainsTestSectionStatus = {
    key: "evaluation",
    label: "Evaluation",
    status: "Not submitted",
    detail: "Submit your answer copy to move this paper into mentor evaluation.",
    tone: "slate",
  };
  let mentorship: MainsTestSectionStatus = {
    key: "mentorship",
    label: "Mentorship",
    status: "Locked",
    detail: "Mentorship opens only after the mentor checks your submission and assigns marks.",
    tone: "slate",
  };
  let activeSection: MainsTestSectionKey = "question_paper";
  let overallStatus = "Question paper ready";

  if (latestSubmission) {
    activeSection = "evaluation";
    overallStatus = "Evaluation awaited";
    evaluation = {
      key: "evaluation",
      label: "Evaluation",
      status: "Evaluation awaited",
      detail: "Your answer copy has been submitted. The mentor review is still pending.",
      tone: "amber",
    };
    mentorship = {
      key: "mentorship",
      label: "Mentorship",
      status: "Locked",
      detail: "Request mentorship after the checked copy and marks are ready.",
      tone: "slate",
    };
  }

  if (latestSubmission?.status === "eta_declared" || latestSubmission?.status === "under_review" || latestSubmission?.eta_set_at) {
    evaluation = {
      key: "evaluation",
      label: "Evaluation",
      status: latestSubmission.provider_eta_text ? "Under review" : "Evaluation awaited",
      detail: latestSubmission.provider_eta_text || "The mentor is reviewing this copy now.",
      tone: "amber",
    };
  }

  if (latestSubmission?.status === "checked") {
    const marksLabel =
      latestSubmission.total_marks !== null && latestSubmission.total_marks !== undefined
        ? `Marks: ${latestSubmission.total_marks}`
        : "Checked copy is ready.";
    evaluation = {
      key: "evaluation",
      label: "Evaluation",
      status: "Checked",
      detail: marksLabel,
      tone: "emerald",
    };
    mentorship = latestRequest
      ? {
          key: "mentorship",
          label: "Mentorship",
          status: mentorshipCurrentStatusLabel(
            latestRequest,
            latestSession,
            latestSubmission,
            latestRequest.booking_open ? 1 : 0,
          ),
          detail:
            latestSession?.status === "scheduled" || latestSession?.status === "live"
              ? "Your mentorship request is active. Open the session details from the desk."
              : "Mentorship request is active for this evaluated submission.",
          tone:
            latestSession?.status === "scheduled" || latestSession?.status === "live"
              ? "indigo"
              : latestRequest.status === "completed"
                ? "emerald"
                : "amber",
        }
      : {
          key: "mentorship",
          label: "Mentorship",
          status: "Request mentorship",
          detail: "Evaluation is complete. You can now request mentorship for this checked submission.",
          tone: "indigo",
        };
    activeSection = "mentorship";
    overallStatus = mentorship.status;
  }

  if (latestRequest) {
    overallStatus = mentorship.status;
  }

  return {
    latestSubmission,
    latestRequest,
    latestSession,
    activeSection,
    overallStatus,
    sections: {
      question_paper: questionPaper,
      evaluation,
      mentorship,
    },
  };
};
