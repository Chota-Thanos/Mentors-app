import AppLayout from "@/components/layouts/AppLayout";
import OnboardingReviewQueue from "@/components/premium/OnboardingReviewQueue";

export default function OnboardingReviewPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <OnboardingReviewQueue />
      </div>
    </AppLayout>
  );
}
