type CollectionNavigationLike = {
  series_id?: unknown;
  meta?: Record<string, unknown> | null;
};

export function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function resolveCollectionSeriesId(collection: CollectionNavigationLike | null | undefined): number {
  if (!collection || typeof collection !== "object") return 0;
  const directSeriesId = toPositiveInt(collection.series_id);
  if (directSeriesId > 0) return directSeriesId;
  const meta = collection.meta && typeof collection.meta === "object" ? collection.meta : {};
  return toPositiveInt((meta as Record<string, unknown>).series_id);
}

export function sanitizeInternalHref(candidate: unknown, fallbackHref: string): string {
  const value = String(candidate || "").trim();
  if (!value.startsWith("/")) return fallbackHref;
  if (value.startsWith("//")) return fallbackHref;
  return value;
}
