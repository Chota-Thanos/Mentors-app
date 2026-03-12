"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import MentorAvailabilityCalendar from "@/components/premium/MentorAvailabilityCalendar";
import RichTextContent from "@/components/ui/RichTextContent";
import RichTextField from "@/components/ui/RichTextField";
import {
  buildAvailabilityDays,
  formatSlotTimeRange,
  MENTORSHIP_SLOT_DURATION_MINUTES,
  mentorshipCallLabel,
} from "@/lib/mentorAvailability";
import { premiumApi } from "@/lib/premiumApi";
import { toNullableRichText } from "@/lib/richText";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import type {
  MentorshipMode,
  MentorshipSlot,
  ProfessionalProfileReview,
  ProfessionalPublicProfileDetail,
  TestSeries,
} from "@/types/premium";

interface DisplayBookingSlot extends MentorshipSlot {
  source_slot_id: number;
  segment_starts_at: string;
  segment_ends_at: string;
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleString();
}

function Stars({ rating }: { rating: number }) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="text-amber-500">
      {"*".repeat(safe)}
      <span className="text-slate-300">{"*".repeat(5 - safe)}</span>
    </span>
  );
}

function ReviewCard({ review }: { review: ProfessionalProfileReview }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{review.reviewer_label}</p>
        <div className="inline-flex items-center gap-2 text-xs">
          <Stars rating={review.rating} />
          <span className="text-slate-500">{formatDateTime(review.created_at)}</span>
        </div>
      </div>
      {review.title ? <p className="mt-1 text-sm font-medium text-slate-800">{review.title}</p> : null}
      {review.comment ? <RichTextContent value={review.comment} className="mt-1 text-sm text-slate-600" /> : null}
    </article>
  );
}

function SeriesMiniCard({ series }: { series: TestSeries }) {
  return (
    <Link href={`/test-series/${series.id}`} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-300">
      <p className="font-semibold text-slate-900">{series.title}</p>
      <p className="text-xs text-slate-500">{series.series_kind} | {series.access_type}</p>
    </Link>
  );
}

function expandSlotsForDisplay(slots: MentorshipSlot[]): DisplayBookingSlot[] {
  const output: DisplayBookingSlot[] = [];
  for (const slot of slots) {
    const startsAt = new Date(slot.starts_at);
    const endsAt = new Date(slot.ends_at);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      continue;
    }

    const durationMs = endsAt.getTime() - startsAt.getTime();
    const segmentMs = MENTORSHIP_SLOT_DURATION_MINUTES * 60 * 1000;
    if (durationMs <= segmentMs) {
      output.push({
        ...slot,
        source_slot_id: slot.id,
        segment_starts_at: slot.starts_at,
        segment_ends_at: slot.ends_at,
      });
      continue;
    }

    let segmentIndex = 0;
    for (let cursor = startsAt.getTime(); cursor + segmentMs <= endsAt.getTime(); cursor += segmentMs) {
      const segmentStart = new Date(cursor);
      const segmentEnd = new Date(cursor + segmentMs);
      output.push({
        ...slot,
        id: -(slot.id * 100 + segmentIndex + 1),
        starts_at: segmentStart.toISOString(),
        ends_at: segmentEnd.toISOString(),
        source_slot_id: slot.id,
        segment_starts_at: segmentStart.toISOString(),
        segment_ends_at: segmentEnd.toISOString(),
      });
      segmentIndex += 1;
    }
  }

  return output.sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

