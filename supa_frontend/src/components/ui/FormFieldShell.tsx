"use client";

import type { ReactNode } from "react";

type FormFieldShellProps = {
  label: string;
  children: ReactNode;
  className?: string;
  helperText?: string;
};

export default function FormFieldShell({
  label,
  children,
  className = "",
  helperText,
}: FormFieldShellProps) {
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <label className="block text-sm font-semibold text-slate-900">{label}</label>
      {helperText ? <p className="text-xs leading-5 text-slate-500">{helperText}</p> : null}
      {children}
    </div>
  );
}
