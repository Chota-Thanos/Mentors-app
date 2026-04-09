import AppLayout from "@/components/layouts/AppLayout";
import ProfessionalOnboardingEligibilityForm from "@/components/premium/ProfessionalOnboardingEligibilityForm";

export default function ProfessionalOnboardingPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <ProfessionalOnboardingEligibilityForm />
      </div>
    </AppLayout>
  );
}
