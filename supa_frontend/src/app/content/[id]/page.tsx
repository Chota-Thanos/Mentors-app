import Link from "next/link";
import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { sanitizeInternalHref } from "@/lib/collectionNavigation";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ backTo?: string }>;
}

export default async function ContentItemPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { backTo } = await searchParams;
  const supabase = await createClient();

  const { data: quiz } = await supabase
    .from("quizzes")
    .select("id,title,quiz_type,question_statement,question_prompt,explanation,linked_explanation")
    .eq("id", id)
    .maybeSingle();

  const { data: passage } = quiz
    ? { data: null }
    : await supabase
        .from("passage_quizzes")
        .select("id,passage_title,passage_text,source_reference")
        .eq("id", id)
        .maybeSingle();

  const { data: mainsQuestion } = quiz || passage
    ? { data: null }
    : await supabase
        .from("mains_questions")
        .select("id,question_text,approach,model_answer,source_reference")
        .eq("id", id)
        .maybeSingle();

  if (!quiz && !passage && !mainsQuestion) return notFound();

  const parentColumn = quiz ? "quiz_id" : passage ? "passage_quiz_id" : "mains_question_id";
  const { data: parentCollectionRow } = await supabase
    .from("premium_collection_items")
    .select("premium_collection_id")
    .eq(parentColumn, id)
    .limit(1)
    .maybeSingle();

  const parentCollectionId = Number(parentCollectionRow?.premium_collection_id || 0);
  const backFallbackHref = sanitizeInternalHref(
    backTo,
    parentCollectionId > 0 ? `/collections/${parentCollectionId}` : "/collections",
  );

  const content = quiz
    ? {
        type: quiz.quiz_type === "maths" ? "Maths Quiz" : "GK Quiz",
        title: quiz.title || quiz.question_statement,
        description: quiz.question_prompt || quiz.explanation || "",
        body: quiz.question_statement,
        url: quiz.linked_explanation,
      }
    : passage
      ? {
          type: "Passage Quiz",
          title: passage.passage_title || "Passage Quiz",
          description: passage.source_reference || "",
          body: passage.passage_text,
          url: null,
        }
      : {
          type: "Mains Question",
          title: mainsQuestion?.question_text?.slice(0, 120) || "Mains Question",
          description: mainsQuestion?.approach || mainsQuestion?.model_answer || "",
          body: mainsQuestion?.question_text || "",
          url: mainsQuestion?.source_reference || null,
        };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl py-8">
        <div className="mb-8">
          <HistoryBackButton
            fallbackHref={backFallbackHref}
            label="Back to Test"
            className="mb-4 inline-flex items-center text-sm text-slate-500 hover:text-slate-900"
            iconClassName="mr-1 h-4 w-4"
          />
          <div className="mt-4 flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">{content.type}</span>
          </div>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">{content.title}</h1>
          <p className="mt-4 text-xl leading-relaxed text-slate-500">{content.description}</p>
        </div>

        <div className="flex min-h-[600px] items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
          <div className="w-full space-y-6 p-12">
            <p className="whitespace-pre-line text-lg leading-8 text-slate-700">{content.body}</p>
            {content.url ? (
              <Link
                href={content.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl bg-slate-900 px-8 py-3 font-bold text-white transition-all hover:bg-slate-800"
              >
                Open Source Link
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
