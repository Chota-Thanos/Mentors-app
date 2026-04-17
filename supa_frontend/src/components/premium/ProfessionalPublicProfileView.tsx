"use client";

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
  CalendarDays,
  ArrowRight,
} from "lucide-react";

import RichTextContent from "@/components/ui/RichTextContent";
import MentorshipRequestModal from "./MentorshipRequestModal";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { premiumApi } from "@/lib/premiumApi";
import { createClient } from "@/lib/supabase/client";
import type {
  MentorshipRequest,
  ProfessionalProfileReview,
  ProfessionalPublicProfileDetail,
  TestSeries,
} from "@/types/premium";

function toError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return "Unknown error";
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
    <article className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#173aa9]/5 text-sm font-black text-[#173aa9]">
            {initialsFromLabel(review.reviewer_label)}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">{review.reviewer_label}</p>
            <p className="text-xs font-medium text-slate-500">{formatReviewDate(review.created_at)}</p>
          </div>
        </div>
        <RatingStars rating={review.rating} />
      </div>
      {review.title ? <p className="mt-4 text-sm font-semibold text-slate-900">{review.title}</p> : null}
      {review.comment ? <RichTextContent value={review.comment} className="mt-3 text-sm leading-7 text-slate-600" /> : null}
    </article>
  );
}

