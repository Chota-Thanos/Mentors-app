"use client";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import CategoryManager from "@/components/premium/CategoryManager";

export default function PrelimsCategoriesPage() {
  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Prelims Categories</h1>
            <p className="mt-2 text-sm text-slate-500">
              Manage the full prelims taxonomy for GK, Maths, and Passage. Categories are global inside each prelims
              type, and you can now delete them in bulk from the tree below.
            </p>
          </div>

          <CategoryManager
            title="Prelims Category Manager"
            description="Create, edit, bulk create, and bulk delete prelims categories without the rest of the premium workspace around it."
            showExamManagement={false}
          />
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
