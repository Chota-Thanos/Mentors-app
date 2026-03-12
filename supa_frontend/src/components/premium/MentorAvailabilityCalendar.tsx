"use client";

import { CalendarDays } from "lucide-react";

import {
  buildAvailabilityDays,
  formatSlotTimeRange,
  MENTORSHIP_SLOT_DURATION_MINUTES,
  mentorshipCallLabel,
  toLocalDateKey,
} from "@/lib/mentorAvailability";
import type { MentorshipSlot } from "@/types/premium";

interface MentorAvailabilityCalendarProps {
  slots: MentorshipSlot[];
  days?: number;
  title?: string;
  description?: string;
  emptyLabel?: string;
  selectedDateKey?: string | null;
  selectedSlotId?: number | null;
  bookingSlotId?: number | null;
  onSelectDate?: (dateKey: string, slotIds: number[]) => void;
  onSelectSlot?: (slot: MentorshipSlot, dateKey: string) => void;
  slotActionLabel?: string;
  deactivatingDateKey?: string | null;
  onDeactivateDate?: (dateKey: string, slotIds: number[]) => void;
}

export default function MentorAvailabilityCalendar({
  slots,
  days = 14,
  title = "Availability Calendar",
  description,
  emptyLabel = "No active slots are published for this period.",
  selectedDateKey,
  selectedSlotId,
  bookingSlotId,
  onSelectDate,
  onSelectSlot,
  slotActionLabel = "Select Slot",
  deactivatingDateKey,
  onDeactivateDate,
}: MentorAvailabilityCalendarProps) {
  const dayRows = buildAvailabilityDays(slots, days);
  const todayKey = toLocalDateKey(new Date());
  const bookingInProgress = bookingSlotId !== null && bookingSlotId !== undefined;
  const selectDayOnly = Boolean(onSelectDate && !onSelectSlot);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
            <CalendarDays className="h-4 w-4" />
            {title}
          </h3>
          {description ? <p className="mt-1 text-xs text-slate-600">{description}</p> : null}
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          Showing {days} days
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dayRows.map((day) => {
          const hasAvailability = day.slots.length > 0;
          const isToday = day.dateKey === todayKey;
          const isSelectedDay = selectedDateKey === day.dateKey;
          const slotIds = day.slots.map((slot) => slot.id);
          const selectDate = () => onSelectDate?.(day.dateKey, slotIds);
          const firstSlot = day.slots[0] || null;
          const lastSlot = day.slots[day.slots.length - 1] || null;
          const dayWindowLabel =
            firstSlot && lastSlot
              ? `${new Date(firstSlot.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${new Date(
                  lastSlot.ends_at,
                ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : null;

          return (
            <article
              key={day.dateKey}
              onClick={selectDayOnly ? selectDate : undefined}
              onKeyDown={
                selectDayOnly
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectDate();
                      }
                    }
                  : undefined
              }
              role={selectDayOnly ? "button" : undefined}
              aria-pressed={selectDayOnly ? isSelectedDay : undefined}
              tabIndex={selectDayOnly ? 0 : undefined}
              className={`rounded-xl border p-3 ${
                hasAvailability ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50"
              } ${isToday ? "ring-1 ring-sky-300" : ""} ${isSelectedDay ? "ring-2 ring-emerald-300" : ""} ${
                selectDayOnly ? "cursor-pointer transition hover:border-emerald-300" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{day.date.toLocaleDateString([], { weekday: "long" })}</p>
                  <p className="text-xs text-slate-500">
                    {day.date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                    {isToday ? " | Today" : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                    hasAvailability ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {hasAvailability ? `${day.availableSlots} open slot${day.availableSlots === 1 ? "" : "s"}` : "Unavailable"}
                </span>
              </div>
              {onSelectDate && !selectDayOnly ? (
                <button
                  type="button"
                  onClick={() => onSelectDate(day.dateKey, slotIds)}
                  className={`mt-2 rounded border px-2 py-1 text-[11px] font-semibold ${
                    isSelectedDay
                      ? "border-emerald-300 bg-white text-emerald-700"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {isSelectedDay ? "Selected Day" : hasAvailability ? "Check Slots" : "Select Day"}
                </button>
              ) : null}

              {hasAvailability ? (
                <div className="mt-3 space-y-2">
                  {selectDayOnly ? (
                    <div className="rounded-lg border border-white/80 bg-white/85 px-2.5 py-2 text-xs text-slate-700">
                      <p className="font-semibold text-slate-900">{dayWindowLabel}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {day.slots.length} slot{day.slots.length === 1 ? "" : "s"} x {MENTORSHIP_SLOT_DURATION_MINUTES} min
                        {isSelectedDay ? " | Booking panel open below" : ""}
                      </p>
                    </div>
                  ) : null}
                  {day.slots.map((slot) => {
                    if (selectDayOnly) {
                      return null;
                    }
                    const slotAvailable = (slot.booked_count || 0) < (slot.max_bookings || 1);
                    const slotSelected = slot.id === selectedSlotId;
                    const slotLabel = bookingSlotId === slot.id
                      ? "Booking..."
                      : slotSelected
                        ? "Selected"
                        : slotAvailable
                          ? slotActionLabel
                          : "Booked";
                    const slotClassName = `w-full rounded-lg border px-2.5 py-2 text-left text-xs text-slate-700 ${
                      slotSelected
                        ? "border-emerald-300 bg-emerald-100/70"
                        : slotAvailable
                          ? "border-white/80 bg-white/90"
                          : "border-slate-200 bg-slate-100"
                    }`;

                    const slotBody = (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{formatSlotTimeRange(slot)}</span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                            {mentorshipCallLabel(slot.mode, slot.call_provider)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <p className="text-slate-500">
                            Capacity {slot.booked_count}/{slot.max_bookings}
                            {slot.title ? ` | ${slot.title}` : ""}
                          </p>
                          {onSelectSlot ? (
                            <span className={`font-semibold ${slotAvailable ? "text-emerald-700" : "text-slate-500"}`}>
                              {slotLabel}
                            </span>
                          ) : null}
                        </div>
                      </>
                    );

                    if (!onSelectSlot) {
                      return (
                        <div key={slot.id} className={slotClassName}>
                          {slotBody}
                        </div>
                      );
                    }

                    return (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={!slotAvailable || bookingInProgress}
                        onClick={() => {
                          onSelectDate?.(day.dateKey, slotIds);
                          onSelectSlot(slot, day.dateKey);
                        }}
                        className={`${slotClassName} transition disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {slotBody}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">No active mentorship timings published for this date.</p>
              )}

              {onDeactivateDate && slotIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onDeactivateDate(day.dateKey, slotIds)}
                  disabled={deactivatingDateKey === day.dateKey}
                  className="mt-3 rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                >
                  {deactivatingDateKey === day.dateKey ? "Marking..." : "Mark Day Unavailable"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>

      {slots.length === 0 ? <p className="text-sm text-slate-500">{emptyLabel}</p> : null}
    </section>
  );
}
