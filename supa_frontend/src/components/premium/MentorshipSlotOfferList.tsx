"use client";

import { Loader2 } from "lucide-react";

import { formatSlotTimeRange, mentorshipCallLabel } from "@/lib/mentorAvailability";
import type { MentorshipSlot } from "@/types/premium";

interface MentorshipSlotOfferListProps {
  slots: MentorshipSlot[];
  acceptingSlotId?: number | null;
  onAccept?: (slotId: number) => void;
}

export default function MentorshipSlotOfferList({
  slots,
  acceptingSlotId = null,
  onAccept,
}: MentorshipSlotOfferListProps) {
  if (slots.length === 0) {
    return <p className="text-xs text-slate-500">No mentor slot options are available yet.</p>;
  }

  return (
    <div className="space-y-2">
      {slots.map((slot) => (
        <div key={slot.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{formatSlotTimeRange(slot)}</p>
              <p className="mt-1 text-slate-600">
                {mentorshipCallLabel(slot.mode, slot.call_provider)} | Capacity {slot.booked_count}/{slot.max_bookings}
              </p>
              {slot.title ? <p className="mt-1 text-slate-500">{slot.title}</p> : null}
            </div>
            {onAccept ? (
              <button
                type="button"
                onClick={() => onAccept(slot.id)}
                disabled={acceptingSlotId !== null}
                className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 disabled:opacity-60"
              >
                {acceptingSlotId === slot.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {acceptingSlotId === slot.id ? "Accepting..." : "Accept This Slot"}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
