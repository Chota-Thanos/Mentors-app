import AppLayout from "@/components/layouts/AppLayout";
import ProfessionalOnboardingForm from "@/components/premium/ProfessionalOnboardingForm";

export default function ProfessionalOnboardingPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <ProfessionalOnboardingForm />
      </div>
    </AppLayout>
  );
}
