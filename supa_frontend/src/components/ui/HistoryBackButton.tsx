"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface HistoryBackButtonProps {
  fallbackHref: string;
  label: string;
  className?: string;
  iconClassName?: string;
}

type BrowserHistoryState = {
  idx?: number;
};

const canUseBrowserBack = (): boolean => {
  if (typeof window === "undefined") return false;
  const state = (window.history.state || {}) as BrowserHistoryState;
  return typeof state.idx === "number" && state.idx > 0;
};

export default function HistoryBackButton({
  fallbackHref,
  label,
  className,
  iconClassName,
}: HistoryBackButtonProps) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (canUseBrowserBack()) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [fallbackHref, router]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className || "app-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"}
    >
      <ArrowLeft className={iconClassName || "h-4 w-4"} />
      {label}
    </button>
  );
}
