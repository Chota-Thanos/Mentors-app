import AppLayout from "@/components/layouts/AppLayout";
import ProfessionalOnboardingEligibilityForm from "@/components/premium/ProfessionalOnboardingEligibilityForm";
import { Suspense } from "react";

export default function ProfessionalApplyPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading application form...</div>}>
          <ProfessionalOnboardingEligibilityForm />
        </Suspense>
      </div>
    </AppLayout>
  );
}
