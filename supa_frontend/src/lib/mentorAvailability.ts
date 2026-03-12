import type {
  MentorshipCallProvider,
  MentorshipMode,
  MentorshipSlot,
  MentorshipSlotBatchCreatePayload,
  MentorshipSlotCreatePayload,
} from "@/types/premium";

export interface MentorAvailabilityDay {
  dateKey: string;
  date: Date;
  slots: MentorshipSlot[];
  availableSlots: number;
  totalCapacity: number;
  bookedCount: number;
}

export interface MentorAvailabilityBatchInput {
  startDate: string;
  endDate: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  mode: MentorshipMode;
  callProvider: MentorshipCallProvider;
  title?: string;
  description?: string;
  meetingLink?: string;
}

export const MENTORSHIP_SLOT_DURATION_MINUTES = 20;

const pad = (value: number): string => String(value).padStart(2, "0");

export const sortSlotsByStart = <T extends MentorshipSlot>(slots: T[]): T[] =>
  [...slots].sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());

export const toLocalDateKey = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const parseDateKey = (dateKey: string): Date => new Date(`${dateKey}T00:00:00`);

export const buildUpcomingDateKeys = (days: number, startDate?: Date): string[] => {
  const anchor = startDate ? new Date(startDate) : new Date();
  const values: string[] = [];
  for (let index = 0; index < days; index += 1) {
    const next = new Date(anchor);
    next.setHours(0, 0, 0, 0);
    next.setDate(anchor.getDate() + index);
    values.push(toLocalDateKey(next));
  }
  return values;
};

export const slotIdsForDate = (slots: MentorshipSlot[], dateKey: string): number[] =>
  slots
    .filter((slot) => toLocalDateKey(slot.starts_at) === dateKey)
    .map((slot) => slot.id);

export const buildAvailabilityDays = <T extends MentorshipSlot>(
  slots: T[],
  days: number,
  startDate?: Date,
): Array<Omit<MentorAvailabilityDay, "slots"> & { slots: T[] }> => {
  const sortedSlots = sortSlotsByStart(slots);
  const slotsByDate = new Map<string, T[]>();
  for (const slot of sortedSlots) {
    const dateKey = toLocalDateKey(slot.starts_at);
    const current = slotsByDate.get(dateKey) || [];
    current.push(slot);
    slotsByDate.set(dateKey, current);
  }

  return buildUpcomingDateKeys(days, startDate).map((dateKey) => {
    const dateSlots = slotsByDate.get(dateKey) || [];
    const totalCapacity = dateSlots.reduce((sum, slot) => sum + Math.max(slot.max_bookings || 1, 0), 0);
    const bookedCount = dateSlots.reduce((sum, slot) => sum + Math.max(slot.booked_count || 0, 0), 0);
    const availableSlots = dateSlots.filter((slot) => (slot.booked_count || 0) < (slot.max_bookings || 1)).length;
    return {
      dateKey,
      date: parseDateKey(dateKey),
      slots: dateSlots,
      availableSlots,
      totalCapacity,
      bookedCount,
    };
  });
};

export const formatSlotTimeRange = (slot: MentorshipSlot): string => {
  const startsAt = new Date(slot.starts_at);
  const endsAt = new Date(slot.ends_at);
  return `${startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${endsAt.toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit" },
  )}`;
};

export const mentorshipModeLabel = (mode: MentorshipMode): string =>
  mode === "audio" ? "Audio" : "Video";

export const mentorshipCallProviderLabel = (callProvider: MentorshipCallProvider): string =>
  callProvider === "zoom" ? "Zoom" : "Custom Link";

export const mentorshipCallLabel = (
  mode: MentorshipMode,
  callProvider: MentorshipCallProvider,
): string => `${mentorshipCallProviderLabel(callProvider)} ${mentorshipModeLabel(mode)}`;

export const buildDateRange = (startDate: string, endDate: string): string[] => {
  if (!startDate || !endDate) return [];
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const values: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    values.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
};

export const buildSlotBatchPayload = (input: MentorAvailabilityBatchInput): MentorshipSlotBatchCreatePayload => {
  const allowedWeekdays = new Set(input.weekdays);
  const slots: MentorshipSlotCreatePayload[] = [];
  for (const dateKey of buildDateRange(input.startDate, input.endDate)) {
    const date = parseDateKey(dateKey);
    if (allowedWeekdays.size > 0 && !allowedWeekdays.has(date.getDay())) {
      continue;
    }

    const startsAt = new Date(`${dateKey}T${input.startTime}`);
    const endsAt = new Date(`${dateKey}T${input.endTime}`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      continue;
    }

    const cursor = new Date(startsAt);
    while (cursor.getTime() + MENTORSHIP_SLOT_DURATION_MINUTES * 60 * 1000 <= endsAt.getTime()) {
      const slotEnd = new Date(cursor.getTime() + MENTORSHIP_SLOT_DURATION_MINUTES * 60 * 1000);
      slots.push({
        starts_at: cursor.toISOString(),
        ends_at: slotEnd.toISOString(),
        mode: input.mode,
        call_provider: input.callProvider,
        max_bookings: 1,
        title: input.title?.trim() || null,
        description: input.description?.trim() || null,
        meeting_link: input.meetingLink?.trim() || null,
        is_active: true,
      });
      cursor.setTime(slotEnd.getTime());
    }
  }
  return { slots };
};
