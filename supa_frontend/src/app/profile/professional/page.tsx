import AppLayout from "@/components/layouts/AppLayout";
import ProfessionalProfileForm from "@/components/premium/ProfessionalProfileForm";

export default function ProfessionalProfilePage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <ProfessionalProfileForm />
      </div>
    </AppLayout>
  );
}