export default function ProfessionalPublicProfileView({
  userId,
  seriesId,
}: {
  userId: string;
  seriesId?: number | null;
}) {
  const { isAuthenticated, showLoginModal, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingReview, setSavingReview] = useState(false);
  const [bookingSlotId, setBookingSlotId] = useState<number | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [bookingNote, setBookingNote] = useState("");
  const [directCopyPdfUrl, setDirectCopyPdfUrl] = useState("");
  const [directCopyNote, setDirectCopyNote] = useState("");
  const [directCopyPreferredMode, setDirectCopyPreferredMode] = useState<MentorshipMode>("video");
  const [submittingDirectCopy, setSubmittingDirectCopy] = useState(false);
  const [detail, setDetail] = useState<ProfessionalPublicProfileDetail | null>(null);
  const [mentorSlots, setMentorSlots] = useState<MentorshipSlot[]>([]);
  const [rating, setRating] = useState("5");
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [detailResponse, slotsResponse] = await Promise.all([
        premiumApi.get<ProfessionalPublicProfileDetail>(`/profiles/${userId}/detail`),
        premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
          params: {
            provider_user_id: userId,
            only_available: false,
          },
        }),
      ]);
      setDetail(detailResponse.data || null);
      setMentorSlots(Array.isArray(slotsResponse.data) ? slotsResponse.data : []);
    } catch (error: unknown) {
      setDetail(null);
      setMentorSlots([]);
      toast.error("Failed to load professional profile", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const combinedSeries = useMemo(() => {
    const map = new Map<number, TestSeries>();
    for (const row of detail?.provided_series || []) {
      map.set(row.id, row);
    }
    for (const row of detail?.assigned_series || []) {
      if (!map.has(row.id)) map.set(row.id, row);
    }
    return Array.from(map.values());
  }, [detail?.assigned_series, detail?.provided_series]);

  const availableSeriesById = useMemo(() => {
    const map = new Map<number, TestSeries>();
    for (const row of combinedSeries) {
      map.set(row.id, row);
    }
    return map;
  }, [combinedSeries]);
  const displaySlots = useMemo(() => expandSlotsForDisplay(mentorSlots), [mentorSlots]);
  const availabilityDays = useMemo(() => buildAvailabilityDays(displaySlots, 14), [displaySlots]);
  const selectedDay = useMemo(
    () => availabilityDays.find((day) => day.dateKey === selectedDateKey) || null,
    [availabilityDays, selectedDateKey],
  );

  const submitReview = async () => {
    if (!isAuthenticated) {
      showLoginModal();
      return;
    }
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      toast.error("Rating should be between 1 and 5.");
      return;
    }
    setSavingReview(true);
    try {
      await premiumApi.post(`/profiles/${userId}/reviews`, {
        rating: numericRating,
        title: title.trim() || null,
        comment: toNullableRichText(comment),
      });
      toast.success("Review submitted");
      setTitle("");
      setComment("");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to submit review", { description: toError(error) });
    } finally {
      setSavingReview(false);
    }
  };

  useEffect(() => {
    if (selectedDateKey && !availabilityDays.some((day) => day.dateKey === selectedDateKey)) {
      setSelectedDateKey(null);
    }
  }, [availabilityDays, selectedDateKey]);

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading profile...</div>;
  }

  if (!detail) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Profile not found.</div>;
  }

  const profile = detail.profile;
  const ownProfile = String(user?.id || "").trim() === String(profile.user_id || "").trim();
  const roleLabel = detail.role_label || toDisplayRoleLabel(profile.role);
  const canBookFromProfile = detail.mentorship_availability_mode === "open";
  const selectedDayWindowLabel =
    selectedDay && selectedDay.slots.length > 0
      ? `${new Date(selectedDay.slots[0].starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${new Date(
          selectedDay.slots[selectedDay.slots.length - 1].ends_at,
        ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : null;

  const bookMentorshipSlot = async (slot: DisplayBookingSlot) => {
    if (!isAuthenticated) {
      showLoginModal();
      return;
    }

    setBookingSlotId(slot.id);
    try {
      await premiumApi.post("/mentorship/requests", {
        series_id: seriesId || undefined,
        provider_user_id: profile.user_id,
        slot_id: slot.source_slot_id,
        slot_segment_starts_at: slot.segment_starts_at,
        slot_segment_ends_at: slot.segment_ends_at,
        preferred_mode: slot.mode,
        note: toNullableRichText(bookingNote),
      });
      toast.success(`${mentorshipCallLabel(slot.mode, slot.call_provider)} slot booked`);
      setBookingNote("");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to book slot", { description: toError(error) });
    } finally {
      setBookingSlotId(null);
    }
  };

  const submitDirectCopy = async () => {
    if (!isAuthenticated) {
      showLoginModal();
      return;
    }
    if (!directCopyPdfUrl.trim()) {
      toast.error("Answer PDF URL is required.");
      return;
    }

    setSubmittingDirectCopy(true);
    try {
      await premiumApi.post(`/mentors/${userId}/copy-submissions`, {
        answer_pdf_url: directCopyPdfUrl.trim(),
        note: toNullableRichText(directCopyNote),
        preferred_mode: directCopyPreferredMode,
      });
      toast.success("Copy submitted for evaluation. Track the workflow from Mentorship Manage.");
      setDirectCopyPdfUrl("");
      setDirectCopyNote("");
      setDirectCopyPreferredMode("video");
    } catch (error: unknown) {
      toast.error("Failed to submit copy", { description: toError(error) });
    } finally {
      setSubmittingDirectCopy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="h-28 w-28 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {profile.profile_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profile_image_url} alt={profile.display_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{profile.display_name}</h1>
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                {roleLabel}
              </span>
              {profile.is_verified ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  Verified
                </span>
              ) : null}
            </div>
            <p className="text-sm text-slate-600">{profile.headline || roleLabel}</p>
            {profile.bio ? (
              <RichTextContent value={profile.bio} className="text-sm text-slate-700" />
            ) : (
              <p className="text-sm text-slate-700">No public bio yet.</p>
            )}
            <p className="text-xs text-slate-500">
              {profile.city || "City n/a"} | Experience: {profile.years_experience ? `${profile.years_experience}+ years` : "n/a"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                Avg Rating: {detail.review_summary.average_rating.toFixed(2)} ({detail.review_summary.total_reviews})
              </span>
              {profile.contact_url ? (
                <a href={profile.contact_url} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                  Contact Link
                </a>
              ) : null}
              {detail.authenticity_proof_url ? (
                <a href={detail.authenticity_proof_url} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-2 py-1 text-slate-700">
                  Authenticity Proof
                </a>
              ) : null}
            </div>
            {detail.authenticity_note ? (
              <div className="text-xs text-slate-500">
                <p className="font-semibold uppercase tracking-wide text-slate-400">Verification note</p>
                <RichTextContent value={detail.authenticity_note} className="mt-1 text-xs text-slate-500 [&_p]:my-1" />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {detail.achievements.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Achievements</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {detail.achievements.map((row, index) => (
              <li key={`ach-${index}`}>- {row}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.service_specifications.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Technical Specifications</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {detail.service_specifications.map((row, index) => (
              <li key={`spec-${index}`}>- {row}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {String(profile.role).toLowerCase() === "mentor" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Mentorship Availability</h2>
          <p className="mt-1 text-sm text-slate-700">
            {detail.mentorship_availability_mode === "open"
              ? "Open availability: users can bring standalone problems or any test."
              : "Series-only availability: mentorship requests are limited to selected series."}
          </p>
          {detail.copy_evaluation_enabled ? (
            <p className="mt-1 text-xs text-emerald-700">
              Direct copy evaluation + mentorship is enabled on this profile.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-600">
            Default call platform:{" "}
            <span className="font-semibold text-slate-900">
              {detail.mentorship_default_call_provider === "zoom" ? "Zoom" : "Custom link / manual setup"}
            </span>
          </p>
          {detail.mentorship_open_scope_note ? (
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Scope note</p>
              <RichTextContent value={detail.mentorship_open_scope_note} className="mt-1 text-xs text-slate-500 [&_p]:my-1" />
            </div>
          ) : null}
          {detail.mentorship_call_setup_note ? (
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Call setup note</p>
              <RichTextContent value={detail.mentorship_call_setup_note} className="mt-1 text-xs text-slate-500 [&_p]:my-1" />
            </div>
          ) : null}
          {detail.copy_evaluation_note ? (
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Copy evaluation note</p>
              <RichTextContent value={detail.copy_evaluation_note} className="mt-1 text-xs text-slate-500 [&_p]:my-1" />
            </div>
          ) : null}
          {!ownProfile ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="#booking-panel"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Open Booking Panel
              </a>
              {detail.copy_evaluation_enabled ? (
                <a
                  href="#direct-copy-evaluation"
                  className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                >
                  Send Copy For Evaluation
                </a>
              ) : (
                <span className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                  Direct copy evaluation is not enabled on this mentor profile yet.
                </span>
              )}
            </div>
          ) : null}
          {detail.mentorship_availability_mode === "series_only" ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {detail.mentorship_available_series_ids.map((seriesId) => {
                const series = availableSeriesById.get(seriesId);
                return series ? <SeriesMiniCard key={`avail-${seriesId}`} series={series} /> : null;
              })}
              {detail.mentorship_available_series_ids.length === 0 ? (
                <p className="text-sm text-slate-500">No specific series declared yet.</p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4">
            <MentorAvailabilityCalendar
              slots={displaySlots}
              days={14}
              title="Upcoming Mentor Calendar"
              description="Click any date card to open the booking panel for that day. Each slot is a 20-minute mentorship session with its own audio/video mode and call platform."
              emptyLabel="No future mentorship timings have been published yet."
              selectedDateKey={selectedDateKey}
              onSelectDate={(dateKey) => {
                setSelectedDateKey((current) => (current === dateKey ? null : dateKey));
              }}
            />
          </div>
          {!ownProfile ? (
            <div id="booking-panel" className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Booking Panel</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Pick a date from the calendar above. The selected day opens here with all exact {MENTORSHIP_SLOT_DURATION_MINUTES}
                    -minute mentorship slots.
                  </p>
                  {seriesId ? (
                    <p className="mt-1 text-xs text-emerald-700">This booking will be linked to series #{seriesId}.</p>
                  ) : null}
                  {detail.mentorship_default_call_provider === "zoom" && detail.mentorship_zoom_meeting_link ? (
                    <p className="mt-1 text-xs text-slate-500">This mentor currently uses Zoom for scheduled calls.</p>
                  ) : null}
                </div>
                {isAuthenticated ? (
                  <Link href="/mentorship/manage" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    My Bookings
                  </Link>
                ) : null}
              </div>

              {!selectedDay ? (
                <p className="mt-4 text-sm text-slate-500">Click any date in the calendar to open that day&apos;s booking panel.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {selectedDay.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {selectedDay.availableSlots} open slot{selectedDay.availableSlots === 1 ? "" : "s"} for this date.
                    </p>
                    {selectedDayWindowLabel ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Window: {selectedDayWindowLabel} | {selectedDay.slots.length} slots x {MENTORSHIP_SLOT_DURATION_MINUTES} min
                      </p>
                    ) : null}
                    {selectedDay.slots.length === 3 && selectedDayWindowLabel ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Example split for a 1-hour window: Slot 1, Slot 2, and Slot 3 are booked separately.
                      </p>
                    ) : null}
                    {selectedDay.slots.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {selectedDay.slots
                          .map((slot, index) => `Slot ${index + 1}: ${formatSlotTimeRange(slot)}`)
                          .join(" | ")}
                      </p>
                    ) : null}
                  </div>

                  {canBookFromProfile ? (
                    <>
                      <RichTextField
                        label="Booking context"
                        value={bookingNote}
                        onChange={setBookingNote}
                        placeholder="Add context for the mentor before booking this call."
                        helperText="Share the problem area, test context, or what you want to discuss in the session."
                      />
                      <div className="space-y-2">
                        {selectedDay.slots.map((slot, index) => {
                          const isAvailable = (slot.booked_count || 0) < (slot.max_bookings || 1);
                          const slotLabel = `Slot ${index + 1} of ${selectedDay.slots.length}`;
                          return (
                            <div key={slot.id} className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{slotLabel}</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">{formatSlotTimeRange(slot)}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {slot.title ? `${slot.title} | ` : ""}
                                    {mentorshipCallLabel(slot.mode, slot.call_provider)} | Capacity {slot.booked_count}/{slot.max_bookings}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  disabled={!isAvailable || bookingSlotId !== null}
                                  onClick={() => void bookMentorshipSlot(slot)}
                                  className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {bookingSlotId === slot.id ? "Booking..." : isAvailable ? `Book ${slotLabel}` : "Booked"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {selectedDay.slots.length === 0 ? (
                          <p className="text-sm text-slate-500">No published slots exist for this date.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      This mentor accepts bookings only for selected test series. Use the relevant test series mentorship flow
                      after your copy has been checked.
                    </div>
                  )}

                  {!isAuthenticated ? (
                    <p className="text-xs text-slate-500">Sign in first to book any open slot from this panel.</p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {ownProfile ? (
            <div id="direct-copy-evaluation" className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Direct Copy Evaluation + Mentorship</h3>
                  {detail.copy_evaluation_enabled ? (
                    <p className="mt-1 text-sm text-slate-600">
                      Preview: learners will see a direct copy submission form on this profile and the workflow will open in
                      Mentorship Manage after submission.
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-600">
                      Direct copy evaluation is currently disabled on your public profile.
                    </p>
                  )}
                  {detail.copy_evaluation_note ? (
                    <RichTextContent value={detail.copy_evaluation_note} className="mt-2 text-xs text-slate-500 [&_p]:my-1" />
                  ) : null}
                </div>
                <Link
                  href="/mentorship/manage"
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Open Mentor Desk
                </Link>
              </div>
              {!detail.copy_evaluation_enabled ? (
                <p className="mt-3 text-xs text-slate-500">
                  Enable <span className="font-semibold text-slate-700">Accept direct copy evaluation + mentorship requests</span>{" "}
                  from your availability settings to make the learner-side form visible here.
                </p>
              ) : null}
            </div>
          ) : (
            detail.copy_evaluation_enabled ? (
              <div id="direct-copy-evaluation" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Direct Copy Evaluation + Mentorship</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Submit your answer copy here. The mentor will share checking ETA, review the copy, and then offer multiple call slots for you to accept.
                  </p>
                  {detail.mentorship_default_call_provider === "zoom" ? (
                    <p className="mt-1 text-xs text-slate-500">Post-review mentorship is currently configured to run on Zoom unless the mentor changes the slot setup.</p>
                  ) : null}
                  {detail.copy_evaluation_note ? (
                    <RichTextContent value={detail.copy_evaluation_note} className="mt-1 text-xs text-emerald-700 [&_p]:my-1" />
                  ) : null}
                </div>
                {isAuthenticated ? (
                  <Link href="/mentorship/manage" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Track Workflow
                  </Link>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input
                  value={directCopyPdfUrl}
                  onChange={(event) => setDirectCopyPdfUrl(event.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm md:col-span-2"
                  placeholder="Paste the answer PDF URL"
                />
                <select
                  value={directCopyPreferredMode}
                  onChange={(event) => setDirectCopyPreferredMode(event.target.value as MentorshipMode)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="video">Preferred call: Video</option>
                  <option value="audio">Preferred call: Audio</option>
                </select>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  Flow: submit copy -&gt; mentor shares ETA -&gt; mentor checks copy -&gt; mentor offers slots -&gt; you accept one call slot.
                </div>
                <RichTextField
                  label="Copy context"
                  value={directCopyNote}
                  onChange={setDirectCopyNote}
                  className="md:col-span-2"
                  placeholder="Add context, topic, or specific evaluation focus for the mentor."
                  helperText="This note travels with your submission into the mentor workflow."
                />
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={submittingDirectCopy}
                  onClick={() => void submitDirectCopy()}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submittingDirectCopy ? "Submitting..." : "Submit Copy For Evaluation"}
                </button>
              </div>
              </div>
            ) : (
              <div id="direct-copy-evaluation" className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 scroll-mt-24">
                <h3 className="text-base font-semibold text-slate-900">Direct Copy Evaluation + Mentorship</h3>
                <p className="mt-1 text-sm text-slate-600">
                  This mentor has not enabled direct copy evaluation on the public profile yet.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  You can still book normal mentorship slots from the booking panel above, or submit your copy through the
                  linked test-series writing desk when the mentor is handling that series workflow.
                </p>
              </div>
            )
          )}
        </section>
      ) : null}

      {detail.provided_series.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Provided Test Series</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {detail.provided_series.map((row) => (
              <SeriesMiniCard key={`provided-${row.id}`} series={row} />
            ))}
          </div>
        </section>
      ) : null}

      {detail.assigned_series.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Assigned Mentorship Series</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {detail.assigned_series.map((row) => (
              <SeriesMiniCard key={`assigned-${row.id}`} series={row} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Reviews</h2>
        <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-5">
          <div className="rounded bg-slate-50 px-2 py-1">5*: {detail.review_summary.rating_5}</div>
          <div className="rounded bg-slate-50 px-2 py-1">4*: {detail.review_summary.rating_4}</div>
          <div className="rounded bg-slate-50 px-2 py-1">3*: {detail.review_summary.rating_3}</div>
          <div className="rounded bg-slate-50 px-2 py-1">2*: {detail.review_summary.rating_2}</div>
          <div className="rounded bg-slate-50 px-2 py-1">1*: {detail.review_summary.rating_1}</div>
        </div>

        <div className="mt-3 space-y-2">
          {detail.recent_reviews.map((row) => (
            <ReviewCard key={row.id} review={row} />
          ))}
          {detail.recent_reviews.length === 0 ? <p className="text-sm text-slate-500">No reviews yet.</p> : null}
        </div>

        {!ownProfile ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">Submit or Update Your Review</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <select value={rating} onChange={(event) => setRating(event.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="5">5 - Excellent</option>
                <option value="4">4 - Good</option>
                <option value="3">3 - Average</option>
                <option value="2">2 - Below average</option>
                <option value="1">1 - Poor</option>
              </select>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Review title" />
              <RichTextField
                label="Review comment"
                value={comment}
                onChange={setComment}
                className="md:col-span-2"
                placeholder="Share what was helpful, where the mentor added value, and what future learners should know."
                helperText="Your review can include short bullets or paragraphs."
              />
            </div>
            <button type="button" disabled={savingReview} onClick={() => void submitReview()} className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
              {savingReview ? "Submitting..." : isAuthenticated ? "Submit Review" : "Login to Review"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
