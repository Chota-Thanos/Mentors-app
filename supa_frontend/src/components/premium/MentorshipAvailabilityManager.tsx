"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useProfile } from "@/context/ProfileContext";
import { profilesApi } from "@/lib/backendServices";
import { dbMentorshipMode } from "@/lib/mentorshipV2";
import {
  buildAvailabilityDays,
  buildSlotBatchPayload,
  formatSlotTimeRange,
  MENTORSHIP_SLOT_DURATION_MINUTES,
  mentorshipCallLabel,
  slotIdsForDate,
} from "@/lib/mentorAvailability";
import { premiumApi } from "@/lib/premiumApi";
import { createClient } from "@/lib/supabase/client";
import { toNullableRichText } from "@/lib/richText";
import type {
  MentorshipCallProvider,
  MentorshipMode,
  MentorshipSlot,
  MentorshipSlotBatchCreatePayload,
  ProfessionalProfile,
  ProfessionalSeriesOptions,
} from "@/types/premium";
import MentorAvailabilityCalendar from "@/components/premium/MentorAvailabilityCalendar";
import FormFieldShell from "@/components/ui/FormFieldShell";
import RichTextContent from "@/components/ui/RichTextContent";
import RichTextField from "@/components/ui/RichTextField";

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const toError = (error: unknown): string => {
  return error instanceof Error ? error.message : "Unknown error";
};

