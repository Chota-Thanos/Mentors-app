import Link from "next/link";
import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import MainsCollectionTestRunner from "@/components/mains/MainsCollectionTestRunner";
import ChallengeCreatorCard from "@/components/premium/ChallengeCreatorCard";
import CollectionContentList, { type CollectionContentListItem } from "@/components/premium/CollectionContentList";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { canAccessMainsAuthoring, canAccessManualQuizBuilder } from "@/lib/accessControl";
import { getCollectionTestKind } from "@/lib/collectionKind";
import { getCurrentProfile } from "@/lib/backendServer";
import { richTextToPlainText } from "@/lib/richText";
import { createClient } from "@/lib/supabase/server";
import type { MainsCollectionTestPayload } from "@/types/premium";

interface PageProps {
  params: Promise<{ id: string }>;
}

type CollectionItemJoin = {
  id: number;
  order_index?: number | null;
  item_type: string;
  quiz_id?: number | null;
  passage_quiz_id?: number | null;
  mains_question_id?: number | null;
  quiz?: Record<string, unknown> | Record<string, unknown>[] | null;
  passage_quiz?: (Record<string, unknown> & { passage_questions?: unknown[] }) | Array<Record<string, unknown> & { passage_questions?: unknown[] }> | null;
  mains_question?: Record<string, unknown> | Record<string, unknown>[] | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstJoin(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0] || null);
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function mapCollectionItem(row: CollectionItemJoin): CollectionContentListItem | null {
  const order = Number(row.order_index || 0);
  if (row.item_type === "gk_quiz" || row.item_type === "maths_quiz") {
    const quiz = firstJoin(row.quiz);
    if (!quiz) return null;
    const quizType = String(quiz.quiz_type || (row.item_type === "gk_quiz" ? "gk" : "maths"));
    const data = {
      question_statement: asText(quiz.question_statement),
      supp_question_statement: asText(quiz.supp_question_statement) || null,
      supplementary_statement: asText(quiz.supp_question_statement) || null,
      statements_facts: Array.isArray(quiz.statements_facts) ? quiz.statements_facts : [],
      statement_facts: Array.isArray(quiz.statements_facts) ? quiz.statements_facts : [],
      question_prompt: asText(quiz.question_prompt) || null,
      options: Array.isArray(quiz.options) ? quiz.options : [],
      correct_answer: asText(quiz.correct_answer) || "A",
      answer: asText(quiz.correct_answer) || "A",
      explanation: asText(quiz.explanation) || null,
      explanation_text: asText(quiz.explanation) || null,
    };
    return {
      collection_item_id: row.id,
      content_item_id: Number(row.quiz_id || quiz.id || 0),
      order,
      title: asText(quiz.title) || asText(quiz.question_statement).slice(0, 120),
      type: quizType === "maths" ? "quiz_maths" : "quiz_gk",
      data,
      description: asText(quiz.explanation) || undefined,
      is_free: true,
    };
  }

  if (row.item_type === "passage_quiz") {
    const passage = firstJoin(row.passage_quiz);
    if (!passage) return null;
    const questions = Array.isArray(passage.passage_questions)
      ? [...passage.passage_questions]
          .map((question) => asRecord(question))
          .sort((left, right) => asNumber(left.display_order) - asNumber(right.display_order))
          .map((question) => ({
            question_statement: asText(question.question_statement),
            supp_question_statement: asText(question.supp_question_statement) || null,
            supplementary_statement: asText(question.supp_question_statement) || null,
            statements_facts: Array.isArray(question.statements_facts) ? question.statements_facts : [],
            statement_facts: Array.isArray(question.statements_facts) ? question.statements_facts : [],
            question_prompt: asText(question.question_prompt) || null,
            options: Array.isArray(question.options) ? question.options : [],
            correct_answer: asText(question.correct_answer) || "A",
            explanation: asText(question.explanation) || null,
            explanation_text: asText(question.explanation) || null,
          }))
      : [];
    const data = {
      passage_title: asText(passage.passage_title) || "Passage Quiz",
      passage_text: asText(passage.passage_text),
      source_reference: asText(passage.source_reference) || null,
      questions,
    };
    return {
      collection_item_id: row.id,
      content_item_id: Number(row.passage_quiz_id || passage.id || 0),
      order,
      title: asText(passage.passage_title) || "Passage Quiz",
      type: "quiz_passage",
      data,
      description: `${questions.length} passage question(s)`,
      is_free: true,
    };
  }

  if (row.item_type === "mains_question") {
    const question = firstJoin(row.mains_question);
    if (!question) return null;
    const data = {
      question_text: asText(question.question_text),
      answer_approach: asText(question.approach) || null,
      model_answer: asText(question.model_answer) || null,
      word_limit: asNumber(question.word_limit) || 150,
      source_reference: asText(question.source_reference) || null,
    };
    return {
      collection_item_id: row.id,
      content_item_id: Number(row.mains_question_id || question.id || 0),
      order,
      title: asText(question.question_text).slice(0, 120) || `Mains Question ${row.mains_question_id || row.id}`,
      type: "question",
      data,
      description: asText(question.question_text),
      is_free: true,
    };
  }

  return null;
}

