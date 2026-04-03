import type { TestSeriesDiscussion } from "@/types/premium";

type DiscussionKey = "final_discussion" | "test_discussion";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asDraftText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function normalizeDiscussion(value: unknown): TestSeriesDiscussion | null {
  const raw = asRecord(value);
  const deliveryMode = asText(raw.delivery_mode);
  if (deliveryMode !== "video" && deliveryMode !== "live_zoom") return null;

  const normalized: TestSeriesDiscussion = {
    delivery_mode: deliveryMode,
    title: asText(raw.title),
    description: asText(raw.description),
    starts_when_creator_joins: Boolean(raw.starts_when_creator_joins),
  };

  if (deliveryMode === "video") {
    normalized.video_url = asText(raw.video_url);
    return normalized.video_url ? normalized : null;
  }

  normalized.zoom_schedule_mode = asText(raw.zoom_schedule_mode) === "manual" ? "manual" : "auto";
  normalized.meeting_link = asText(raw.meeting_link) || asText(raw.provider_join_url);
  normalized.scheduled_for = asText(raw.scheduled_for);
  normalized.duration_minutes = asPositiveNumber(raw.duration_minutes);
  normalized.provider_session_id = asText(raw.provider_session_id);
  normalized.provider_host_url = asText(raw.provider_host_url);
  normalized.provider_join_url = asText(raw.provider_join_url);
  normalized.provider_payload = asRecord(raw.provider_payload);
  return normalized.scheduled_for ? normalized : null;
}

export function getDiscussionFromMeta(meta: unknown, key: DiscussionKey): TestSeriesDiscussion | null {
  return normalizeDiscussion(asRecord(meta)[key]);
}

export function getDiscussionDraftFromMeta(meta: unknown, key: DiscussionKey): TestSeriesDiscussion | null {
  const raw = asRecord(asRecord(meta)[key]);
  const deliveryMode = asText(raw.delivery_mode);
  if (deliveryMode !== "video" && deliveryMode !== "live_zoom") return null;

  if (deliveryMode === "video") {
    return {
      delivery_mode: "video",
      title: asDraftText(raw.title),
      description: asDraftText(raw.description),
      video_url: asDraftText(raw.video_url),
      starts_when_creator_joins: false,
    };
  }

  return {
    delivery_mode: "live_zoom",
    title: asDraftText(raw.title),
    description: asDraftText(raw.description),
    scheduled_for: asDraftText(raw.scheduled_for),
    duration_minutes: asPositiveNumber(raw.duration_minutes) || 60,
    zoom_schedule_mode: asText(raw.zoom_schedule_mode) === "manual" ? "manual" : "auto",
    meeting_link: asDraftText(raw.meeting_link),
    provider_session_id: asDraftText(raw.provider_session_id),
    provider_host_url: asDraftText(raw.provider_host_url),
    provider_join_url: asDraftText(raw.provider_join_url),
    provider_payload: asRecord(raw.provider_payload),
    starts_when_creator_joins: true,
  };
}

export function mergeDiscussionIntoMeta(
  meta: Record<string, unknown> | null | undefined,
  key: DiscussionKey,
  discussion: TestSeriesDiscussion | null,
): Record<string, unknown> {
  const next = { ...(meta || {}) };
  if (!discussion) {
    delete next[key];
    return next;
  }
  next[key] = {
    delivery_mode: discussion.delivery_mode,
    title: asText(discussion.title),
    description: asText(discussion.description),
    video_url: discussion.delivery_mode === "video" ? asText(discussion.video_url) : null,
    scheduled_for: discussion.delivery_mode === "live_zoom" ? asText(discussion.scheduled_for) : null,
    duration_minutes: discussion.delivery_mode === "live_zoom" ? asPositiveNumber(discussion.duration_minutes) || 60 : null,
    zoom_schedule_mode: discussion.delivery_mode === "live_zoom" ? "auto" : null,
    meeting_link: discussion.delivery_mode === "live_zoom" ? asText(discussion.meeting_link) : null,
    provider_session_id: discussion.delivery_mode === "live_zoom" ? asText(discussion.provider_session_id) : null,
    provider_host_url: discussion.delivery_mode === "live_zoom" ? asText(discussion.provider_host_url) : null,
    provider_join_url: discussion.delivery_mode === "live_zoom" ? asText(discussion.provider_join_url) : null,
    provider_payload: discussion.delivery_mode === "live_zoom" && discussion.provider_payload && typeof discussion.provider_payload === "object"
      ? discussion.provider_payload
      : null,
    starts_when_creator_joins: discussion.delivery_mode === "live_zoom",
  };
  return next;
}

export function isoToDatetimeLocal(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function datetimeLocalToIso(value?: string | null): string | null {
  if (!value || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function resolveVideoPresentation(url?: string | null): { kind: "iframe" | "video" | "link"; src: string } | null {
  const raw = asText(url);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();

    if (host.includes("youtu.be")) {
      const videoId = parsed.pathname.replace(/\//g, "").trim();
      if (videoId) return { kind: "iframe", src: `https://www.youtube.com/embed/${videoId}` };
    }

    if (host.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/embed/")) {
        return { kind: "iframe", src: raw };
      }
      const videoId = parsed.searchParams.get("v");
      if (videoId) return { kind: "iframe", src: `https://www.youtube.com/embed/${videoId}` };
    }

    if (host.includes("vimeo.com")) {
      const match = parsed.pathname.match(/\/(\d+)/);
      if (match?.[1]) return { kind: "iframe", src: `https://player.vimeo.com/video/${match[1]}` };
    }

    if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(parsed.pathname)) {
      return { kind: "video", src: raw };
    }
  } catch {
    return { kind: "link", src: raw };
  }

  return { kind: "link", src: raw };
}
