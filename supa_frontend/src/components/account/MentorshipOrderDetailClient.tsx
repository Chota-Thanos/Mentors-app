"use client";

import axios from "axios";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import WorkflowProgressTrack from "@/components/premium/WorkflowProgressTrack";
import RichTextContent from "@/components/ui/RichTextContent";
import { loadLearnerMentorshipOrders, type LearnerMentorshipOrdersData } from "@/lib/learnerMentorshipOrders";
import {
  buildMentorshipWorkflowSteps,
  formatWorkflowDateTime,
  mentorshipCurrentStatusLabel,
  mentorshipKindLabel,
  mentorshipNextActionLabel,
} from "@/lib/mentorshipOrderFlow";
import { offeredSlotsForRequest, requestOfferedSlotIds } from "@/lib/copyEvaluationFlow";
import { premiumApi } from "@/lib/premiumApi";
import { loadRazorpayCheckout, type RazorpaySuccessResponse } from "@/lib/razorpayCheckout";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import type { MentorshipMessage, MentorshipPaymentOrder, MentorshipSlot } from "@/types/premium";

interface MentorshipOrderDetailClientProps {
  requestId: number;
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function isFutureSlot(slot: MentorshipSlot): boolean {
  return Boolean(slot.is_active) && new Date(slot.ends_at).getTime() > Date.now() && (slot.booked_count || 0) < (slot.max_bookings || 1);
}

function mergeMentorshipMessages(current: MentorshipMessage[], incoming: MentorshipMessage): MentorshipMessage[] {
  const next = [...current];
  const index = next.findIndex((message) => message.id === incoming.id);
  if (index >= 0) {
    next[index] = incoming;
  } else {
    next.push(incoming);
  }
  next.sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  return next;
}

function maybeShowIncomingCallNotification(title: string, body: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Ignore browser notification failures.
  }
}

function isSafeReturnUrl(value: string | null): value is string {
  if (!value) return false;
  const normalized = value.trim();
  return normalized.startsWith("mentorsappmobile://");
}

