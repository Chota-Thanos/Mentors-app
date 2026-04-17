"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, CalendarDays, ExternalLink, MessageSquare } from "lucide-react";
import type { MentorshipMessage, MentorshipRequest, MentorshipSession, MainsCopySubmission, MentorshipSlot } from "@/types/premium";

interface MentorshipChatViewProps {
  mode: "user" | "provider";
  request: MentorshipRequest;
  session: MentorshipSession | null;
  submission: MainsCopySubmission | null;
  messages: MentorshipMessage[];
  actionBusy: string | null;
  offerableSlots?: MentorshipSlot[];
  
  onSendMessage: (body: string) => Promise<void>;
  onMutateRequest?: (status: "accepted" | "rejected") => void;
  onStartSession?: () => void;
  onOfferSlots?: (slotIds: number[]) => void;
  
  // For Learner payment
  onPayClick?: () => void;
  onJoinSession?: (sessionId: number) => void;
}

function titleCaseLabel(value?: string | null): string {
  const normalized = String(value || "").trim().replaceAll("_", " ");
  if (!normalized) return "N/a";
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

export default function MentorshipChatView({
  mode,
  request,
  session,
  submission,
  messages,
  actionBusy,
  offerableSlots = [],
  onSendMessage,
  onMutateRequest,
  onStartSession,
  onOfferSlots,
  onPayClick,
  onJoinSession,
}: MentorshipChatViewProps) {
  const [messageBody, setMessageBody] = useState("");
  const [offerSlotIds, setOfferSlotIds] = useState<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isSending, setIsSending] = useState(false);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, request.id]);

  const handleSend = async () => {
    if (!messageBody.trim()) return;
    setIsSending(true);
    await onSendMessage(messageBody.trim());
    setMessageBody("");
    setIsSending(false);
  };

  const isProvider = mode === "provider";
  
  // Resolve Action blocks that behave like full-width system messages
  const renderStatusBlock = () => {
    // 1. New Request: Block for Mentor to accept/reject
    if (request.status === "requested") {
      if (isProvider) {
        return (
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
            <p className="font-semibold text-amber-900">New Request Pending Review</p>
            <p className="mt-1 text-[13px] text-amber-800">You can chat with the learner to confirm fit before deciding.</p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => onMutateRequest?.("rejected")}
                disabled={actionBusy !== null}
                className="rounded-full border border-rose-300 bg-white px-5 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60 hover:bg-rose-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => onMutateRequest?.("accepted")}
                disabled={actionBusy !== null}
                className="rounded-full bg-[#091a4a] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 hover:bg-[#1a237e]"
              >
                Accept Request
              </button>
            </div>
          </div>
        );
      } else {
        return (
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <p className="text-sm font-semibold text-slate-700">Awaiting Mentor Response</p>
            <p className="mt-1 text-[12px] text-slate-500">The mentor will review your problem statement shortly.</p>
          </div>
        );
      }
    }

    // 2. Accepted but not paid
    if (request.status === "accepted" && request.payment_status !== "paid" && request.payment_amount > 0) {
      if (!isProvider) {
        return (
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center shadow-sm">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <p className="mt-3 font-semibold text-emerald-900">Mentor has accepted!</p>
            <p className="mt-1 text-[13px] text-emerald-800">Please complete your payment to proceed to slot booking or evaluation.</p>
            <button
              type="button"
              onClick={onPayClick}
              disabled={actionBusy !== null}
              className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-[#091a4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Pay {request.payment_currency} {request.payment_amount.toLocaleString()}
            </button>
          </div>
        );
      } else {
        return (
          <div className="mx-auto w-full max-w-lg flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
             <Clock3 className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">Awaiting Learner Payment</p>
          </div>
        );
      }
    }

    // 3. Paid & Ready for session scheduling (If no active session yet)
    if (request.payment_status === "paid" && !session) {
      if (isProvider) {
        return (
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
            <p className="font-semibold text-indigo-900">Ready to Schedule</p>
            <p className="mt-1 text-[13px] text-indigo-800">The learner has paid. Offer slots below or start the session now if both are ready.</p>
            
            {offerableSlots.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] font-bold uppercase text-indigo-600">Select slots to offer:</p>
                <div className="max-h-[140px] overflow-y-auto rounded-xl border border-indigo-100 bg-white p-2">
                  {offerableSlots.map(slot => (
                    <label key={slot.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={offerSlotIds.includes(slot.id)}
                        onChange={(e) => setOfferSlotIds(curr => e.target.checked ? [...curr, slot.id] : curr.filter(id => id !== slot.id))}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm cursor-pointer">{new Date(slot.starts_at).toLocaleString()}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={offerSlotIds.length === 0 || actionBusy !== null}
                  onClick={() => onOfferSlots?.(offerSlotIds)}
                  className="mt-2 w-full rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Send Slots to Learner
                </button>
              </div>
            )}
            
            <div className="mt-4 flex gap-2 border-t border-indigo-200/50 pt-3">
               <button
                  type="button"
                  onClick={onStartSession}
                  disabled={actionBusy !== null}
                  className="w-full rounded-full border border-indigo-600 bg-transparent px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                >
                  Start Call Now
                </button>
            </div>
          </div>
        );
      } else {
        return (
           <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <p className="text-sm font-semibold text-slate-700">Payment Successful. Awaiting Slots.</p>
            <p className="mt-1 text-[12px] text-slate-500">The mentor will send you available slots shortly, or may start a sudden call.</p>
          </div>
        );
      }
    }

    // 4. Session Active / Scheduled
    if (session) {
      const isLive = session.status === "live";
      return (
        <div className="mx-auto w-full max-w-lg rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center shadow-sm">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <CalendarDays className="h-5 w-5" />
          </div>
          <p className="mt-3 font-semibold text-blue-900">Session Scheduled</p>
          <p className="mt-1 text-sm font-medium text-blue-800">{new Date(session.starts_at).toLocaleString()}</p>
          <p className="text-[12px] text-blue-600 mt-1">{titleCaseLabel(session.mode)} Call via {titleCaseLabel(session.call_provider)}</p>
          
          <button
              type="button"
              onClick={() => onJoinSession?.(session.id)}
              className={`mt-4 w-full rounded-full px-5 py-3 text-sm font-semibold text-white transition ${isLive ? 'bg-emerald-600 animate-pulse shadow-[0_0_15px_rgba(5,150,105,0.4)]' : 'bg-[#091a4a]'}`}
            >
              {isLive ? 'Join Live Session' : 'Enter Waiting Room'}
            </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col h-[500px] border border-slate-200 rounded-[24px] bg-white overflow-hidden shadow-[0_12px_28px_rgba(0,0,0,0.03)]">
      {/* Header */}
      <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
        <h3 className="font-sans text-lg font-bold text-slate-900">
          Chat Room
        </h3>
        <p className="text-[12px] text-slate-500">Keep questions and coordination here.</p>
      </div>

      {/* Messages Scroll Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/30">
        
        {/* Render Initial Request context if we are mentor */}
        {isProvider && request.note && (
             <div className="mx-auto w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative text-sm text-slate-600">
               <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Learner Problem Statement</p>
               <p className="whitespace-pre-wrap">{request.note}</p>
               {submission?.answer_pdf_url && (
                   <a href={submission.answer_pdf_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700">
                       <ExternalLink className="h-4 w-4"/> View Evaluation Document
                   </a>
               )}
            </div>
        )}

        {messages.map((message) => {
          const isSystem = message.sender_user_id === "system";
          const isMe = isProvider 
            ? message.sender_user_id === String(request.mentor_id)

            : message.sender_user_id === String(request.user_id);

          if (isSystem) {
             return (
               <div key={message.id} className="mx-auto my-2 max-w-[85%] rounded-2xl border border-sky-100 bg-sky-50 px-4 py-2 text-center text-xs text-sky-800">
                 {message.body}
               </div>
             )
          }

          return (
            <div key={message.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-[22px] px-5 py-3 text-[14px] leading-relaxed shadow-sm ${
                isMe 
                  ? "bg-[#091a4a] text-white rounded-tr-[6px]" 
                  : "border border-slate-200 bg-white text-slate-800 rounded-tl-[6px]"
              }`}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </div>
            </div>
          );
        })}
        
        {/* System action blocks effectively placed at the bottom bounds of chat */}
        {renderStatusBlock()}

      </div>

      {/* Input Area */}
      <div className="border-t border-slate-100 bg-white p-4">
        <div className="relative">
          <textarea
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            disabled={isSending}
            onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                }
            }}
            placeholder="Type your message..."
            className="w-full resize-none rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 pr-14 text-sm text-slate-900 outline-none transition focus:border-[#091a4a] focus:bg-white disabled:opacity-70"
            rows={2}
          />
          <button 
             type="button" 
             onClick={() => void handleSend()} 
             disabled={!messageBody.trim() || isSending}
             className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#091a4a] text-white transition hover:bg-[#1a237e] disabled:opacity-50"
          >
             <MessageSquare className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-400">Press Enter to send, Shift+Enter for new line.</p>
      </div>
    </div>
  );
}