function ProgramCard({ series }: { series: TestSeries }) {
  const isMains = series.series_kind === "mains";
  const priceLabel = series.access_type === "paid" ? `\u20B9${series.price.toLocaleString()}` : "Free";
  
  return (
    <Link href={`/programs/${series.id}`} className="block group">
      <article className="h-full rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-[#173aa9] hover:shadow-md">
        <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-slate-100 mb-4">
          {series.cover_image_url ? (
            <Image
              src={series.cover_image_url}
              alt={series.title}
              fill
              unoptimized
              className="object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4 text-center">
               <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                 {series.series_kind} Program
               </span>
            </div>
          )}
          <div className="absolute top-3 left-3">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              series.access_type === "paid" ? 'bg-white text-[#173aa9]' : 'bg-[#eaf8f4] text-[#176a5c]'
            }`}>
              {priceLabel}
            </span>
          </div>
        </div>
        
        <h3 className="font-sans text-lg font-bold text-slate-900 line-clamp-1 group-hover:text-[#173aa9]">
          {series.title}
        </h3>
        
        <div className="mt-3 flex items-center justify-between">
           <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
             <Layers3 className="h-3.5 w-3.5" />
             {series.test_count || 0} Tests
           </div>
           <div className="flex items-center gap-1 text-[#c98c00] text-xs font-bold">
             <Star className="h-3 w-3 fill-current" />
             New
           </div>
        </div>
      </article>
    </Link>
  );
}

export default function ProfessionalPublicProfileView({
  userId,
  seriesId,
}: {
  userId: string;
  seriesId?: number | null;
}) {
  const { isAuthenticated, showLoginModal } = useAuth();
  const { profileId } = useProfile();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ProfessionalPublicProfileDetail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [existingActiveRequest, setExistingActiveRequest] = useState<MentorshipRequest | null>(null);
  
  const ownProfile = useMemo(() => {
    if (!isAuthenticated || !profileId || !detail) return false;
    return String(profileId) === detail.profile.user_id;
  }, [isAuthenticated, profileId, detail]);

  useEffect(() => {
    let active = true;
    const fetchProfile = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: detail } = await premiumApi.get<ProfessionalPublicProfileDetail>(`/profiles/${userId}/detail`, {
          params: { reviews_limit: 12 },
        });

        let activeRequest: MentorshipRequest | null = null;
        if (isAuthenticated && profileId) {
          const { data: requestData } = await supabase
            .from("mentorship_requests")
            .select("*")
            .eq("user_id", profileId)
            .eq("mentor_id", detail.profile.id)
            .in("status", ["requested", "scheduled"])
            .maybeSingle();
          activeRequest = requestData as MentorshipRequest;
        }
        if (active) {
          setDetail(detail);
          setExistingActiveRequest(activeRequest);
        }
      } catch (error: unknown) {
        if (!active) return;
        setDetail(null);
        toast.error("Failed to load mentor profile", { description: toError(error) });
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchProfile();
    return () => { active = false; };
  }, [isAuthenticated, profileId, userId]);

  
  // Check for active requests
  // Check for active requests and subscribe to updates
  useEffect(() => {
    if (!isAuthenticated || !profileId || !detail || ownProfile) return;
    
    const supabase = createClient();
    
    const checkRequests = async () => {
      const { data } = await supabase
        .from("mentorship_requests")
        .select("*")
        .eq("user_id", profileId)
        .eq("mentor_id", detail.profile.id)
        .in("status", ["requested", "accepted", "scheduled"])
        .order("requested_at", { ascending: false })
        .limit(1);
        
      if (data?.[0]) setExistingActiveRequest(data[0] as any);
    };
    
    checkRequests();

    const channel = supabase
      .channel(`mentorship-updates-${profileId}-${detail.profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mentorship_requests",
          filter: `user_id=eq.${profileId}`,
        },
        (payload) => {
          const updatedRequest = payload.new as MentorshipRequest;
          if (updatedRequest && updatedRequest.mentor_id === detail.profile.id) {
            if (["requested", "accepted", "scheduled"].includes(updatedRequest.status)) {
              setExistingActiveRequest(updatedRequest);
            } else {
              setExistingActiveRequest(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAuthenticated, profileId, detail, ownProfile]);

  const mentorshipPriceLabel = `${detail?.currency || "INR"} ${Number(detail?.mentorship_price || 0).toLocaleString()}`;
  const reviewBundlePriceLabel = `${detail?.currency || "INR"} ${Number(detail?.copy_evaluation_price || 0).toLocaleString()}`;

  const requestBlockedReason = useMemo(() => {
    if (!detail) return "Profile is unavailable.";
    if (existingActiveRequest) return "You already have an active request with this mentor.";
    return null;
  }, [detail, existingActiveRequest]);

  if (loading) {
    return (
      <div className="flex flex-col gap-8 animate-pulse">
        <div className="h-64 rounded-[32px] bg-slate-100" />
        <div className="grid gap-6 md:grid-cols-3">
           <div className="h-32 rounded-3xl bg-slate-100" />
           <div className="h-32 rounded-3xl bg-slate-100" />
           <div className="h-32 rounded-3xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-[32px] border border-slate-200 bg-white p-12 text-center shadow-sm">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Mentor not found</h1>
        <p className="mt-2 text-slate-600">This profile might be private or doesn't exist.</p>
        <Link href="/mentors/discover" className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-[#173aa9] px-6 text-sm font-bold text-white shadow-lg">
          Back to Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-12">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-[40px] border border-slate-100 bg-white p-6 shadow-sm md:p-10">
          <div className="flex flex-col gap-8 md:flex-row md:items-start">
            <div className="relative h-40 w-40 flex-shrink-0 overflow-hidden rounded-[32px] bg-slate-50 shadow-md md:h-52 md:w-52">
              {detail.profile.profile_image_url ? (
                <Image
                  src={detail.profile.profile_image_url}
                  alt={detail.profile.display_name}
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#173aa9]/10 to-[#8df5e4]/10 text-6xl font-black text-[#173aa9]">
                  {initialsFromLabel(detail.profile.display_name)}
                </div>
              )}
            </div>

            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap gap-2">
                 <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {detail.role_label}
                 </span>
                 {detail.profile.is_verified && (
                   <span className="flex items-center gap-1 inline-flex rounded-full bg-[#eaf8f4] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#176a5c]">
                      <Check className="h-3 w-3" /> Verified
                   </span>
                 )}
              </div>

              <div>
                <h1 className="text-4xl font-black tracking-tight text-slate-900">{detail.profile.display_name}</h1>
                <p className="mt-2 text-xl font-medium text-slate-600">{detail.profile.headline || "Professional Mentor"}</p>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                 <div className="flex items-center gap-2">
                    <RatingStars rating={detail.review_summary.average_rating} />
                    <span className="text-sm font-bold text-slate-900">{detail.review_summary.average_rating.toFixed(1)}</span>
                    <span className="text-sm font-medium text-slate-400">({detail.review_summary.total_reviews} reviews)</span>
                 </div>
                 <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                    <Clock3 className="h-4 w-4 text-[#173aa9]" />
                    {detail.response_time_text}
                 </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {detail.profile.specialization_tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-slate-100 bg-slate-50/50 px-4 py-1.5 text-xs font-semibold text-slate-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* bio & Stats */}
        <section className="grid gap-6 md:grid-cols-3">
           <div className="md:col-span-2 space-y-4">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">About Mentor</h2>
              <div className="rounded-[32px] bg-slate-50/50 p-8">
                 <RichTextContent value={cleanBio(detail.profile.bio)} className="text-sm leading-8 text-slate-600" />
              </div>
           </div>
           
           <div className="space-y-4">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">Experience</h2>
              <div className="space-y-3">
                 <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Preparation</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{detail.profile.years_experience || 0}+ years guiding students</p>
                 </div>
                 <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Focus Areas</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">{detail.exam_focus}</p>
                 </div>
              </div>
           </div>
        </section>

        {/* Programs Section */}
        {detail.provided_series.length > 0 && (
          <section className="space-y-6">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-3xl font-black tracking-tight text-slate-900">My Programs</h2>
                <p className="mt-1 text-slate-500 font-medium text-sm">Targeted courses and test series created by {detail.profile.display_name}.</p>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {detail.provided_series.map((series) => (
                <ProgramCard key={series.id} series={series} />
              ))}
            </div>
          </section>
        )}

        {/* Reviews Section */}
        <section className="space-y-8">
           <div className="flex items-center justify-between">
              <h2 className="text-3xl font-black tracking-tight text-slate-900">Mentee Feedback</h2>
              <div className="flex items-center gap-2">
                 <span className="text-sm font-bold text-slate-400">{detail.review_summary.total_reviews} reviews collected</span>
              </div>
           </div>

           {detail.recent_reviews.length > 0 ? (
             <div className="grid gap-6 md:grid-cols-2">
                {detail.recent_reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
             </div>
           ) : (
             <div className="rounded-[32px] border border-dashed border-slate-200 bg-slate-50/30 p-12 text-center">
                <p className="text-sm font-medium text-slate-400">No public reviews for this mentor yet.</p>
             </div>
           )}
        </section>
      </div>

      {/* Sidebar - Mentorship Booking */}
      <aside className="lg:sticky lg:top-24 lg:self-start space-y-6">
        <section className="rounded-[32px] border border-slate-100 bg-white p-8 shadow-xl shadow-slate-200/50">
           <h2 className="text-2xl font-black tracking-tight text-slate-900">Direct Services</h2>
           <p className="mt-2 text-sm font-medium text-slate-500">Book standalone services and mentorship sessions.</p>

           <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                 <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-900">Mentorship Call</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">30-45 Minute Session</p>
                 </div>
                 <span className="text-sm font-black text-[#173aa9]">{mentorshipPriceLabel}</span>
              </div>

              {detail.copy_evaluation_enabled && (
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                  <div className="space-y-0.5">
                      <p className="text-sm font-bold text-slate-900">Copy Evaluation</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deep Review + Call</p>
                  </div>
                  <span className="text-sm font-black text-[#173aa9]">{reviewBundlePriceLabel}</span>
                </div>
              )}
           </div>

           <div className="mt-8 space-y-3">
              <button
                type="button"
                onClick={() => {
                  if (!isAuthenticated) return showLoginModal();
                  if (requestBlockedReason) return toast.error(requestBlockedReason);
                  setIsModalOpen(true);
                }}
                disabled={ownProfile || (!!requestBlockedReason && !existingActiveRequest)}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-slate-900 px-6 py-4 text-sm font-bold text-white transition-all hover:bg-[#173aa9] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="relative z-10">Contact Mentor</span>
                <ArrowRight className="h-4 w-4 relative z-10 transition-transform group-hover:translate-x-1" />
              </button>

              {existingActiveRequest && (
                <Link href={`/my-purchases/mentorship/${existingActiveRequest.id}`} className="flex w-full items-center justify-center rounded-2xl border-2 border-slate-100 bg-white px-6 py-3.5 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-50">
                   Continue Active Discussion
                </Link>
              )}
           </div>

           <p className="mt-6 text-[10px] font-medium leading-5 text-slate-400 italic">
              * Sending a request starts a private chat to discuss your requirements. No immediate payment required.
           </p>
        </section>

        {/* Stats card */}
        <section className="rounded-[32px] bg-gradient-to-br from-[#173aa9] to-[#1a237e] p-8 text-white">
           <Trophy className="h-8 w-8 text-[#8df5e4] mb-4" />
           <h3 className="text-xl font-black tracking-tight">Verified Expert</h3>
           <p className="mt-2 text-sm font-medium text-[#bdc2ff]">This mentor has undergone a verification process to ensure quality and authenticity of their credentials.</p>
           
           <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-2 gap-4">
              <div>
                 <p className="text-[10px] font-bold uppercase tracking-widest text-[#bdc2ff]">Mentorship</p>
                 <p className="mt-1 text-lg font-black">{detail.sessions_completed || "New"} <span className="text-xs font-normal opacity-70">sessions</span></p>
              </div>
              <div>
                 <p className="text-[10px] font-bold uppercase tracking-widest text-[#bdc2ff]">Programs</p>
                 <p className="mt-1 text-lg font-black">{detail.provided_series.length} <span className="text-xs font-normal opacity-70">created</span></p>
              </div>
           </div>
        </section>
      </aside>

      <MentorshipRequestModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        mentorId={detail.profile.id.toString()}
        mentorName={detail.profile.display_name}
        copyEvaluationEnabled={detail.copy_evaluation_enabled}
        mentorshipPriceLabel={mentorshipPriceLabel}
        reviewBundlePriceLabel={reviewBundlePriceLabel}
        seriesId={seriesId}
      />
    </div>
  );
}
