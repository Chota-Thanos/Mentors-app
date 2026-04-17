"use client";

import { X, Check, ArrowRight, ArrowLeft } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import type { MentorshipServiceType } from "@/types/premium";

function toError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

interface MentorshipRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentorId: string;
  mentorName: string;
  copyEvaluationEnabled: boolean;
  mentorshipPriceLabel: string;
  reviewBundlePriceLabel: string;
  seriesId?: number | null;
}

export default function MentorshipRequestModal({
  open,
  onOpenChange,
  mentorId,
  mentorName,
  copyEvaluationEnabled,
  mentorshipPriceLabel,
  reviewBundlePriceLabel,
  seriesId,
}: MentorshipRequestModalProps) {
  const router = useRouter();
  const { isAuthenticated, showLoginModal, user } = useAuth();
  
  const [step, setStep] = useState<1 | 2>(1);
  const [serviceType, setServiceType] = useState<MentorshipServiceType>("mentorship_only");
  const [problemStatement, setProblemStatement] = useState("");
  const [copyPdfUrl, setCopyPdfUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { profileId } = useProfile();

  const handleNext = () => {
    if (step === 1) setStep(2);
  };

  const handleBack = () => {
    if (step === 2) setStep(1);
  };

  const submitRequest = async () => {
    if (!isAuthenticated || !user || !profileId) {
      onOpenChange(false);
      showLoginModal();
      return;
    }
    if (!problemStatement.trim()) {
      toast.error("Please provide a little context or problem statement.");
      return;
    }
    if (serviceType === "copy_evaluation_and_mentorship" && !copyPdfUrl.trim()) {
      toast.error("Please provide a document URL for evaluation.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      let requestId: number | null = null;
      let submissionId: number | null = null;

      if (serviceType === "copy_evaluation_and_mentorship" && seriesId) {
        const { data: subData, error: subError } = await supabase
          .from("mains_test_copy_submissions")
          .insert({
            user_id: profileId,
            series_id: seriesId,
            answer_pdf_url: copyPdfUrl.trim(),
            status: "submitted",
            learner_note: problemStatement.trim(),
          })
          .select()
          .single();

        if (subError) throw subError;
        submissionId = subData.id;
      }

      const { data: reqData, error: reqError } = await supabase
        .from("mentorship_requests")
        .insert({
          user_id: profileId,
          mentor_id: parseInt(mentorId, 10),
          series_id: seriesId || null,
          preferred_mode: "video",
          note: [
            problemStatement.trim(),
            serviceType === "copy_evaluation_and_mentorship" && copyPdfUrl.trim()
              ? `Evaluation document: ${copyPdfUrl.trim()}`
              : "",
          ].filter(Boolean).join("\n\n"),
          status: "requested",
        })
        .select()
        .single();

      if (reqError) throw reqError;
      requestId = reqData.id;

      if (submissionId && seriesId) {
        await supabase.from("mains_program_mentorship_requests").insert({
          user_id: profileId,
          mentor_id: parseInt(mentorId, 10),
          series_id: seriesId,
          submission_id: submissionId,
          preferred_mode: "video",
          learner_note: problemStatement.trim(),
          status: "requested",
        });
      }

      if (!requestId) {
        throw new Error("Request created but failed to route.");
      }

      toast.success("Request sent!");
      onOpenChange(false);
      setTimeout(() => {
        setStep(1);
        setProblemStatement("");
        setCopyPdfUrl("");
      }, 300);
      router.push(`/my-purchases/mentorship/${requestId}`);
    } catch (error: unknown) {
      toast.error("Failed to send request", { description: toError(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[#0c0d10]/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-[100] w-full max-w-md translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-[2rem] bg-white text-left align-middle shadow-[0_24px_54px_rgba(0,0,0,0.1)] outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          
          <div className="flex items-center justify-between border-b border-[#edf1f4] px-6 py-5">
            <div className="flex flex-col">
              <Dialog.Title className="font-sans text-lg font-extrabold text-[#191c1e]">
                Contact {mentorName || "Mentor"}
              </Dialog.Title>
              <p className="text-[12px] font-semibold text-[#767683]">Step {step} of 2</p>
            </div>
            <Dialog.Close className="rounded-full bg-[#f2f4f6] p-2 text-[#454652] transition hover:bg-[#eef2f5] hover:text-[#191c1e]">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="relative min-h-[360px] overflow-hidden p-6">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <p className="text-sm font-semibold text-[#454652]">How would you like to proceed?</p>
                  
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setServiceType("mentorship_only")}
                      className={`w-full rounded-[1.2rem] p-4 text-left transition-all ${
                        serviceType === "mentorship_only"
                          ? "bg-[#eef0ff] ring-2 ring-[#000666]"
                          : "bg-[#f2f4f6] hover:bg-[#edf1f4]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${serviceType === "mentorship_only" ? "border-[#000666] bg-[#000666]" : "border-[#767683] bg-white"}`}>
                          {serviceType === "mentorship_only" && <Check className="h-3.5 w-3.5 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-[#191c1e]">Direct Mentorship</p>
                            <span className="text-[11px] font-bold text-[#000666]">{mentorshipPriceLabel}</span>
                          </div>
                          <p className="mt-1 text-xs text-[#767683]">Strategy session & guidance</p>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={!copyEvaluationEnabled}
                      onClick={() => setServiceType("copy_evaluation_and_mentorship")}
                      className={`w-full rounded-[1.2rem] p-4 text-left transition-all ${
                        serviceType === "copy_evaluation_and_mentorship"
                          ? "bg-[#eef0ff] ring-2 ring-[#000666]"
                          : "bg-[#f2f4f6] hover:bg-[#edf1f4]"
                      } ${!copyEvaluationEnabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${serviceType === "copy_evaluation_and_mentorship" ? "border-[#000666] bg-[#000666]" : "border-[#767683] bg-white"}`}>
                          {serviceType === "copy_evaluation_and_mentorship" && <Check className="h-3.5 w-3.5 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-[#191c1e]">Copy Evaluation + Call</p>
                            <span className="text-[11px] font-bold text-[#000666]">{reviewBundlePriceLabel}</span>
                          </div>
                          <p className="mt-1 text-xs text-[#767683]">Feedback first, call later</p>
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="pt-6">
                    <button
                      type="button"
                      onClick={handleNext}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#000666] to-[#1a237e] px-5 py-4 text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,6,102,0.14)]"
                    >
                      Continue to Details <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5"
                >
                  <label className="block space-y-2">
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#767683]">
                      What do you need help with?
                    </span>
                    <textarea
                      value={problemStatement}
                      onChange={(e) => setProblemStatement(e.target.value)}
                      placeholder="Start typing your problem statement or goals..."
                      className="h-28 w-full resize-none rounded-[1.2rem] bg-[#f2f4f6] px-4 py-3 text-sm text-[#191c1e] outline-none ring-2 ring-transparent transition focus:ring-[#000666]"
                    />
                  </label>

                  {serviceType === "copy_evaluation_and_mentorship" && (
                    <label className="block space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#767683]">
                        evaluation document URL
                      </span>
                      <input
                        type="url"
                        value={copyPdfUrl}
                        onChange={(e) => setCopyPdfUrl(e.target.value)}
                        placeholder="Paste document link here"
                        className="w-full rounded-[1.2rem] bg-[#f2f4f6] px-4 py-3 text-sm text-[#191c1e] outline-none ring-2 ring-transparent transition focus:ring-[#000666]"
                      />
                    </label>
                  )}

                  <div className="rounded-[1.2rem] bg-[#fff8e6] p-4">
                    <p className="text-xs leading-5 text-[#865d00]">
                      <strong>No payment is required right now.</strong> Sending this request starts an informal chat with the mentor to confirm availability and fit.
                    </p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleBack}
                      className="flex items-center justify-center rounded-xl bg-[#f2f4f6] px-4 py-3 text-[#454652] transition hover:bg-[#edf1f4]"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void submitRequest()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#000666] to-[#1a237e] px-5 py-4 text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,6,102,0.14)] disabled:opacity-60"
                    >
                      {submitting ? "Sending..." : "Send Request to Mentor"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