function buildMainsPayload(
  collectionId: number,
  collectionTitle: string,
  seriesId: number,
  items: CollectionContentListItem[],
): MainsCollectionTestPayload {
  const orderedItems = [...items].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.collection_item_id - right.collection_item_id;
  });

  const questions = orderedItems.flatMap((item) => {
    if (item.type !== "question") return [];
    const data = asRecord(item.data);
    const questionText = asText(data.question_text || data.question_statement || data.question);
    if (!questionText) return [];
    const wordLimit = Math.max(1, asNumber(data.word_limit) || 150);
    const maxMarks = Math.max(1, asNumber(data.max_marks || data.marks || data.question_marks) || 10);
    return [{
      item_id: item.collection_item_id * 1000,
      content_item_id: item.content_item_id,
      question_number: 0,
      question_text: questionText,
      answer_approach: asText(data.answer_approach) || null,
      model_answer: asText(data.model_answer) || null,
      word_limit: wordLimit,
      max_marks: maxMarks,
      answer_style_guidance: asText(data.answer_style_guidance) || null,
    }];
  }).map((question, index) => ({ ...question, question_number: index + 1 }));

  return {
    collection_id: collectionId,
    series_id: seriesId > 0 ? seriesId : null,
    collection_title: collectionTitle,
    total_questions: questions.length,
    questions,
  };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: collection, error: collectionError } = await supabase
    .from("premium_collections")
    .select("id,name,description,collection_type,is_paid,is_public,price,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (collectionError || !collection) {
    console.error("Collection not found:", collectionError);
    return notFound();
  }

  const { data: itemsData } = await supabase
    .from("premium_collection_items")
    .select(`
      id,
      order_index,
      item_type,
      quiz_id,
      passage_quiz_id,
      mains_question_id,
      quiz:quizzes(id,quiz_type,title,question_statement,supp_question_statement,statements_facts,question_prompt,options,correct_answer,explanation),
      passage_quiz:passage_quizzes(id,passage_title,passage_text,source_reference,passage_questions(id,question_statement,supp_question_statement,question_prompt,statements_facts,options,correct_answer,explanation,display_order)),
      mains_question:mains_questions(id,question_text,approach,model_answer,word_limit,source_reference,category_id)
    `)
    .eq("premium_collection_id", id)
    .order("order_index", { ascending: true });

  const contentItems = ((itemsData || []) as CollectionItemJoin[])
    .map((row) => mapCollectionItem(row))
    .filter((item): item is CollectionContentListItem => Boolean(item))
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.collection_item_id - right.collection_item_id;
    });

  const profile = user ? await getCurrentProfile<{ role: string }>() : null;

  const { data: programStep } = await supabase
    .from("program_unit_steps")
    .select("program_unit:program_units(series_id)")
    .eq("collection_id", id)
    .eq("step_type", "test")
    .maybeSingle();

  const programUnit = firstJoin(asRecord(programStep).program_unit);
  const linkedSeriesId = asNumber(programUnit?.series_id);

  const collectionTitle = String(collection.name || `Test ${id}`);
  const collectionDescription = String(collection.description || "");
  const testKind = getCollectionTestKind({ test_kind: collection.collection_type });
  const isMainsTest = testKind === "mains";
  const canManageQuestions = isMainsTest ? canAccessMainsAuthoring({ role: profile?.role }) : canAccessManualQuizBuilder({ role: profile?.role });
  const mainsPayload = isMainsTest
    ? buildMainsPayload(Number(id), collectionTitle, linkedSeriesId, contentItems)
    : null;
  const backFallbackHref = linkedSeriesId > 0 ? `/programs/${linkedSeriesId}` : "/collections";
  const backLabel = linkedSeriesId > 0 ? "Back to Series" : "Back to Tests";

  return (
    <AppLayout>
      <div className="mb-8">
        <HistoryBackButton
          fallbackHref={backFallbackHref}
          label={backLabel}
          className="mb-4 inline-flex items-center text-sm text-slate-500 hover:text-slate-900"
          iconClassName="mr-1 h-4 w-4"
        />

        <div className="mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{collectionTitle}</h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                isMainsTest ? "bg-indigo-100 text-indigo-800" : "bg-blue-100 text-blue-800"
              }`}
            >
              {isMainsTest ? "Mains Test" : "Prelims Test"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isMainsTest ? (
              <Link
                href={`/collections/${id}/test`}
                className="inline-flex items-center rounded-md border border-indigo-600 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100"
              >
                Start Prelims Test
              </Link>
            ) : null}
            {canManageQuestions ? (
              <Link
                href={`/collections/${id}/question-methods`}
                className="inline-flex items-center rounded-md border border-slate-900 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:bg-slate-50"
              >
                {isMainsTest ? "+ Manage Mains Questions" : "Add Quiz"}
              </Link>
            ) : null}
          </div>
        </div>

        <p className="mt-4 max-w-3xl text-xl text-slate-500">
          {richTextToPlainText(collectionDescription) || "No description provided."}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {collection.is_paid ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
              Premium Content
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 ring-1 ring-inset ring-green-600/20">
              Free Content
            </span>
          )}
          {collection.price && Number(collection.price) > 0 ? (
            <span className="text-2xl font-bold text-slate-900">INR {collection.price}</span>
          ) : null}
        </div>

        <div className="mt-5 max-w-3xl">
          {isMainsTest ? (
            <p className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              This is a Mains Test. The question paper, answer-copy submission, evaluation status, and mentorship flow now sit on this page.
            </p>
          ) : (
            <ChallengeCreatorCard collectionId={id} collectionTitle={collectionTitle} />
          )}
        </div>

        {isMainsTest ? (
          <div className="mt-8">
            <MainsCollectionTestRunner collectionId={id} embedded initialPayload={mainsPayload} />
          </div>
        ) : null}
      </div>

      {!isMainsTest ? (
        <div className="mt-12 border-t border-slate-200 pt-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold">Test Content</h2>
            <span className="text-sm text-slate-500">{contentItems.length} items</span>
          </div>

          <div className="space-y-4">
            {!contentItems || contentItems.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
                <div className="mx-auto mb-4 h-12 w-12 text-slate-300">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </div>
                <p className="font-medium text-slate-500">No content items added to this test yet.</p>
              </div>
            ) : (
              <CollectionContentList
                collectionId={Number(id)}
                manageHref={`/collections/${id}/question-methods`}
                items={contentItems}
              />
            )}
          </div>
        </div>
      ) : null}
    </AppLayout>
  );
}
