import AppLayout from "@/components/layouts/AppLayout";
import QuizComplaintManagementView from "@/components/premium/QuizComplaintManagementView";

export const metadata = {
  title: "Quiz Master Complaint Desk - UPSC Prep",
  description: "Manage learner complaints raised from prelims test result pages.",
};

export default function QuizMasterComplaintsPage() {
  return (
    <AppLayout hideAdminLinks>
      <QuizComplaintManagementView />
    </AppLayout>
  );
}
