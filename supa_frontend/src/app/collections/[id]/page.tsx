import Link from "next/link";

import AppLayout from "@/components/layouts/AppLayout";
import MainsCollectionTestRunner from "@/components/mains/MainsCollectionTestRunner";
import ChallengeCreatorCard from "@/components/premium/ChallengeCreatorCard";
import CollectionContentList, { type CollectionContentListItem } from "@/components/premium/CollectionContentList";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { canAccessMainsAuthoring, canAccessManualQuizBuilder } from "@/lib/accessControl";
import { getCollectionTestKind } from "@/lib/collectionKind";
import { resolveCollectionSeriesId } from "@/lib/collectionNavigation";
import { richTextToPlainText } from "@/lib/richText";
import { createClient } from "@/lib/supabase/server";
import type { MainsCollectionTestPayload } from "@/types/premium";

interface PageProps {
  params: Promise<{ id: string }>;
}

type ContentRow = {
  id: number;
  title: string | null;
  type: string;
  data?: Record<string, unknown> & {
    description?: string;
    is_free?: boolean;
    url?: string;
  } | null;
};

type CollectionItemJoin = {
  id: number;
  content_item_id?: number | null;
  order?: number | null;
  content_items: ContentRow | ContentRow[] | null;
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
    .from("collections")
    .select("*")
    .eq("id", id)
    .single();

  if (collectionError || !collection) {
    console.error("Collection not found:", collectionError);
  }

  let contentItems: CollectionContentListItem[] = [];
  const { data: itemsData } = await supabase
    .from("collection_items")
    .select(`
      id,
      content_item_id,
      order,
      content_items (
        id,
        title,
        type,
        data
      )
    `)
    .eq("collection_id", id);

  if (itemsData) {
    contentItems = (itemsData as CollectionItemJoin[])
      .map((row) => {
        const item = Array.isArray(row.content_items) ? (row.content_items[0] ?? null) : row.content_items;
        if (!item) return null;
        return {
          collection_item_id: row.id,
          content_item_id: Number(row.content_item_id || item.id || 0),
          order: Number(row.order || 0),
          title: item.title,
          type: item.type,
          data: item.data,
          description: typeof item.data?.description === "string" ? item.data.description : undefined,
          is_free: Boolean(item.data?.is_free),
          url: typeof item.data?.url === "string" ? item.data.url : undefined,
        } as CollectionContentListItem;
      })
      .filter((item): item is CollectionContentListItem => Boolean(item))
      .sort((left, right) => {
        if (left.order !== right.order) return left.order - right.order;
        return left.collection_item_id - right.collection_item_id;
      });
  }

  const testKind = getCollectionTestKind(collection || null);
  const isMainsTest = testKind === "mains";
  const canManageQuestions = isMainsTest ? canAccessMainsAuthoring(user) : canAccessManualQuizBuilder(user);
  const linkedSeriesId = resolveCollectionSeriesId(collection || null);
  const mainsPayload = isMainsTest
    ? buildMainsPayload(Number(id), String(collection?.title || `Test ${id}`), linkedSeriesId, contentItems)
    : null;
  const backFallbackHref = linkedSeriesId > 0 ? `/test-series/${linkedSeriesId}` : "/collections";
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
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{collection?.title}</h1>
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
          {richTextToPlainText(collection?.description || "") || "No description provided."}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {collection?.is_premium ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
              Premium Content
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 ring-1 ring-inset ring-green-600/20">
              Free Content
            </span>
          )}
          {collection?.price && collection.price > 0 ? (
            <span className="text-2xl font-bold text-slate-900">INR {collection.price}</span>
          ) : null}
        </div>

        <div className="mt-5 max-w-3xl">
          {isMainsTest ? (
            <p className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              This is a Mains Test. The question paper, answer-copy submission, evaluation status, and mentorship flow now sit on this page.
            </p>
          ) : (
            <ChallengeCreatorCard collectionId={id} collectionTitle={collection?.title || undefined} />
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
