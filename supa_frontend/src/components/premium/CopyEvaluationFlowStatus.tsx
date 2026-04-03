"use client";

import type { CopyFlowStep } from "@/lib/copyEvaluationFlow";

interface CopyEvaluationFlowStatusProps {
  steps: CopyFlowStep[];
}

export default function CopyEvaluationFlowStatus({ steps }: CopyEvaluationFlowStatusProps) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
      {steps.map((step) => {
        const done = step.status === "completed";
        const current = step.status === "current";
        return (
          <div
            key={step.key}
            className={`rounded-lg border px-3 py-2 text-xs ${
              done
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : current
                  ? "border-sky-200 bg-sky-50 text-sky-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            <p className="font-semibold">{step.label}</p>
            <p className="mt-1 text-[11px]">{done ? "Completed" : current ? "Current" : "Pending"}</p>
            {step.detail ? <p className="mt-1 text-[11px]">{step.detail}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
