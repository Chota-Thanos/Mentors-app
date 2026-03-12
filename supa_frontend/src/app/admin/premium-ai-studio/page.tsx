import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import AIStudio from "@/components/ai/AIStudio";

export const metadata = {
  title: "Admin Premium AI Studio - UPSC Prep",
  description: "Admin studio for premium AI quiz generation workflows.",
};

export default function AdminPremiumAIStudioPage() {
  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Premium AI Studio (Admin)</h1>
          <p className="mt-2 text-sm text-slate-600">
            Admin workflow for instruction tuning, format management, and generation controls.
          </p>
        </div>
        <AIStudio />
      </AppLayout>
    </AdminOnly>
  );
}
