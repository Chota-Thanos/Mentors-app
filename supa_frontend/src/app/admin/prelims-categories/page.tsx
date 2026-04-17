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
            <h1 className="text-3xl font-bold text-slate-900">Exams and Prelims Categories</h1>
            <p className="mt-2 text-sm text-slate-500">
              Create exams and manage the full prelims taxonomy for GK, Maths, and Passage. Exams drive higher-level
              selection across the premium system, while categories remain global inside each prelims type in the new
              backend schema.
            </p>
          </div>

          <CategoryManager
            title="Exam and Prelims Taxonomy Manager"
            description="Create, edit, and remove exams, then manage prelims categories with bulk create and bulk delete from one admin page."
            showExamManagement
          />
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
