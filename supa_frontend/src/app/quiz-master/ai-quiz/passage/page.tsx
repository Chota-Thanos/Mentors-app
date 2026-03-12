import { Suspense } from "react";

import AIUserStudio from "@/components/ai/AIUserStudio";
import AppLayout from "@/components/layouts/AppLayout";

export const metadata = {
  title: "Quiz Master AI Parser - Passage - UPSC Prep",
  description: "Quiz Master workspace for AI parsing and passage quiz creation linked to prelims tests.",
};

export default function QuizMasterPassagePage() {
  return (
    <AppLayout hideAdminLinks>
      <Suspense fallback={<div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading Quiz Master AI workspace...</div>}>
        <AIUserStudio quizKind="passage" mode="quiz_master" />
      </Suspense>
    </AppLayout>
  );
}