export default function MentorshipOrderDetailClient({ requestId }: MentorshipOrderDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(true);
  const [data, setData] = useState<LearnerMentorshipOrdersData | null>(null);
  const [messages, setMessages] = useState<MentorshipMessage[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [slotBusyId, setSlotBusyId] = useState<number | null>(null);
  const [requestActionBusy, setRequestActionBusy] = useState<"cancel" | "delete" | null>(null);
  const [providerSlots, setProviderSlots] = useState<MentorshipSlot[]>([]);
  const [hadUnreadUpdate, setHadUnreadUpdate] = useState(false);
  const autoPayAttemptedRef = useRef(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await loadLearnerMentorshipOrders();
      setData(response);
      const request = (response.requests || []).find((row) => row.id === requestId) || null;
      if (request) {
        const [messageResponse, slotsResponse] = await Promise.all([
          premiumApi.get<MentorshipMessage[]>(`/mentorship/requests/${requestId}/messages`),
          premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
            params: { provider_user_id: request.provider_user_id, only_available: false },
          }),
        ]);
        const nextMessages = Array.isArray(messageResponse.data) ? messageResponse.data : [];
        const unreadMentorCount = nextMessages.filter(
          (message) => !message.is_read && message.sender_user_id !== request.user_id,
        ).length;
        setHadUnreadUpdate(unreadMentorCount > 0);
        setMessages(nextMessages);
        setProviderSlots(Array.isArray(slotsResponse.data) ? slotsResponse.data : []);
        if (unreadMentorCount > 0) {
          premiumApi.post(`/mentorship/requests/${requestId}/messages/read`).catch(() => undefined);
        }
      } else {
        setMessages([]);
        setProviderSlots([]);
        setHadUnreadUpdate(false);
      }
    } catch (error: unknown) {
      setData(null);
      setMessages([]);
      setProviderSlots([]);
      toast.error("Failed to load mentorship request", { description: toError(error) });
    } finally {
      setBusy(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!requestId) return;
    const currentRequest = (data?.requests || []).find((row) => row.id === requestId) || null;
    if (!currentRequest) return;
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`mentorship-request-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mentorship_messages",
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => {
          const row = payload.new as MentorshipMessage | undefined;
          if (!row?.id) return;
          setMessages((current) => mergeMentorshipMessages(current, row));
          if (row.sender_user_id !== currentRequest.user_id && row.sender_user_id !== "system") {
            setHadUnreadUpdate(true);
            void premiumApi.post(`/mentorship/requests/${requestId}/messages/read`).catch(() => undefined);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mentorship_sessions",
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => {
          const row = payload.new as { id?: number; status?: string; join_available?: boolean } | undefined;
          const becameJoinable = Boolean(row?.id && row.join_available && (row.status === "scheduled" || row.status === "live"));
          void load();
          if (becameJoinable) {
            toast.success("Mentor started the call", {
              description: "The live mentorship room is ready to join now.",
            });
            maybeShowIncomingCallNotification("Mentorship call is ready", "Your mentor has started the live session. Join now.");
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data?.requests, load, requestId]);

  const sessionByRequestId = useMemo(() => {
    const map: Record<string, LearnerMentorshipOrdersData["sessions"][number]> = {};
    for (const session of data?.sessions || []) {
      const key = String(session.request_id);
      const existing = map[key];
      if (!existing || (existing.status !== "live" && session.status === "live")) {
        map[key] = session;
      }
    }
    return map;
  }, [data]);

  const cycleByRequestId = useMemo(() => {
    const map: Record<string, LearnerMentorshipOrdersData["tracking"]["mentorship_cycles"][number]> = {};
    for (const cycle of data?.tracking.mentorship_cycles || []) {
      map[String(cycle.request_id)] = cycle;
    }
    return map;
  }, [data]);

  if (busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading mentorship request...</div>;
  }

  const request = (data?.requests || []).find((row) => row.id === requestId) || null;
  if (!request) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-slate-900">Mentorship request not found</h1>
        <p className="mt-2 text-sm text-slate-600">This request is not present in your current learner workspace.</p>
        <Link href="/my-purchases" className="mt-4 inline-flex rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          Back to My Purchases
        </Link>
      </div>
    );
  }

  const session = sessionByRequestId[String(request.id)] || null;
  const submission = request.submission_id ? data?.submissionsById[String(request.submission_id)] || null : null;
  const series = request.series_id ? data?.seriesById[String(request.series_id)] || null : null;
  const cycle = cycleByRequestId[String(request.id)] || null;
  const mentorName = data?.mentorNameByUserId[request.provider_user_id] || request.provider_user_id;
  const offeredSlotCount = Math.max(requestOfferedSlotIds(request).length, request.booking_open ? 1 : 0, cycle?.booking_open ? 1 : 0);
  const currentStatus = mentorshipCurrentStatusLabel(request, session, submission, offeredSlotCount);
  const nextAction = mentorshipNextActionLabel(request, session, submission, offeredSlotCount);
  const steps = buildMentorshipWorkflowSteps({ request, session, submission, offeredSlotCount });
  const canJoinCallNow = Boolean(session?.join_available && (session.status === "scheduled" || session.status === "live"));
  const offeredSlots = offeredSlotsForRequest(request, providerSlots).filter(isFutureSlot);
  const bookableSlots = (offeredSlots.length > 0 ? offeredSlots : providerSlots.filter(isFutureSlot)).slice(0, 10);
  const canCancelRequest = !["cancelled", "rejected", "expired", "completed"].includes(request.status) && session?.status !== "live";
  const canDeleteRequest = ["cancelled", "rejected", "expired", "completed"].includes(request.status) && session?.status !== "live";
  const autoPayRequested = searchParams.get("autopay") === "1";
  const returnToUrl = searchParams.get("return_to");

  const handleSendMessage = async () => {
    if (!messageBody.trim()) return;
    setChatBusy(true);
    try {
      const response = await premiumApi.post<MentorshipMessage>(`/mentorship/requests/${request.id}/messages`, { body: messageBody.trim() });
      setMessages((current) => mergeMentorshipMessages(current, response.data));
      setMessageBody("");
    } catch (error: unknown) {
      toast.error("Failed to send message", { description: toError(error) });
    } finally {
      setChatBusy(false);
    }
  };

  const handlePaymentVerified = useCallback(async (response: RazorpaySuccessResponse) => {
    await premiumApi.post(`/mentorship/requests/${request.id}/payment/verify`, {
      ...response,
      payment_method: "razorpay",
    });
    toast.success("Payment completed successfully");
    await load();
    if (typeof window !== "undefined" && isSafeReturnUrl(returnToUrl)) {
      window.setTimeout(() => {
        window.location.assign(returnToUrl);
      }, 900);
    }
  }, [load, request.id, returnToUrl]);

  const handlePay = useCallback(async () => {
    setPaymentBusy(true);
    try {
      if (request.payment_amount <= 0) {
        await premiumApi.post(`/mentorship/requests/${request.id}/pay`, { payment_method: "complimentary" });
        toast.success("Payment completed successfully");
        await load();
        return;
      }

      const orderResponse = await premiumApi.post<MentorshipPaymentOrder>(
        `/mentorship/requests/${request.id}/payment/order`,
        { payment_method: "razorpay" },
      );
      const order = orderResponse.data;
      await loadRazorpayCheckout();
      if (!window.Razorpay) {
        throw new Error("Razorpay checkout is unavailable.");
      }

      const checkout = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        order_id: order.order_id,
        prefill: order.prefill,
        notes: order.notes,
        theme: { color: "#0f172a" },
        modal: {
          ondismiss: () => {
            setPaymentBusy(false);
          },
        },
        handler: (response) => {
          void handlePaymentVerified(response).finally(() => {
            setPaymentBusy(false);
          });
        },
      });
      checkout.on("payment.failed", (response) => {
        const reason = response.error?.description || response.error?.reason || "Payment was not completed.";
        toast.error("Payment failed", { description: reason });
        setPaymentBusy(false);
      });
      checkout.open();
    } catch (error: unknown) {
      toast.error("Failed to complete payment", { description: toError(error) });
      setPaymentBusy(false);
    }
  }, [handlePaymentVerified, load, request.id, request.payment_amount]);

  useEffect(() => {
    if (!autoPayRequested || autoPayAttemptedRef.current || paymentBusy) return;
    if (request.status !== "accepted" || request.payment_status === "paid") return;
    autoPayAttemptedRef.current = true;
    void handlePay();
  }, [autoPayRequested, handlePay, paymentBusy, request.payment_status, request.status]);

  const handleBookSlot = async (slotId: number) => {
    setSlotBusyId(slotId);
    try {
      await premiumApi.post(`/mentorship/requests/${request.id}/accept-slot`, { slot_id: slotId });
      toast.success("Session booked");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to book slot", { description: toError(error) });
    } finally {
      setSlotBusyId(null);
    }
  };

  const handleCancelRequest = async () => {
    if (!canCancelRequest) return;
    if (typeof window !== "undefined" && !window.confirm("Cancel this mentorship request?")) return;
    setRequestActionBusy("cancel");
    try {
      await premiumApi.put(`/mentorship/requests/${request.id}/status`, { status: "cancelled" });
      toast.success("Mentorship request cancelled");
      await load();
    } catch (error: unknown) {
      toast.error("Failed to cancel request", { description: toError(error) });
    } finally {
      setRequestActionBusy(null);
    }
  };

  const handleDeleteRequest = async () => {
    if (!canDeleteRequest) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this mentorship request from your workspace?")) return;
    setRequestActionBusy("delete");
    try {
      await premiumApi.delete(`/mentorship/requests/${request.id}`);
      toast.success("Mentorship request deleted");
      router.push("/dashboard/requests");
      router.refresh();
    } catch (error: unknown) {
      toast.error("Failed to delete request", { description: toError(error) });
    } finally {
      setRequestActionBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Request #{request.id}</h1>
            <p className="mt-2 text-sm text-slate-600">{mentorshipKindLabel(request, submission)}</p>
          </div>
          <div className="text-sm lg:text-right">
            <p className="font-semibold text-slate-900">{currentStatus}</p>
            <p className="text-slate-600">{nextAction}</p>
          </div>
        </div>
        <div className="mt-4">
          <WorkflowProgressTrack steps={steps} />
        </div>
        {hadUnreadUpdate ? (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
            Your mentor sent a new update on this request. Review the latest chat message below.
          </div>
        ) : null}
        {canJoinCallNow ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-900">{session?.status === "live" ? "Your mentor is calling now." : "Your mentorship room is ready."}</p>
              <p className="mt-1 text-sm text-emerald-800">Join the call directly from this request page.</p>
            </div>
            <Link
              href={`/mentorship/session/${session!.id}?autojoin=1`}
              className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
            >
              {session?.status === "live" ? "Join live call" : "Join call"}
            </Link>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Request summary</h2>
            <p className="mt-1 text-sm text-slate-500">Keep this page open for payment, slot booking, and mentor replies.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Mentor</p>
                <p className="mt-2 font-semibold text-slate-900">{mentorName}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Requested</p>
                <p className="mt-2 font-semibold text-slate-900">{formatWorkflowDateTime(request.requested_at)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Series</p>
                <p className="mt-2 font-semibold text-slate-900">{series?.title || "Direct mentor request"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Mode / timing</p>
                <p className="mt-2 font-semibold text-slate-900">{request.preferred_mode}{request.preferred_timing ? ` | ${request.preferred_timing}` : ""}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Problem statement</p>
              <div className="mt-2 text-sm text-slate-700">
                <RichTextContent value={request.note || "No problem statement attached."} className="[&_p]:my-1 whitespace-pre-wrap" />
              </div>
            </div>
            {canCancelRequest || canDeleteRequest ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {canCancelRequest ? (
                  <button
                    type="button"
                    onClick={() => void handleCancelRequest()}
                    disabled={requestActionBusy !== null}
                    className="inline-flex rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-60"
                  >
                    {requestActionBusy === "cancel" ? "Cancelling..." : "Cancel Request"}
                  </button>
                ) : null}
                {canDeleteRequest ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteRequest()}
                    disabled={requestActionBusy !== null}
                    className="inline-flex rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60"
                  >
                    {requestActionBusy === "delete" ? "Deleting..." : "Delete Request"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {submission ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-slate-900">Evaluation package</h2>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p>Status: <span className="font-semibold text-slate-900">{submission.status}</span></p>
                {submission.provider_eta_text || submission.provider_eta_hours ? (
                  <p className="mt-2">
                    ETA: <span className="font-semibold text-slate-900">{submission.provider_eta_text || `${submission.provider_eta_hours} hour(s)`}</span>
                  </p>
                ) : null}
                {submission.total_marks !== null && submission.total_marks !== undefined ? (
                  <p className="mt-2">Marks: <span className="font-semibold text-slate-900">{submission.total_marks}</span></p>
                ) : null}
                {submission.provider_note ? (
                  <div className="mt-3">
                    <p className="font-semibold text-slate-900">Mentor note</p>
                    <div className="mt-1">
                      <RichTextContent value={submission.provider_note} className="[&_p]:my-1" />
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {submission.answer_pdf_url ? (
                    <a href={submission.answer_pdf_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                      Answer PDF
                    </a>
                  ) : null}
                  {submission.checked_copy_pdf_url ? (
                    <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      Checked Copy
                    </a>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

            {request.booking_open && !session ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Select a slot</h2>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                {bookableSlots.length ? bookableSlots.map((slot) => (
                  <div key={slot.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="font-semibold text-slate-900">{formatWorkflowDateTime(slot.starts_at)}</p>
                    <p className="mt-1 text-sm text-slate-600">{formatWorkflowDateTime(slot.ends_at)}</p>
                    <button
                      type="button"
                      onClick={() => void handleBookSlot(slot.id)}
                      disabled={slotBusyId !== null}
                      className="mt-3 inline-flex rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {slotBusyId === slot.id ? "Booking..." : "Confirm slot"}
                    </button>
                  </div>
                )) : <p className="text-sm text-slate-500">No slot is available right now. Stay in chat with the mentor for the next update.</p>}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Chat with mentor</h2>
                </div>
              </div>
            <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {messages.length ? messages.map((message) => {
                const isSystem = message.sender_user_id === "system";
                const isUser = message.sender_user_id === request.user_id;
                return (
                  <div key={`${message.id}-${message.created_at}`} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    isSystem
                      ? "mx-auto border border-amber-200 bg-amber-50 text-amber-900"
                      : isUser
                        ? "ml-auto bg-slate-900 text-white"
                        : "mr-auto border border-slate-200 bg-white text-slate-700"
                  }`}>
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    <p className={`mt-2 text-[11px] ${isUser ? "text-slate-300" : "text-slate-500"}`}>{formatWorkflowDateTime(message.created_at)}</p>
                  </div>
                );
              }) : <p className="text-sm text-slate-500">No messages yet.</p>}
            </div>
            <div className="mt-4 flex gap-3">
              <textarea
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                className="min-h-[110px] flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700 outline-none focus:border-slate-400"
                placeholder="Write a message to the mentor"
              />
              <button type="button" onClick={() => void handleSendMessage()} disabled={chatBusy} className="h-fit rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {chatBusy ? "Sending..." : "Send"}
              </button>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Payment</h2>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p>Service: <span className="font-semibold text-slate-900">{mentorshipKindLabel(request, submission)}</span></p>
              <p className="mt-2">Status: <span className="font-semibold text-slate-900">{request.payment_status.replaceAll("_", " ")}</span></p>
              <p className="mt-2">Amount: <span className="font-semibold text-slate-900">{request.payment_currency} {request.payment_amount.toLocaleString()}</span></p>
            </div>
            {request.status === "accepted" && request.payment_status !== "paid" ? (
              <button type="button" onClick={() => void handlePay()} disabled={paymentBusy} className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {paymentBusy ? "Processing..." : "Pay now"}
              </button>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Session</h2>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p>Status: <span className="font-semibold text-slate-900">{currentStatus}</span></p>
              <p className="mt-2">Next action: <span className="font-semibold text-slate-900">{nextAction}</span></p>
              <p className="mt-2">Scheduled for: <span className="font-semibold text-slate-900">{formatWorkflowDateTime(session?.starts_at || cycle?.scheduled_for)}</span></p>
            </div>
            {session?.join_available ? (
              <Link href={`/mentorship/session/${session.id}?autojoin=1`} className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                {session.status === "live" ? "Join live call" : "Join call"}
              </Link>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Timeline</h2>
            <div className="mt-4 space-y-3">
              {(cycle?.timeline || []).map((item, index) => (
                <div key={`${item.key}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">{item.label}</p>
                  {item.at ? <p className="mt-1 text-xs text-slate-500">{formatWorkflowDateTime(item.at)}</p> : null}
                  {item.detail ? <p className="mt-1 text-sm text-slate-600">{item.detail}</p> : null}
                </div>
              ))}
              {(!cycle || cycle.timeline.length === 0) ? <p className="text-sm text-slate-500">No timeline events recorded yet.</p> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
