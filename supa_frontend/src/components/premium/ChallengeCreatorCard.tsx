"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { isSeriesOperatorLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import type { ChallengeLinkResponse } from "@/types/premium";

interface ChallengeCreatorCardProps {
  collectionId: string | number;
  collectionTitle?: string;
}

function toError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  return "Unknown error";
}

export default function ChallengeCreatorCard({ collectionId, collectionTitle }: ChallengeCreatorCardProps) {
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [latestChallenge, setLatestChallenge] = useState<ChallengeLinkResponse | null>(null);
  const hideForOperatorRole = isSeriesOperatorLike(user);

  const shareUrl = useMemo(() => {
    if (!latestChallenge) return "";
    if (latestChallenge.share_url) return latestChallenge.share_url;
    if (latestChallenge.share_path && typeof window !== "undefined") {
      return `${window.location.origin}${latestChallenge.share_path}`;
    }
    return "";
  }, [latestChallenge]);

  if (hideForOperatorRole) {
    return null;
  }

  const createChallenge = async () => {
    setIsCreating(true);
    try {
      const payload = {
        title: collectionTitle ? `${collectionTitle} Challenge` : "Test Challenge",
        expires_in_hours: 72,
        allow_anonymous: true,
        require_login: false,
        max_attempts_per_participant: 3,
      };
      const response = await premiumApi.post<ChallengeLinkResponse>(`/collections/${collectionId}/challenges`, payload);
      setLatestChallenge(response.data);
      toast.success("Challenge link created");
    } catch (error: unknown) {
      toast.error("Failed to create challenge link", { description: toError(error) });
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Challenge link copied");
    } catch {
      toast.error("Failed to copy challenge link");
    }
  };

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Challenge Mode</p>
      <h3 className="mt-1 text-lg font-semibold text-slate-900">Turn This Test Into a Public Challenge</h3>
      <p className="mt-1 text-sm text-slate-600">
        This creates the live public challenge link and prepares the test for public attempts.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={createChallenge}
          disabled={isCreating}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isCreating ? "Creating..." : "Create Public Challenge"}
        </button>
        {shareUrl ? (
          <>
            <button
              onClick={copyLink}
              className="rounded border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700"
            >
              Copy Link
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Open Challenge
            </a>
          </>
        ) : null}
      </div>

      {shareUrl ? (
        <p className="mt-3 break-all rounded border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-700">{shareUrl}</p>
      ) : null}
    </section>
  );
}
