"use client";

import RichTextField from "@/components/ui/RichTextField";
import {
  datetimeLocalToIso,
  isoToDatetimeLocal,
} from "@/lib/testSeriesDiscussion";
import type { TestSeriesDiscussion } from "@/types/premium";

function createDiscussion(mode: "" | "video" | "live_zoom", current?: TestSeriesDiscussion | null): TestSeriesDiscussion | null {
  if (!mode) return null;
  if (mode === "video") {
    return {
      delivery_mode: "video",
      title: current?.title || "",
      description: current?.description || "",
      video_url: current?.delivery_mode === "video" ? current.video_url || "" : "",
      starts_when_creator_joins: false,
    };
  }
  return {
    delivery_mode: "live_zoom",
    title: current?.title || "",
    description: current?.description || "",
    scheduled_for: current?.delivery_mode === "live_zoom" ? current.scheduled_for || "" : "",
    duration_minutes: current?.delivery_mode === "live_zoom" ? current.duration_minutes || 60 : 60,
    zoom_schedule_mode: "auto",
    meeting_link: current?.delivery_mode === "live_zoom" ? current.meeting_link || "" : "",
    provider_session_id: current?.delivery_mode === "live_zoom" ? current.provider_session_id || "" : "",
    provider_host_url: current?.delivery_mode === "live_zoom" ? current.provider_host_url || "" : "",
    provider_join_url: current?.delivery_mode === "live_zoom" ? current.provider_join_url || "" : "",
    starts_when_creator_joins: true,
  };
}

export default function DiscussionConfigEditor({
  heading,
  hint,
  value,
  onChange,
}: {
  heading: string;
  hint: string;
  value: TestSeriesDiscussion | null;
  onChange: (value: TestSeriesDiscussion | null) => void;
}) {
  const selectedMode = value?.delivery_mode || "";

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">{heading}</p>
        <p className="mt-1 text-xs text-slate-600">{hint}</p>
      </div>

      <select
        value={selectedMode}
        onChange={(event) => onChange(createDiscussion(event.target.value as "" | "video" | "live_zoom", value))}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      >
        <option value="">No discussion</option>
        <option value="video">Discussion video</option>
        <option value="live_zoom">Live class on Agora</option>
      </select>

      {value ? (
        <>
          <input
            value={value.title || ""}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Discussion title"
          />

          <RichTextField
            label="Discussion description"
            value={value.description || ""}
            onChange={(nextValue) => onChange({ ...value, description: nextValue })}
            placeholder="Explain what this discussion covers and how learners should use it."
            helperText="Shown to learners alongside the discussion action."
          />

          {value.delivery_mode === "video" ? (
            <div className="space-y-2">
              <input
                value={value.video_url || ""}
                onChange={(event) => onChange({ ...value, video_url: event.target.value })}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="YouTube, Vimeo, or direct video URL"
              />
              <p className="text-xs text-slate-500">
                Web learners can watch the video inline. Mobile learners will get a direct watch action from the series page.
              </p>
            </div>
          ) : null}

          {value.delivery_mode === "live_zoom" ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled for</span>
                  <input
                    type="datetime-local"
                    value={isoToDatetimeLocal(value.scheduled_for)}
                    onChange={(event) => onChange({ ...value, scheduled_for: datetimeLocalToIso(event.target.value) || "" })}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Duration Minutes</span>
                  <input
                    type="number"
                    min={15}
                    max={240}
                    value={String(value.duration_minutes || 60)}
                    onChange={(event) => onChange({ ...value, duration_minutes: Number(event.target.value) || 60 })}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <p className="font-semibold uppercase tracking-wide text-slate-500">Agora room flow</p>
                <p className="mt-2">
                  Learners join this class directly inside the app or browser with Agora. No external meeting link is required.
                </p>
                <p className="mt-2">
                  The series creator or assigned mentor opens the room as host. Learners join as viewers until you extend speaking controls later.
                </p>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
