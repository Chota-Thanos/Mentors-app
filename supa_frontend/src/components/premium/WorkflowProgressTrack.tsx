"use client";

import type { WorkflowStep } from "@/lib/mentorshipOrderFlow";
import { formatWorkflowDateTime } from "@/lib/mentorshipOrderFlow";

interface WorkflowProgressTrackProps {
  steps: WorkflowStep[];
}

const stepTone = (state: WorkflowStep["state"]): string => {
  if (state === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (state === "current") return "border-sky-200 bg-sky-50 text-sky-900";
  return "border-slate-200 bg-slate-50 text-slate-600";
};

export default function WorkflowProgressTrack({ steps }: WorkflowProgressTrackProps) {
  return (
    <div className="grid gap-3 md:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step.key} className="relative">
          {index < steps.length - 1 ? <div className="absolute left-8 top-8 hidden h-px w-[calc(100%-1rem)] bg-slate-200 md:block" /> : null}
          <div className={`relative h-full rounded-2xl border p-3 ${stepTone(step.state)}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-current text-[11px] font-bold">
                {index + 1}
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.18em]">{step.label}</p>
            </div>
            <p className="mt-3 text-sm font-semibold">
              {step.state === "completed" ? "Completed" : step.state === "current" ? "Current" : "Pending"}
            </p>
            {step.at ? <p className="mt-1 text-xs opacity-80">{formatWorkflowDateTime(step.at)}</p> : null}
            {step.detail ? <p className="mt-2 text-xs opacity-80">{step.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
