import { redirect } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import MyTestsPageClient, { type MyTestsCardItem } from "@/components/premium/MyTestsPageClient";
import { canAccessMainsAuthoring } from "@/lib/accessControl";
import { getCollectionTestKind } from "@/lib/collectionKind";
import { createClient } from "@/lib/supabase/server";

interface CollectionRow {
  id: number;
  title: string;
  is_premium: boolean;
  is_public: boolean;
  is_finalized: boolean;
  created_at: string;
  updated_at?: string | null;
  test_kind?: "prelims" | "mains";
  meta?: Record<string, unknown> | null;
}

interface CollectionItemRow {
  collection_id: number;
  content_items:
    | {
        type?: string | null;
        data?: Record<string, unknown> | null;
      }
    | Array<{
        type?: string | null;
        data?: Record<string, unknown> | null;
      }>
    | null;
}

function asQuestionCount(row: CollectionItemRow): number {
  const content = Array.isArray(row.content_items) ? (row.content_items[0] ?? null) : row.content_items;
  if (!content) return 0;
  const type = String(content.type || "").trim().toLowerCase();
  const data = content.data && typeof content.data === "object" ? content.data : {};
  if (type === "quiz_passage") {
    const questions = Array.isArray((data as { questions?: unknown[] }).questions)
      ? (data as { questions: unknown[] }).questions
      : [];
    return questions.length;
  }
  if (type === "quiz_gk" || type === "quiz_maths" || type === "question") {
    return 1;
  }
  return 0;
}

export default async function CollectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const canCreateMains = canAccessMainsAuthoring(user);

  const { data: collections } = await supabase
    .from("collections")
    .select("id,title,is_premium,is_public,is_finalized,created_at,updated_at,test_kind,meta")
    .eq("meta->>author_id", user.id)
    .order("created_at", { ascending: false });

  const rows = (collections || []) as CollectionRow[];
  const collectionIds = rows.map((row) => row.id).filter((value) => Number.isFinite(value) && value > 0);

  let questionCountMap = new Map<number, number>();
  if (collectionIds.length > 0) {
    const collectionItemsQuery = supabase
      .from("collection_items")
      .select(`
        collection_id,
        content_items (
          type,
          data
        )
      `);

    const { data: collectionItems } =
      collectionIds.length === 1
        ? await collectionItemsQuery.eq("collection_id", collectionIds[0])
        : await collectionItemsQuery.in("collection_id", collectionIds);

    questionCountMap = (collectionItems as CollectionItemRow[] | null)?.reduce((map, item) => {
      const collectionId = Number(item.collection_id || 0);
      if (collectionId <= 0) return map;
      map.set(collectionId, (map.get(collectionId) || 0) + asQuestionCount(item));
      return map;
    }, new Map<number, number>()) || new Map<number, number>();
  }

  const tests: MyTestsCardItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    test_kind: getCollectionTestKind(row),
    question_count: questionCountMap.get(row.id) || 0,
    is_finalized: Boolean(row.is_finalized),
    is_public: Boolean(row.is_public),
    is_premium: Boolean(row.is_premium),
    updated_at: row.updated_at || null,
    created_at: row.created_at,
  }));

  return (
    <AppLayout>
      <MyTestsPageClient initialTests={tests} canCreateMains={canCreateMains} />
    </AppLayout>
  );
}
