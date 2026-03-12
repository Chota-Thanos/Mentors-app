import { Suspense } from "react";

import AIUserStudio from "@/components/ai/AIUserStudio";
import AppLayout from "@/components/layouts/AppLayout";

export const metadata = {
  title: "Quiz Master AI Parser - GK - UPSC Prep",
  description: "Quiz Master workspace for AI parsing and quiz creation linked to prelims tests.",
};

export default function QuizMasterGKPage() {
  return (
    <AppLayout hideAdminLinks>
      <Suspense fallback={<div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading Quiz Master AI workspace...</div>}>
        <AIUserStudio quizKind="gk" mode="quiz_master" />
      </Suspense>
    </AppLayout>
  );
}