const addDays = (days: number): string => {
  const next = new Date();
  next.setDate(next.getDate() + days);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

interface MentorshipAvailabilityManagerProps {
  slots: MentorshipSlot[];
  onRefresh: () => Promise<void> | void;
}

export default function MentorshipAvailabilityManager({
  slots,
  onRefresh,
}: MentorshipAvailabilityManagerProps) {
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deactivatingDateKey, setDeactivatingDateKey] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const [role, setRole] = useState("mentor");
  const [displayName, setDisplayName] = useState("");
  const [availabilityMode, setAvailabilityMode] = useState<"open" | "series_only">("series_only");
  const [openScopeNote, setOpenScopeNote] = useState("");
  const [defaultCallProvider, setDefaultCallProvider] = useState<MentorshipCallProvider>("zoom_video_sdk");
  const [zoomMeetingLink, setZoomMeetingLink] = useState("");
  const [callSetupNote, setCallSetupNote] = useState("");
  const [copyEvaluationEnabled, setCopyEvaluationEnabled] = useState(false);
  const [copyEvaluationNote, setCopyEvaluationNote] = useState("");
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<number[]>([]);
  const [seriesOptions, setSeriesOptions] = useState<ProfessionalSeriesOptions>({
    provided_series: [],
    assigned_series: [],
  });

  const [startDate, setStartDate] = useState(addDays(0));
  const [endDate, setEndDate] = useState(addDays(21));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [slotMode, setSlotMode] = useState<MentorshipMode>("video");
  const [slotCallProvider, setSlotCallProvider] = useState<MentorshipCallProvider>("zoom_video_sdk");
  const [title, setTitle] = useState("Mentorship session");
  const [description, setDescription] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const { profile, profileId } = useProfile();

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const supabase = createClient();
      try {
        if (!profileId) throw new Error("Profile is not loaded yet.");

        const { data: profileData } = await premiumApi.get<any>("/profiles/me");

        if (!active) return;

        const creatorProfile = profileData as ProfessionalProfile | null;
        const meta = (((profileData as any)?.meta as Record<string, unknown>) || {});
        const resolvedRole = String((profileData as any)?.professional_role || profile?.role || "mains_expert").trim() || "mains_expert";
        setRole(resolvedRole);
        setDisplayName(String(creatorProfile?.display_name || profile?.display_name || "").trim());
        setAvailabilityMode(String(meta.mentorship_availability_mode || "").toLowerCase() === "open" ? "open" : "series_only");
        setOpenScopeNote(String(meta.mentorship_open_scope_note || ""));
        const rawDefaultCallProvider = String(meta.mentorship_default_call_provider || "").trim().toLowerCase();
        const hasLegacyMeetingLink = typeof meta.mentorship_zoom_meeting_link === "string" && meta.mentorship_zoom_meeting_link.trim();
        const resolvedDefaultCallProvider: MentorshipCallProvider =
          rawDefaultCallProvider === "custom"
            ? "custom"
            : rawDefaultCallProvider === "zoom_video_sdk"
              ? "zoom_video_sdk"
              : rawDefaultCallProvider === "zoom"
                ? (hasLegacyMeetingLink ? "custom" : "zoom_video_sdk")
                : hasLegacyMeetingLink
                  ? "custom"
                  : "zoom_video_sdk";
        setDefaultCallProvider(resolvedDefaultCallProvider);
        setSlotCallProvider(resolvedDefaultCallProvider);
        setZoomMeetingLink(String(meta.mentorship_zoom_meeting_link || ""));
        setCallSetupNote(String(meta.mentorship_call_setup_note || ""));
        setCopyEvaluationEnabled(
          Object.prototype.hasOwnProperty.call(meta, "copy_evaluation_enabled")
            ? Boolean(meta.copy_evaluation_enabled)
            : resolvedRole.toLowerCase() === "mentor",
        );
        setCopyEvaluationNote(String(meta.copy_evaluation_note || ""));
        setSelectedSeriesIds(
          Array.isArray(meta.mentorship_available_series_ids)
            ? meta.mentorship_available_series_ids
              .map((value) => Number(value))
              .filter((value, index, array) => Number.isFinite(value) && value > 0 && array.indexOf(value) === index)
            : [],
        );

        // Load series options
        const { data: seriesData } = await supabase
          .from("test_series")
          .select("id, name, series_kind")
          .eq("is_active", true);
        
        if (!active) return;
        setSeriesOptions({
          provided_series: (seriesData || []).map((row: any) => ({
            id: row.id,
            title: row.name,
            series_kind: row.series_kind,
          })),
          assigned_series: [],
        });
      } catch (error: unknown) {
        if (active) {
          toast.error("Failed to load mentorship settings", { description: toError(error) });
          setSeriesOptions({ provided_series: [], assigned_series: [] });
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [profile, profileId]);

  const seriesRows = useMemo(() => {
    const map = new Map<number, { id: number; title: string; hint: string }>();
    for (const row of seriesOptions.provided_series || []) {
      if (!map.has(row.id)) {
        map.set(row.id, { id: row.id, title: row.title, hint: "Provided by you" });
      }
    }
    for (const row of seriesOptions.assigned_series || []) {
      if (!map.has(row.id)) {
        map.set(row.id, { id: row.id, title: row.title, hint: "Assigned to you" });
      }
    }
    return Array.from(map.values());
  }, [seriesOptions.assigned_series, seriesOptions.provided_series]);
  const availabilityDays = useMemo(() => buildAvailabilityDays(slots, 21), [slots]);
  const selectedDay = useMemo(
    () => availabilityDays.find((day) => day.dateKey === selectedDateKey) || null,
    [availabilityDays, selectedDateKey],
  );

  useEffect(() => {
    if (!selectedDateKey) {
      const firstAvailableDay = availabilityDays.find((day) => day.slots.length > 0) || availabilityDays[0] || null;
      if (firstAvailableDay) {
        setSelectedDateKey(firstAvailableDay.dateKey);
      }
      return;
    }

    const stillExists = availabilityDays.some((day) => day.dateKey === selectedDateKey);
    if (!stillExists) {
      const fallbackDay = availabilityDays.find((day) => day.slots.length > 0) || availabilityDays[0] || null;
      setSelectedDateKey(fallbackDay?.dateKey || null);
    }
  }, [availabilityDays, selectedDateKey]);

  const toggleWeekday = (weekday: number) => {
    setWeekdays((prev) =>
      prev.includes(weekday) ? prev.filter((value) => value !== weekday) : [...prev, weekday].sort(),
    );
  };

  const toggleSeriesId = (seriesId: number) => {
    setSelectedSeriesIds((prev) =>
      prev.includes(seriesId) ? prev.filter((value) => value !== seriesId) : [...prev, seriesId],
    );
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      if (!profileId) throw new Error("Profile is not loaded yet.");
      await premiumApi.put("/profiles/me", {
        display_name: displayName || profile?.display_name || "Mentor",
        is_public: true,
        is_active: true,
        meta: {
          mentorship_availability_mode: availabilityMode,
          mentorship_open_scope_note: toNullableRichText(openScopeNote),
          mentorship_available_series_ids: selectedSeriesIds,
          mentorship_default_call_provider: defaultCallProvider,
          mentorship_zoom_meeting_link: zoomMeetingLink.trim() || null,
          mentorship_call_setup_note: toNullableRichText(callSetupNote),
          copy_evaluation_enabled: copyEvaluationEnabled,
          copy_evaluation_configured: true,
          copy_evaluation_note: toNullableRichText(copyEvaluationNote),
        },
      });
      profilesApi.clearCache();
      toast.success("Mentorship settings saved");
      await onRefresh();
    } catch (error: unknown) {
      toast.error("Failed to save mentorship settings", { description: toError(error) });
    } finally {
      setSavingSettings(false);
    }
  };

  const publishAvailability = async () => {
    const resolvedMeetingLink = slotCallProvider === "custom"
      ? meetingLink.trim() || zoomMeetingLink.trim()
      : meetingLink.trim();

    const payload: MentorshipSlotBatchCreatePayload = buildSlotBatchPayload({
      startDate,
      endDate,
      weekdays,
      startTime,
      endTime,
      mode: slotMode,
      callProvider: slotCallProvider,
      title,
      description: toNullableRichText(description) || "",
      meetingLink: resolvedMeetingLink,
    });

    if (payload.slots.length === 0) {
      toast.error("No valid slots were generated. Check the dates, days, and time range.");
      return;
    }

    setPublishing(true);
    const supabase = createClient();
    try {
      if (!profileId) throw new Error("Profile is not loaded yet.");
      const rows = payload.slots.map((slot) => ({
        mentor_id: profileId,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        mode: dbMentorshipMode(slot.mode),
        meeting_link: slot.meeting_link,
        title: slot.title,
        description: slot.description,
        is_active: true,
        booked_count: 0,
        max_bookings: 1,
      }));
      const { error } = await supabase.from("mentorship_slots").insert(rows);
      if (error) throw error;
      toast.success(`Published ${payload.slots.length} availability slot${payload.slots.length === 1 ? "" : "s"}`);
      await onRefresh();
    } catch (error: unknown) {
      toast.error("Failed to publish availability", { description: toError(error) });
    } finally {
      setPublishing(false);
    }
  };

  const markDateUnavailable = async (dateKey: string, slotIds?: number[]) => {
    const targetSlotIds = (slotIds && slotIds.length > 0 ? slotIds : slotIdsForDate(slots, dateKey)).filter(
      (value, index, array) => value > 0 && array.indexOf(value) === index,
    );
    if (targetSlotIds.length === 0) {
      toast.error("No active slots exist on that date.");
      return;
    }

    setDeactivatingDateKey(dateKey);
    const supabase = createClient();
    try {
      const { error } = await supabase.from("mentorship_slots")
        .update({ is_active: false })
        .in("id", targetSlotIds);
      if (error) throw error;
      toast.success(`Marked ${dateKey} unavailable`);
      await onRefresh();
    } catch (error: unknown) {
      toast.error("Failed to mark day unavailable", { description: toError(error) });
    } finally {
      setDeactivatingDateKey(null);
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship availability...</div>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Availability Settings</h2>
            <p className="mt-1 text-xs text-slate-600">
              Keep mentorship scope and the published calendar here. Your public profile only reads from this workspace.
            </p>
          </div>
          <Link href="/profile/professional" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Open Public Profile
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <FormFieldShell label="Availability mode">
            <select
              value={availabilityMode}
              onChange={(event) => setAvailabilityMode(event.target.value as "open" | "series_only")}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="series_only">Series-only mentorship</option>
              <option value="open">Open mentorship requests</option>
            </select>
          </FormFieldShell>
          <FormFieldShell label="Mode guidance">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              Choose <span className="font-semibold text-slate-800">Open</span> if learners can bring any issue. Choose{" "}
              <span className="font-semibold text-slate-800">Series-only</span> if requests should stay restricted to selected
              programs flows.
            </div>
          </FormFieldShell>
          <RichTextField
            label="Open mentorship scope note"
            value={openScopeNote}
            onChange={setOpenScopeNote}
            className="md:col-span-2"
            placeholder="Explain what topics, formats, or learner situations you accept in open mentorship."
            helperText="Shown to learners when they view your mentorship scope."
          />
        </div>

        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
          <p className="text-sm font-semibold text-slate-900">Default Call Platform</p>
          <p className="mt-1 text-xs text-slate-600">
            These defaults are reused across public booking, mentorship slots, and session records.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <FormFieldShell label="Default platform">
              <select
                value={defaultCallProvider}
                onChange={(event) => {
                  const value = event.target.value as MentorshipCallProvider;
                  setDefaultCallProvider(value);
                  setSlotCallProvider(value);
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="custom">Custom link / manual setup</option>
                <option value="zoom_video_sdk">Agora In-App Room</option>
              </select>
            </FormFieldShell>
            {defaultCallProvider === "custom" && (
              <FormFieldShell label="Reusable custom meeting link">
                <input
                  value={zoomMeetingLink}
                  onChange={(event) => setZoomMeetingLink(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="https://meet.google.com/... or any external call link"
                />
              </FormFieldShell>
            )}
            {defaultCallProvider === "zoom_video_sdk" && (
              <FormFieldShell label="In-App Mode">
                <p className="text-xs text-slate-500 mb-2">Sessions take place entirely inside the browser using Agora. No external links are required.</p>
              </FormFieldShell>
            )}
            <RichTextField
              label="Call setup note"
              value={callSetupNote}
              onChange={setCallSetupNote}
              className="md:col-span-2"
              placeholder="Explain how learners should join, fallback steps, and whether audio-only sessions are supported."
              helperText="Shown as part of the mentor-facing call setup context."
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <input
              type="checkbox"
              checked={copyEvaluationEnabled}
              onChange={(event) => setCopyEvaluationEnabled(event.target.checked)}
            />
            Accept direct copy evaluation + mentorship requests
          </label>
          <p className="mt-1 text-xs text-slate-600">
            Enable this for mentor-cum-evaluator workflows where learners can submit copies directly from your public profile.
          </p>
          <RichTextField
            label="Copy evaluation panel note"
            value={copyEvaluationNote}
            onChange={setCopyEvaluationNote}
            className="mt-3"
            placeholder="Explain expected checking style, response expectations, or turnaround rules."
            helperText="Learners will see this before they submit a direct copy for evaluation."
          />
        </div>

        {availabilityMode === "series_only" ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allowed Programs</p>
            <div className="grid gap-2 md:grid-cols-2">
              {seriesRows.map((row) => (
                <label key={row.id} className="inline-flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                  <input type="checkbox" checked={selectedSeriesIds.includes(row.id)} onChange={() => toggleSeriesId(row.id)} />
                  <span>{row.title}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{row.hint}</span>
                </label>
              ))}
            </div>
            {seriesRows.length === 0 ? <p className="text-xs text-slate-500">No series mapped yet. Create or assign a mains series first.</p> : null}
          </div>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={savingSettings}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {savingSettings ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Publish Calendar Availability</h2>
        <p className="mt-1 text-xs text-slate-600">
          Apply one daily time block across selected weekdays. Each published window is automatically split into{" "}
          {MENTORSHIP_SLOT_DURATION_MINUTES}-minute learner-bookable slots with one booking per slot. If you need a day
          off later, use the calendar cards below to mark that day unavailable.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <FormFieldShell label="Start date">
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </FormFieldShell>
          <FormFieldShell label="End date">
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </FormFieldShell>
          <FormFieldShell label="Call mode">
            <select
              value={slotMode}
              onChange={(event) => setSlotMode(event.target.value as MentorshipMode)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="video">Video calls</option>
              <option value="audio">Audio calls</option>
            </select>
          </FormFieldShell>
          <FormFieldShell label="Call platform">
            <select
              value={slotCallProvider}
              onChange={(event) => setSlotCallProvider(event.target.value as MentorshipCallProvider)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="custom">Custom link / manual setup</option>
              <option value="zoom_video_sdk">Agora In-App Room</option>
            </select>
          </FormFieldShell>
          <FormFieldShell label="Daily start time">
            <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </FormFieldShell>
          <FormFieldShell label="Daily end time">
            <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </FormFieldShell>
          <FormFieldShell label="Slot title">
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Slot title" />
          </FormFieldShell>
          {slotCallProvider === "custom" && (
            <FormFieldShell label="Meeting link (optional)">
              <input
                value={meetingLink}
                onChange={(event) => setMeetingLink(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Leave blank to reuse default custom link"
              />
            </FormFieldShell>
          )}
          <RichTextField
            label="Slot description"
            value={description}
            onChange={setDescription}
            className="xl:col-span-3"
            placeholder="Explain what this slot block is for, expected preparation, or call focus."
            helperText="Saved with each generated slot and shown in scheduling records."
          />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Example: publishing 6:00 PM to 7:00 PM creates 3 slots, so up to 3 separate mentorship calls can be booked on
          that day.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {WEEKDAY_OPTIONS.map((option) => {
            const selected = weekdays.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleWeekday(option.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selected ? "border-emerald-400 bg-emerald-100 text-emerald-800" : "border-slate-300 bg-white text-slate-700"
                  }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void publishAvailability()}
            disabled={publishing}
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {publishing ? "Publishing..." : "Publish Calendar"}
          </button>
          <button
            type="button"
            onClick={() => void markDateUnavailable(startDate)}
            disabled={deactivatingDateKey === startDate}
            className="rounded border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
          >
            {deactivatingDateKey === startDate ? "Marking..." : `Mark ${startDate} Unavailable`}
          </button>
        </div>
      </section>

      <MentorAvailabilityCalendar
        slots={slots}
        days={21}
        title="Published Mentor Calendar"
        description="This is the learner-facing availability view for the next three weeks."
        selectedDateKey={selectedDateKey}
        onSelectDate={(dateKey) => setSelectedDateKey(dateKey)}
        deactivatingDateKey={deactivatingDateKey}
        onDeactivateDate={(dateKey, slotIds) => {
          void markDateUnavailable(dateKey, slotIds);
        }}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Selected Day Slot Breakdown</h2>
            <p className="mt-1 text-xs text-slate-600">
              Click any day in the calendar above to inspect the exact 20-minute call slots learners can book.
            </p>
          </div>
          {selectedDay ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {selectedDay.date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
            </span>
          ) : null}
        </div>

        {selectedDay ? (
          selectedDay.slots.length > 0 ? (
            <div className="mt-4 space-y-2">
              {selectedDay.slots.map((slot, index) => {
                const slotBooked = (slot.booked_count || 0) >= (slot.max_bookings || 1);
                return (
                  <div
                    key={slot.id}
                    className={`rounded-lg border p-3 text-sm ${slotBooked ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50/50"
                      }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Slot {index + 1} of {selectedDay.slots.length}
                        </p>
                        <p className="mt-1 font-semibold text-slate-900">{formatSlotTimeRange(slot)}</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Slot #{slot.id} | {mentorshipCallLabel(slot.mode, slot.call_provider)} | Capacity {slot.booked_count}/{slot.max_bookings}
                        </p>
                        {slot.title ? <p className="mt-1 text-xs text-slate-600">{slot.title}</p> : null}
                        {slot.description ? (
                          <RichTextContent
                            value={slot.description}
                            className="mt-1 text-xs text-slate-500 [&_p]:my-1"
                          />
                        ) : null}
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${slotBooked ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                      >
                        {slotBooked ? "Booked by learner" : "Open for booking"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              No active 20-minute slots are published on this date.
            </div>
          )
        ) : (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            No calendar date is selected yet.
          </div>
        )}
      </section>
    </div>
  );
}
