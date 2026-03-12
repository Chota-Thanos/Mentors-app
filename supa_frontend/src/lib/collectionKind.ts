export type CollectionTestKind = "prelims" | "mains";

type CollectionLike = {
  test_kind?: unknown;
  collection_mode?: unknown;
  meta?: Record<string, unknown> | null;
};

const MAINS_COLLECTION_MODES = new Set([
  "mains",
  "mains_ai",
  "mains_ai_question",
  "mains_question",
  "mains_test",
]);

const PRELIMS_COLLECTION_MODES = new Set([
  "prelims",
  "prelims_quiz",
  "quiz",
  "quiz_collection",
  "quiz_test",
]);

const normalize = (value: unknown): string => String(value || "").trim().toLowerCase();

export const getCollectionTestKind = (collection: CollectionLike | null | undefined): CollectionTestKind => {
  if (!collection || typeof collection !== "object") return "prelims";

  const explicitKind = normalize(collection.test_kind);
  if (explicitKind === "mains") return "mains";
  if (explicitKind === "prelims") return "prelims";

  const directMode = normalize(collection.collection_mode);
  if (MAINS_COLLECTION_MODES.has(directMode)) return "mains";
  if (PRELIMS_COLLECTION_MODES.has(directMode)) return "prelims";

  const meta = (collection.meta && typeof collection.meta === "object")
    ? (collection.meta as Record<string, unknown>)
    : null;
  if (!meta) return "prelims";

  const metaKind = normalize(meta.test_kind);
  if (metaKind === "mains") return "mains";
  if (metaKind === "prelims") return "prelims";

  const metaMode = normalize(meta.collection_mode);
  if (MAINS_COLLECTION_MODES.has(metaMode)) return "mains";
  if (PRELIMS_COLLECTION_MODES.has(metaMode)) return "prelims";

  return "prelims";
};

export const isMainsTestCollection = (collection: CollectionLike | null | undefined): boolean =>
  getCollectionTestKind(collection) === "mains";

export const getCollectionTestLabel = (collection: CollectionLike | null | undefined): string =>
  getCollectionTestKind(collection) === "mains" ? "Mains Test" : "Prelims Test";
