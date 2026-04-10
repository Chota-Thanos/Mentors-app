"use client";

import axios from "axios";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  MessageSquareQuote,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useExamContext } from "@/context/ExamContext";
import { premiumApi } from "@/lib/premiumApi";
import type { ProfessionalProfile } from "@/types/premium";

function toErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function initialsFromLabel(label: string): string {
  const tokens = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return "MM";
  return tokens.map((token) => token.charAt(0).toUpperCase()).join("");
}

function snippet(value?: string | null, fallback = "Verified mentor for structured mains guidance and request-led sessions."): string {
  const clean = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

function priceLabel(profile: ProfessionalProfile): string | null {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const amount = Number(meta.mentorship_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = String(meta.currency || "INR").trim().toUpperCase() || "INR";
  return `${currency} ${amount.toLocaleString()}`;
}

function reviewMeta(profile: ProfessionalProfile): { average: number; total: number } {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const reviewSummary = (meta.review_summary || {}) as Record<string, unknown>;
  const average = Number(reviewSummary.average_rating || 0);
  const total = Number(reviewSummary.total_reviews || 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function copyEvaluationEnabled(profile: ProfessionalProfile): boolean {
  return Boolean((profile.meta || {})?.copy_evaluation_enabled);
}

function matchesExamIds(examIds: number[] | undefined | null, examId: number | null): boolean {
  if (!examId) return true;
  return Array.isArray(examIds) && examIds.includes(examId);
}

function FeaturedMentorCard({ mentor }: { mentor: ProfessionalProfile }) {
  const review = reviewMeta(mentor);
  const badge = mentor.credentials[0] || mentor.highlights[0] || mentor.specialization_tags[0] || "Verified Mentor";

  return (
    <article className="group rounded-[30px] border border-[#dbe3f6] bg-white p-5 shadow-[0_18px_40px_rgba(16,31,74,0.06)] transition-transform duration-300 hover:-translate-y-1">
      <div className="relative overflow-hidden rounded-[24px] bg-[#edf2ff]">
        {mentor.profile_image_url ? (
          <Image
            src={mentor.profile_image_url}
            alt={mentor.display_name}
            width={520}
            height={420}
            unoptimized
            className="h-64 w-full object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-64 w-full items-center justify-center bg-[linear-gradient(135deg,#edf2ff_0%,#f9fbff_56%,#eaf8f4_100%)] font-sans text-4xl font-semibold tracking-[-0.05em] text-[#1235ae]">
            {initialsFromLabel(mentor.display_name)}
          </div>
        )}
        <div className="absolute right-4 top-4 rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#17328f]">
          {badge}
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-sans text-[30px] font-semibold leading-none tracking-[-0.05em] text-[#141b2d]">{mentor.display_name}</h3>
          <p className="mt-2 text-[14px] font-medium text-[#17328f]">{mentor.headline || "Mains Mentor"}</p>
        </div>
        {review.total > 0 ? (
          <div className="inline-flex items-center gap-1 rounded-full border border-[#f0ddb1] bg-[#fff3d8] px-3 py-1 text-xs font-semibold text-[#80520d]">
            <Star className="h-3.5 w-3.5 fill-current" />
            {review.average.toFixed(1)}
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-[14px] leading-7 text-[#5f6883]">{snippet(mentor.bio)}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {mentor.specialization_tags.slice(0, 2).map((tag) => (
          <span key={`${mentor.user_id}-${tag}`} className="rounded-full border border-[#c9eee6] bg-[#eaf8f4] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#176a5c]">
            {tag}
          </span>
        ))}
        {copyEvaluationEnabled(mentor) ? (
          <span className="rounded-full border border-[#dbe3f6] bg-[#f6f8ff] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5e6885]">
            Copy Evaluation
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-[#6d7690]">
          {priceLabel(mentor) ? `Starts ${priceLabel(mentor)}` : "Request first, pay after acceptance"}
        </p>
        <Link
          href={`/profiles/${mentor.user_id}`}
          className="inline-flex items-center gap-2 rounded-full bg-[#173aa9] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.2)] transition hover:bg-[#15328f]"
        >
          View Profile
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

export default function MentorshipLandingView() {
  const { globalExamId, globalExamName } = useExamContext();
  const [mentors, setMentors] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    premiumApi
      .get<ProfessionalProfile[]>("/mentors/public", {
        params: { only_verified: true, limit: 6, exam_id: globalExamId || undefined },
      })
      .then((response) => {
        if (!active) return;
        const rows = Array.isArray(response.data) ? response.data : [];
        setMentors(rows.filter((row) => matchesExamIds(row.exam_ids, globalExamId)));
        setError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMentors([]);
        setError(toErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [globalExamId]);

  const heroMentor = mentors[0] || null;
  const featuredMentors = useMemo(() => mentors.slice(0, 3), [mentors]);

  return (
    <main className="bg-[#f6f8ff] text-[#192133]">
      <section className="relative overflow-hidden">
        <div className="absolute -right-8 top-8 h-64 w-64 rounded-full bg-[#d9e4ff]/70 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[#d7f5ef]/60 blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.02fr)_420px] lg:px-8 lg:py-20">
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#cbd8fb] bg-white/85 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#304a92]">
              <ShieldCheck className="h-4 w-4" />
              Verified Mentor Network
            </div>
            <h1 className="mt-6 max-w-xl font-sans text-[42px] font-semibold leading-[0.94] tracking-[-0.07em] text-[#1235ae] sm:text-[58px] lg:text-[68px]">
              Elevate your prep with structured mentorship.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-8 text-[#6d7690] sm:text-[16px]">
              Discover verified mains mentors, send a request with your problem statement, chat first, then pay only after acceptance.
            </p>
            {globalExamName ? (
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5f7aa9]">Exam scope: {globalExamName}</p>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/mentors"
                className="inline-flex items-center gap-2 rounded-full bg-[#173aa9] px-6 py-3 text-[13px] font-semibold text-white shadow-[0_15px_28px_rgba(23,58,169,0.24)] transition hover:bg-[#15328f]"
              >
                Find a Mentor
              </Link>
              <Link
                href="/my-purchases"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[13px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)]"
              >
                Open Requests
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Request-led", value: "Chat before payment" },
                { label: "Two paths", value: "Mentorship or copy review" },
                { label: "Final step", value: "Book slot after approval" },
              ].map((item) => (
                <div key={item.label} className="rounded-[24px] border border-[#dbe3f6] bg-white/90 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)] backdrop-blur">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-[#1d2945]">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 lg:justify-self-end">
            <div className="rounded-[32px] border border-[#dbe3f6] bg-white/92 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="rounded-[26px] bg-[linear-gradient(135deg,#173aa9_0%,#264bb9_62%,#2f57cc_100%)] p-4 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#dbe5ff]">Featured Mentor</p>
                <div className="mt-4 overflow-hidden rounded-[22px] bg-[#17328f]">
                  {heroMentor?.profile_image_url ? (
                    <Image
                      src={heroMentor.profile_image_url}
                      alt={heroMentor.display_name}
                      width={520}
                      height={640}
                      unoptimized
                      className="h-[320px] w-full object-cover opacity-95"
                    />
                  ) : (
                    <div className="flex h-[320px] w-full items-center justify-center bg-[linear-gradient(135deg,#224d39_0%,#284d3f_36%,#315948_100%)] font-sans text-5xl font-semibold tracking-[-0.05em]">
                      {initialsFromLabel(heroMentor?.display_name || "Mentor")}
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-[20px] bg-white/10 p-4">
                  <p className="font-sans text-[26px] font-semibold leading-none tracking-[-0.05em]">
                    {heroMentor?.display_name || "Verified Mentor"}
                  </p>
                  <p className="mt-2 text-[13px] leading-6 text-[#e3e9ff]">
                    {heroMentor?.headline || "One-to-one strategy and copy review"}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[24px] bg-[linear-gradient(180deg,#f8faff_0%,#f2f6ff_100%)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Flow</p>
                <div className="mt-3 space-y-2 text-[14px] font-semibold text-[#1d2945]">
                  <div className="flex items-center gap-2"><Search className="h-4 w-4 text-[#173aa9]" /> Discover mentor</div>
                  <div className="flex items-center gap-2"><MessageSquareQuote className="h-4 w-4 text-[#173aa9]" /> Request and chat</div>
                  <div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-[#173aa9]" /> Mentor accepts</div>
                  <div className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-[#173aa9]" /> Pay and book slot</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Featured Mentors</p>
              <h2 className="mt-2 font-sans text-[36px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#141b2d]">
                Mentors with proof, reviews, and clear service paths.
              </h2>
            </div>
            <Link href="/mentors" className="hidden items-center gap-2 text-[13px] font-semibold text-[#17328f] md:inline-flex">
              Browse all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? <div className="mt-8 rounded-[28px] border border-[#dbe3f6] bg-white p-6 text-sm text-[#5f6883]">Loading mentors...</div> : null}
          {!loading && error ? <div className="mt-8 rounded-[28px] border border-rose-200 bg-white p-6 text-sm text-[#ba1a1a]">{error}</div> : null}

          {!loading && !error ? (
            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              {featuredMentors.length > 0 ? featuredMentors.map((mentor) => <FeaturedMentorCard key={mentor.user_id} mentor={mentor} />) : (
                <div className="rounded-[28px] border border-[#dbe3f6] bg-white p-6 text-sm text-[#5f6883]">No mentors are public yet.</div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6d7690]">Choose Your Path</p>
            <h2 className="mt-2 font-sans text-[36px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#141b2d]">
              Mentorship only or evaluation plus mentorship.
            </h2>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded-[32px] bg-[linear-gradient(135deg,#173bad_0%,#274bb9_65%,#2f57cc_100%)] p-8 text-white shadow-[0_18px_42px_rgba(23,58,169,0.18)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#dbe5ff]">Path One</p>
              <h3 className="mt-4 font-sans text-[36px] font-semibold leading-[0.98] tracking-[-0.05em]">Mentorship Only</h3>
              <p className="mt-4 max-w-lg text-[14px] leading-7 text-[#dfe6ff]">Request guidance, clarify your problem in chat, then lock the session after mentor acceptance.</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {["Problem review", "Strategy session", "Chat support"].map((item) => (
                  <div key={item} className="rounded-[20px] bg-white/10 px-4 py-3 text-sm font-semibold text-white">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[28px] border border-[#c9eee6] bg-[#eaf8f4] p-6 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#176a5c]">Path Two</p>
                <h3 className="mt-3 font-sans text-[30px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#143c35]">
                  Copy Evaluation + Mentorship
                </h3>
                <p className="mt-3 text-[14px] leading-7 text-[#176a5c]">Share your answer copy, get mentor feedback, then move into the follow-up session.</p>
              </div>
              <div className="rounded-[28px] border border-[#f0ddb1] bg-[#fff3d8] p-6 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#80520d]">Request Rules</p>
                <p className="mt-3 text-[14px] font-semibold leading-7 text-[#4d3000]">
                  No payment before acceptance. Chat opens after request. Slot booking happens after approval or evaluation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-[32px] bg-[linear-gradient(135deg,#173bad_0%,#274bb9_65%,#2f57cc_100%)] px-6 py-10 text-center text-white shadow-[0_20px_48px_rgba(23,58,169,0.2)] sm:px-10">
            <Sparkles className="mx-auto h-6 w-6 text-[#dff1ff]" />
            <h2 className="mt-4 font-sans text-[38px] font-semibold leading-[1.02] tracking-[-0.05em]">
              Ready to move from confusion to a clear mentor workflow?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-[14px] leading-7 text-[#dfe6ff]">Start with discovery. Send a request only when the fit is right.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/mentors" className="rounded-full bg-white px-6 py-3 text-[13px] font-semibold text-[#17328f]">
                Start Exploring
              </Link>
              <Link href="/dashboard" className="rounded-full bg-white/10 px-6 py-3 text-[13px] font-semibold text-white">
                Open Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
