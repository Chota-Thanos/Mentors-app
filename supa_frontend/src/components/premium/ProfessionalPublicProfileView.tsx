"use client";

import axios from "axios";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpenCheck,
  Check,
  Clock3,
  Layers3,
  School,
  Star,
  Trophy,
  Users2,
} from "lucide-react";

import RichTextContent from "@/components/ui/RichTextContent";
import MentorshipRequestModal from "./MentorshipRequestModal";
import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
import { toDisplayRoleLabel } from "@/lib/roleLabels";
import type {
  MentorshipMode,
  MentorshipRequest,
  MentorshipServiceType,
  ProfessionalProfileReview,
  ProfessionalPublicProfileDetail,
} from "@/types/premium";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function initialsFromLabel(label: string): string {
  const tokens = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return "MM";
  return tokens.map((token) => token.charAt(0).toUpperCase()).join("");
}

function formatReviewDate(value?: string | null): string {
  if (!value) return "Recent";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recent";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function cleanBio(value?: string | null, fallback = "Mentor bio will be updated soon."): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function profileMetaText(meta: Record<string, unknown> | null | undefined, key: string): string {
  const value = meta && typeof meta === "object" ? meta[key] : null;
  return typeof value === "string" ? value.trim() : "";
}

function activeRequestForMentor(requests: MentorshipRequest[], providerUserId: string): MentorshipRequest | null {
  return (
    requests
      .filter(
        (row) =>
          row.provider_user_id === providerUserId
          && ["requested", "accepted", "scheduled"].includes(String(row.status || "").trim().toLowerCase()),
      )
      .sort((left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime())[0] || null
  );
}

function currentLearnerLabel(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string {
  const metadata = user?.user_metadata || {};
  const namedKeys = ["full_name", "name", "display_name"] as const;
  for (const key of namedKeys) {
    const value = String(metadata[key] || "").trim();
    if (value) return value;
  }
  const firstName = String(metadata["first_name"] || "").trim();
  const lastName = String(metadata["last_name"] || "").trim();
  const combined = `${firstName} ${lastName}`.trim();
  if (combined) return combined;
  return "";
}

function RatingStars({ rating }: { rating: number }) {
  const total = 5;
  const safe = Math.max(0, Math.min(total, Math.round(rating)));
  return (
    <div className="flex items-center gap-1 text-[#c98c00]">
      {Array.from({ length: total }).map((_, index) => (
        <Star key={index} className={`h-4 w-4 ${index < safe ? "fill-current" : "text-[#c6c5d4]"}`} />
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: ProfessionalProfileReview }) {
  return (
    <article className="rounded-[1.4rem] bg-white p-5 shadow-[0_12px_28px_rgba(25,28,30,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef2f5] text-sm font-black text-[#000666]">
            {initialsFromLabel(review.reviewer_label)}
          </div>
          <div>
            <p className="text-sm font-bold text-[#191c1e]">{review.reviewer_label}</p>
            <p className="text-xs font-medium text-[#767683]">{formatReviewDate(review.created_at)}</p>
          </div>
        </div>
        <RatingStars rating={review.rating} />
      </div>
      {review.title ? <p className="mt-4 text-sm font-semibold text-[#191c1e]">{review.title}</p> : null}
      {review.comment ? <RichTextContent value={review.comment} className="mt-3 text-sm leading-7 text-[#454652]" /> : null}
    </article>
  );
}





export default function ProfessionalPublicProfileView({
  userId,
  seriesId,
}: {
  userId: string;
  seriesId?: number | null;
}) {
  const router = useRouter();
  const { isAuthenticated, showLoginModal, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ProfessionalPublicProfileDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [existingActiveRequest, setExistingActiveRequest] = useState<MentorshipRequest | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    premiumApi
      .get<ProfessionalPublicProfileDetail>(`/profiles/${userId}/detail`)
      .then((response) => {
        if (!active) return;
        setDetail(response.data || null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDetail(null);
        toast.error("Failed to load mentor profile", { description: toError(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const profile = detail?.profile || null;
  const ownProfile = profile ? String(user?.id || "").trim() === String(profile.user_id || "").trim() : false;
  const roleLabel = profile && detail ? detail.role_label || toDisplayRoleLabel(profile.role) : "";
  const preparationStrategy = profileMetaText(profile?.meta, "preparation_strategy");

  useEffect(() => {
    if (!isAuthenticated || ownProfile) {
      setExistingActiveRequest(null);
      return;
    }
    let active = true;
    premiumApi
      .get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "me" } })
      .then((response) => {
        if (!active) return;
        const requests = Array.isArray(response.data) ? response.data : [];
        setExistingActiveRequest(activeRequestForMentor(requests, userId));
      })
      .catch(() => {
        if (active) setExistingActiveRequest(null);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, ownProfile, userId]);

  const requestBlockedReason = useMemo(() => {
    if (!detail) return "Profile is unavailable.";
    if (existingActiveRequest) return "You already have an active request with this mentor. Open it to continue instead of sending another one.";
    if (detail.mentorship_availability_mode !== "series_only") return null;
    if (seriesId && (!detail.mentorship_available_series_ids.length || detail.mentorship_available_series_ids.includes(seriesId))) {
      return null;
    }
    return "This mentor accepts requests only from supported programs flows.";
  }, [detail, existingActiveRequest, seriesId]);



  const mentorshipPriceLabel = `${detail?.currency || "INR"} ${Number(detail?.mentorship_price || 0).toLocaleString()}`;
  const reviewBundlePriceLabel = `${detail?.currency || "INR"} ${Number(detail?.copy_evaluation_price || 0).toLocaleString()}`;

  const milestoneCards = useMemo(() => {
    if (!detail || !profile) return [];
    const achievementLead = detail.achievements[0] || detail.exam_focus || profile.headline || "Focused mentorship";
    const achievementSupport = detail.achievements[1] || detail.service_specifications[0] || "Structured guidance for mains writing and decision-making.";
    const serviceSupport = detail.copy_evaluation_enabled
      ? detail.copy_evaluation_note || "Evaluation can move into mentorship after feedback is ready."
      : detail.service_specifications[0] || "Mentorship stays request-first and slot selection happens later.";

    return [
      {
        key: "milestone-main",
        title: achievementLead,
        description: achievementSupport,
        icon: Trophy,
        className: "md:col-span-2 bg-[#8df5e4] text-[#00201c]",
        iconClass: "text-[#005048]",
      },
      {
        key: "response",
        title: detail.response_time_text || "Responsive mentor",
        description: `${detail.students_mentored || 0}+ students mentored`,
        icon: School,
        className: "bg-gradient-to-br from-[#000666] to-[#1a237e] text-white",
        iconClass: "text-[#bdc2ff]",
      },
      {
        key: "sessions",
        title: `${detail.sessions_completed || 0}+ sessions completed`,
        description: detail.service_specifications[0] || "Session flow opens after request review and payment.",
        icon: Layers3,
        className: "bg-[#eef2f5] text-[#191c1e]",
        iconClass: "text-[#000666]",
      },
      {
        key: "community",
        title: detail.achievements[2] || (detail.copy_evaluation_enabled ? "Copy review available" : "Mentorship focused"),
        description: serviceSupport,
        icon: Users2,
        className: "md:col-span-2 bg-[#ffdeac] text-[#281900]",
        iconClass: "text-[#604100]",
      },
    ];
  }, [detail, profile]);

  if (loading) {
    return <div className="rounded-[2rem] bg-white p-6 text-sm text-[#454652] shadow-[0_12px_32px_rgba(25,28,30,0.05)]">Loading mentor profile...</div>;
  }

  if (!detail || !profile) {
    return (
      <div className="rounded-[2rem] bg-white p-6 shadow-[0_12px_32px_rgba(25,28,30,0.05)]">
        <h1 className="font-sans text-2xl font-extrabold tracking-tight text-[#000666]">Mentor profile not found</h1>
        <p className="mt-2 text-sm text-[#454652]">Check the mentor link or return to the directory.</p>
        <Link href="/mentors" className="mt-5 inline-flex rounded-xl bg-[#000666] px-4 py-3 text-sm font-bold text-white">
          Back to mentors
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-8">
        <section className="overflow-hidden rounded-[2.2rem] bg-[#f8f9fb]">
          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="relative h-[260px] overflow-hidden rounded-[1.8rem] bg-[#edf1f4] lg:h-[320px] lg:w-[260px] lg:flex-shrink-0">
              {profile.profile_image_url ? (
                <Image
                  src={profile.profile_image_url}
                  alt={profile.display_name}
                  fill
                  unoptimized
                  sizes="320px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#e0e0ff] to-[#8df5e4] text-5xl font-black text-[#000666]">
                  {initialsFromLabel(profile.display_name)}
                </div>
              )}
              {profile.is_verified ? (
                <div className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full bg-[#8df5e4] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#00201c] shadow-[0_10px_18px_rgba(25,28,30,0.14)]">
                  <Check className="h-4 w-4" />
                  Verified
                </div>
              ) : null}
            </div>

            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#767683]">{roleLabel}</span>
                {detail.copy_evaluation_enabled ? (
                  <span className="rounded-full bg-[#eef2f5] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#454652]">
                    Evaluation + Mentorship
                  </span>
                ) : null}
              </div>

              <div>
                <h1 className="font-sans text-4xl font-extrabold tracking-tight text-[#000666]">{profile.display_name}</h1>
                <p className="mt-2 text-lg font-medium text-[#454652]">{profile.headline || "Mentor profile"}</p>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
                <span className="inline-flex items-center gap-2 text-[#c98c00]">
                  <RatingStars rating={detail.review_summary.average_rating} />
                  {detail.review_summary.average_rating.toFixed(1)}
                  <span className="text-[#767683]">({detail.review_summary.total_reviews} reviews)</span>
                </span>
                <span className="inline-flex items-center gap-2 text-[#454652]">
                  <Clock3 className="h-4 w-4 text-[#000666]" />
                  {detail.response_time_text || "Replies soon"}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {profile.specialization_tags.slice(0, 4).map((tag) => (
                  <span key={`${profile.user_id}-${tag}`} className="rounded-full bg-[#eef2f5] px-4 py-2 text-xs font-semibold text-[#000666]">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-[1.3rem] bg-white p-4 shadow-[0_10px_24px_rgba(25,28,30,0.05)]">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#767683]">Experience</p>
                  <p className="mt-2 text-sm font-bold text-[#191c1e]">{profile.years_experience || 0}+ years</p>
                </div>
                <div className="rounded-[1.3rem] bg-white p-4 shadow-[0_10px_24px_rgba(25,28,30,0.05)]">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#767683]">Students</p>
                  <p className="mt-2 text-sm font-bold text-[#191c1e]">{detail.students_mentored || 0}+</p>
                </div>
                <div className="rounded-[1.3rem] bg-white p-4 shadow-[0_10px_24px_rgba(25,28,30,0.05)]">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#767683]">Sessions</p>
                  <p className="mt-2 text-sm font-bold text-[#191c1e]">{detail.sessions_completed || 0}+</p>
                </div>
                <div className="rounded-[1.3rem] bg-white p-4 shadow-[0_10px_24px_rgba(25,28,30,0.05)]">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#767683]">Focus</p>
                  <p className="mt-2 text-sm font-bold text-[#191c1e]">{detail.exam_focus || "Mains"}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-5">
          <h2 className="font-sans text-2xl font-extrabold tracking-tight text-[#191c1e]">Professional Milestones</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {milestoneCards.map((card) => {
              const Icon = card.icon;
              return (
                <article key={card.key} className={`rounded-[1.5rem] p-6 shadow-[0_12px_28px_rgba(25,28,30,0.05)] ${card.className}`}>
                  <Icon className={`h-6 w-6 ${card.iconClass}`} />
                  <h3 className="mt-6 font-sans text-xl font-extrabold tracking-tight">{card.title}</h3>
                  <p className="mt-3 text-sm leading-7 opacity-85">{card.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans text-2xl font-extrabold tracking-tight text-[#191c1e]">Mentorship Philosophy</h2>
          <div className="rounded-[1.75rem] bg-[#f2f4f6] p-6">
            <RichTextContent value={cleanBio(profile.bio)} className="text-sm leading-8 text-[#454652]" />
          </div>
          {detail.authenticity_note || detail.authenticity_proof_url ? (
            <div className="rounded-[1.4rem] bg-white p-5 shadow-[0_12px_28px_rgba(25,28,30,0.05)]">
              {detail.authenticity_note ? <RichTextContent value={detail.authenticity_note} className="text-sm leading-7 text-[#454652]" /> : null}
              {detail.authenticity_proof_url ? (
                <a href={detail.authenticity_proof_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-[#000666] underline">
                  Open proof link
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        {preparationStrategy ? (
          <section className="space-y-4">
            <h2 className="font-sans text-2xl font-extrabold tracking-tight text-[#191c1e]">Preparation Strategy</h2>
            <div className="rounded-[1.75rem] bg-white p-6 shadow-[0_12px_28px_rgba(25,28,30,0.05)]">
              <p className="whitespace-pre-wrap text-sm leading-8 text-[#454652]">{preparationStrategy}</p>
            </div>
          </section>
        ) : null}

        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-sans text-2xl font-extrabold tracking-tight text-[#191c1e]">What mentees say</h2>
            <span className="text-sm font-bold text-[#000666]">{detail.review_summary.total_reviews} reviews</span>
          </div>
          {detail.recent_reviews.length > 0 ? (
            <div className="space-y-4">
              {detail.recent_reviews.slice(0, 3).map((review) => <ReviewCard key={review.id} review={review} />)}
            </div>
          ) : (
            <div className="rounded-[1.5rem] bg-white p-5 text-sm text-[#454652] shadow-[0_12px_28px_rgba(25,28,30,0.05)]">No public reviews yet.</div>
          )}
        </section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <section className="rounded-[1.8rem] bg-white p-6 shadow-[0_20px_48px_rgba(25,28,30,0.08)]">
          <h2 className="font-sans text-2xl font-extrabold tracking-tight text-[#191c1e]">Mentorship Details</h2>
          
          <div className="mt-6 flex items-center justify-between border-b border-[#edf1f4] pb-4">
            <p className="text-sm font-semibold text-[#454652]">Mentorship Only</p>
            <span className="rounded-full bg-[#f2f4f6] px-3 py-1 text-xs font-bold uppercase text-[#000666]">
              {mentorshipPriceLabel}
            </span>
          </div>

          <div className="mt-4 flex items-center justify-between border-b border-[#edf1f4] pb-5">
            <div className="flex flex-col">
              <p className="text-sm font-semibold text-[#454652] opacity-50 data-[active=true]:opacity-100" data-active={detail.copy_evaluation_enabled}>Copy Evaluation</p>
            </div>
            <span className="rounded-full bg-[#f2f4f6] px-3 py-1 text-xs font-bold uppercase text-[#000666] opacity-50 data-[active=true]:opacity-100" data-active={detail.copy_evaluation_enabled}>
              {detail.copy_evaluation_enabled ? reviewBundlePriceLabel : "Unavailable"}
            </span>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                if (!isAuthenticated) return showLoginModal();
                if (requestBlockedReason) return toast.error(requestBlockedReason);
                setIsModalOpen(true);
              }}
              disabled={ownProfile || Boolean(requestBlockedReason)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#000666] to-[#1a237e] px-5 py-4 text-sm font-bold text-white shadow-[0_16px_28px_rgba(0,6,102,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Contact Mentor
            </button>

            <button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-[#191c1e] bg-[#f2f4f6] hover:bg-[#edf1f4] transition">
              <BookOpenCheck className="h-4 w-4" />
              Save Mentor
            </button>
          </div>

          {requestBlockedReason ? <p className="mt-4 font-semibold text-[#c98c00] text-sm">{requestBlockedReason}</p> : null}
          
          {existingActiveRequest ? (
            <Link href={`/my-purchases/mentorship/${existingActiveRequest.id}`} className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-[#c9d3ff] bg-white px-3 py-3 text-sm font-bold text-[#000666]">
              Open existing chat
            </Link>
          ) : null}

          {ownProfile ? <p className="mt-4 text-sm text-[#767683]">You cannot request your own profile.</p> : null}
          <p className="mt-4 text-[11px] leading-5 text-[#767683]">
            You won&apos;t be charged yet. First, introduce yourself and confirm fit. Once accepted, you can securely book your slot.
          </p>
        </section>
      </aside>

      <MentorshipRequestModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        mentorId={userId}
        mentorName={profile.display_name}
        copyEvaluationEnabled={detail.copy_evaluation_enabled}
        mentorshipPriceLabel={mentorshipPriceLabel}
        reviewBundlePriceLabel={reviewBundlePriceLabel}
        seriesId={seriesId}
      />
    </div>
  );
}
