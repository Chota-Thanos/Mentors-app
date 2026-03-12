import { Suspense } from "react";
import AppLayout from "@/components/layouts/AppLayout";
import AIUserStudio from "@/components/ai/AIUserStudio";

export const metadata = {
  title: "AI Quiz Generator - GK - UPSC Prep",
  description: "Generate GK quizzes from text, URL, photo OCR, or uploaded PDF.",
};

export default function GKAIQuizGeneratorPage() {
  return (
    <AppLayout hideAdminLinks>
      <Suspense fallback={<div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading AI studio...</div>}>
        <AIUserStudio quizKind="gk" />
      </Suspense>
    </AppLayout>
  );
}
