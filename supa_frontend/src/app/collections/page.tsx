"use server";

import { redirect } from "next/navigation";
import AppLayout from "@/components/layouts/AppLayout";
import MyTestsPageClient, {
  type MyTestsCardItem,
} from "@/components/premium/MyTestsPageClient";
import { getCurrentProfile } from "@/lib/backendServer";
import { createClient } from "@/lib/supabase/server";

export default async function CollectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = await getCurrentProfile<{ id: number; role: string }>();
  if (!profile) redirect("/onboarding");

  const profileId = profile.id;
  const role = profile.role as string;
  const canCreateMains =
    role === "admin" || role === "moderator" || role === "mains_expert";

  // ── Fetch creator's own collections from new table ────────────────────────
  const { data: collections } = await supabase
    .from("premium_collections")
    .select(
      "id, name, collection_type, is_paid, is_public, is_finalized, is_active, created_at, updated_at",
    )
    .eq("creator_id", profileId)
    .order("created_at", { ascending: false });

  const rows = collections ?? [];

  // ── Fetch question counts via items table ─────────────────────────────────
  const collectionIds = rows.map((r) => r.id);
  let countMap = new Map<number, number>();

  if (collectionIds.length > 0) {
    const { data: items } = await supabase
      .from("premium_collection_items")
      .select("premium_collection_id, item_type")
      .in("premium_collection_id", collectionIds);

    countMap = (items ?? []).reduce((map, item) => {
      const id = Number(item.premium_collection_id);
      map.set(id, (map.get(id) ?? 0) + 1);
      return map;
    }, new Map<number, number>());
  }

  // ── Map to UI shape ───────────────────────────────────────────────────────
  const tests: MyTestsCardItem[] = rows.map((row) => ({
    id: row.id,
    title: row.name,                                  // name → title
    test_kind: row.collection_type === "mains" ? "mains" : "prelims",
    question_count: countMap.get(row.id) ?? 0,
    is_finalized: Boolean(row.is_finalized),
    is_public: Boolean(row.is_public),
    is_premium: Boolean(row.is_paid),                 // is_paid → is_premium
    updated_at: row.updated_at ?? null,
    created_at: row.created_at,
  }));

  return (
    <AppLayout>
      <MyTestsPageClient initialTests={tests} canCreateMains={canCreateMains} />
    </AppLayout>
  );
}
